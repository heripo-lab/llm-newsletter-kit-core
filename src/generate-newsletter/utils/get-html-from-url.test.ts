import { getHtmlFromUrl } from './get-html-from-url';

// Helper to create a minimal Response-like object
function makeResponse({
  ok,
  status,
  headers = {},
  body = '',
}: {
  ok: boolean;
  status: number;
  headers?: Record<string, string>;
  body?: string;
}) {
  const map = Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]),
  );
  return {
    ok,
    status,
    headers: {
      get(name: string) {
        return map[name.toLowerCase()] ?? null;
      },
    },
    text: async () => body,
  } as any;
}

// Minimal logger stub following AppLogger shape
function makeLogger() {
  return {
    debug: vi.fn(),
    error: vi.fn(),
  } as const;
}

describe('getHtmlFromUrl', () => {
  const originalFetch = globalThis.fetch;
  const originalRandom = Math.random;

  afterEach(() => {
    // restore fetch and timers/random after each test
    if (originalFetch) {
      globalThis.fetch = originalFetch as any;
    } else {
      delete (globalThis as any).fetch;
    }
    Math.random = originalRandom;
    vi.useRealTimers();
  });

  test('returns HTML on success with text/html and logs success', async () => {
    // Use real timers here to avoid race conditions with immediate resolution
    Math.random = vi.fn().mockReturnValue(0); // deterministic UA and sleeps

    const html = '<html><body>ok</body></html>';
    const fetchMock = vi.fn().mockResolvedValue(
      makeResponse({
        ok: true,
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
        body: html,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const logger = makeLogger();

    const result = await getHtmlFromUrl(
      logger as any,
      'https://example.com',
      'https://ref',
    );

    expect(result).toBe(html);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(init).toBeTruthy();
    expect((init as any).headers['Accept-Language']).toContain('ko-KR');
    expect((init as any).headers.Referer).toBe('https://ref');
    expect((init as any).headers['User-Agent']).toBeTruthy();

    // success log
    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'fetch.success' }),
    );
  });

  test('logs nonHtml when content-type is not text/html but still returns body', async () => {
    // Use real timers; only 250ms post-sleep
    Math.random = vi.fn().mockReturnValue(0);

    const fetchMock = vi.fn().mockResolvedValue(
      makeResponse({
        ok: true,
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: '{"a":1}',
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const logger = makeLogger();

    const result = await getHtmlFromUrl(logger as any, 'https://example.com');

    expect(result).toBe('{"a":1}');
    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'fetch.nonHtml' }),
    );
  });

  test('retries on 5xx and eventually succeeds', async () => {
    vi.useFakeTimers();
    Math.random = vi.fn().mockReturnValue(0);

    const fetchMock = vi
      .fn()
      // attempt 1: 500
      .mockResolvedValueOnce(
        makeResponse({ ok: false, status: 500, headers: {} }),
      )
      // attempt 2: 200
      .mockResolvedValueOnce(
        makeResponse({
          ok: true,
          status: 200,
          headers: { 'content-type': 'text/html' },
          body: '<ok/>',
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const logger = makeLogger();

    const promise = getHtmlFromUrl(logger as any, 'https://retry.com');

    // flush backoff and post-success sleep timers deterministically
    await vi.runOnlyPendingTimersAsync();
    await vi.runOnlyPendingTimersAsync();

    const html = await promise;
    expect(html).toBe('<ok/>');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // ensure error log not called
    expect(logger.error).not.toHaveBeenCalled();
  });

  test('does not retry on 4xx (e.g., 404) and throws', async () => {
    vi.useFakeTimers();
    Math.random = vi.fn().mockReturnValue(0);

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        makeResponse({ ok: false, status: 404, headers: {} }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const logger = makeLogger();

    await expect(
      getHtmlFromUrl(logger as any, 'https://notfound.test'),
    ).rejects.toThrow(
      /Request failed \(status=404\) - https:\/\/notfound\.test/,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(logger.error).not.toHaveBeenCalled();
  });

  test('429 with Retry-After header (seconds) then success', async () => {
    vi.useFakeTimers();
    Math.random = vi.fn().mockReturnValue(0);

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        makeResponse({
          ok: false,
          status: 429,
          headers: { 'retry-after': '2' }, // 2 seconds
        }),
      )
      .mockResolvedValueOnce(
        makeResponse({
          ok: true,
          status: 200,
          headers: { 'content-type': 'text/html' },
          body: '<done/>',
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const logger = makeLogger();
    const promise = getHtmlFromUrl(logger as any, 'https://rate.test');

    // flush backoff and post-success sleep timers deterministically
    await vi.runOnlyPendingTimersAsync();
    await vi.runOnlyPendingTimersAsync();

    const res = await promise;
    expect(res).toBe('<done/>');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // first debug should record fetch.error
    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'fetch.error' }),
    );
  });

  test('aborts on timeout, retries up to max, then logs failed and throws', async () => {
    vi.useFakeTimers();
    Math.random = vi.fn().mockReturnValue(0);

    // A fetch mock that rejects when the signal aborts (to emulate real fetch).
    // It must reject with `signal.reason` rather than an Error of its own: the
    // timeout aborts with a string, real fetch rejects with that value as-is,
    // and a mock that wraps it in an Error hides whether the retry predicate
    // can read a non-Error rejection.
    const hangingFetch = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise((_, reject) => {
          const signal = (init as any)?.signal as AbortSignal | undefined;
          if (signal) {
            const onAbort = () => {
              signal.removeEventListener('abort', onAbort);
              reject(signal.reason);
            };
            signal.addEventListener('abort', onAbort);
          }
        }),
    );
    vi.stubGlobal('fetch', hangingFetch as any);

    const logger = makeLogger();

    const promise = getHtmlFromUrl(logger as any, 'https://slow.example');

    // Attach rejection handler before timers flush to avoid unhandled rejection warning
    const expectation = expect(promise).rejects.toThrow(/timeout|fetch/i);

    // Flush all scheduled timers (timeouts and retry delays) across attempts
    await vi.runAllTimersAsync();

    await expectation;

    // fetch attempted 5 times
    expect(hangingFetch).toHaveBeenCalledTimes(5);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'fetch.failed' }),
    );
  });
});

// Additional coverage tests to hit parseRetryAfter (HTTP-date) and shouldRetry branches

describe('getHtmlFromUrl - extra coverage', () => {
  const originalFetch = globalThis.fetch;
  const originalRandom = Math.random;

  afterEach(() => {
    if (originalFetch) {
      globalThis.fetch = originalFetch as any;
    } else {
      delete (globalThis as any).fetch;
    }
    Math.random = originalRandom;
    vi.useRealTimers();
  });

  test('429 with Retry-After as HTTP-date clamps to 60s then succeeds', async () => {
    vi.useFakeTimers();
    Math.random = vi.fn().mockReturnValue(0);

    // Fix system time so future date calculation is deterministic
    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));
    const retryAfterDate = new Date(Date.now() + 120_000).toUTCString(); // +120s, clamped to 60s

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        makeResponse({
          ok: false,
          status: 429,
          headers: { 'retry-after': retryAfterDate },
        }),
      )
      .mockResolvedValueOnce(
        makeResponse({
          ok: true,
          status: 200,
          headers: { 'content-type': 'text/html' },
          body: '<ok-date/>',
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const logger = makeLogger();
    const promise = getHtmlFromUrl(logger as any, 'https://rate-date.test');

    // Flush the clamped delay and the post-success short sleep
    await vi.runOnlyPendingTimersAsync();
    await vi.runOnlyPendingTimersAsync();

    const html = await promise;

    expect(html).toBe('<ok-date/>');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'fetch.error' }),
    );
  });

  test('retries on Error("Network error") then succeeds', async () => {
    vi.useFakeTimers();
    Math.random = vi.fn().mockReturnValue(0);

    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce(
        makeResponse({
          ok: true,
          status: 200,
          headers: { 'content-type': 'text/html' },
          body: '<ok-net/>',
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const logger = makeLogger();
    const promise = getHtmlFromUrl(logger as any, 'https://neterr.test');

    // Flush retry delay and post-success sleep
    await vi.runOnlyPendingTimersAsync();
    await vi.runOnlyPendingTimersAsync();

    const html = await promise;
    expect(html).toBe('<ok-net/>');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // ensure fetch.catch debug logged for first attempt
    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'fetch.catch' }),
    );
  });

  test('non-retryable error does not retry and throws', async () => {
    vi.useFakeTimers();
    Math.random = vi.fn().mockReturnValue(0);

    const fetchMock = vi.fn().mockRejectedValue(new Error('boom'));
    vi.stubGlobal('fetch', fetchMock);

    const logger = makeLogger();

    const promise = getHtmlFromUrl(logger as any, 'https://no-retry.test');
    await expect(promise).rejects.toThrow('boom');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'fetch.failed' }),
    );
  });
});

// Cover parseRetryAfter returning null for past/invalid HTTP-date

describe('getHtmlFromUrl - parseRetryAfter null branch', () => {
  const originalFetch = globalThis.fetch;
  const originalRandom = Math.random;

  afterEach(() => {
    if (originalFetch) {
      globalThis.fetch = originalFetch as any;
    } else {
      delete (globalThis as any).fetch;
    }
    Math.random = originalRandom;
    vi.useRealTimers();
  });

  test('429 with past Retry-After date falls back to backoff (return null path)', async () => {
    vi.useFakeTimers();
    Math.random = vi.fn().mockReturnValue(0);

    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));
    const pastDate = new Date(Date.now() - 5_000).toUTCString();

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        makeResponse({
          ok: false,
          status: 429,
          headers: { 'retry-after': pastDate },
        }),
      )
      .mockResolvedValueOnce(
        makeResponse({
          ok: true,
          status: 200,
          headers: { 'content-type': 'text/html' },
          body: '<ok-past/>',
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const logger = makeLogger();
    const promise = getHtmlFromUrl(logger as any, 'https://rate-past.test');

    // Since Retry-After is ignored, it uses backoff (1s at attempt 1 with jitter=0)
    await vi.advanceTimersByTimeAsync(1000);
    await vi.runOnlyPendingTimersAsync();

    const html = await promise;
    expect(html).toBe('<ok-past/>');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

// Extra branches: content-type missing, non-Error rejection, and final throw after loop

describe('getHtmlFromUrl - branch edge cases', () => {
  const originalFetch = globalThis.fetch;
  const originalRandom = Math.random;

  afterEach(() => {
    if (originalFetch) {
      globalThis.fetch = originalFetch as any;
    } else {
      delete (globalThis as any).fetch;
    }
    Math.random = originalRandom;
    vi.useRealTimers();
  });

  test('success with missing content-type header logs nonHtml and returns body', async () => {
    Math.random = vi.fn().mockReturnValue(0);

    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        makeResponse({ ok: true, status: 200, headers: {}, body: '<b/>' }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const logger = makeLogger();
    const html = await getHtmlFromUrl(logger as any, 'https://no-ct.test');

    expect(html).toBe('<b/>');
    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'fetch.nonHtml' }),
    );
  });

  test('non-Error rejection wraps into Error and does not retry', async () => {
    vi.useFakeTimers();
    Math.random = vi.fn().mockReturnValue(0);

    const fetchMock = vi.fn().mockRejectedValue('string failure');
    vi.stubGlobal('fetch', fetchMock);

    const logger = makeLogger();
    const promise = getHtmlFromUrl(logger as any, 'https://string-fail.test');

    await expect(promise).rejects.toThrow('string failure');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'fetch.failed' }),
    );
  });

  test('5xx across all retries throws after loop (maxRetries path)', async () => {
    vi.useFakeTimers();
    Math.random = vi.fn().mockReturnValue(0);

    const fetchMock = vi
      .fn()
      .mockResolvedValue(makeResponse({ ok: false, status: 500, headers: {} }));
    vi.stubGlobal('fetch', fetchMock);

    const logger = makeLogger();
    const promise = getHtmlFromUrl(logger as any, 'https://always-500.test');

    // Attach expectation before flushing timers to avoid unhandled rejection warning
    const expectation = expect(promise).rejects.toThrow(/status=500/);
    await vi.runAllTimersAsync();
    await expectation;

    // 5 attempts total
    expect(fetchMock).toHaveBeenCalledTimes(5);
    // This path does not call logger.error inside catch; final throw happens post-loop
    expect(logger.error).not.toHaveBeenCalled();
  });
  test.each([
    ['a string reason', 'timeout after 10000ms'],
    ['a DOMException-like object', { name: 'AbortError', message: '' }],
    ['an object carrying only a message', { message: 'network down' }],
  ])('retries when a customFetch rejects with %s', async (_label, reason) => {
    vi.useFakeTimers();
    Math.random = vi.fn().mockReturnValue(0);

    const rejecting = vi.fn(() => Promise.reject(reason));
    vi.stubGlobal('fetch', rejecting as any);

    const logger = makeLogger();
    const promise = getHtmlFromUrl(logger as any, 'https://slow.example');
    const expectation = expect(promise).rejects.toBeDefined();

    await vi.runAllTimersAsync();
    await expectation;

    // Retried to the cap rather than giving up on the first attempt.
    expect(rejecting).toHaveBeenCalledTimes(5);
  });

  test.each([
    ['a string naming no transient cause', 'parse failure'],
    ['an object with neither name nor message', { code: 42 }],
    ['a null rejection', null],
  ])('does not retry %s', async (_label, reason) => {
    vi.useFakeTimers();
    Math.random = vi.fn().mockReturnValue(0);

    const rejecting = vi.fn(() => Promise.reject(reason));
    vi.stubGlobal('fetch', rejecting as any);

    const logger = makeLogger();
    const promise = getHtmlFromUrl(logger as any, 'https://slow.example');
    const expectation = expect(promise).rejects.toBeDefined();

    await vi.runAllTimersAsync();
    await expectation;

    expect(rejecting).toHaveBeenCalledTimes(1);
  });
});
