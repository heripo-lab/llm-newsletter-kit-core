import { assertPublicUrl, createPublicLookup } from './public-address';

const resolveTo =
  (...addresses: string[]) =>
  async () =>
    addresses;

describe('assertPublicUrl', () => {
  test.each([
    'http://0.0.0.0/',
    'http://10.1.2.3/',
    'http://100.64.0.1/',
    'http://127.0.0.1/',
    'http://169.254.169.254/latest/meta-data/',
    'http://172.16.0.1/',
    'http://172.31.255.255/',
    'http://192.168.0.1/',
    'http://198.18.0.1/',
    'http://224.0.0.1/',
    'http://255.255.255.255/',
    'http://[::]/',
    'http://[::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[64:ff9b::a00:1]/',
    'http://[fc00::1]/',
    'http://[fd12:3456::1]/',
    'http://[fe80::1]/',
    'http://[ff02::1]/',
  ])('blocks %s', async (url) => {
    await expect(assertPublicUrl(new URL(url), resolveTo())).rejects.toThrow(
      /^blocked address/,
    );
  });

  test('blocks localhost names without resolving them', async () => {
    const lookup = vi.fn();
    for (const url of ['http://localhost/', 'http://app.LOCALHOST:3000/']) {
      await expect(assertPublicUrl(new URL(url), lookup)).rejects.toThrow(
        /^blocked host/,
      );
    }
    expect(lookup).not.toHaveBeenCalled();
  });

  test('blocks a name when any address it resolves to is not public', async () => {
    await expect(
      assertPublicUrl(
        new URL('https://mixed.example.com/a.png'),
        resolveTo('93.184.216.34', '192.168.1.10'),
      ),
    ).rejects.toThrow('blocked address (192.168.1.10)');
    await expect(
      assertPublicUrl(new URL('https://empty.example.com/'), resolveTo()),
    ).rejects.toThrow('blocked address (none)');
  });

  test('allows public addresses and names', async () => {
    await expect(
      assertPublicUrl(new URL('https://8.8.8.8/'), resolveTo()),
    ).resolves.toBeUndefined();
    await expect(
      assertPublicUrl(new URL('http://[2606:4700::1111]/'), resolveTo()),
    ).resolves.toBeUndefined();
    await expect(
      assertPublicUrl(
        new URL('https://www.khs.go.kr/a.jpg'),
        resolveTo('211.252.85.160', '2001:4860:4860::8888'),
      ),
    ).resolves.toBeUndefined();
  });

  test('rejects other protocols', async () => {
    await expect(
      assertPublicUrl(new URL('ftp://example.com/a.png'), resolveTo()),
    ).rejects.toThrow('unsupported protocol (ftp:)');
  });

  test('uses DNS by default', async () => {
    await expect(
      assertPublicUrl(new URL('http://localhost.example.invalid/')),
    ).rejects.toThrow();
  });
});

describe('createPublicLookup', () => {
  const run = (
    lookup: ReturnType<typeof createPublicLookup>,
    options: Parameters<ReturnType<typeof createPublicLookup>>[1],
  ) =>
    new Promise<{ error: Error | null; result: unknown[] }>((resolve) => {
      lookup('img.example.com', options, (error, ...result) =>
        resolve({ error, result }),
      );
    });

  test('answers with the checked addresses, one or all', async () => {
    const lookup = createPublicLookup(
      resolveTo('93.184.216.34', '2606:4700::1111'),
    );

    expect(await run(lookup, {})).toEqual({
      error: null,
      result: ['93.184.216.34', 4],
    });
    expect(await run(lookup, { all: true })).toEqual({
      error: null,
      result: [
        [
          { address: '93.184.216.34', family: 4 },
          { address: '2606:4700::1111', family: 6 },
        ],
      ],
    });
    expect(await run(lookup, { family: 6 })).toEqual({
      error: null,
      result: ['2606:4700::1111', 6],
    });
    expect(await run(lookup, { family: 'IPv4', all: true })).toEqual({
      error: null,
      result: [[{ address: '93.184.216.34', family: 4 }]],
    });
    expect(await run(lookup, { family: 'IPv6' })).toEqual({
      error: null,
      result: ['2606:4700::1111', 6],
    });
  });

  test('refuses at connect time when the name now points inside', async () => {
    // Public when checked ahead of the request, private when connecting
    let calls = 0;
    const rebinding = createPublicLookup(async () =>
      ++calls === 1 ? ['93.184.216.34'] : ['10.0.0.8'],
    );

    expect((await run(rebinding, {})).error).toBeNull();
    const { error } = await run(rebinding, {});
    expect(error?.message).toBe('blocked address (10.0.0.8)');
  });

  test('fails when no address matches the requested family', async () => {
    const lookup = createPublicLookup(resolveTo('93.184.216.34'));
    const { error } = await run(lookup, { family: 6 });
    expect(error?.message).toBe('no IPv6 address for img.example.com');
  });
});
