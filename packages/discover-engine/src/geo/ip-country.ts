/**
 * The country an IP address is in, from DB-IP's free "IP to Country Lite"
 * database: a first guess at a place that needs no permission prompt and no
 * outside call, better than the browser's time zone where one zone covers many
 * countries.
 *
 * ## The data and its licence
 *
 * DB-IP publishes the file monthly under Creative Commons Attribution 4.0
 * (https://creativecommons.org/licenses/by/4.0/). A page that shows or uses a
 * result must credit it with a link: "IP geolocation by DB-IP", linking to
 * https://db-ip.com. `scripts/download-ip-country.ts` fetches the month's file;
 * nothing here reaches the network, and the table is built from text it is handed.
 *
 * ## The format
 *
 * One range a line, `start,end,country` (RFC 4180, so a field may be quoted):
 * `1.0.0.0,1.0.0.255,AU`, and IPv6 rows in the same file
 * (`2001:200::,2001:200:ffff:ffff:ffff:ffff:ffff:ffff,JP`). `ZZ` marks a range
 * with no country. A line that does not read as a range (a header, a blank, a
 * bad address, an end before its start) is skipped and counted, never thrown on.
 *
 * ## The lookup
 *
 * IPv4 ranges sit in typed arrays and IPv6 ranges in `BigUint64Array`s, each
 * address split into its high and low 64 bits, so a whole month's file stays
 * compact. Both are sorted by start and searched by halving. An IPv4-mapped IPv6
 * address (`::ffff:1.2.3.4`, which a dual-stack server reports for an IPv4
 * client) is looked up as the IPv4 address it carries.
 *
 * Private, loopback, link-local, documentation, multicast and other reserved
 * addresses answer null without a search: they say nothing about where a
 * person is, and a range file that wrongly covered one must not make it say so.
 */

export interface IpCountryTable {
  readonly v4Starts: Uint32Array;
  readonly v4Ends: Uint32Array;
  /** Two letters as one number: the first in the high byte. */
  readonly v4Countries: Uint16Array;
  readonly v6StartHigh: BigUint64Array;
  readonly v6StartLow: BigUint64Array;
  readonly v6EndHigh: BigUint64Array;
  readonly v6EndLow: BigUint64Array;
  readonly v6Countries: Uint16Array;
  /** Lines that were not a range with a country, `ZZ` ones included. */
  readonly skipped: number;
}

const COUNTRY = /^[A-Z]{2}$/;
const NO_COUNTRY = 'ZZ';
const LOW_64 = (1n << 64n) - 1n;

type Address = { version: 4; value: number } | { version: 6; value: bigint };

/** Dotted quad, four decimal parts of 0 to 255 with no leading zero (which some read as octal). */
function parseIpv4(text: string): number | null {
  const parts = text.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) return null;
    const byte = Number(part);
    if (byte > 255) return null;
    value = value * 256 + byte;
  }
  return value;
}

/** Eight groups, `::` once at most, and an IPv4 tail allowed in the last 32 bits. */
function parseIpv6(text: string): bigint | null {
  if (!/^[0-9a-fA-F:.]+$/.test(text)) return null;

  let words: number[] = [];
  const halves = text.split('::');
  if (halves.length > 2) return null;

  const groupsOf = (half: string): number[] | null => {
    if (half === '') return [];
    const groups: number[] = [];
    const pieces = half.split(':');
    for (const [index, piece] of pieces.entries()) {
      if (piece.includes('.')) {
        // Only the very last piece may be an IPv4 tail.
        if (index !== pieces.length - 1) return null;
        const v4 = parseIpv4(piece);
        if (v4 === null) return null;
        groups.push(Math.floor(v4 / 65536), v4 % 65536);
      } else {
        if (!/^[0-9a-fA-F]{1,4}$/.test(piece)) return null;
        groups.push(Number.parseInt(piece, 16));
      }
    }
    return groups;
  };

  const head = groupsOf(halves[0]);
  const tail = halves.length === 2 ? groupsOf(halves[1]) : [];
  if (head === null || tail === null) return null;
  // An IPv4 tail can only end the address, never the part before `::`.
  if (halves.length === 2 && halves[0].includes('.')) return null;

  if (halves.length === 2) {
    const missing = 8 - head.length - tail.length;
    if (missing < 1) return null;
    words = [...head, ...new Array<number>(missing).fill(0), ...tail];
  } else {
    words = head;
  }
  if (words.length !== 8) return null;

  return words.reduce((value, word) => (value << 16n) | BigInt(word), 0n);
}

/**
 * An address as a lookup reads it. Brackets and a zone (`[fe80::1%eth0]`) are
 * taken off, since a server may report either; anything else that is not one
 * address is null.
 */
function parseAddress(raw: string): Address | null {
  let text = raw.trim();
  if (text.startsWith('[') && text.endsWith(']')) text = text.slice(1, -1);
  const zone = text.indexOf('%');
  if (zone !== -1) text = text.slice(0, zone);
  if (text === '' || text.length > 45) return null;

  if (text.includes(':')) {
    const value = parseIpv6(text);
    return value === null ? null : { version: 6, value };
  }
  const value = parseIpv4(text);
  return value === null ? null : { version: 4, value };
}

/** `[first address, prefix length]`, IPv4 as a number. */
const RESERVED_V4: readonly (readonly [string, number])[] = [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // documentation
  ['192.88.99.0', 24], // retired 6to4 relay
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentation
  ['203.0.113.0', 24], // documentation
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, and the broadcast address
];

const RESERVED_V6: readonly (readonly [string, number])[] = [
  ['::', 96], // unspecified, loopback, and the retired IPv4-compatible form
  ['64:ff9b::', 96], // NAT64: the address inside is the server's, not the person's
  ['64:ff9b:1::', 48], // local NAT64
  ['100::', 64], // discard
  ['2001:db8::', 32], // documentation
  ['3fff::', 20], // documentation (2024)
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['ff00::', 8], // multicast
];

const V4_RANGES = RESERVED_V4.map(([first, bits]) => {
  const start = parseIpv4(first) ?? 0;
  return [start, start + 2 ** (32 - bits) - 1] as const;
});

const V6_RANGES = RESERVED_V6.map(([first, bits]) => {
  const start = parseIpv6(first) ?? 0n;
  return [start, start + (1n << BigInt(128 - bits)) - 1n] as const;
});

const MAPPED_V4_PREFIX = 0xffffn << 32n;

function isReservedV4(value: number): boolean {
  return V4_RANGES.some(([start, end]) => value >= start && value <= end);
}

function isReservedV6(value: bigint): boolean {
  return V6_RANGES.some(([start, end]) => value >= start && value <= end);
}

function packCountry(code: string): number {
  return (code.charCodeAt(0) << 8) | code.charCodeAt(1);
}

function unpackCountry(packed: number): string {
  return String.fromCharCode(packed >> 8, packed & 0xff);
}

/** One RFC 4180 field: surrounding quotes off, a doubled quote inside back to one. */
function unquote(field: string): string {
  const text = field.trim();
  return text.length >= 2 && text.startsWith('"') && text.endsWith('"')
    ? text.slice(1, -1).replace(/""/g, '"')
    : text;
}

/** Builds the lookup table from the CSV's text. Never throws on what is inside it. */
export function parseIpCountryCsv(csvText: string): IpCountryTable {
  const v4: [number, number, number][] = [];
  const v6: [bigint, bigint, number][] = [];
  let skipped = 0;

  for (const line of csvText.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    // The three fields are addresses and a code, none of which holds a comma.
    const fields = line.split(',');
    if (fields.length !== 3) {
      skipped += 1;
      continue;
    }

    const country = unquote(fields[2]).toUpperCase();
    const start = parseAddress(unquote(fields[0]));
    const end = parseAddress(unquote(fields[1]));
    if (
      !COUNTRY.test(country) ||
      country === NO_COUNTRY ||
      !start ||
      !end ||
      start.version !== end.version ||
      start.value > end.value
    ) {
      skipped += 1;
      continue;
    }

    if (start.version === 4) v4.push([start.value, end.value as number, packCountry(country)]);
    else v6.push([start.value, end.value as bigint, packCountry(country)]);
  }

  v4.sort((a, b) => a[0] - b[0]);
  v6.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

  return {
    v4Starts: Uint32Array.from(v4, (row) => row[0]),
    v4Ends: Uint32Array.from(v4, (row) => row[1]),
    v4Countries: Uint16Array.from(v4, (row) => row[2]),
    v6StartHigh: BigUint64Array.from(v6, (row) => row[0] >> 64n),
    v6StartLow: BigUint64Array.from(v6, (row) => row[0] & LOW_64),
    v6EndHigh: BigUint64Array.from(v6, (row) => row[1] >> 64n),
    v6EndLow: BigUint64Array.from(v6, (row) => row[1] & LOW_64),
    v6Countries: Uint16Array.from(v6, (row) => row[2]),
    skipped,
  };
}

/** The index of the last start at or below `value`, or -1. */
function lastStartAtOrBelow(count: number, startAt: (index: number) => boolean): number {
  let low = 0;
  let high = count - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    if (startAt(middle)) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}

function lookupV4(table: IpCountryTable, value: number): string | null {
  if (isReservedV4(value)) return null;
  const index = lastStartAtOrBelow(table.v4Starts.length, (i) => table.v4Starts[i] <= value);
  return index !== -1 && value <= table.v4Ends[index]
    ? unpackCountry(table.v4Countries[index])
    : null;
}

function lookupV6(table: IpCountryTable, value: bigint): string | null {
  if (value >> 32n === MAPPED_V4_PREFIX >> 32n) return lookupV4(table, Number(value & 0xffffffffn));
  if (isReservedV6(value)) return null;

  const at = (high: BigUint64Array, low: BigUint64Array, index: number) =>
    (high[index] << 64n) | low[index];
  const index = lastStartAtOrBelow(
    table.v6Countries.length,
    (i) => at(table.v6StartHigh, table.v6StartLow, i) <= value,
  );
  return index !== -1 && value <= at(table.v6EndHigh, table.v6EndLow, index)
    ? unpackCountry(table.v6Countries[index])
    : null;
}

/**
 * The ISO 3166-1 alpha-2 country of an address, or null: for an address that is
 * not one, a reserved or private one, one no range covers, or one whose range
 * has no country.
 */
export function lookupCountry(table: IpCountryTable, ip: string): string | null {
  const address = typeof ip === 'string' ? parseAddress(ip) : null;
  if (!address) return null;
  return address.version === 4 ? lookupV4(table, address.value) : lookupV6(table, address.value);
}
