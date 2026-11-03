import {
  extractImageReferences,
  loadImageAttachments,
  readImageDimensions,
  resolveImageUrl,
  sniffImageMediaType,
} from './image-attachments';

// Every host resolves to a public address unless listed here, so no test
// depends on real DNS.
const RESOLVED: Record<string, string[]> = {
  'internal.example.com': ['93.184.216.34', '10.0.0.5'],
};
// The default download fetch, replaced so tests make no connections. It is
// created when the module loads, so the stand-in delegates to `defaultFetch`.
const defaultFetch: { impl: typeof fetch | null; lookups: unknown[] } = {
  impl: null,
  lookups: [],
};
vi.mock('./public-fetch', () => ({
  createPublicFetch:
    (lookupHost?: unknown) =>
    (...args: Parameters<typeof fetch>) => {
      defaultFetch.lookups.push(lookupHost);
      return defaultFetch.impl!(...args);
    },
}));
vi.mock('node:dns/promises', () => ({
  lookup: async (hostname: string) =>
    (RESOLVED[hostname] ?? ['93.184.216.34']).map((address) => ({
      address,
      family: address.includes(':') ? 6 : 4,
    })),
}));

const BASE_URL = 'https://board.example.com/notice/list?page=1';

function bytes(head: number[], size = 8_192): Uint8Array {
  const out = new Uint8Array(Math.max(size, head.length));
  out.set(head);
  return out;
}

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const u16be = (n: number) => [(n >> 8) & 0xff, n & 0xff];
const u16le = (n: number) => [n & 0xff, (n >> 8) & 0xff];
const u24le = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff];
const u32be = (n: number) => [
  (n >>> 24) & 0xff,
  (n >> 16) & 0xff,
  (n >> 8) & 0xff,
  n & 0xff,
];
const u32le = (n: number) => [
  n & 0xff,
  (n >> 8) & 0xff,
  (n >> 16) & 0xff,
  (n >>> 24) & 0xff,
];

const png = (width: number, height: number, size?: number) =>
  bytes(
    [
      ...[0x89, ...ascii('PNG\r\n\x1a\n')],
      ...u32be(13),
      ...ascii('IHDR'),
      ...u32be(width),
      ...u32be(height),
    ],
    size,
  );

const gif = (width: number, height: number) =>
  bytes([...ascii('GIF89a'), ...u16le(width), ...u16le(height)]);

const webp = (chunk: string, payload: number[]) =>
  bytes([
    ...ascii('RIFF'),
    ...u32le(0),
    ...ascii('WEBP'),
    ...ascii(chunk),
    ...payload,
  ]);

// SOI, APP0, DHT (skipped: not a frame), SOF0
const jpeg = (width: number, height: number) =>
  bytes([
    0xff,
    0xd8,
    ...[0xff, 0xe0, ...u16be(16), ...new Array(14).fill(0)],
    ...[0xff, 0xc4, ...u16be(4), 0, 0],
    ...[0xff, 0xc0, ...u16be(17), 8, ...u16be(height), ...u16be(width)],
  ]);

const imageResponse = (body: Uint8Array, headers: HeadersInit = {}) =>
  new Response(body as BodyInit, { status: 200, headers });

function makeLogger() {
  return { debug: vi.fn(), info: vi.fn(), error: vi.fn() };
}

describe('extractImageReferences', () => {
  test('returns trimmed references in document order and skips empty ones', () => {
    const markdown = [
      'text',
      '![a]( https://a.com/1.png )',
      '![]()',
      '![b](/2.jpg "title")',
      '![c](   )',
    ].join('\n');

    expect(extractImageReferences(markdown)).toEqual([
      'https://a.com/1.png',
      '/2.jpg "title"',
    ]);
  });
});

describe('resolveImageUrl', () => {
  test.each([
    ['https://a.com/1.png', 'https://a.com/1.png'],
    ['http://a.com/1.png', 'http://a.com/1.png'],
    ['https://a.com/1.png "Title"', 'https://a.com/1.png'],
    [
      'http://www.khs.go.kr/getImageFile.do?seId=1 “홍보물”',
      'http://www.khs.go.kr/getImageFile.do?seId=1',
    ],
    ['<https://a.com/1.png>', 'https://a.com/1.png'],
    ['//cdn.example.com/1.png', 'https://cdn.example.com/1.png'],
    ['/upload/1.jpg', 'https://board.example.com/upload/1.jpg'],
    ['../uploads/1.jpg', 'https://board.example.com/uploads/1.jpg'],
    ['data/file/1.jpg', 'https://board.example.com/notice/data/file/1.jpg'],
    ['data:image/png;base64,AAAA', 'data:image/png;base64,AAAA'],
  ])('%s → %s', (reference, expected) => {
    expect(resolveImageUrl(reference, BASE_URL)).toBe(expected);
  });

  test.each([
    'blob:https://board.example.com/6753bdfc',
    'ftp://a.com/1.png',
    'mailto:x@y.com',
    'http://',
  ])('drops %s', (reference) => {
    expect(resolveImageUrl(reference, BASE_URL)).toBeNull();
  });

  test('drops relative references when the base URL is invalid', () => {
    expect(resolveImageUrl('/1.png', 'not a url')).toBeNull();
  });
});

describe('sniffImageMediaType', () => {
  test.each([
    [jpeg(10, 10), 'image/jpeg'],
    [png(10, 10), 'image/png'],
    [gif(10, 10), 'image/gif'],
    [webp('VP8X', []), 'image/webp'],
  ])('detects %#', (input, expected) => {
    expect(sniffImageMediaType(input)).toBe(expected);
  });

  test('rejects HTML and other content', () => {
    expect(sniffImageMediaType(bytes(ascii('<!DOCTYPE html>')))).toBeNull();
    expect(
      sniffImageMediaType(
        bytes([...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WAVE')]),
      ),
    ).toBeNull();
  });
});

describe('readImageDimensions', () => {
  test('reads PNG, GIF and JPEG headers', () => {
    expect(readImageDimensions(png(640, 480), 'image/png')).toEqual({
      width: 640,
      height: 480,
    });
    expect(readImageDimensions(gif(300, 200), 'image/gif')).toEqual({
      width: 300,
      height: 200,
    });
    expect(readImageDimensions(jpeg(858, 572), 'image/jpeg')).toEqual({
      width: 858,
      height: 572,
    });
  });

  test('reads all WebP variants', () => {
    expect(
      readImageDimensions(
        webp('VP8X', [...u32le(10), 0, 0, 0, 0, ...u24le(1199), ...u24le(799)]),
        'image/webp',
      ),
    ).toEqual({ width: 1200, height: 800 });

    expect(
      readImageDimensions(
        webp('VP8 ', [
          ...u32le(10),
          0,
          0,
          0,
          0x9d,
          0x01,
          0x2a,
          ...u16le(320),
          ...u16le(240),
        ]),
        'image/webp',
      ),
    ).toEqual({ width: 320, height: 240 });

    expect(
      readImageDimensions(
        webp('VP8L', [...u32le(10), 0x2f, ...u32le(99 | (49 << 14))]),
        'image/webp',
      ),
    ).toEqual({ width: 100, height: 50 });

    expect(readImageDimensions(webp('ALPH', []), 'image/webp')).toBeNull();
  });

  test('returns null when a JPEG has no readable frame header', () => {
    // Segment without a marker byte
    expect(
      readImageDimensions(bytes([0xff, 0xd8, 0x00, 0x00], 16), 'image/jpeg'),
    ).toBeNull();
    // Segments run past the end of the data
    expect(
      readImageDimensions(
        new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x02, 0, 0, 0, 0, 0]),
        'image/jpeg',
      ),
    ).toBeNull();
  });

  test('returns null for a truncated header', () => {
    expect(
      readImageDimensions(png(1, 1).subarray(0, 12), 'image/png'),
    ).toBeNull();
  });
});

describe('loadImageAttachments', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  test('downloads images with browser headers and the board as Referer', async () => {
    const customFetch = vi.fn(async () => imageResponse(jpeg(800, 600)));

    const result = await loadImageAttachments({
      references: ['/upload/a.jpg "사진"'],
      baseUrl: BASE_URL,
      customFetch: customFetch as any,
      logger: makeLogger(),
    });

    expect(result).toEqual([
      { data: expect.any(Uint8Array), mediaType: 'image/jpeg' },
    ]);
    expect(result[0].data.byteLength).toBe(8_192);

    const [url, init] = (customFetch.mock.calls as any[])[0];
    expect(url).toBe('https://board.example.com/upload/a.jpg');
    // Redirects are followed by the loader, which checks each destination.
    expect(init.redirect).toBe('manual');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.headers.Referer).toBe(BASE_URL);
    expect(init.headers['User-Agent']).toMatch(/^Mozilla\/5\.0/);
    expect(init.headers.Accept).toContain('image/');
  });

  test('omits Referer when the base URL is not a valid URL', async () => {
    const customFetch = vi.fn(async () => imageResponse(png(10, 10)));

    await loadImageAttachments({
      references: ['https://a.com/1.png'],
      baseUrl: undefined as unknown as string,
      customFetch: customFetch as any,
      logger: makeLogger(),
    });

    const [, init] = (customFetch.mock.calls as any[])[0];
    expect(init.headers).not.toHaveProperty('Referer');
  });

  test('downloads through the connect-time checked fetch by default', async () => {
    const send = vi.fn(async () => imageResponse(png(10, 10)));
    defaultFetch.impl = send as any;
    defaultFetch.lookups = [];
    const lookupHost = async () => ['93.184.216.34'];

    expect(
      await loadImageAttachments({
        references: ['https://a.com/1.png'],
        baseUrl: BASE_URL,
        logger: makeLogger(),
      }),
    ).toHaveLength(1);
    expect(
      await loadImageAttachments({
        references: ['https://a.com/2.png'],
        baseUrl: BASE_URL,
        logger: makeLogger(),
        lookupHost,
      }),
    ).toHaveLength(1);

    expect(send).toHaveBeenCalledTimes(2);
    // The shared instance, then one built on the given resolver
    expect(defaultFetch.lookups).toEqual([undefined, lookupHost]);
  });

  test('skips unusable images, logs why, and keeps the rest in order', async () => {
    const logger = makeLogger();
    const responses: Record<string, () => Response> = {
      'https://a.com/ok.png': () => imageResponse(png(100, 100)),
      'https://a.com/missing.png': () => new Response('', { status: 404 }),
      'https://a.com/page.html': () => imageResponse(bytes(ascii('<html>'))),
      'https://a.com/emoji.png': () => imageResponse(png(16, 16, 404)),
      'https://a.com/tall.png': () => imageResponse(png(1000, 9000)),
      'https://a.com/huge.png': () => imageResponse(png(5000, 7000)),
      'https://a.com/declared.jpg': () =>
        imageResponse(jpeg(10, 10), { 'content-length': '6000000' }),
      'https://a.com/ok.gif': () => imageResponse(gif(50, 50)),
    };
    const customFetch = vi.fn(async (url: string) => responses[url]());

    const result = await loadImageAttachments({
      references: Object.keys(responses),
      baseUrl: BASE_URL,
      customFetch: customFetch as any,
      logger,
    });

    expect(result.map((image) => image.mediaType)).toEqual([
      'image/png',
      'image/gif',
    ]);

    const reasons = logger.debug.mock.calls.map(
      ([entry]: any[]) => `${entry.data.url} ${entry.data.reason}`,
    );
    expect(logger.debug.mock.calls[0][0].event).toBe('insights.images.skip');
    expect(reasons).toEqual([
      'https://a.com/missing.png status 404',
      'https://a.com/page.html not a supported image',
      'https://a.com/emoji.png too small (404 bytes)',
      'https://a.com/tall.png dimensions exceed model limits (1000x9000)',
      'https://a.com/huge.png dimensions exceed model limits (5000x7000)',
      'https://a.com/declared.jpg too large (6000000 bytes)',
    ]);
  });

  test('cancels the body of a response it gives up on before reading', async () => {
    const cancelled: string[] = [];
    const tracked = (name: string, init: ResponseInit) =>
      new Response(
        new ReadableStream({
          pull: (controller) => controller.enqueue(new Uint8Array(1024)),
          cancel: () => {
            cancelled.push(name);
          },
        }),
        init,
      );
    const responses: Record<string, () => Response> = {
      'https://a.com/missing.png': () => tracked('404', { status: 404 }),
      'https://a.com/huge.png': () =>
        tracked('content-length', {
          status: 200,
          headers: { 'content-length': '6000000' },
        }),
    };
    const logger = makeLogger();

    await loadImageAttachments({
      references: Object.keys(responses),
      baseUrl: BASE_URL,
      customFetch: (async (url: string) => responses[url]()) as any,
      logger,
    });

    expect(cancelled.sort()).toEqual(['404', 'content-length']);
    expect(
      logger.debug.mock.calls.map(([entry]: any[]) => entry.data.reason),
    ).toEqual(['status 404', 'too large (6000000 bytes)']);
  });

  test('stops reading a body that grows past the size limit', async () => {
    const chunk = new Uint8Array(1_000_000);
    chunk.set(png(10, 10).subarray(0, 24));
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += 1;
        controller.enqueue(sent === 1 ? chunk : new Uint8Array(1_000_000));
      },
    });
    const logger = makeLogger();

    const result = await loadImageAttachments({
      references: ['https://a.com/file.hwp'],
      baseUrl: BASE_URL,
      customFetch: (async () => new Response(stream)) as any,
      logger,
    });

    expect(result).toEqual([]);
    // The stream may pull one chunk ahead of the reader
    expect(sent).toBeLessThanOrEqual(7);
    expect(logger.debug.mock.calls[0][0].data.reason).toBe(
      'too large (over 5000000 bytes)',
    );
  });

  test('reads a response without a body stream', async () => {
    const image = png(20, 20);
    const response = {
      ok: true,
      status: 200,
      headers: new Headers(),
      body: null,
      arrayBuffer: async () => image.buffer,
    };

    const result = await loadImageAttachments({
      references: ['https://a.com/1.png'],
      baseUrl: BASE_URL,
      customFetch: (async () => response) as any,
      logger: makeLogger(),
    });

    expect(result).toEqual([{ data: image, mediaType: 'image/png' }]);

    // The size limit holds without a stream too.
    const logger = makeLogger();
    const large = png(20, 20, 5_000_001);
    expect(
      await loadImageAttachments({
        references: ['https://a.com/2.png'],
        baseUrl: BASE_URL,
        customFetch: (async () => ({
          ...response,
          arrayBuffer: async () => large.buffer,
        })) as any,
        logger,
      }),
    ).toEqual([]);
    expect(logger.debug.mock.calls[0][0].data.reason).toBe(
      'too large (5000001 bytes)',
    );
  });

  test('decodes base64 data URIs and drops other data URIs', async () => {
    const encoded = Buffer.from(gif(30, 30)).toString('base64');
    const customFetch = vi.fn();
    const logger = makeLogger();

    const result = await loadImageAttachments({
      references: [
        `data:image/gif;base64,${encoded}`,
        'data:image/svg+xml;utf8,<svg/>',
      ],
      baseUrl: BASE_URL,
      customFetch,
      logger,
    });

    expect(result).toEqual([
      { data: new Uint8Array(gif(30, 30)), mediaType: 'image/gif' },
    ]);
    expect(customFetch).not.toHaveBeenCalled();
    expect(logger.debug.mock.calls[0][0].data.reason).toBe(
      'not a base64 data URI',
    );
  });

  test('drops an oversized data URI and keeps an image without readable dimensions', async () => {
    const logger = makeLogger();
    const large = Buffer.from(png(10, 10, 5_100_000)).toString('base64');
    const unknownWebp = webp('ALPH', []);

    const result = await loadImageAttachments({
      references: [
        `data:image/png;base64,${large}`,
        `data:image/webp;base64,${Buffer.from(unknownWebp).toString('base64')}`,
      ],
      baseUrl: BASE_URL,
      logger,
    });

    expect(result).toEqual([
      { data: new Uint8Array(unknownWebp), mediaType: 'image/webp' },
    ]);
    expect(logger.debug.mock.calls[0][0].data.reason).toBe(
      'too large (5100000 bytes)',
    );
  });

  test('measures data URIs before decoding them, padding included', async () => {
    const logger = makeLogger();
    // 5000002 bytes encode with "==" padding.
    const padded = Buffer.from(png(10, 10, 5_000_002)).toString('base64');
    expect(padded.endsWith('==')).toBe(true);
    // 5000003 bytes encode with a single "=".
    const single = Buffer.from(png(10, 10, 5_000_003)).toString('base64');
    expect(single.endsWith('=') && !single.endsWith('==')).toBe(true);

    await loadImageAttachments({
      references: [
        `data:image/png;base64,${padded}`,
        `data:image/png;base64,${single}`,
      ],
      baseUrl: BASE_URL,
      logger,
    });

    expect(
      logger.debug.mock.calls.map(([entry]: any[]) => entry.data.reason),
    ).toEqual(['too large (5000002 bytes)', 'too large (5000003 bytes)']);
  });

  test('stops downloading once five usable images are in hand', async () => {
    const customFetch = vi.fn(async () => imageResponse(png(10, 10)));
    const references = [
      'https://a.com/0.png',
      'https://a.com/0.png "again"',
      ...Array.from({ length: 11 }, (_, i) => `https://a.com/${i + 1}.png`),
    ];

    const result = await loadImageAttachments({
      references,
      baseUrl: BASE_URL,
      customFetch: customFetch as any,
      logger: makeLogger(),
    });

    // Deduplicated, and the candidates after the first five never requested
    expect(customFetch.mock.calls.map(([url]: any[]) => url)).toEqual(
      [0, 1, 2, 3, 4].map((i) => `https://a.com/${i}.png`),
    );
    expect(result).toHaveLength(5);
  });

  test('tries later candidates for failed ones, up to ten in all', async () => {
    const customFetch = vi.fn(async (url: string) =>
      /\/[0-3]\.png$/.test(url)
        ? new Response('', { status: 404 })
        : imageResponse(png(10, 10)),
    );
    const many = Array.from({ length: 12 }, (_, i) => `https://a.com/${i}.png`);

    const result = await loadImageAttachments({
      references: many,
      baseUrl: BASE_URL,
      customFetch: customFetch as any,
      logger: makeLogger(),
    });

    // 0-4 first, four failed, so 5-8 next, and the fifth image fills it
    expect(customFetch).toHaveBeenCalledTimes(9);
    expect(result).toHaveLength(5);

    const allFail = vi.fn(async () => new Response('', { status: 404 }));
    await loadImageAttachments({
      references: many,
      baseUrl: BASE_URL,
      customFetch: allFail as any,
      logger: makeLogger(),
    });
    expect(allFail).toHaveBeenCalledTimes(10);
  });

  test('never requests internal addresses, directly or after a redirect', async () => {
    const logger = makeLogger();
    const requested: string[] = [];
    const customFetch = vi.fn(async (url: string) => {
      requested.push(url);
      if (url === 'https://a.com/hop.png') {
        return new Response(null, {
          status: 302,
          headers: { location: 'http://169.254.169.254/latest/meta-data/' },
        });
      }
      return imageResponse(png(10, 10));
    });

    const result = await loadImageAttachments({
      references: [
        'http://169.254.169.254/latest/meta-data/',
        'http://127.0.0.1:3000/internal',
        'http://[::1]/x.png',
        'http://localhost/x.png',
        'https://internal.example.com/x.png',
        'https://a.com/hop.png',
      ],
      baseUrl: BASE_URL,
      customFetch: customFetch as any,
      logger,
    });

    expect(result).toEqual([]);
    expect(requested).toEqual(['https://a.com/hop.png']);
    expect(
      logger.debug.mock.calls.map(([entry]: any[]) => entry.data.reason),
    ).toEqual([
      'blocked address (169.254.169.254)',
      'blocked address (127.0.0.1)',
      'blocked address (::1)',
      'blocked host (localhost)',
      'blocked address (10.0.0.5)',
      'blocked address (169.254.169.254)',
    ]);
  });

  test('follows public redirects and gives up after five', async () => {
    const hops = vi.fn(async (url: string) => {
      const n = Number(/(\d+)\.png$/.exec(url)![1]);
      return n < 3
        ? new Response(null, {
            status: 301,
            headers: { location: `/${n + 1}.png` },
          })
        : imageResponse(png(10, 10));
    });

    const result = await loadImageAttachments({
      references: ['https://a.com/0.png'],
      baseUrl: BASE_URL,
      customFetch: hops as any,
      logger: makeLogger(),
    });
    expect(result).toHaveLength(1);
    expect(hops.mock.calls.map(([url]: any[]) => url)).toEqual([
      'https://a.com/0.png',
      'https://a.com/1.png',
      'https://a.com/2.png',
      'https://a.com/3.png',
    ]);

    const logger = makeLogger();
    const loop = vi.fn(
      async () =>
        new Response(null, { status: 302, headers: { location: '/again' } }),
    );
    await loadImageAttachments({
      references: ['https://a.com/start.png'],
      baseUrl: BASE_URL,
      customFetch: loop as any,
      logger,
    });
    expect(loop).toHaveBeenCalledTimes(6);
    expect(logger.debug.mock.calls[0][0].data.reason).toBe(
      'too many redirects',
    );

    // A redirect without a Location is an ordinary failed response.
    const bare = vi.fn(async () => new Response(null, { status: 302 }));
    const bareLogger = makeLogger();
    await loadImageAttachments({
      references: ['https://a.com/x.png'],
      baseUrl: BASE_URL,
      customFetch: bare as any,
      logger: bareLogger,
    });
    expect(bareLogger.debug.mock.calls[0][0].data.reason).toBe('status 302');
  });

  test('times out a download even when the fetch ignores the abort signal', async () => {
    vi.useFakeTimers();
    const logger = makeLogger();
    let signal: AbortSignal | undefined;
    const customFetch = vi.fn((_url: string, init: RequestInit) => {
      signal = init.signal as AbortSignal;
      return new Promise<Response>(() => {});
    });

    const pending = loadImageAttachments({
      references: ['https://a.com/slow.png'],
      baseUrl: BASE_URL,
      customFetch: customFetch as any,
      logger,
    });
    await vi.advanceTimersByTimeAsync(15_000);

    expect(await pending).toEqual([]);
    expect(signal?.aborted).toBe(true);
    expect(logger.debug.mock.calls[0][0].data.reason).toBe(
      'timeout after 15000ms',
    );
  });

  test('logs non-Error rejections', async () => {
    const logger = makeLogger();

    const result = await loadImageAttachments({
      references: ['https://a.com/1.png'],
      baseUrl: BASE_URL,
      customFetch: (async () => {
        throw 'blocked';
      }) as any,
      logger,
    });

    expect(result).toEqual([]);
    expect(logger.debug.mock.calls[0][0].data.reason).toBe('blocked');
  });
});
