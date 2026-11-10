/**
 * `DISCOVER_SIMULATION`: real recorded answers instead of the network.
 *
 * {@link FIXTURE_FEEDS} is the one list of what is recorded, shared with
 * `scripts/record-fixtures.ts`. Each one is matched by the address the sources
 * really ask for, so the path through the engine is the same as the real thing,
 * including the fallback when a place has no recording.
 *
 * Two addresses move, so they are matched on what comes before the moving part:
 * Wikipedia's ends in a day, and YouTube's in the key. Any day reads the one
 * recording, which keeps the Wikipedia group alive long after it was made.
 *
 * YouTube has no recording: there is no key to record with. Its files are written
 * by hand, named `.sample.` and marked inside as samples, and a real recording,
 * if one is ever made, is served in their place.
 */
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { editionFor, type NewsLocale } from './geo/editions';
import { BLUESKY_TRENDS_URL } from './sources/bluesky';
import { newsPlaceUrl, newsTopUrl } from './sources/google-news';
import { trendsFeedUrl } from './sources/google-trends';
import { HOLIDAY_CALENDAR_IDS, holidayCalendarUrl } from './sources/holidays/google-calendar';
import { mastodonTrendsUrl } from './sources/mastodon';
import { wikipediaTopPrefix } from './sources/wikipedia';
import { youtubePopularPrefix } from './sources/youtube';
import type { DiscoverFetch } from './types';

export { createSimulatedGeocoder } from './geo/geocoder/simulated';

export type FixtureType = 'xml' | 'json' | 'ics';

export interface FixtureFeed {
  /** The folder under `fixtures/`. */
  place: string;
  /** The file name, before its date. */
  name: string;
  /** The address the source asks for, or what it starts with when `match` is `prefix`. */
  url: string;
  /** `prefix` when the address ends in something that moves: a day, or a key. */
  match?: 'prefix';
  /** The recording's file type. A feed (`xml`) when left out. */
  type?: FixtureType;
  /** The address ends in a UTC day (`YYYY/MM/DD`), which the recorder fills in. */
  dated?: boolean;
  /** Written by hand and marked as a sample. Never fetched by the recorder. */
  sample?: boolean;
}

function newsFeeds(place: string, city: string, locale: NewsLocale): FixtureFeed[] {
  const edition = locale.ceid.replace(':', '-');
  return [
    { place, name: `news-top-${edition}`, url: newsTopUrl(locale) },
    { place, name: `news-place-${edition}`, url: newsPlaceUrl(city, locale) },
  ];
}

function wikipedia(place: string, language: string): FixtureFeed {
  return {
    place,
    name: `wikipedia-${language}`,
    url: wikipediaTopPrefix(`${language}.wikipedia`),
    match: 'prefix',
    type: 'json',
    dated: true,
  };
}

function holidays(place: string, countryCode: string): FixtureFeed {
  return {
    place,
    name: `holidays-${countryCode}`,
    url: holidayCalendarUrl(HOLIDAY_CALENDAR_IDS[countryCode]),
    type: 'ics',
  };
}

function youtubeSample(place: string, countryCode: string): FixtureFeed {
  return {
    place,
    name: `youtube-${countryCode}`,
    url: youtubePopularPrefix(countryCode),
    match: 'prefix',
    type: 'json',
    sample: true,
  };
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

  // Module 05. English Wikipedia sits with San Francisco, and also answers for
  // Chennai read in English and for Worldwide: a recording is found by its
  // address, never by its folder.
  wikipedia('chennai', 'ta'),
  wikipedia('san-francisco', 'en'),
  wikipedia('paris', 'fr'),
  { place: 'worldwide', name: 'bluesky-trends', url: BLUESKY_TRENDS_URL, type: 'json' },
  { place: 'worldwide', name: 'mastodon-tags', url: mastodonTrendsUrl(), type: 'json' },
  holidays('chennai', 'IN'),
  holidays('san-francisco', 'US'),
  holidays('paris', 'FR'),
  youtubeSample('chennai', 'IN'),
  youtubeSample('san-francisco', 'US'),
  youtubeSample('paris', 'FR'),
];

/** `trends-IN.2026-11-04.xml`, and for a hand-written one `youtube-IN.sample.json`. */
export function fixtureFileName(feed: FixtureFeed, stamp: string): string {
  return `${feed.name}.${stamp}.${feed.type ?? 'xml'}`;
}

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

function feedFor(url: string): FixtureFeed | undefined {
  const asked = asRecordedUrl(url);
  return FIXTURE_FEEDS.find((entry) =>
    entry.match === 'prefix' ? asked.startsWith(entry.url) : entry.url === asked,
  );
}

/** The files recorded for a feed, oldest first, and a hand-written sample only when there are none. */
export async function recordingsOf(directory: string, feed: FixtureFeed): Promise<string[]> {
  const folder = join(directory, feed.place);
  if (!existsSync(folder)) return [];

  const suffix = `.${feed.type ?? 'xml'}`;
  const files = (await readdir(folder)).filter(
    (file) => file.startsWith(`${feed.name}.`) && file.endsWith(suffix),
  );
  const sample = fixtureFileName(feed, 'sample');
  const recorded = files.filter((file) => file !== sample).sort();
  return recorded.length > 0 ? recorded : files.filter((file) => file === sample);
}

/**
 * Serves the newest recording of a feed, and a 404 for anything not recorded,
 * which the sources read as "nothing here".
 */
export function createFixtureFetch(options: { directory?: string } = {}): DiscoverFetch {
  const directory = options.directory ?? findFixturesDir();

  return async (url) => {
    const feed = feedFor(url);
    if (!feed) return { status: 404, body: '', finalUrl: url };

    const newest = (await recordingsOf(directory, feed)).at(-1);
    if (!newest) return { status: 404, body: '', finalUrl: url };

    return {
      status: 200,
      body: await readFile(join(directory, feed.place, newest), 'utf8'),
      finalUrl: url,
    };
  };
}
