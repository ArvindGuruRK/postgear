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
 *
 * GDELT (Module 10) is matched by its whole address, which names the place and
 * the language, so each recording answers only the place and language it was
 * made for. Any other GDELT address answers an empty article list, not a 404.
 *
 * Competitors (Module 07) have one invented company, {@link COMPETITOR_SAMPLE},
 * whose website, feeds, channel and accounts are all hand-written samples in
 * `fixtures/competitors/acme/`. Anything else a person types under simulation is
 * a 404, so no stranger's site is ever fetched. Its Instagram (Module 10) is a
 * sample too, and any other Instagram username is Graph's "not found".
 */
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { editionFor, type NewsLocale } from './geo/editions';
import { CHENNAI, PARIS, SAN_FRANCISCO } from './geo/geocoder/simulated';
import { GOOGLE_NEWS_BATCH_URL, isGoogleNewsLink } from './reader/google-news-link';
import { BLUESKY_TRENDS_URL } from './sources/bluesky';
import { blueskyAuthorFeedUrl } from './sources/bluesky-author';
import { GDELT_DOC_URL, gdeltDocUrl, gdeltQuery } from './sources/gdelt';
import { newsPlaceUrl, newsTopUrl } from './sources/google-news';
import { trendsFeedUrl } from './sources/google-trends';
import { HOLIDAY_CALENDAR_IDS, holidayCalendarUrl } from './sources/holidays/google-calendar';
import { businessDiscoveryUsername, instagramBusinessPrefix } from './sources/instagram-business';
import { mastodonTrendsUrl } from './sources/mastodon';
import { mastodonLookupUrl, mastodonStatusesUrl } from './sources/mastodon-account';
import { wikipediaTopPrefix } from './sources/wikipedia';
import { youtubePopularPrefix } from './sources/youtube';
import { youtubeChannelFeedUrl } from './sources/youtube-channel';
import type { DiscoverFetch, Locality } from './types';

export { createSimulatedGeocoder } from './geo/geocoder/simulated';

export type FixtureType = 'xml' | 'json' | 'ics' | 'html';

export interface FixtureFeed {
  /** The folder under `fixtures/`. */
  place: string;
  /** The file name, before its date. */
  name: string;
  /** The address the source asks for, or what it starts with when `match` is `prefix`. */
  url: string;
  /** `prefix` when the address ends in something that moves: a day, or a key. */
  match?: 'prefix';
  /**
   * Decides instead of `url` and `match`, for an address whose moving parts sit
   * in the middle: Instagram's names a Graph version and the workspace's own
   * account before the competitor.
   */
  matches?: (url: string) => boolean;
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

  // Module 10. One article list per place, in its first language. Paris is a
  // recording; GDELT refused Chennai and San Francisco with a 429 twice on the
  // day, so theirs are hand-written until a real one is made.
  gdelt('chennai', CHENNAI, 'ta', { sample: true }),
  gdelt('san-francisco', SAN_FRANCISCO, 'en', { sample: true }),
  gdelt('paris', PARIS, 'fr'),
];

function gdelt(
  place: string,
  locality: Locality,
  language: string,
  extra: Pick<FixtureFeed, 'sample'> = {},
): FixtureFeed {
  const query = gdeltQuery(locality, language);
  if (!query) throw new Error(`No GDELT query for ${place}.`);
  return { place, name: 'gdelt', url: gdeltDocUrl(query), type: 'json', ...extra };
}

/**
 * An article list with nothing in it: what simulation answers for a GDELT
 * address it has no recording of (another place, or another language), so a
 * place it does not know reads as a quiet day rather than as GDELT being down.
 */
const GDELT_NOTHING = '{"articles":[]}';

/**
 * The competitor every simulated screen follows (Module 07). All of it is
 * invented and lives on `.example`, a name reserved for exactly this, so it can
 * never be mistaken for a real company or reach a real site.
 */
export const COMPETITOR_SAMPLE = {
  name: 'Acme',
  website: 'https://acme.example/',
  blogFeed: 'https://acme.example/blog/rss.xml',
  changelogFeed: 'https://acme.example/changelog/atom.xml',
  youtubeChannelId: 'UCacmeSampleChannel00000',
  blueskyHandle: 'acme.example',
  mastodonAcct: 'acme@mastodon.example',
  mastodonAccountId: '110000000000000001',
  /** Module 10. A username is not a host name, so this one needs no `.example`. */
  instagramUsername: 'acme.sample',
} as const;

const COMPETITOR_FOLDER = 'competitors/acme';

function competitorSample(
  name: string,
  url: string,
  extra: Pick<FixtureFeed, 'type' | 'match' | 'matches'> = {},
): FixtureFeed {
  return { place: COMPETITOR_FOLDER, name, url, sample: true, ...extra };
}

/**
 * What simulation answers for that competitor. Written by hand, never recorded,
 * and kept out of {@link FIXTURE_FEEDS}, which is the recorder's list: no real
 * site stands behind any of these addresses.
 *
 * The news search is matched on how its address starts, so it answers for any
 * phrase that opens with the sample's name, in whichever edition is asked.
 * Instagram (Module 10) is matched on the username it asks about, at any Graph
 * version, for any account and token; every other username is Graph's
 * "Cannot find User".
 */
export const COMPETITOR_FIXTURES: readonly FixtureFeed[] = [
  competitorSample('site', COMPETITOR_SAMPLE.website, { type: 'html' }),
  competitorSample('blog-rss', COMPETITOR_SAMPLE.blogFeed),
  competitorSample('changelog-atom', COMPETITOR_SAMPLE.changelogFeed),
  competitorSample('youtube-channel', youtubeChannelFeedUrl(COMPETITOR_SAMPLE.youtubeChannelId)),
  competitorSample('bluesky-author', blueskyAuthorFeedUrl(COMPETITOR_SAMPLE.blueskyHandle), {
    type: 'json',
  }),
  competitorSample(
    'mastodon-lookup',
    mastodonLookupUrl({ user: 'acme', instance: 'mastodon.example' }),
    { type: 'json' },
  ),
  competitorSample(
    'mastodon-statuses',
    mastodonStatusesUrl('mastodon.example', COMPETITOR_SAMPLE.mastodonAccountId),
    { type: 'json' },
  ),
  competitorSample(
    'news-search',
    `https://news.google.com/rss/search?q=${encodeURIComponent(`"${COMPETITOR_SAMPLE.name}`)}`,
    { match: 'prefix' },
  ),
  competitorSample(
    'instagram',
    instagramBusinessPrefix({
      igUserId: '17841400000000001',
      username: COMPETITOR_SAMPLE.instagramUsername,
    }),
    {
      type: 'json',
      matches: (url) => businessDiscoveryUsername(url) === COMPETITOR_SAMPLE.instagramUsername,
    },
  ),
];

/**
 * Graph's answer to Business Discovery for a username it cannot find, or one
 * that is a personal account, in the shape Meta's developer forums report (its
 * error table leaves code 110 out).
 */
const GRAPH_USER_NOT_FOUND = JSON.stringify({
  error: {
    message: 'Invalid user id',
    type: 'OAuthException',
    code: 110,
    error_subcode: 2207013,
    is_transient: false,
    error_user_title: 'Cannot find User',
    error_user_msg: 'The user cannot be found. (A simulated answer.)',
    fbtrace_id: 'SimulatedTrace',
  },
});

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
  return [...FIXTURE_FEEDS, ...COMPETITOR_FIXTURES].find((entry) => {
    if (entry.matches) return entry.matches(asked);
    return entry.match === 'prefix' ? asked.startsWith(entry.url) : entry.url === asked;
  });
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
    if (!feed) {
      if (businessDiscoveryUsername(url) !== null) {
        return { status: 400, body: GRAPH_USER_NOT_FOUND, finalUrl: url };
      }
      return url.startsWith(`${GDELT_DOC_URL}?`)
        ? { status: 200, body: GDELT_NOTHING, finalUrl: url }
        : { status: 404, body: '', finalUrl: url };
    }

    const newest = (await recordingsOf(directory, feed)).at(-1);
    if (!newest) return { status: 404, body: '', finalUrl: url };

    return {
      status: 200,
      body: await readFile(join(directory, feed.place, newest), 'utf8'),
      finalUrl: url,
    };
  };
}

/**
 * The pages the simulated reader knows by address (Module 08). All invented,
 * all on `.example`, all hand-written and marked as samples inside.
 */
export const READER_SAMPLE = {
  /** An English article with an `article` tag, a byline, a date and a picture. */
  article: 'https://reader.example/articles/harbour-market',
  /** A Tamil article with no `article` tag. What the sample Google News link resolves to. */
  tamilArticle: 'https://reader.example/articles/coimbatore-rain',
  /** A front page: links and headings, and no story. */
  frontPage: 'https://reader.example/',
  /** Always a 404. */
  missing: 'https://reader.example/missing',
} as const;

const READER_FOLDER = 'reader';

/** The reader's sample files, by what they are. `fixtures/reader/` holds exactly these. */
export const READER_FIXTURES = {
  article: 'article-en.sample.html',
  tamilArticle: 'article-ta.sample.html',
  frontPage: 'not-article.sample.html',
  googleNewsArticle: 'google-news-article.sample.html',
  googleNewsBatch: 'google-news-batch.sample.txt',
} as const;

/**
 * What the reader fetches under simulation.
 *
 * - The sample pages answer at their own addresses, and `missing` is a 404.
 * - Any Google News article link answers the sample article page, and the one
 *   POST to `batchexecute` answers the sample batch answer, so a News card's
 *   Read walks the whole decoder and ends at the Tamil sample.
 * - **Any other web address answers the English sample article.** A Trends card
 *   under simulation still points at a real publisher, and simulation must never
 *   fetch one. The stand-in says it is a sample in its first paragraph, the page
 *   wears its Simulated sticker, and the Read flow can be seen end to end offline.
 *
 * Nothing here reaches the network, whatever it is asked.
 */
export function createReaderFixtureFetch(options: { directory?: string } = {}): DiscoverFetch {
  const folder = join(options.directory ?? findFixturesDir(), READER_FOLDER);

  const page = async (file: string, url: string) => ({
    status: 200,
    body: await readFile(join(folder, file), 'utf8'),
    finalUrl: url,
  });

  return async (url, init) => {
    if (init.post) {
      return url === GOOGLE_NEWS_BATCH_URL
        ? page(READER_FIXTURES.googleNewsBatch, url)
        : { status: 404, body: '', finalUrl: url };
    }
    if (isGoogleNewsLink(url)) return page(READER_FIXTURES.googleNewsArticle, url);

    switch (url) {
      case READER_SAMPLE.missing:
        return { status: 404, body: '', finalUrl: url };
      case READER_SAMPLE.frontPage:
        return page(READER_FIXTURES.frontPage, url);
      case READER_SAMPLE.tamilArticle:
        return page(READER_FIXTURES.tamilArticle, url);
      default:
        return page(READER_FIXTURES.article, url);
    }
  };
}
