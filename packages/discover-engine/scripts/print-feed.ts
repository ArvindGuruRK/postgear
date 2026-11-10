/**
 * The Module 01 hand check: runs the real sources over the recorded feeds and
 * prints what a tab would show. No network.
 *
 *   npx ts-node packages/discover-engine/scripts/print-feed.ts IN-TN ta
 *
 * The first argument is a region or a country that has a recording (`IN-TN`, `IN`,
 * `US-CA`, `US`, `FR-IDF`, `FR`). On a Windows console, run `chcp 65001` first or
 * Tamil text prints as boxes.
 */
import {
  CHENNAI,
  composeFeed,
  createFixtureFetch,
  createGoogleNewsSource,
  createGoogleTrendsSource,
  type Locality,
  PARIS,
  SAN_FRANCISCO,
} from '../src';

const PLACES = [CHENNAI, SAN_FRANCISCO, PARIS];

function placeFor(code: string): Locality | undefined {
  return PLACES.find((place) => place.regionCode === code || place.countryCode === code);
}

function printGroup(heading: string, lines: string[], warnings: string[]): void {
  console.log(`\n${heading} (${lines.length})`);
  for (const warning of warnings) console.log(`  [${warning}]`);
  for (const [index, line] of lines.entries()) console.log(`  ${index + 1}. ${line}`);
}

async function main(): Promise<void> {
  const [code = 'IN-TN', argument] = process.argv.slice(2);
  const locality = placeFor(code);
  if (!locality) {
    console.error(`No recording for "${code}". Try IN-TN, US-CA or FR.`);
    process.exitCode = 1;
    return;
  }

  const language = argument ?? locality.languages[0];
  const input = { locality, language };
  const fetchFixture = createFixtureFetch();

  const [trends, place, top] = await Promise.all([
    createGoogleTrendsSource({ fetch: fetchFixture }).fetch(input),
    createGoogleNewsSource({ fetch: fetchFixture }).place(input),
    createGoogleNewsSource({ fetch: fetchFixture }).top(input),
  ]);

  // Recordings age, so the 48 hour limit stays off here as it does in simulation.
  const [rising, cityStories, topStories] = composeFeed(
    [
      { id: 'rising', items: trends.items },
      { id: 'place', items: place.items },
      { id: 'top', items: top.items },
    ],
    { maxNewsAgeMs: null },
  );

  console.log(`${locality.city}, ${locality.regionName}, in ${language}`);
  printGroup(
    `Rising searches in ${trends.answeredGeo}`,
    rising.items.map((item) => {
      const stories = item.related?.length ?? 0;
      return `${item.title} (${item.signal?.label}, ${stories} related)`;
    }),
    trends.warnings,
  );
  printGroup(
    `${locality.city} stories`,
    cityStories.items.map((item) => `${item.title} (${item.source.name})`),
    place.warnings,
  );
  printGroup(
    'Top stories',
    topStories.items.map((item) => `${item.title} (${item.source.name})`),
    top.warnings,
  );
}

void main();
