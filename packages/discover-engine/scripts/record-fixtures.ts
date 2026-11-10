/**
 * Records the public feeds simulation serves, into
 * `fixtures/<place>/<feed>.<YYYY-MM-DD>.xml`. Run by a person, with the owner's OK,
 * never by tests or CI:
 *
 *   npm run fixtures --workspace=@postgear/discover-engine
 *
 * Twelve requests, about two seconds apart, no retries: a feed that does not
 * answer is reported and left for another day, not asked again.
 *
 * The em dash and the middle dot are written as numeric entities, because neither
 * character may appear anywhere in this project. Nothing is lost: feed text goes
 * through `stripHtml`, which decodes them back.
 */
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FIXTURE_FEEDS } from '../src/simulation';

const USER_AGENT = 'PostGearBot/1.0 (+https://postgear.rkay.in; recording test fixtures)';
const PAUSE_MS = 2_000;
const TIMEOUT_MS = 20_000;
const SOFT_LIMIT_BYTES = 1024 * 1024;

const EM_DASH = new RegExp(String.fromCodePoint(0x2014), 'g');
const MIDDLE_DOT = new RegExp(String.fromCodePoint(0xb7), 'g');

function withoutBannedCharacters(body: string): string {
  return body.replace(EM_DASH, '&#8212;').replace(MIDDLE_DOT, '&#183;');
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const root = join(__dirname, '..', 'fixtures');
  const date = new Date().toISOString().slice(0, 10);
  const failed: string[] = [];

  for (const [index, feed] of FIXTURE_FEEDS.entries()) {
    if (index > 0) await pause(PAUSE_MS);

    const label = `${feed.place}/${feed.name}`;
    try {
      const response = await fetch(feed.url, {
        headers: {
          accept: 'application/rss+xml, application/xml;q=0.9, text/xml;q=0.8',
          'user-agent': USER_AGENT,
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (response.status !== 200) {
        failed.push(`${label}: HTTP ${response.status}`);
        console.log(`  ${label}: HTTP ${response.status}, skipped`);
        continue;
      }

      const folder = join(root, feed.place);
      mkdirSync(folder, { recursive: true });
      const path = join(folder, `${feed.name}.${date}.xml`);
      writeFileSync(path, withoutBannedCharacters(await response.text()));

      const size = statSync(path).size;
      const note = size > SOFT_LIMIT_BYTES ? ' (over 1 MiB)' : '';
      console.log(`  ${label}: ${Math.round(size / 1024)} KiB${note}`);
    } catch (error) {
      failed.push(`${label}: ${(error as Error).message}`);
      console.log(`  ${label}: failed, skipped`);
    }
  }

  if (failed.length > 0) {
    console.log(`\n${failed.length} feed(s) not recorded:\n${failed.join('\n')}`);
    process.exitCode = 1;
  }
}

void main();
