/**
 * Records the public answers simulation serves, into
 * `fixtures/<place>/<feed>.<YYYY-MM-DD>.<xml|json|ics>`. Run by a person, with the
 * owner's OK, never by tests or CI:
 *
 *   npm run fixtures --workspace=@postgear/discover-engine -- --dry-run
 *   npm run fixtures --workspace=@postgear/discover-engine
 *
 * ## A recording is made once
 *
 * A feed that already has a recording is skipped, so a run only ever asks for
 * what is missing: adding a source to `FIXTURE_FEEDS` and running this again does
 * not touch the feeds recorded before it. `--dry-run` prints what a run would ask
 * for and asks for nothing. Hand-written samples (YouTube, which needs a key) are
 * never fetched.
 *
 * About two seconds apart, no retries: an address that does not answer is reported
 * and left for another day, not asked again. The one exception is the source's own
 * rule, not a retry: Wikipedia publishes a day's numbers some hours into the next,
 * so a 404 for yesterday is followed by one request for the day before, which is
 * exactly what the source does.
 *
 * ## The two banned characters
 *
 * The em dash and the middle dot may not appear anywhere in this project. A feed
 * gets them as numeric entities and JSON as `\u` escapes, and nothing is lost:
 * `stripHtml` and `JSON.parse` turn them back. A calendar has no escape, so there
 * they become a hyphen and a full stop, and the run says how many it changed.
 */
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  FIXTURE_FEEDS,
  type FixtureFeed,
  type FixtureType,
  fixtureFileName,
  recordingsOf,
} from '../src/simulation';
import { GDELT_DOC_URL } from '../src/sources/gdelt';

/** The same name Discover gives every outside service (`DISCOVER_GEOCODER_USER_AGENT`'s default). */
const USER_AGENT = 'PostGear/1.0 (+https://postgear.rkay.in)';
const PAUSE_MS = 2_000;
/** GDELT asks for one request every five seconds from an address, and answers 429 sooner. */
const GDELT_PAUSE_MS = 6_000;
const TIMEOUT_MS = 20_000;
const SOFT_LIMIT_BYTES = 1024 * 1024;
const DAY_MS = 24 * 60 * 60 * 1000;

const ACCEPT: Record<FixtureType, string> = {
  xml: 'application/rss+xml, application/xml;q=0.9, text/xml;q=0.8',
  json: 'application/json',
  ics: 'text/calendar, text/plain;q=0.9',
  // Never recorded: the only pages are the hand-written competitor samples.
  html: 'text/html',
};

const EM_DASH = new RegExp(String.fromCodePoint(0x2014), 'g');
const MIDDLE_DOT = new RegExp(String.fromCodePoint(0xb7), 'g');

function withoutBannedCharacters(body: string, type: FixtureType): string {
  if (type === 'json') return body.replace(EM_DASH, '\\u2014').replace(MIDDLE_DOT, '\\u00b7');
  if (type === 'ics') return body.replace(EM_DASH, '-').replace(MIDDLE_DOT, '.');
  return body.replace(EM_DASH, '&#8212;').replace(MIDDLE_DOT, '&#183;');
}

function bannedCount(body: string): number {
  return (body.match(EM_DASH)?.length ?? 0) + (body.match(MIDDLE_DOT)?.length ?? 0);
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The UTC day `daysAgo` days back, as the Wikimedia address writes it. */
function utcDay(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * DAY_MS).toISOString().slice(0, 10).replace(/-/g, '/');
}

/** The addresses to ask, in order. Only a dated feed has a second one, for a 404 on the first. */
function addressesOf(feed: FixtureFeed): string[] {
  return feed.dated ? [`${feed.url}${utcDay(1)}`, `${feed.url}${utcDay(2)}`] : [feed.url];
}

async function ask(url: string, type: FixtureType): Promise<{ status: number; body: string }> {
  const response = await fetch(url, {
    headers: { accept: ACCEPT[type], 'user-agent': USER_AGENT },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return { status: response.status, body: response.status === 200 ? await response.text() : '' };
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const root = join(__dirname, '..', 'fixtures');
  const date = new Date().toISOString().slice(0, 10);
  const failed: string[] = [];

  const missing: FixtureFeed[] = [];
  for (const feed of FIXTURE_FEEDS) {
    if (feed.sample) continue;
    if ((await recordingsOf(root, feed)).length === 0) missing.push(feed);
  }

  console.log(
    `${FIXTURE_FEEDS.length} in the list, ${missing.length} not recorded yet${dryRun ? ' (dry run, nothing is fetched)' : ''}.`,
  );

  let asked = 0;
  for (const feed of missing) {
    const label = `${feed.place}/${feed.name}`;
    const type = feed.type ?? 'xml';
    const addresses = addressesOf(feed);

    if (dryRun) {
      console.log(
        `  ${label}: ${addresses[0]}${addresses[1] ? ' (then the day before on a 404)' : ''}`,
      );
      continue;
    }

    try {
      let answer: { status: number; body: string } | null = null;
      for (const address of addresses) {
        if (asked > 0) await pause(address.startsWith(GDELT_DOC_URL) ? GDELT_PAUSE_MS : PAUSE_MS);
        asked += 1;
        answer = await ask(address, type);
        if (answer.status !== 404) break;
      }

      if (answer?.status !== 200) {
        failed.push(`${label}: HTTP ${answer?.status}`);
        console.log(`  ${label}: HTTP ${answer?.status}, skipped`);
        continue;
      }

      const folder = join(root, feed.place);
      mkdirSync(folder, { recursive: true });
      const path = join(folder, fixtureFileName(feed, date));
      const changed = type === 'ics' ? bannedCount(answer.body) : 0;
      writeFileSync(path, withoutBannedCharacters(answer.body, type));

      const size = statSync(path).size;
      const notes = [
        size > SOFT_LIMIT_BYTES ? 'over 1 MiB' : '',
        changed > 0 ? `${changed} banned character(s) replaced` : '',
        // A calendar names itself, which is how its id is checked.
        type === 'ics' ? (/^X-WR-CALNAME:(.*)$/m.exec(answer.body)?.[1]?.trim() ?? 'no name') : '',
      ].filter(Boolean);
      console.log(
        `  ${label}: ${Math.round(size / 1024)} KiB${notes.length > 0 ? ` (${notes.join(', ')})` : ''}`,
      );
    } catch (error) {
      failed.push(`${label}: ${(error as Error).name}`);
      console.log(`  ${label}: failed, skipped`);
    }
  }

  if (!dryRun) console.log(`\n${asked} request(s) made.`);

  if (failed.length > 0) {
    console.log(`\n${failed.length} not recorded:\n${failed.join('\n')}`);
    process.exitCode = 1;
  }
}

void main();
