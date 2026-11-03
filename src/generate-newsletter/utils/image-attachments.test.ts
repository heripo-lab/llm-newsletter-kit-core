import {
  extractImageReferences,
  loadImageAttachments,
  readImageDimensions,
  resolveImageUrl,
  sniffImageMediaType,
} from './image-attachments';

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
    expect(init.redirect).toBe('follow');
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

  test('uses the global fetch by default', async () => {
    const globalFetch = vi.fn(async () => imageResponse(png(10, 10)));
    vi.stubGlobal('fetch', globalFetch);

    const result = await loadImageAttachments({
      references: ['https://a.com/1.png'],
      baseUrl: BASE_URL,
      logger: makeLogger(),
    });

    expect(result).toHaveLength(1);
    expect(globalFetch).toHaveBeenCalledTimes(1);
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

  test('deduplicates URLs, tries at most ten and sends at most five', async () => {
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

    expect(customFetch).toHaveBeenCalledTimes(10);
    expect(result).toHaveLength(5);
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
