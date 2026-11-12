/**
 * Downloads DB-IP's "IP to Country Lite" CSV for the current month, unpacked,
 * to the path given, for `parseIpCountryCsv` in `src/geo/ip-country.ts` to read:
 *
 *   npx ts-node scripts/download-ip-country.ts <path/to/dbip-country-lite.csv>
 *
 * Run by a person (or a deploy step), never by tests or CI, and never at runtime:
 * the API reads the file it is pointed at and asks nobody.
 *
 * ## Licence
 *
 * The database is DB-IP's, published under Creative Commons Attribution 4.0
 * (https://creativecommons.org/licenses/by/4.0/). Every page that shows or uses
 * a result must credit it with a link back:
 *
 *   IP geolocation by DB-IP (https://db-ip.com)
 *
 * ## The month's file
 *
 * It is published as `dbip-country-lite-<YYYY-MM>.csv.gz` at the start of each
 * month. Early on the first day it may not be there yet, so a 404 for this month
 * is followed by one request for last month's, which is still a good table.
 * A path ending in `.gz` keeps the file packed; any other is written unpacked.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { parseIpCountryCsv } from '../src/geo/ip-country';

const BASE_URL = 'https://download.db-ip.com/free';
const USER_AGENT = 'PostGear-Discover/1.0 (+https://postgear.rkay.in)';
const TIMEOUT_MS = 120_000;
/** The real file has hundreds of thousands of ranges. Far fewer is a broken download, not a table. */
const MIN_RANGES = 10_000;

/** `2026-11`, or the month before it, in UTC. */
function monthOf(monthsBack: number): string {
  const now = new Date();
  const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsBack, 1));
  return month.toISOString().slice(0, 7);
}

function ipCountryUrl(month: string): string {
  return `${BASE_URL}/dbip-country-lite-${month}.csv.gz`;
}

async function download(url: string): Promise<Buffer | null> {
  const response = await fetch(url, {
    headers: { 'user-agent': USER_AGENT },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (response.status === 404) return null;
  if (response.status !== 200) throw new Error(`${url} answered HTTP ${response.status}.`);
  return Buffer.from(await response.arrayBuffer());
}

async function main(): Promise<void> {
  const target = process.argv[2];
  if (!target) {
    console.error('Usage: ts-node scripts/download-ip-country.ts <output path>');
    process.exitCode = 1;
    return;
  }

  let packed: Buffer | null = null;
  let month = '';
  for (const monthsBack of [0, 1]) {
    month = monthOf(monthsBack);
    packed = await download(ipCountryUrl(month));
    if (packed) break;
    console.log(`No file for ${month} yet.`);
  }
  if (!packed) throw new Error('Neither this month nor last month has a file.');

  const csv = gunzipSync(packed).toString('utf8');
  const table = parseIpCountryCsv(csv);
  const ranges = table.v4Starts.length + table.v6Countries.length;
  if (ranges < MIN_RANGES) {
    throw new Error(`The ${month} file has only ${ranges} ranges, so it was not written.`);
  }

  // Run through `npm run discover:ip-db` the working folder is this package's,
  // so a relative path is read from where the person typed it (INIT_CWD).
  const path = resolve(process.env.INIT_CWD ?? process.cwd(), target);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, path.endsWith('.gz') ? packed : csv);
  console.log(
    `Wrote ${month}: ${table.v4Starts.length} IPv4 and ${table.v6Countries.length} IPv6 ranges (${table.skipped} lines skipped) to ${path}.`,
  );
  console.log('Credit it where it is used: IP geolocation by DB-IP (https://db-ip.com).');
}

main().catch((error: unknown) => {
  console.error((error as Error).message);
  process.exitCode = 1;
});
