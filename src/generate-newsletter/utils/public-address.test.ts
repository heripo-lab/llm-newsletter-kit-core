import { assertPublicUrl } from './public-address';

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
