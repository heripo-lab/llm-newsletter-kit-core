import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';

import { createPublicFetch } from './public-fetch';

type Captured = {
  client: 'http' | 'https';
  url: URL;
  options: Record<string, any>;
  respond: (message: Readable) => void;
  request: EventEmitter & { end: () => void };
};

// Hoisted with the mocks below, which run before the module body.
const { calls, fakeClient } = vi.hoisted(() => {
  const calls: Captured[] = [];
  const fakeClient = async (client: Captured['client']) => {
    const { EventEmitter } = await import('node:events');
    return {
      request: (url: URL, options: Record<string, any>, respond: any) => {
        const request = Object.assign(new EventEmitter(), { end: () => {} });
        calls.push({ client, url, options, respond, request });
        return request;
      },
    };
  };
  return { calls, fakeClient };
});
vi.mock('node:http', () => fakeClient('http'));
vi.mock('node:https', () => fakeClient('https'));

function message(
  statusCode: number,
  headers: Record<string, string | string[] | undefined>,
  body: string[] = [],
) {
  return Object.assign(Readable.from(body.map((chunk) => Buffer.from(chunk))), {
    statusCode,
    statusMessage: 'Status',
    headers,
  });
}

beforeEach(() => {
  calls.length = 0;
});

describe('createPublicFetch', () => {
  test('connects through the public lookup and returns the response', async () => {
    const send = createPublicFetch(async () => ['93.184.216.34']);
    const controller = new AbortController();

    const pending = send('https://img.example.com/a.png', {
      headers: { Referer: 'https://board.example.com/' },
      signal: controller.signal,
    });
    const [call] = calls;
    expect(call.client).toBe('https');
    expect(call.url.href).toBe('https://img.example.com/a.png');
    expect(call.options).toMatchObject({
      method: 'GET',
      headers: { referer: 'https://board.example.com/' },
      signal: controller.signal,
    });

    // The connection resolves through the checking lookup.
    const resolved = await new Promise((resolve) =>
      call.options.lookup('img.example.com', {}, (...args: unknown[]) =>
        resolve(args),
      ),
    );
    expect(resolved).toEqual([null, '93.184.216.34', 4]);

    call.respond(
      message(
        200,
        {
          'content-type': 'image/png',
          'set-cookie': ['a=1', 'b=2'],
          x: undefined,
        },
        ['ab', 'cd'],
      ),
    );
    const response = await pending;
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('set-cookie')).toBe('a=1, b=2');
    expect(await response.text()).toBe('abcd');
  });

  test('uses http for http URLs and takes a Request or URL', async () => {
    const send = createPublicFetch(async () => ['93.184.216.34']);

    const fromRequest = send(new Request('http://img.example.com/r.png'));
    calls[0].respond(message(204, {}));
    expect(calls[0].client).toBe('http');
    expect((await fromRequest).body).toBeNull();

    const fromUrl = send(new URL('http://img.example.com/u.png'));
    calls[1].respond(
      message(302, { location: 'https://img.example.com/next.png' }),
    );
    expect((await fromUrl).headers.get('location')).toBe(
      'https://img.example.com/next.png',
    );
  });

  test('refuses a connection the lookup blocks', async () => {
    const send = createPublicFetch(async () => ['169.254.169.254']);
    const pending = send('http://rebind.example.com/');
    const blocked = await new Promise<Error | null>((resolve) =>
      calls[0].options.lookup('rebind.example.com', {}, resolve),
    );
    calls[0].request.emit('error', blocked);
    await expect(pending).rejects.toThrow('blocked address (169.254.169.254)');
  });

  test('rejects a response it cannot represent', async () => {
    const send = createPublicFetch(async () => ['93.184.216.34']);
    const pending = send('https://img.example.com/odd');
    const odd = message(0, {});
    calls[0].respond(Object.assign(odd, { statusCode: undefined }));
    await expect(pending).rejects.toThrow(RangeError);
    expect(odd.destroyed).toBe(true);
  });
});
