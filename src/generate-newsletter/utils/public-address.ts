import type { LookupFunction } from 'node:net';

import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

/** Resolves a hostname to every address it points at. */
export type HostLookup = (hostname: string) => Promise<string[]>;

const lookupAll: HostLookup = async (hostname) =>
  (await lookup(hostname, { all: true, order: 'verbatim' })).map(
    ({ address }) => address,
  );

/**
 * Addresses a request built from untrusted content must never reach: this
 * host, private and shared networks, link-local (which includes the cloud
 * metadata endpoint 169.254.169.254), and reserved, documentation and
 * multicast ranges. NAT64 IPv6 is blocked whole, since it can wrap any of the
 * IPv4 ranges; IPv4-mapped IPv6 is handled in `isPublicAddress`.
 */
const nonPublic = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  nonPublic.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['100::', 64],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  nonPublic.addSubnet(network, prefix, 'ipv6');
}

function isPublicAddress(address: string): boolean {
  const family = isIP(address);

  // IPv4-mapped IPv6 (::ffff:a.b.c.d) can wrap any IPv4 address, and no public
  // host is reached through one. It is not a BlockList rule because BlockList
  // applies an ::ffff:0:0/96 subnet to every IPv4 address as well.
  if (family === 6 && /^::ffff:/i.test(address)) {
    return false;
  }

  return (
    family !== 0 && !nonPublic.check(address, family === 4 ? 'ipv4' : 'ipv6')
  );
}

/** Resolves `hostname` and throws unless every address it points at is public. */
async function resolvePublicAddresses(
  hostname: string,
  lookupHost: HostLookup,
): Promise<string[]> {
  const addresses = isIP(hostname) ? [hostname] : await lookupHost(hostname);
  const blocked = addresses.find((address) => !isPublicAddress(address));

  if (addresses.length === 0 || blocked !== undefined) {
    throw new Error(`blocked address (${blocked ?? 'none'})`);
  }

  return addresses;
}

/**
 * Throws unless `url` is http(s) and its host resolves only to public
 * addresses.
 *
 * Image URLs come from crawled articles, so without this a post could make the
 * host request its own internal services or the cloud metadata endpoint. Every
 * address the name resolves to is checked, not just the first.
 *
 * This is a check ahead of the request: the request resolves the name again,
 * and an answer that changes in between (DNS rebinding) would get past it. The
 * default download closes that gap with {@link createPublicLookup}; a custom
 * fetch makes its own connections, and only this check applies to it.
 */
export async function assertPublicUrl(
  url: URL,
  lookupHost: HostLookup = lookupAll,
): Promise<void> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`unsupported protocol (${url.protocol})`);
  }

  const hostname = url.hostname.replace(/^\[(.*)\]$/, '$1').toLowerCase();

  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new Error(`blocked host (${hostname})`);
  }

  await resolvePublicAddresses(hostname, lookupHost);
}

/**
 * A `lookup` for `http.request` that refuses non-public addresses at connect
 * time.
 *
 * The socket connects to the address this returns, so the address checked and
 * the address connected to are the same answer, which a check ahead of the
 * request cannot guarantee. Node skips `lookup` for IP literals, which
 * {@link assertPublicUrl} checks instead.
 */
export function createPublicLookup(
  lookupHost: HostLookup = lookupAll,
): LookupFunction {
  return (hostname, options, callback) => {
    resolvePublicAddresses(hostname, lookupHost).then(
      (addresses) => {
        const wanted =
          options.family === 4 || options.family === 'IPv4'
            ? 4
            : options.family === 6 || options.family === 'IPv6'
              ? 6
              : 0;
        const entries = addresses
          .map((address) => ({ address, family: isIP(address) }))
          .filter(({ family }) => wanted === 0 || family === wanted);

        if (entries.length === 0) {
          callback(new Error(`no IPv${wanted} address for ${hostname}`), '', 0);
        } else if (options.all) {
          callback(null, entries);
        } else {
          callback(null, entries[0].address, entries[0].family);
        }
      },
      (error: Error) => callback(error, '', 0),
    );
  };
}
