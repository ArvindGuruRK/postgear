/**
 * `DISCOVER_SIMULATION`: real recorded feeds instead of the network.
 *
 * {@link FIXTURE_FEEDS} is the one list of what is recorded, shared with
 * `scripts/record-fixtures.ts`. Each feed is matched by the address the sources
 * really ask for, so the path through the engine is the same as the real thing,
 * including the fallback when a place has no recording.
 */
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { editionFor, type NewsLocale } from './geo/editions';
import { newsPlaceUrl, newsTopUrl } from './sources/google-news';
import { trendsFeedUrl } from './sources/google-trends';
import type { DiscoverFetch } from './types';

export { createSimulatedGeocoder } from './geo/geocoder/simulated';

export interface FixtureFeed {
  /** The folder under `fixtures/`. */
  place: string;
  /** The file name, before its date. */
  name: string;
  url: string;
}

function newsFeeds(place: string, city: string, locale: NewsLocale): FixtureFeed[] {
  const edition = locale.ceid.replace(':', '-');
  return [
    { place, name: `news-top-${edition}`, url: newsTopUrl(locale) },
    { place, name: `news-place-${edition}`, url: newsPlaceUrl(city, locale) },
  ];
}

export const FIXTURE_FEEDS: readonly FixtureFeed[] = [
  { place: 'chennai', name: 'trends-IN-TN', url: trendsFeedUrl('IN-TN') },
  { place: 'chennai', name: 'trends-IN', url: trendsFeedUrl('IN') },
  ...newsFeeds('chennai', 'Chennai', editionFor('IN', 'ta')),
  ...newsFeeds('chennai', 'Chennai', editionFor('IN', 'en')),
  { place: 'san-francisco', name: 'trends-US-CA', url: trendsFeedUrl('US-CA') },
  ...newsFeeds('san-francisco', 'San Francisco', editionFor('US', 'en')),
  { place: 'paris', name: 'trends-FR', url: trendsFeedUrl('FR') },
  ...newsFeeds('paris', 'Paris', editionFor('FR', 'fr')),
];

/**
 * Walks up from here rather than counting levels, because compiled workspace
 * packages land under `dist/` in the API. Simulation is refused in production, so
 * the folder only has to be found in a checkout.
 */
function findFixturesDir(): string {
  let directory = __dirname;
  for (;;) {
    for (const candidate of [
      join(directory, 'fixtures'),
      join(directory, 'packages', 'discover-engine', 'fixtures'),
    ]) {
      if (existsSync(join(candidate, 'chennai'))) return candidate;
    }
    const parent = dirname(directory);
    if (parent === directory) throw new Error('The Discover fixtures folder was not found.');
    directory = parent;
  }
}

/** A topic has no recording of its own: it reads as that edition's top stories. */
function asRecordedUrl(url: string): string {
  return url.replace(/\/rss\/headlines\/section\/topic\/[^?]+\?/, '/rss?');
}

/**
 * Serves the newest recording of a feed, and a 404 for anything not recorded,
 * which the sources read as "nothing here".
 */
export function createFixtureFetch(options: { directory?: string } = {}): DiscoverFetch {
  const directory = options.directory ?? findFixturesDir();

  return async (url) => {
    const feed = FIXTURE_FEEDS.find((entry) => entry.url === asRecordedUrl(url));
    if (!feed) return { status: 404, body: '', finalUrl: url };

    const folder = join(directory, feed.place);
    const recordings = (await readdir(folder))
      .filter((file) => file.startsWith(`${feed.name}.`) && file.endsWith('.xml'))
      .sort();
    const newest = recordings.at(-1);
    if (!newest) return { status: 404, body: '', finalUrl: url };

    return { status: 200, body: await readFile(join(folder, newest), 'utf8'), finalUrl: url };
  };
}
