import type { AppLogger } from '~/models/interfaces';

// User-Agent list used by real browsers
const USER_AGENTS = [
  // Windows - Chrome, Edge, Firefox
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0',

  // macOS - Chrome, Safari, Firefox
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:126.0) Gecko/20100101 Firefox/126.0',

  // Linux - Chrome, Firefox
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:126.0) Gecko/20100101 Firefox/126.0',

  // Additional common combinations
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
];

// Pick a random User-Agent
const getRandomUserAgent = () =>
  USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  // Seconds value
  const seconds = Number(header);
  if (!Number.isNaN(seconds)) return clamp(seconds * 1000, 0, 60_000);
  // HTTP date format
  const date = new Date(header);
  const diff = date.getTime() - Date.now();
  if (Number.isFinite(diff) && diff > 0) return clamp(diff, 0, 60_000);
  return null;
}

function shouldRetry(status: number | null, error: unknown): boolean {
  if (status === 429) return true; // Too Many Requests (429)
  if (status && status >= 500) return true; // 5xx server error
  if (status && status >= 400 && status < 500) return false; // Fatal client error
  // Network error or aborted
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (
      msg.includes('aborted') ||
      msg.includes('timeout') ||
      msg.includes('network') ||
      msg.includes('fetch')
    ) {
      return true;
    }
  }
  return false;
}

export async function getHtmlFromUrl(
  logger: AppLogger,
  url: string,
  referer: string = 'https://www.google.com/',
  customFetch?: typeof fetch,
): Promise<string> {
  const maxRetries = 5;
  const baseTimeoutMs = 10_000; // Base 10s, increases per attempt
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeoutMs = clamp(
      baseTimeoutMs * Math.pow(1.3, attempt - 1),
      5_000,
      30_000,
    );
    const timeout = setTimeout(
      () => controller.abort(`timeout after ${timeoutMs}ms`),
      timeoutMs,
    );

    try {
      const startedAt = Date.now();
      const response = await (customFetch ?? fetch)(url, {
        // mode: 'cors' // Not applicable in Node, left here for behavioral parity with browsers
        redirect: 'follow',
        // @ts-expect-error Undici/Fetch in Node may allow duplex; safe to ignore
        duplex: 'half',
        signal: controller.signal,
        headers: {
          'User-Agent': getRandomUserAgent(), // Randomize User-Agent
          Accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
          'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
          Referer: referer, // Include previous page information
          Connection: 'keep-alive',
          // Compression is handled automatically by undici/node-fetch, no need to set Accept-Encoding explicitly
        },
      });
      clearTimeout(timeout);

      const duration = Date.now() - startedAt;
      const status = response.status;

      if (!response.ok) {
        const retryAfterMs = parseRetryAfter(
          response.headers.get('retry-after'),
        );
        const canRetry = shouldRetry(status, null);
        logger.debug({
          event: 'fetch.error',
          data: { url, status, attempt, canRetry, duration, retryAfterMs },
        });
        if (!canRetry || attempt === maxRetries) {
          const msg = `Request failed (status=${status}) - ${url}`;
          lastError = new Error(msg);
          break;
        }
        const backoff = Math.pow(2, attempt - 1) * 1000 + Math.random() * 1000;
        const delay =
          retryAfterMs != null ? Math.max(retryAfterMs, backoff) : backoff;
        await sleep(delay);
        continue;
      }

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.toLowerCase().includes('text/html')) {
        // If not HTML, log a warning and continue (keep I/O compatibility)
        logger.debug({
          event: 'fetch.nonHtml',
          data: { url, contentType, attempt },
        });
      }

      const html = await response.text();
      logger.debug({
        event: 'fetch.success',
        data: { url, status, attempt, duration, size: html.length },
      });

      // Short randomized sleep after success to reduce server load during crawling
      const sleepTime = Math.random() * 500 + 250;
      await sleep(sleepTime);

      return html;
    } catch (error) {
      clearTimeout(timeout);
      const canRetry = shouldRetry(null, error);
      lastError = error instanceof Error ? error : new Error(String(error));
      logger.debug({
        event: 'fetch.catch',
        data: { url, attempt, canRetry, error: (lastError as Error).message },
      });

      if (!canRetry || attempt === maxRetries) {
        logger.error({
          event: 'fetch.failed',
          data: { url, attempt, error: (lastError as Error).message },
        });
        throw lastError;
      }

      // Wait before the next attempt (exponential backoff + jitter)
      const retryDelay = Math.pow(2, attempt - 1) * 1000 + Math.random() * 1000;
      await sleep(retryDelay);
    }
  }

  // Should not reach here; keep for type safety
  throw lastError;
}
