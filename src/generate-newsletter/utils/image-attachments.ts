import type { AppLogger } from '~/models/interfaces';

import { getRandomUserAgent } from './get-html-from-url';
import { type HostLookup, assertPublicUrl } from './public-address';

export type ImageAttachment = {
  data: Uint8Array;
  mediaType: ImageMediaType;
};

type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

type ImageDimensions = { width: number; height: number };

type LoadImageAttachmentsParams = {
  /** Raw Markdown image references, in document order. */
  references: string[];
  /**
   * URL that relative references resolve against. Also sent as `Referer`
   * when it is a valid URL.
   */
  baseUrl: string;
  customFetch?: typeof fetch;
  logger: AppLogger;
  /** Resolves image hosts before they are requested. Replaced in tests. */
  lookupHost?: HostLookup;
};

/** Images sent to the model per article (to save cost). */
export const MAX_IMAGES_PER_ARTICLE = 5;

/**
 * References tried per article. Boards mix decorative icons, tracking pixels
 * and file links in with the images, so more are tried than are sent.
 */
const MAX_CANDIDATES_PER_ARTICLE = 10;

/** Below this size an image is an icon, emoji or tracking pixel. */
const MIN_IMAGE_BYTES = 4_096;

/** Largest image accepted. Anthropic rejects images over 5 MB. */
const MAX_IMAGE_BYTES = 5_000_000;

/** Anthropic rejects images with a side longer than 8000 px. */
const MAX_IMAGE_SIDE = 8_000;

/**
 * OpenAI rejects images that need more than 30000 patches of 32×32 px instead
 * of downscaling them, which tall single-image posters exceed.
 */
const MAX_IMAGE_PATCHES = 30_000;
const IMAGE_PATCH_SIZE = 32;

const DOWNLOAD_TIMEOUT_MS = 15_000;

/** Redirects followed per image, each to a destination checked again. */
const MAX_REDIRECTS = 5;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

// Markdown image pattern: ![alt text](url) or ![](url)
const IMAGE_REFERENCE_PATTERN = /!\[.*?\]\(([^)]+)\)/g;

/**
 * Extracts Markdown image references in document order.
 * Titles (`![a](url "title")`) are kept here and removed by `resolveImageUrl`.
 */
export function extractImageReferences(markdown: string): string[] {
  return [...markdown.matchAll(IMAGE_REFERENCE_PATTERN)]
    .map((match) => match[1].trim())
    .filter((reference) => reference.length > 0);
}

/**
 * Resolves a Markdown image reference to a fetchable URL.
 *
 * The URL is the first whitespace-separated token: boards append titles in
 * straight or curly quotes (`url "title"`, `url “title”`), and a URL cannot
 * contain raw whitespace. Relative references resolve against `baseUrl`.
 * Anything other than http(s) or an inline `data:image/` URI is dropped,
 * including `blob:` URLs copied out of editors.
 */
export function resolveImageUrl(
  reference: string,
  baseUrl: string,
): string | null {
  const token = reference.split(/\s+/)[0].replace(/^<(.*)>$/, '$1');

  if (token.startsWith('data:image/')) {
    return token;
  }

  try {
    const url = new URL(token, baseUrl);

    return url.protocol === 'http:' || url.protocol === 'https:'
      ? url.href
      : null;
  } catch {
    return null;
  }
}

/**
 * Detects the image type from its leading bytes. Response headers are not
 * trusted: some boards label JPEGs as `image/png;charset=utf-8`, and blocked or
 * missing images come back as HTML with status 200.
 */
export function sniffImageMediaType(bytes: Uint8Array): ImageMediaType | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }

  if (ascii(bytes, 0, 8) === '\x89PNG\r\n\x1a\n') {
    return 'image/png';
  }

  if (ascii(bytes, 0, 4) === 'GIF8') {
    return 'image/gif';
  }

  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') {
    return 'image/webp';
  }

  return null;
}

/**
 * Reads pixel dimensions from the image header. Returns null when the header
 * cannot be read, in which case the image is sent as is.
 */
export function readImageDimensions(
  bytes: Uint8Array,
  mediaType: ImageMediaType,
): ImageDimensions | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  try {
    switch (mediaType) {
      case 'image/png':
        return { width: view.getUint32(16), height: view.getUint32(20) };
      case 'image/gif':
        return {
          width: view.getUint16(6, true),
          height: view.getUint16(8, true),
        };
      case 'image/webp':
        return readWebpDimensions(bytes, view);
      case 'image/jpeg':
        return readJpegDimensions(view);
    }
  } catch {
    // Truncated header
    return null;
  }
}

/**
 * Downloads the images referenced by an article so that their bytes, not their
 * URLs, are sent to the model.
 *
 * Passing URLs made the model provider fetch each image from its own servers,
 * where boards time out, refuse foreign or non-browser clients, or (for
 * Anthropic) are rejected outright for using http. A single unreachable image
 * failed the whole request. Images are now fetched here and an image that
 * cannot be used is skipped, so the article is analyzed with the rest.
 */
export async function loadImageAttachments({
  references,
  baseUrl,
  customFetch,
  logger,
  lookupHost,
}: LoadImageAttachmentsParams): Promise<ImageAttachment[]> {
  const urls = [
    ...new Set(
      references
        .map((reference) => resolveImageUrl(reference, baseUrl))
        .filter((url): url is string => url !== null),
    ),
  ].slice(0, MAX_CANDIDATES_PER_ARTICLE);

  const attachments: ImageAttachment[] = [];
  let next = 0;

  // Only as many candidates as images still needed are downloaded at a time,
  // so a slow image after the first five usable ones is never waited on.
  // Articles are analyzed one after another, so that wait would add up.
  while (attachments.length < MAX_IMAGES_PER_ARTICLE && next < urls.length) {
    const batch = urls.slice(
      next,
      next + MAX_IMAGES_PER_ARTICLE - attachments.length,
    );
    next += batch.length;

    const results = await Promise.all(
      batch.map(async (url) => {
        try {
          return await loadImage(url, baseUrl, customFetch, lookupHost);
        } catch (error) {
          return error instanceof Error ? error.message : String(error);
        }
      }),
    );

    results.forEach((result, i) => {
      if (typeof result === 'string') {
        logger.debug({
          event: 'insights.images.skip',
          data: { url: batch[i].slice(0, 200), reason: result },
        });
      } else {
        attachments.push(result);
      }
    });
  }

  return attachments;
}

async function loadImage(
  url: string,
  referer: string,
  customFetch?: typeof fetch,
  lookupHost?: HostLookup,
): Promise<ImageAttachment> {
  const bytes = url.startsWith('data:')
    ? decodeDataUri(url)
    : await download(url, referer, customFetch, lookupHost);

  const mediaType = sniffImageMediaType(bytes);

  if (!mediaType) {
    throw new Error('not a supported image');
  }

  // The upper bound is enforced before the bytes exist: downloads stop reading
  // past it, and data URIs are measured before decoding.
  if (bytes.byteLength < MIN_IMAGE_BYTES) {
    throw new Error(`too small (${bytes.byteLength} bytes)`);
  }

  const dimensions = readImageDimensions(bytes, mediaType);

  if (dimensions && exceedsModelLimits(dimensions)) {
    throw new Error(
      `dimensions exceed model limits (${dimensions.width}x${dimensions.height})`,
    );
  }

  return { data: bytes, mediaType };
}

function exceedsModelLimits({ width, height }: ImageDimensions): boolean {
  const patches =
    Math.ceil(width / IMAGE_PATCH_SIZE) * Math.ceil(height / IMAGE_PATCH_SIZE);

  return (
    width > MAX_IMAGE_SIDE ||
    height > MAX_IMAGE_SIDE ||
    patches > MAX_IMAGE_PATCHES
  );
}

function decodeDataUri(uri: string): Uint8Array {
  const match = /^data:image\/[^;,]+;base64,(.*)$/s.exec(uri);

  if (!match) {
    throw new Error('not a base64 data URI');
  }

  // Checked on the encoded length, so an oversized image is never decoded.
  const encoded = match[1];
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
  const size = Math.floor((encoded.length * 3) / 4) - padding;

  if (size > MAX_IMAGE_BYTES) {
    throw new Error(`too large (${size} bytes)`);
  }

  const decoded = Buffer.from(encoded, 'base64');

  return new Uint8Array(decoded.buffer, decoded.byteOffset, decoded.byteLength);
}

async function download(
  url: string,
  referer: string,
  customFetch?: typeof fetch,
  lookupHost?: HostLookup,
): Promise<Uint8Array> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  // A custom fetch may ignore the abort signal, so the timeout also races it.
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`timeout after ${DOWNLOAD_TIMEOUT_MS}ms`));
    }, DOWNLOAD_TIMEOUT_MS);
  });

  try {
    return await Promise.race([
      fetchImageBytes(url, referer, controller.signal, customFetch, lookupHost),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function fetchImageBytes(
  url: string,
  referer: string,
  signal: AbortSignal,
  customFetch?: typeof fetch,
  lookupHost?: HostLookup,
): Promise<Uint8Array> {
  const headers = {
    'User-Agent': getRandomUserAgent(),
    Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
    'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
    ...(URL.canParse(referer) ? { Referer: referer } : {}),
  };
  let target = new URL(url);
  let response: Response;

  // Redirects are followed here rather than by fetch, so that a public URL
  // redirecting to an internal address is caught like a direct link to one.
  for (let redirects = 0; ; redirects++) {
    await assertPublicUrl(target, lookupHost);
    response = await (customFetch ?? fetch)(target.href, {
      redirect: 'manual',
      signal,
      headers,
    });

    const location = response.headers.get('location');

    if (!REDIRECT_STATUSES.has(response.status) || !location) {
      break;
    }

    await response.body?.cancel();

    if (redirects === MAX_REDIRECTS) {
      throw new Error('too many redirects');
    }

    target = new URL(location, target);
  }

  if (!response.ok) {
    throw new Error(`status ${response.status}`);
  }

  const declaredLength = Number(response.headers.get('content-length'));

  if (declaredLength > MAX_IMAGE_BYTES) {
    throw new Error(`too large (${declaredLength} bytes)`);
  }

  return readBodyWithLimit(response, MAX_IMAGE_BYTES);
}

/**
 * Reads the body but stops past `limit`, so that a reference that turns out to
 * be a large file download is not read to the end.
 */
async function readBodyWithLimit(
  response: Response,
  limit: number,
): Promise<Uint8Array> {
  if (!response.body) {
    return new Uint8Array(await response.arrayBuffer());
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    total += value.byteLength;

    if (total > limit) {
      await reader.cancel();
      throw new Error(`too large (over ${limit} bytes)`);
    }

    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return bytes;
}

function readWebpDimensions(
  bytes: Uint8Array,
  view: DataView,
): ImageDimensions | null {
  switch (ascii(bytes, 12, 16)) {
    case 'VP8X':
      return {
        width: 1 + readUint24LE(view, 24),
        height: 1 + readUint24LE(view, 27),
      };
    case 'VP8 ':
      return {
        width: view.getUint16(26, true) & 0x3fff,
        height: view.getUint16(28, true) & 0x3fff,
      };
    case 'VP8L': {
      const bits = view.getUint32(21, true);

      return {
        width: 1 + (bits & 0x3fff),
        height: 1 + ((bits >> 14) & 0x3fff),
      };
    }
    default:
      return null;
  }
}

/** Walks the JPEG segments to the start-of-frame marker that holds the size. */
function readJpegDimensions(view: DataView): ImageDimensions | null {
  let offset = 2;

  while (offset + 9 <= view.byteLength) {
    if (view.getUint8(offset) !== 0xff) {
      return null;
    }

    const marker = view.getUint8(offset + 1);

    // SOF0–SOF15, except DHT (C4), JPG (C8) and DAC (CC)
    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc
    ) {
      return {
        height: view.getUint16(offset + 5),
        width: view.getUint16(offset + 7),
      };
    }

    offset += 2 + view.getUint16(offset + 2);
  }

  return null;
}

function readUint24LE(view: DataView, offset: number): number {
  return (
    view.getUint8(offset) |
    (view.getUint8(offset + 1) << 8) |
    (view.getUint8(offset + 2) << 16)
  );
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end));
}
