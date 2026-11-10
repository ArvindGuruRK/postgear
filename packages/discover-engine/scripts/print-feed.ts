/**
 * The engine's hand check: runs the real sources over the recorded answers and
 * prints what each tab would show for a place. No network.
 *
 *   npx ts-node packages/discover-engine/scripts/print-feed.ts IN-TN ta
 *
 * The first argument is a region or a country that has a recording (`IN-TN`, `IN`,
 * `US-CA`, `US`, `FR-IDF`, `FR`). On a Windows console, run `chcp 65001` first or
 * Tamil text prints as boxes.
 *
 * Trending and News are Module 01's groups. Module 05 added Wikipedia, the two
 * social networks, videos and festivals. The videos are hand-written samples
 * (there is no YouTube key to record with), and the festivals are cut around the
 * real today in the place's own zone, the way the API cuts them.
 */
import {
  CHENNAI,
  composeFeed,
  createBlueskySource,
  createFixtureFetch,
  createGoogleNewsSource,
  createGoogleTrendsSource,
  createHolidaysSource,
  createMastodonSource,
  createWikipediaSource,
  createYoutubeSource,
  daysUntil,
  festivalsInWindow,
  type Locality,
  PARIS,
  SAN_FRANCISCO,
  todayIn,
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

/** "today", "in 5 days", "2 days ago". */
function whenFrom(days: number): string {
  if (days === 0) return 'today';
  const count = `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'}`;
  return days > 0 ? `in ${count}` : `${count} ago`;
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

  const [trends, place, top, wiki, bluesky, mastodon, videos, festivals] = await Promise.all([
    createGoogleTrendsSource({ fetch: fetchFixture }).fetch(input),
    createGoogleNewsSource({ fetch: fetchFixture }).place(input),
    createGoogleNewsSource({ fetch: fetchFixture }).top(input),
    createWikipediaSource({ fetch: fetchFixture }).fetch(input),
    createBlueskySource({ fetch: fetchFixture }).fetch(input),
    createMastodonSource({ fetch: fetchFixture }).fetch(input),
    // Any key reads the sample: simulation matches the address before the key.
    createYoutubeSource({ fetch: fetchFixture, apiKey: 'no-key-in-simulation' }).fetch(input),
    createHolidaysSource({ fetch: fetchFixture }).fetch(input),
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

  // Each of these is one load of its own in the API, so none is composed with another.
  printGroup(
    `Most read on ${wiki.attribution.url ?? 'Wikipedia'}, numbers of ${wiki.answeredDay ?? 'no day'}`,
    wiki.items.map((item) => `${item.title} (${item.signal?.label})`),
    wiki.warnings,
  );
  printGroup(
    'Worldwide on Bluesky and Mastodon',
    [...bluesky.items, ...mastodon.items].map(
      (item) => `${item.title} (${item.signal?.label ?? 'no count'}, ${item.source.name})`,
    ),
    [...bluesky.warnings, ...mastodon.warnings],
  );
  printGroup(
    `Trending videos in ${locality.countryCode} (hand-written samples, ${videos.unitsUsed ?? 0} unit)`,
    videos.items.map(
      (item) =>
        `${item.title}, by ${item.summary ?? 'no channel'} (${item.signal?.label ?? 'views hidden'})`,
    ),
    videos.warnings,
  );

  const today = todayIn(locality.timeZone);
  printGroup(
    `Festivals around ${today}, out of ${festivals.items.length} handed over${festivals.partial ? ', calendar missing' : ''}`,
    festivalsInWindow(festivals.items, today).map((item) => {
      const badge = item.observance ? 'observance' : 'public holiday';
      return `${item.date} ${item.title} (${badge}, ${whenFrom(daysUntil(item.date ?? '', today))})`;
    }),
    festivals.warnings,
  );
}

void main();
