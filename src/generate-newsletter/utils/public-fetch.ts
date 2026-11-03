import * as http from 'node:http';
import * as https from 'node:https';
import { Readable } from 'node:stream';

import { type HostLookup, createPublicLookup } from './public-address';

/** Statuses whose response must not have a body. */
const NULL_BODY_STATUSES = new Set([204, 205, 304]);

/**
 * A minimal GET-only `fetch` for downloading images, built on `http.request`
 * so that the connection goes through {@link createPublicLookup}: an address
 * is checked in the same step that connects to it.
 *
 * Global `fetch` cannot do this without an undici dispatcher, and the check
 * ahead of the request alone leaves DNS rebinding open. Redirects are not
 * followed; the caller follows them and checks each hop. Only the URL,
 * `headers` and `signal` of the request are used.
 */
export function createPublicFetch(lookupHost?: HostLookup): typeof fetch {
  const lookup = createPublicLookup(lookupHost);

  return (input, init) =>
    new Promise<Response>((resolve, reject) => {
      const url = new URL(input instanceof Request ? input.url : input);
      const client = url.protocol === 'https:' ? https : http;
      const request = client.request(
        url,
        {
          method: 'GET',
          headers: Object.fromEntries(new Headers(init?.headers)),
          signal: init?.signal ?? undefined,
          lookup,
        },
        (message) => {
          const status = message.statusCode ?? 0;
          const headers = new Headers();

          for (const [name, value] of Object.entries(message.headers)) {
            if (value !== undefined) {
              headers.set(
                name,
                Array.isArray(value) ? value.join(', ') : value,
              );
            }
          }

          try {
            resolve(
              new Response(
                NULL_BODY_STATUSES.has(status)
                  ? null
                  : (Readable.toWeb(message) as ReadableStream<Uint8Array>),
                { status, statusText: message.statusMessage, headers },
              ),
            );
          } catch (error) {
            message.destroy();
            reject(error);
          }
        },
      );

      request.on('error', reject);
      request.end();
    });
}
