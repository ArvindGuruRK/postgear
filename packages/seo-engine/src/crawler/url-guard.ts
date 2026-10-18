/**
 * SSRF protection for every URL the engine fetches: the main page, each
 * redirect hop, every link it checks, robots.txt, the sitemap, and (through
 * the browser pool's route hook) every sub-resource a headless page requests.
 *
 * A URL-input feature that fetches what it is given is the textbook SSRF
 * vector: `http://169.254.169.254/latest/meta-data` reads cloud credentials,
 * `http://localhost:6379` talks to Redis, `http://10.0.0.5` walks the private
 * network. So this module **fails closed**: a URL is fetched only when every
 * rule passes, and anything it cannot decide (an unresolvable host, an
 * address it cannot parse) is refused rather than let through.
 *
 * The rules, in the order they are applied:
 * 1. it parses as a URL, with an `http:` or `https:` scheme;
 * 2. no credentials in the authority (`user:pw@host` is how phishing and
 *    some proxy tricks smuggle hosts past naive checks);
 * 3. the port is the scheme's default unless the caller allowed others: an
 *    attacker cannot pick a service by port;
 * 4. the host name is not one of the names that only mean something inside a
 *    machine or a network (`localhost`, `*.local`, `*.internal`,
 *    `metadata.google.internal` …);
 * 5. every address the host resolves to is public. **Every**: a host with one
 *    public and one private record is refused, because the client would pick
 *    whichever it liked. An IP literal is checked without a lookup.
 *
 * Resolution is injectable (`UrlGuardOptions.resolve`) so the tests never
 * touch DNS, and so `safe-fetch.ts` can connect to the exact address that was
 * validated instead of resolving a second time (the DNS-rebinding window).
 */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import {
  SeoCrawlError,
  type UrlGuardOptions,
  type UrlRejectReason,
  type UrlSafetyResult,
} from '../types';

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/** Host names that are forbidden outright, however they resolve. */
const FORBIDDEN_HOSTS = new Set(['localhost', 'metadata.google.internal']);

/** Suffixes (with the leading dot) that only name hosts on the local network. */
const FORBIDDEN_SUFFIXES = ['.localhost', '.local', '.internal', '.home.arpa'];

const REJECT_MESSAGES: Record<UrlRejectReason, string> = {
  invalid: 'That is not a valid URL.',
  scheme: 'Only http:// and https:// URLs can be analysed.',
  credentials: 'URLs with a username or password are not allowed.',
  port: 'Only the default port for the scheme is allowed.',
  host_forbidden:
    'That host name points at the local or internal network, which the analyzer never fetches.',
  unresolvable: 'The host name could not be resolved.',
  private_address:
    'The host resolves to a private or internal network address, which the analyzer never fetches.',
};

export function urlRejectMessage(reason: UrlRejectReason): string {
  return REJECT_MESSAGES[reason];
}

/**
 * Thrown by {@link normaliseUrl} and turned into the `ok: false` branch by
 * {@link assertSafeUrl}. It is a `SeoCrawlError` so a caller that only has the
 * normaliser (the API filters its history by normalised URL) still gets a
 * typed, user-safe failure.
 */
function reject(reason: UrlRejectReason): SeoCrawlError {
  return new SeoCrawlError('unsafe_url', REJECT_MESSAGES[reason], false, { reason });
}

/**
 * The canonical spelling of a URL: lower-cased scheme and host (the URL
 * parser does this), no fragment, no default port, path and query kept as
 * given. Credentials are not stripped silently: they are refused, because a
 * URL that carried them was almost certainly crafted.
 */
export function normaliseUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw reject('invalid');
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) throw reject('scheme');
  if (url.username !== '' || url.password !== '') throw reject('credentials');
  if (url.hostname === '') throw reject('invalid');
  url.hash = '';
  return url.toString();
}

// ---------------------------------------------------------------------------
// Address classification
// ---------------------------------------------------------------------------

function parseIpv4(ip: string): number[] | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const value = Number(part);
    if (value > 255) return null;
    octets.push(value);
  }
  return octets;
}

/**
 * IPv4 ranges that are not globally routable, from the IANA special-purpose
 * registry plus the ones that matter operationally (CGNAT, the cloud
 * metadata link-local block, benchmarking). Each entry is `[prefix, bits]`.
 */
const PRIVATE_V4: ReadonlyArray<readonly [number[], number]> = [
  [[0, 0, 0, 0], 8], // "this" network
  [[10, 0, 0, 0], 8], // private
  [[100, 64, 0, 0], 10], // carrier-grade NAT
  [[127, 0, 0, 0], 8], // loopback
  [[169, 254, 0, 0], 16], // link-local, incl. 169.254.169.254
  [[172, 16, 0, 0], 12], // private
  [[192, 0, 0, 0], 24], // IETF protocol assignments
  [[192, 0, 2, 0], 24], // TEST-NET-1
  [[192, 168, 0, 0], 16], // private
  [[198, 18, 0, 0], 15], // benchmarking
  [[198, 51, 100, 0], 24], // TEST-NET-2
  [[203, 0, 113, 0], 24], // TEST-NET-3
  [[224, 0, 0, 0], 4], // multicast
  [[240, 0, 0, 0], 4], // reserved, incl. 255.255.255.255
];

function v4InRange(octets: number[], prefix: number[], bits: number): boolean {
  const value = ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0;
  const base = ((prefix[0] << 24) | (prefix[1] << 16) | (prefix[2] << 8) | prefix[3]) >>> 0;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (value & mask) === (base & mask);
}

function isPrivateV4(octets: number[]): boolean {
  return PRIVATE_V4.some(([prefix, bits]) => v4InRange(octets, prefix, bits));
}

/**
 * Expands an IPv6 literal to its sixteen bytes. Handles `::` compression, an
 * embedded dotted IPv4 tail (`::ffff:127.0.0.1`) and a zone id (`fe80::1%eth0`).
 * Returns null for anything it cannot read, which the caller treats as
 * private, since an address we cannot parse is not one we can vouch for.
 */
function parseIpv6(ip: string): number[] | null {
  let text = ip;
  const zone = text.indexOf('%');
  if (zone !== -1) text = text.slice(0, zone);
  if (text.startsWith('[') && text.endsWith(']')) text = text.slice(1, -1);
  if (text.length === 0 || text.includes(':::')) return null;

  const parts = text.split('::');
  if (parts.length > 2) return null;
  const head = parts[0] === '' ? [] : parts[0].split(':');
  const tail = parts.length === 2 ? (parts[1] === '' ? [] : parts[1].split(':')) : [];

  const toWords = (groups: string[]): number[] | null => {
    const words: number[] = [];
    for (let i = 0; i < groups.length; i += 1) {
      const group = groups[i];
      if (i === groups.length - 1 && group.includes('.')) {
        const v4 = parseIpv4(group);
        if (!v4) return null;
        words.push((v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]);
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/i.test(group)) return null;
      words.push(Number.parseInt(group, 16));
    }
    return words;
  };

  const headWords = toWords(head);
  const tailWords = toWords(tail);
  if (!headWords || !tailWords) return null;
  const missing = 8 - headWords.length - tailWords.length;
  if (parts.length === 2 ? missing < 1 : missing !== 0) return null;
  const words = [...headWords, ...new Array<number>(missing).fill(0), ...tailWords];

  const bytes: number[] = [];
  for (const word of words) bytes.push(word >> 8, word & 0xff);
  return bytes;
}

function isPrivateV6(bytes: number[]): boolean {
  const allZeroUpTo = (n: number) => bytes.slice(0, n).every((b) => b === 0);

  // :: (unspecified) and ::1 (loopback).
  if (allZeroUpTo(15) && (bytes[15] === 0 || bytes[15] === 1)) return true;
  // ::ffff:a.b.c.d, IPv4-mapped: the verdict is the embedded IPv4's.
  if (allZeroUpTo(10) && bytes[10] === 0xff && bytes[11] === 0xff) {
    return isPrivateV4(bytes.slice(12));
  }
  // 64:ff9b::/96, NAT64: likewise, the embedded IPv4 decides.
  if (
    bytes[0] === 0x00 &&
    bytes[1] === 0x64 &&
    bytes[2] === 0xff &&
    bytes[3] === 0x9b &&
    bytes.slice(4, 12).every((b) => b === 0)
  ) {
    return isPrivateV4(bytes.slice(12));
  }
  // ::a.b.c.d, deprecated IPv4-compatible form; treat like mapped.
  if (allZeroUpTo(12) && bytes.slice(12).some((b) => b !== 0)) {
    return isPrivateV4(bytes.slice(12));
  }
  // fc00::/7 unique local.
  if ((bytes[0] & 0xfe) === 0xfc) return true;
  // fe80::/10 link-local.
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return true;
  // ff00::/8 multicast.
  if (bytes[0] === 0xff) return true;
  // 2001:db8::/32 documentation.
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8) return true;
  return false;
}

/**
 * True when the address must never be connected to: loopback, link-local,
 * private, CGNAT, multicast, reserved, unspecified, documentation, or
 * unparseable. IPv6 forms that wrap an IPv4 address (mapped, NAT64,
 * compatible) are judged by the IPv4 inside them.
 */
export function isPrivateAddress(ip: string): boolean {
  const trimmed = ip.trim();
  const v4 = parseIpv4(trimmed);
  if (v4) return isPrivateV4(v4);
  const v6 = parseIpv6(trimmed);
  if (v6) return isPrivateV6(v6);
  return true;
}

// ---------------------------------------------------------------------------
// The guard
// ---------------------------------------------------------------------------

/** The host name without the brackets the URL parser keeps around IPv6 literals. */
export function bareHostname(url: URL): string {
  const host = url.hostname;
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
}

function isForbiddenHostname(host: string): boolean {
  const name = host.endsWith('.') ? host.slice(0, -1) : host;
  if (FORBIDDEN_HOSTS.has(name)) return true;
  return FORBIDDEN_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

async function defaultResolve(host: string): Promise<string[]> {
  const records = await lookup(host, { all: true, order: 'verbatim' });
  return records.map((record) => record.address);
}

/**
 * Validates and normalises a URL. Never throws: every outcome is a
 * {@link UrlSafetyResult}, and the `ok: false` branch names the rule that
 * refused it so the API can log `seo.unsafe_url` with a reason.
 */
export async function assertSafeUrl(
  input: string,
  options: UrlGuardOptions = {},
): Promise<UrlSafetyResult> {
  const fail = (reason: UrlRejectReason, extra?: string): UrlSafetyResult => ({
    ok: false,
    reason,
    message: extra ? `${REJECT_MESSAGES[reason]} ${extra}` : REJECT_MESSAGES[reason],
  });

  let url: URL;
  try {
    url = new URL(normaliseUrl(input));
  } catch (error) {
    const reason = error instanceof SeoCrawlError && error.reason ? error.reason : 'invalid';
    return fail(reason);
  }

  // The host is judged before the port: `http://localhost:3000` is refused
  // for being the local machine, which is the reason worth logging, not for
  // its port number.
  const host = bareHostname(url).toLowerCase();
  if (isForbiddenHostname(host)) return fail('host_forbidden');

  if (url.port !== '') {
    const allowed = options.allowPorts ?? [];
    if (!allowed.includes(Number(url.port))) return fail('port');
  }

  const literal = isIP(host);
  if (literal !== 0) {
    if (isPrivateAddress(host)) return fail('private_address');
    return { ok: true, url, addresses: [host] };
  }

  let addresses: string[];
  try {
    addresses = await (options.resolve ?? defaultResolve)(host);
  } catch {
    return fail('unresolvable');
  }
  if (!Array.isArray(addresses) || addresses.length === 0) return fail('unresolvable');

  const offending = addresses.find((address) => isPrivateAddress(address));
  if (offending !== undefined) return fail('private_address', `(${host} → ${offending})`);

  return { ok: true, url, addresses };
}
