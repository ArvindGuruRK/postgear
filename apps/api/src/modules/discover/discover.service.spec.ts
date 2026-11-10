/**
 * The feed: what each kind asks for, what is shared and what never is, and how it
 * behaves when a source is struggling. The sources are fakes and the clock is too,
 * so a whole outage can be walked through in a test, and nothing opens a socket.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HttpException, Logger } from '@nestjs/common';
import {
  buildLocality,
  CHENNAI,
  createHolidaysSource,
  createYoutubeSource,
  type DiscoverFetch,
  type DiscoverSource,
  type GoogleNewsSource,
  itemId,
  type Locality,
  PARIS,
  SAN_FRANCISCO,
  type SourceFailure,
  type SourceItem,
  type SourceResult,
  WORLDWIDE,
  youtubePopularUrl,
} from '@postgear/discover-engine';
import { securityLogger } from '../../common/logging/security-logger';
import { DiscoverCache } from './discover.cache';
import type { DiscoverEngine } from './discover.engine';
import { DiscoverGate } from './discover.gate';
import { discoverKeys, workspaceKeys } from './discover.keys';
import { DISCOVER_MESSAGES } from './discover.messages';
import {
  BREAKER_SECONDS,
  DiscoverService,
  type FeedAnswer,
  type FeedRequest,
  NEW_PLACES_PER_MINUTE,
  YOUTUBE_DAILY_UNITS,
} from './discover.service';
import { FakeRedis } from './testing/fake-redis';

/** Ten at night on the 4th in San Francisco, and half past eleven in the morning of the 5th in Chennai. */
const NOW = new Date('2026-11-05T06:00:00.000Z');
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const ORG = 'org-1';
const YOUTUBE_KEY = 'yt-key-that-must-stay-home';
/** NOW is the 5th in UTC and still the 4th in California, where YouTube counts its day. */
const BUDGET = 'discover:budget:youtube:2026-11-04';
const BUDGET_SECONDS = 2 * 24 * 60 * 60;
const FIXTURES = join(__dirname, '../../../../../packages/discover-engine/fixtures');

const TAMIL_NADU = buildLocality({ countryCode: 'IN', regionCode: 'IN-TN' });
const INDIA = buildLocality({ countryCode: 'IN' });
/** A real country Google News has no edition for. */
const NO_EDITION = buildLocality({ countryCode: 'AF' });

function placeIn(index: number): Locality {
  return buildLocality({ countryCode: 'IN', regionCode: `IN-A${index}` });
}

function trend(title: string, rank = 1): SourceItem {
  return {
    kind: 'trend',
    source: { id: 'google-trends', name: 'Google Trends' },
    title,
    signal: { label: '200+ searches', rank },
  };
}

function story(title: string, publishedAt = new Date().toISOString()): SourceItem {
  return {
    kind: 'news',
    source: { id: 'google-news', name: 'Google News' },
    title,
    opaqueUrl: `https://news.google.com/rss/articles/${encodeURIComponent(title)}`,
    publishedAt,
  };
}

function article(title: string, rank = 1): SourceItem {
  return {
    kind: 'wiki',
    source: { id: 'wikipedia', name: 'Wikipedia', url: 'https://ta.wikipedia.org' },
    title,
    url: `https://ta.wikipedia.org/wiki/${encodeURIComponent(title)}`,
    language: 'ta',
    signal: { label: '1,627 reads', rank, views: 1627 },
  };
}

function chip(network: 'bluesky' | 'mastodon', title: string): SourceItem {
  const name = network === 'bluesky' ? 'Bluesky' : 'Mastodon';
  return {
    kind: 'social',
    source: { id: network, name },
    title,
    url: `https://${network}.example/${encodeURIComponent(title)}`,
    signal: { label: '273 posts', posts: 273 },
  };
}

function video(title: string): SourceItem {
  return {
    kind: 'video',
    source: { id: 'youtube', name: 'YouTube', url: 'https://www.youtube.com' },
    title,
    summary: 'A channel',
    url: `https://www.youtube.com/watch?v=${encodeURIComponent(title)}`,
    signal: { label: '1.2M views', views: 1_200_000 },
  };
}

function festival(title: string, date: string, observance = false): SourceItem {
  return {
    kind: 'festival',
    source: { id: 'holidays', name: 'Google Calendar' },
    title,
    date,
    observance,
  };
}

function answer(items: SourceItem[], extra: Partial<SourceResult> = {}): SourceResult {
  return { items, attribution: { name: 'Source' }, warnings: [], ...extra };
}

function failure(failed: SourceFailure): SourceResult {
  return answer([], { failed });
}

type FakeEngine = Pick<DiscoverEngine, 'simulation' | 'userAgent' | 'geocoder'> & {
  trends: jest.Mocked<DiscoverSource>;
  news: jest.Mocked<GoogleNewsSource>;
  wikipedia: jest.Mocked<DiscoverSource>;
  bluesky: jest.Mocked<DiscoverSource>;
  mastodon: jest.Mocked<DiscoverSource>;
  videos: jest.Mocked<DiscoverSource> | null;
  holidays: jest.Mocked<DiscoverSource>;
};

function fakeSource(id: DiscoverSource['id'], result: SourceResult): jest.Mocked<DiscoverSource> {
  return { id, name: id, fetch: jest.fn().mockResolvedValue(result) };
}

/**
 * Wikipedia and the two networks answer with nothing unless a test says otherwise,
 * so a Trending test about rising searches sees only rising searches.
 */
function fakeEngine(simulation: boolean, hasVideos: boolean): FakeEngine {
  return {
    wikipedia: fakeSource('wikipedia', answer([])),
    bluesky: fakeSource('bluesky', answer([])),
    mastodon: fakeSource('mastodon', answer([])),
    videos: hasVideos
      ? fakeSource('youtube', answer([video('A popular video')], { unitsUsed: 1 }))
      : null,
    holidays: fakeSource(
      'holidays',
      answer([festival('A festival', '2026-11-08')], {
        attribution: { name: 'Calendars', url: 'https://calendar.example/in' },
      }),
    ),
    simulation,
    userAgent: 'PostGear/1.0',
    geocoder: null,
    trends: {
      id: 'google-trends',
      name: 'Google Trends',
      fetch: jest
        .fn()
        .mockResolvedValue(answer([trend('A rising search')], { answeredGeo: 'IN-TN' })),
    },
    news: {
      id: 'google-news',
      name: 'Google News',
      fetch: jest.fn(),
      place: jest.fn().mockResolvedValue(answer([story('A local story')])),
      top: jest.fn().mockResolvedValue(answer([story('A national story')])),
      topic: jest.fn().mockResolvedValue(answer([story('A topic story')])),
    },
  };
}

function build(
  options: { simulation?: boolean; gate?: DiscoverGate; videos?: boolean; redis?: FakeRedis } = {},
) {
  const redis = options.redis ?? new FakeRedis();
  const engine = fakeEngine(options.simulation ?? false, options.videos ?? true);
  const gate = options.gate ?? new DiscoverGate(4, 4_000);
  const service = new DiscoverService(
    engine as unknown as DiscoverEngine,
    new DiscoverCache(redis.asService()),
    gate,
    redis.asService(),
  );
  return { service, engine, redis, gate };
}

function trending(locality: Locality = TAMIL_NADU, language = 'ta'): FeedRequest {
  return { kind: 'trending', locality, language };
}

function news(locality: Locality = CHENNAI, language = 'ta', topic?: FeedRequest['topic']) {
  return { kind: 'news', locality, language, topic } satisfies FeedRequest;
}

function videos(locality: Locality = TAMIL_NADU, language = 'ta'): FeedRequest {
  return { kind: 'videos', locality, language };
}

function festivals(locality: Locality = CHENNAI, language = 'ta'): FeedRequest {
  return { kind: 'festivals', locality, language };
}

/** The videos source of an engine that was built with a key. */
function youtube(engine: FakeEngine): jest.Mocked<DiscoverSource> {
  if (!engine.videos) throw new Error('This engine was built without a key.');
  return engine.videos;
}

/** The UTC day so many days before the fake clock's now, as Wikipedia names its days. */
function utcDay(daysBack: number): string {
  return new Date(Date.now() - daysBack * DAY).toISOString().slice(0, 10);
}

/** Gives Wikipedia and both networks something to say, so Trending has all of its groups. */
function fillTrending(engine: FakeEngine): void {
  engine.wikipedia.fetch.mockResolvedValue(
    answer([article('An article')], { answeredDay: utcDay(1) }),
  );
  engine.bluesky.fetch.mockResolvedValue(answer([chip('bluesky', 'A Bluesky trend')]));
  engine.mastodon.fetch.mockResolvedValue(answer([chip('mastodon', '#atag')]));
}

/** A recorded answer, as simulation would serve it. */
function recorded(file: string): string {
  return readFileSync(join(FIXTURES, file), 'utf8');
}

/** Sets the day's count of YouTube units, as if that many calls had been made. */
function spend(redis: FakeRedis, units: number, key = BUDGET): void {
  redis.write(key, String(units), BUDGET_SECONDS);
}

/** What a kept copy holds, which is more than any one answer shows. */
function stored(redis: FakeRedis, key: string) {
  return JSON.parse(redis.read(key) as string) as {
    groups: { id: string; items: { id: string; title: string; date?: string }[] }[];
    unavailable: string[];
  };
}

function breakers(redis: FakeRedis): string[] {
  return redis.keys.filter((key) => key.includes(':breaker:'));
}

/** The copies kept, of one kind (`trending`, `wiki`, `social`, ...) or of all. */
function feedKeys(redis: FakeRedis, kind = ''): string[] {
  return redis.keys.filter((key) => key.includes(`:feed:v1:${kind}`) && !key.includes(':lock:'));
}

/** The refresh lines logged so far, for the keys of one kind or for all. */
function refreshes(kind = ''): { key: string; ms: number; unavailable: string[] }[] {
  return logLine.mock.calls
    .map(([line]) => JSON.parse(line as string))
    .filter((line) => line.event === 'discover.feed.refresh' && line.key.includes(kind));
}

/** Everything the service has said to a log, as one string to search. */
function everythingLogged(): string {
  return JSON.stringify([
    logLine.mock.calls,
    warnLine.mock.calls,
    errorLine.mock.calls,
    securityWarn.mock.calls,
  ]);
}

function titles(result: { groups: { items: { title: string }[] }[] }): string[][] {
  return result.groups.map((group) => group.items.map((item) => item.title));
}

/** Lets a refresh started in the background finish. */
async function settle(): Promise<void> {
  await jest.advanceTimersByTimeAsync(0);
}

let logLine: jest.SpyInstance;
let warnLine: jest.SpyInstance;
let errorLine: jest.SpyInstance;
let securityWarn: jest.SpyInstance;

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
  logLine = jest.spyOn(Logger.prototype, 'log').mockImplementation();
  warnLine = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  errorLine = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  securityWarn = jest.spyOn(securityLogger, 'warn').mockImplementation();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('status', () => {
  it('says which world it is in, and which sources it has', () => {
    expect(build({ simulation: true }).service.status()).toEqual({
      simulation: true,
      geocoder: 'off',
      sources: {
        trends: true,
        news: true,
        wikipedia: true,
        videos: true,
        holidays: true,
        social: true,
      },
    });
  });

  it('tells the truth about videos when there is no key', () => {
    expect(build({ videos: false }).service.status().sources).toEqual({
      trends: true,
      news: true,
      wikipedia: true,
      videos: false,
      holidays: true,
      social: true,
    });
  });
});

describe('Trending', () => {
  it('answers the shape the page is built on', async () => {
    const { service } = build();

    await expect(service.feed(ORG, trending())).resolves.toEqual({
      kind: 'trending',
      locality: { ...TAMIL_NADU, newsLanguages: ['ta', 'en'] },
      language: 'ta',
      unavailable: [],
      groups: [
        {
          id: 'trends',
          title: 'Rising Searches In Tamil Nadu',
          subtitle: 'Via Google Trends.',
          attribution: { name: 'Google Trends', url: 'https://trends.google.com/trending' },
          items: [
            expect.objectContaining({
              id: expect.any(String),
              title: 'A rising search',
              brief: expect.stringContaining('A rising search'),
            }),
          ],
          stale: false,
          fetchedAt: NOW.toISOString(),
        },
      ],
    });
  });

  it('gives the source a deadline', async () => {
    const { service, engine } = build();

    await service.feed(ORG, trending());

    expect(engine.trends.fetch.mock.calls[0][0].signal).toBeInstanceOf(AbortSignal);
  });

  it('names the country when that is what really answered', async () => {
    const { service, engine } = build();
    engine.trends.fetch.mockResolvedValue(answer([trend('x')], { answeredGeo: 'IN' }));

    const result = await service.feed(ORG, trending());

    expect(result.groups[0].title).toBe('Rising Searches In India');
  });

  it('names the country for a place at country level', async () => {
    const { service, engine } = build();
    engine.trends.fetch.mockResolvedValue(answer([trend('x')], { answeredGeo: 'IN' }));

    const result = await service.feed(ORG, trending(INDIA));

    expect(result.groups[0].title).toBe('Rising Searches In India');
  });

  it('has no rising searches for Worldwide, and does not ask for any', async () => {
    const { service, engine, redis } = build();

    const result = await service.feed(ORG, trending({ ...WORLDWIDE }, 'en'));

    expect(result.groups).toEqual([]);
    expect(result.unavailable).toEqual([]);
    expect(result.locality.countryCode).toBeNull();
    expect(engine.trends.fetch).not.toHaveBeenCalled();
    expect(feedKeys(redis, 'trending')).toEqual([]);
  });
});

describe('News', () => {
  it('answers the city and then the country, with no story twice', async () => {
    const { service, engine } = build();
    engine.news.place.mockResolvedValue(answer([story('Same story'), story('A local story')]));
    engine.news.top.mockResolvedValue(answer([story('same story!'), story('A national story')]));

    const result = await service.feed(ORG, news());

    expect(result.groups.map((group) => [group.id, group.title, group.subtitle])).toEqual([
      ['place', 'Chennai Stories', 'Via Google News.'],
      ['top', 'Top Stories In India', 'Via Google News.'],
    ]);
    expect(titles(result)[0]).toContain('Same story');
    expect(titles(result)[1]).toEqual(['A national story']);
  });

  it('asks for no city when there is none', async () => {
    const { service, engine } = build();

    const result = await service.feed(ORG, news(INDIA));

    expect(result.groups.map((group) => group.id)).toEqual(['top']);
    expect(engine.news.place).not.toHaveBeenCalled();
  });

  it('puts a chosen topic first, so it keeps a story it shares with the others', async () => {
    const { service, engine } = build();
    engine.news.topic.mockResolvedValue(answer([story('A match report')]));
    engine.news.top.mockResolvedValue(answer([story('A match report'), story('A national story')]));

    const result = await service.feed(ORG, news(CHENNAI, 'ta', 'SPORTS'));

    expect(engine.news.topic.mock.calls[0][1]).toBe('SPORTS');
    expect(result.groups.map((group) => group.id)).toEqual(['topic', 'place', 'top']);
    expect(result.groups[0].title).toBe('Sports Stories');
    expect(titles(result)[0]).toEqual(['A match report']);
    expect(titles(result)[2]).toEqual(['A national story']);
  });

  it('reads world news for Worldwide, and says so', async () => {
    const { service, engine } = build();

    const result = await service.feed(ORG, news({ ...WORLDWIDE }, 'en'));

    expect(engine.news.topic.mock.calls[0][1]).toBe('WORLD');
    expect(engine.news.top).not.toHaveBeenCalled();
    expect(result.groups.map((group) => [group.id, group.title])).toEqual([
      ['world', 'Top Stories Worldwide'],
    ]);
  });

  it("does not put a country's name on American news when it has no edition", async () => {
    const { service, engine } = build();

    const result = await service.feed(ORG, news(NO_EDITION, 'ps'));

    expect(engine.news.top).not.toHaveBeenCalled();
    expect(result.groups[0].title).toBe('Top Stories Worldwide');
    expect(result.language).toBe('en');
    expect(result.locality.newsLanguages).toEqual(['en']);
  });

  it('says which language the stories are really in', async () => {
    const { service } = build();
    const unitedStates = buildLocality({ countryCode: 'US', regionCode: 'US-CA' });

    await expect(service.feed(ORG, news(unitedStates, 'es'))).resolves.toMatchObject({
      language: 'es-419',
    });
    await expect(service.feed(ORG, news(CHENNAI, 'kok'))).resolves.toMatchObject({
      language: 'en',
    });
  });

  it('builds a brief for every item, naming the place', async () => {
    const { service } = build();

    const result = await service.feed(ORG, news(PARIS, 'fr'));

    for (const group of result.groups) {
      for (const item of group.items) {
        expect(item.brief).toContain(item.title);
        expect(item.brief).toContain('Paris');
      }
    }
  });

  it('does not show an empty group, and does not call that a failure', async () => {
    const { service, engine } = build();
    engine.news.place.mockResolvedValue(answer([]));

    const result = await service.feed(ORG, news());

    expect(result.groups.map((group) => group.id)).toEqual(['top']);
    expect(result.unavailable).toEqual([]);
  });

  it('applies the age limit to real stories, and lets recordings be old', async () => {
    const old = new Date(NOW.getTime() - 49 * HOUR).toISOString();
    const real = build();
    const simulated = build({ simulation: true });
    for (const { engine } of [real, simulated]) {
      engine.news.top.mockResolvedValue(answer([story('An old story', old)]));
    }

    const realResult = await real.service.feed(ORG, news(INDIA));
    const simulatedResult = await simulated.service.feed(ORG, news(INDIA));

    expect(realResult.groups).toEqual([]);
    expect(titles(simulatedResult)).toEqual([['An old story']]);
  });
});

describe('what is shared, and what is not', () => {
  it('serves a place from Redis the second time, with no log line', async () => {
    const { service, engine } = build();

    await service.feed(ORG, trending());
    // One line per load: the searches, the Wikipedia edition, and each network.
    expect(logLine).toHaveBeenCalledTimes(4);
    expect(refreshes('trending')).toEqual([
      {
        event: 'discover.feed.refresh',
        key: 'discover:feed:v1:trending:IN:IN-TN:-:-:-',
        ms: expect.any(Number),
        unavailable: [],
      },
    ]);

    await jest.advanceTimersByTimeAsync(9 * MINUTE);
    await service.feed('org-2', trending());

    expect(engine.trends.fetch).toHaveBeenCalledTimes(1);
    expect(logLine).toHaveBeenCalledTimes(4);

    // Ten minutes on, the networks are due and the searches still are not.
    await jest.advanceTimersByTimeAsync(10 * MINUTE);
    await service.feed('org-2', trending());
    await settle();

    expect(engine.trends.fetch).toHaveBeenCalledTimes(1);
    expect(refreshes('trending')).toHaveLength(1);
  });

  it('shares Trending across languages and cities, since Trends has neither', async () => {
    const { service, engine, redis } = build();
    const chennai = buildLocality({ countryCode: 'IN', regionCode: 'IN-TN', city: 'Chennai' });
    const madurai = buildLocality({ countryCode: 'IN', regionCode: 'IN-TN', city: 'Madurai' });

    await service.feed(ORG, trending(chennai, 'ta'));
    await service.feed(ORG, trending(madurai, 'en'));

    expect(engine.trends.fetch).toHaveBeenCalledTimes(1);
    expect(feedKeys(redis, 'trending')).toEqual(['discover:feed:v1:trending:IN:IN-TN:-:-:-']);
  });

  it('shares News by the edition really read, so a language cannot force a fetch', async () => {
    const { service, engine, redis } = build();

    await service.feed(ORG, news(CHENNAI, 'en'));
    await service.feed(ORG, news(CHENNAI, 'en-GB'));
    await service.feed(ORG, news(CHENNAI, 'xx'));
    await service.feed(ORG, news(CHENNAI, 'kok'));

    expect(engine.news.top).toHaveBeenCalledTimes(1);
    expect(feedKeys(redis)).toEqual(['discover:feed:v1:news:IN:-:chennai:en:-']);
  });

  it('shares News across regions and spellings of case, but not across cities', async () => {
    const { service, engine, redis } = build();
    const shouting = buildLocality({ countryCode: 'IN', regionCode: 'IN-XX', city: 'CHENNAI' });
    const madurai = buildLocality({ countryCode: 'IN', regionCode: 'IN-TN', city: 'Madurai' });

    await service.feed(ORG, news(CHENNAI));
    await service.feed(ORG, news(shouting));
    await service.feed(ORG, news(madurai));

    expect(engine.news.place).toHaveBeenCalledTimes(2);
    expect(feedKeys(redis).sort()).toEqual([
      'discover:feed:v1:news:IN:-:chennai:ta:-',
      'discover:feed:v1:news:IN:-:madurai:ta:-',
    ]);
  });

  it('cannot have a field added to its key by a city name', async () => {
    const { service, redis } = build();
    const odd = buildLocality({ countryCode: 'IN', city: 'a:b' });

    await service.feed(ORG, news(odd));

    expect(feedKeys(redis)).toEqual(['discover:feed:v1:news:IN:-:a%3Ab:ta:-']);
  });

  it('keeps a topic in its own copy', async () => {
    const { service, redis } = build();

    await service.feed(ORG, news(CHENNAI, 'ta', 'SPORTS'));

    expect(feedKeys(redis)).toEqual(['discover:feed:v1:news:IN:-:chennai:ta:SPORTS']);
  });

  it("stores no heading and no brief, so nobody's words reach anyone else", async () => {
    const { service, redis } = build();

    await service.feed(ORG, news());

    const stored = JSON.parse(redis.read(feedKeys(redis)[0]) as string);
    expect(stored.groups[0]).not.toHaveProperty('title');
    expect(stored.groups[0]).not.toHaveProperty('subtitle');
    expect(stored.groups[0].items[0]).not.toHaveProperty('brief');
    expect(JSON.stringify(stored)).not.toContain('Chennai Stories');
  });

  it('gives each person their own words for the same shared copy', async () => {
    const { service, engine } = build();
    const named = (regionName: string) =>
      buildLocality({ countryCode: 'IN', regionCode: 'IN-TN', regionName });

    const first = await service.feed(ORG, trending(named('Tamil Nadu')));
    const second = await service.feed(ORG, trending(named('TN')));

    expect(engine.trends.fetch).toHaveBeenCalledTimes(1);
    expect(first.groups[0].title).toBe('Rising Searches In Tamil Nadu');
    expect(second.groups[0].title).toBe('Rising Searches In TN');
    expect(second.groups[0].items[0].brief).toContain('TN');
    expect(second.groups[0].items[0].brief).not.toContain('Tamil Nadu');
  });

  it('never shares simulated and real copies, of a feed or of a breaker', async () => {
    const real = build();
    const simulated = build({ simulation: true });
    simulated.engine.trends.fetch.mockResolvedValue(failure('upstream'));

    await real.service.feed(ORG, trending());
    await simulated.service.feed(ORG, trending());

    expect(real.redis.keys).toContain('discover:feed:v1:trending:IN:IN-TN:-:-:-');
    expect(simulated.redis.keys).toContain('discover:sim:feed:v1:trending:IN:IN-TN:-:-:-');
    expect(simulated.redis.keys).toContain('discover:sim:breaker:google-trends');
  });
});

describe('a copy going stale', () => {
  it('answers at once, says how old it is, and refreshes once', async () => {
    const { service, engine } = build();
    await service.feed(ORG, trending());
    await jest.advanceTimersByTimeAsync(21 * MINUTE);
    engine.trends.fetch.mockResolvedValue(answer([trend('A newer search')]));

    const [first, second] = await Promise.all([
      service.feed(ORG, trending()),
      service.feed('org-2', trending()),
    ]);
    await settle();

    for (const result of [first, second]) {
      expect(titles(result)).toEqual([['A rising search']]);
      expect(result.groups[0].stale).toBe(true);
      expect(result.groups[0].subtitle).toBe(
        'Via Google Trends. Showing what we had from 21 minutes ago.',
      );
    }
    expect(engine.trends.fetch).toHaveBeenCalledTimes(2);

    const next = await service.feed(ORG, trending());
    expect(titles(next)).toEqual([['A newer search']]);
    expect(next.groups[0].stale).toBe(false);
    expect(next.groups[0].subtitle).toBe('Via Google Trends.');
  });

  it('gives News a shorter window than Trending', async () => {
    const { service, engine } = build();
    await service.feed(ORG, news(INDIA));
    await service.feed(ORG, trending());

    await jest.advanceTimersByTimeAsync(16 * MINUTE);
    const stories = await service.feed(ORG, news(INDIA));
    const searches = await service.feed(ORG, trending());
    await settle();

    expect(stories.groups[0].stale).toBe(true);
    expect(searches.groups[0].stale).toBe(false);
    expect(engine.news.top).toHaveBeenCalledTimes(2);
    expect(engine.trends.fetch).toHaveBeenCalledTimes(1);
  });

  it('writes one minute in the singular', () => {
    expect(DISCOVER_MESSAGES.staleNote(1)).toBe('Showing what we had from 1 minute ago.');
  });
});

describe('when a source fails', () => {
  it('still answers what the others had, naming the one that failed', async () => {
    const { service, engine } = build();
    engine.news.top.mockResolvedValue(failure('upstream'));

    const result = await service.feed(ORG, news());

    expect(result.groups.map((group) => group.id)).toEqual(['place']);
    expect(result.unavailable).toEqual(['google-news']);
  });

  it('answers 200-shaped emptiness when the only source fails', async () => {
    const { service, engine } = build();
    engine.trends.fetch.mockResolvedValue(failure('upstream'));

    await expect(service.feed(ORG, trending())).resolves.toMatchObject({
      groups: [],
      unavailable: ['google-trends'],
    });
  });

  it('names a source once, however many of its groups failed', async () => {
    const { service, engine } = build();
    engine.news.place.mockResolvedValue(failure('upstream'));
    engine.news.top.mockResolvedValue(failure('upstream'));

    await expect(service.feed(ORG, news())).resolves.toMatchObject({
      unavailable: ['google-news'],
    });
  });

  it('keeps what it had for the failed group, with its real age', async () => {
    const { service, engine } = build();
    await service.feed(ORG, news());
    await jest.advanceTimersByTimeAsync(16 * MINUTE);
    engine.news.place.mockResolvedValue(answer([story('A newer local story')]));
    engine.news.top.mockResolvedValue(failure('upstream'));

    await service.feed(ORG, news());
    await settle();
    const result = await service.feed(ORG, news());

    const [place, top] = result.groups;
    expect(place.items[0].title).toBe('A newer local story');
    expect(place.stale).toBe(false);
    expect(top.items[0].title).toBe('A national story');
    expect(top.stale).toBe(true);
    expect(top.fetchedAt).toBe(NOW.toISOString());
    expect(top.subtitle).toBe('Via Google News. Showing what we had from 16 minutes ago.');
    expect(result.unavailable).toEqual(['google-news']);
  });

  it('does not let a kept copy repeat a story a fresh group now has', async () => {
    const { service, engine } = build();
    engine.news.top.mockResolvedValue(answer([story('Big story'), story('A national story')]));
    await service.feed(ORG, news());
    await jest.advanceTimersByTimeAsync(16 * MINUTE);
    engine.news.place.mockResolvedValue(answer([story('Big story')]));
    engine.news.top.mockResolvedValue(failure('upstream'));

    await service.feed(ORG, news());
    await settle();
    const result = await service.feed(ORG, news());

    expect(titles(result)).toEqual([['Big story'], ['A national story']]);
  });

  it('keeps the place in the heading after a kept copy fell back to the country', async () => {
    const { service, engine } = build();
    engine.trends.fetch.mockResolvedValue(answer([trend('x')], { answeredGeo: 'IN' }));
    await service.feed(ORG, trending());
    await jest.advanceTimersByTimeAsync(21 * MINUTE);
    engine.trends.fetch.mockResolvedValue(failure('upstream'));

    await service.feed(ORG, trending());
    await settle();

    const result = await service.feed(ORG, trending());
    expect(result.groups[0].title).toBe('Rising Searches In India');
  });

  it('drops a kept copy once it is too old to be worth showing', async () => {
    const { service, engine } = build();
    await service.feed(ORG, trending());
    engine.trends.fetch.mockResolvedValue(failure('upstream'));

    await jest.advanceTimersByTimeAsync(5 * HOUR);
    await service.feed(ORG, trending());
    await settle();
    const stillThere = await service.feed(ORG, trending());
    expect(titles(stillThere)).toEqual([['A rising search']]);

    await jest.advanceTimersByTimeAsync(HOUR + MINUTE);
    await service.feed(ORG, trending());
    await settle();
    const gone = await service.feed(ORG, trending());
    expect(gone.groups).toEqual([]);
    expect(gone.unavailable).toEqual(['google-trends']);
  });

  it('tries again after a minute, not after the whole window', async () => {
    const { service, engine } = build();
    engine.trends.fetch.mockResolvedValueOnce(failure('upstream'));
    await service.feed(ORG, trending());

    await jest.advanceTimersByTimeAsync(59_000);
    await service.feed(ORG, trending());
    await settle();
    expect(engine.trends.fetch).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(2_000);
    await service.feed(ORG, trending());
    await settle();
    expect(engine.trends.fetch).toHaveBeenCalledTimes(2);

    const result = await service.feed(ORG, trending());
    expect(result.unavailable).toEqual([]);
    expect(titles(result)).toEqual([['A rising search']]);
  });

  it('treats a source that throws, against its promise, as trouble and frees its slot', async () => {
    const { service, engine, gate, redis } = build();
    const error = jest.spyOn(Logger.prototype, 'error');
    engine.news.top.mockRejectedValue(new TypeError('a bug at https://example.test/?q=secret'));

    const result = await service.feed(ORG, news());

    expect(result.groups.map((group) => group.id)).toEqual(['place']);
    expect(result.unavailable).toEqual(['google-news']);
    expect(gate.running).toBe(0);
    expect(redis.keys.filter((key) => key.includes(':breaker:'))).toEqual([]);
    expect(error.mock.calls[0][0]).toContain('discover.feed.group_threw');
    expect(error.mock.calls[0][0]).not.toContain('secret');
  });

  it('answers with every source named when nobody finished in time', async () => {
    const { service, engine, redis } = build();
    const key = discoverKeys(false).feed({
      kind: 'news',
      country: 'IN',
      region: null,
      city: 'Chennai',
      language: 'ta',
      topic: null,
    });
    await redis.setIfAbsent(`discover:lock:${key}`, '1', 20);

    const waiting = service.feed(ORG, news());
    await jest.advanceTimersByTimeAsync(3_000);

    await expect(waiting).resolves.toMatchObject({ groups: [], unavailable: ['google-news'] });
    expect(engine.news.place).not.toHaveBeenCalled();
  });
});

describe('a place Google has nothing for', () => {
  it('is named as unavailable, but costs the source nothing', async () => {
    const { service, engine, redis } = build();
    engine.trends.fetch.mockResolvedValue(failure('not_found'));

    for (let index = 0; index < 5; index += 1) {
      const result = await service.feed(ORG, trending(placeIn(index)));
      expect(result.unavailable).toEqual(['google-trends']);
    }

    expect(engine.trends.fetch).toHaveBeenCalledTimes(5);
    expect(redis.keys.filter((key) => key.includes(':breaker:'))).toEqual([]);
  });

  it('is not asked again for the whole window', async () => {
    const { service, engine } = build();
    engine.trends.fetch.mockResolvedValue(failure('not_found'));
    await service.feed(ORG, trending());

    await jest.advanceTimersByTimeAsync(19 * MINUTE);
    await service.feed(ORG, trending());
    await settle();

    expect(engine.trends.fetch).toHaveBeenCalledTimes(1);
  });
});

describe('the breaker', () => {
  async function failThreeTimes({ service, engine }: ReturnType<typeof build>) {
    engine.trends.fetch.mockResolvedValue(failure('upstream'));
    for (let index = 0; index < 3; index += 1) {
      await service.feed(ORG, trending(placeIn(index)));
    }
  }

  it('leaves a source alone after three failures, for every place', async () => {
    const built = build();
    await failThreeTimes(built);
    expect(built.engine.trends.fetch).toHaveBeenCalledTimes(3);

    const result = await built.service.feed(ORG, trending(placeIn(3)));

    expect(built.engine.trends.fetch).toHaveBeenCalledTimes(3);
    expect(result.unavailable).toEqual(['google-trends']);
    expect(result.groups).toEqual([]);
  });

  it('is per source', async () => {
    const built = build();
    await failThreeTimes(built);

    const result = await built.service.feed(ORG, news());

    expect(result.unavailable).toEqual([]);
    expect(built.engine.news.top).toHaveBeenCalledTimes(1);
  });

  it('rests for ten minutes from the last failure, not the first', async () => {
    const { service, engine } = build();
    engine.trends.fetch.mockResolvedValue(failure('upstream'));

    await service.feed(ORG, trending(placeIn(0)));
    await jest.advanceTimersByTimeAsync(5 * MINUTE);
    await service.feed(ORG, trending(placeIn(1)));
    await jest.advanceTimersByTimeAsync(4 * MINUTE);
    await service.feed(ORG, trending(placeIn(2)));
    expect(engine.trends.fetch).toHaveBeenCalledTimes(3);

    // Eleven minutes after the first failure, and only two after the third.
    await jest.advanceTimersByTimeAsync(2 * MINUTE);
    engine.trends.fetch.mockResolvedValue(answer([trend('Back')]));
    await service.feed(ORG, trending(placeIn(3)));
    expect(engine.trends.fetch).toHaveBeenCalledTimes(3);

    await jest.advanceTimersByTimeAsync(BREAKER_SECONDS * 1000);
    const back = await service.feed(ORG, trending(placeIn(4)));
    expect(engine.trends.fetch).toHaveBeenCalledTimes(4);
    expect(titles(back)).toEqual([['Back']]);
    expect(back.unavailable).toEqual([]);
  });

  it('forgets failures on a success, so only a run of them counts', async () => {
    const { service, engine } = build();
    const results = [
      failure('upstream'),
      failure('upstream'),
      answer([trend('Fine')]),
      failure('upstream'),
      failure('upstream'),
      answer([trend('Fine')]),
    ];
    for (const [index, result] of results.entries()) {
      engine.trends.fetch.mockResolvedValueOnce(result);
      await service.feed(ORG, trending(placeIn(index)));
    }

    expect(engine.trends.fetch).toHaveBeenCalledTimes(results.length);
  });

  it('forgets failures on a place with nothing, since the source did answer', async () => {
    const { service, engine, redis } = build();
    engine.trends.fetch.mockResolvedValueOnce(failure('upstream'));
    await service.feed(ORG, trending(placeIn(0)));
    engine.trends.fetch.mockResolvedValueOnce(failure('not_found'));
    await service.feed(ORG, trending(placeIn(1)));

    expect(redis.read('discover:breaker:google-trends')).toBeNull();
  });
});

describe('the gate', () => {
  it('does not blame the source for a full gate', async () => {
    const gate = new DiscoverGate(1, 1_000);
    const { service, engine, redis } = build({ gate });
    const release = await gate.acquire();

    const waiting = service.feed(ORG, trending());
    await jest.advanceTimersByTimeAsync(1_000);
    const result = await waiting;

    // Every load of the tab waited for the one slot, and none of them got it.
    expect(result.unavailable).toEqual(['google-trends', 'wikipedia', 'bluesky', 'mastodon']);
    expect(engine.trends.fetch).not.toHaveBeenCalled();
    expect(redis.keys.filter((key) => key.includes(':breaker:'))).toEqual([]);
    release?.();
  });

  it('tries again as soon as the lock allows, well before a failure would', async () => {
    const gate = new DiscoverGate(1, 1_000);
    const { service, engine } = build({ gate });
    const release = await gate.acquire();
    const waiting = service.feed(ORG, trending());
    await jest.advanceTimersByTimeAsync(1_000);
    await waiting;
    release?.();

    await jest.advanceTimersByTimeAsync(20_000);
    await service.feed(ORG, trending());
    await settle();
    const result = await service.feed(ORG, trending());

    expect(engine.trends.fetch).toHaveBeenCalledTimes(1);
    expect(titles(result)).toEqual([['A rising search']]);
    expect(result.unavailable).toEqual([]);
  });

  it('frees its slot once a group is done', async () => {
    const { service, gate } = build();

    await service.feed(ORG, news());

    expect(gate.running).toBe(0);
  });
});

describe('the limit on new places', () => {
  async function askForNewPlaces({ service }: ReturnType<typeof build>, orgId = ORG) {
    for (let index = 0; index < NEW_PLACES_PER_MINUTE; index += 1) {
      await service.feed(orgId, trending(placeIn(index)));
    }
  }

  it('refuses a workspace asking for too many in a minute', async () => {
    const built = build();
    await askForNewPlaces(built);

    const error = await built.service
      .feed(ORG, trending(placeIn(NEW_PLACES_PER_MINUTE)))
      .catch((caught: unknown) => caught);

    expect((error as HttpException).getStatus()).toBe(429);
    expect((error as HttpException).getResponse()).toMatchObject({ code: 'feed_throttled' });
    expect(securityWarn).toHaveBeenCalledWith('discover.feed_throttled', { orgId: ORG });
    expect(built.engine.trends.fetch).toHaveBeenCalledTimes(NEW_PLACES_PER_MINUTE);
  });

  it('does not count a place that is already there', async () => {
    const built = build();
    await askForNewPlaces(built);

    await expect(built.service.feed(ORG, trending(placeIn(0)))).resolves.toMatchObject({
      unavailable: [],
    });
  });

  it('is per workspace, and over after a minute', async () => {
    const built = build();
    await askForNewPlaces(built);
    const fresh = trending(placeIn(NEW_PLACES_PER_MINUTE));

    await expect(built.service.feed('org-2', fresh)).resolves.toBeDefined();

    await jest.advanceTimersByTimeAsync(MINUTE);
    const another = trending(placeIn(NEW_PLACES_PER_MINUTE + 1));
    await expect(built.service.feed(ORG, another)).resolves.toBeDefined();
  });

  it('leaves the workspace out of everything that is shared', async () => {
    const { service, redis } = build();

    await service.feed(ORG, news());

    const shared = redis.keys.filter((key) => !key.includes('feedmiss'));
    expect(JSON.stringify(shared)).not.toContain(ORG);
    const stored = redis.read(feedKeys(redis)[0]) as string;
    expect(stored).not.toContain(ORG);
    expect(JSON.stringify(logLine.mock.calls)).not.toContain(ORG);
  });
});

describe('the four kinds', () => {
  it.each([
    ['trending', ['trends', 'wikipedia', 'social']],
    ['news', ['place', 'top']],
    ['videos', ['videos']],
    ['festivals', ['festivals']],
  ] as const)('answers %s, every item with a brief', async (kind, ids) => {
    const { service, engine } = build();
    fillTrending(engine);

    const result = await service.feed(ORG, { kind, locality: CHENNAI, language: 'ta' });

    expect(result.kind).toBe(kind);
    expect(result.groups.map((group) => group.id)).toEqual(ids);
    expect(result.unavailable).toEqual([]);
    // Only Festivals counts days, and only Videos can be missing for a reason.
    expect('today' in result).toBe(kind === 'festivals');
    expect(result).not.toHaveProperty('reason');
    for (const item of result.groups.flatMap((group) => group.items)) {
      expect(item.id).toEqual(expect.any(String));
      expect(item.brief).toContain(item.title);
    }
  });

  it('answers Videos in the shape the page is built on', async () => {
    const { service } = build();

    await expect(service.feed(ORG, videos())).resolves.toEqual({
      kind: 'videos',
      locality: { ...TAMIL_NADU, newsLanguages: ['ta', 'en'] },
      language: 'ta',
      unavailable: [],
      groups: [
        {
          id: 'videos',
          title: 'Trending On YouTube In India',
          subtitle: 'Via YouTube.',
          attribution: { name: 'YouTube', url: 'https://www.youtube.com' },
          items: [
            expect.objectContaining({
              id: expect.any(String),
              kind: 'video',
              title: 'A popular video',
              brief: 'Trending video in Tamil Nadu: "A popular video" by A channel (1.2M views).',
            }),
          ],
          stale: false,
          fetchedAt: NOW.toISOString(),
        },
      ],
    });
  });

  it("answers Festivals in the shape the page is built on, with the place's today", async () => {
    const { service } = build();

    await expect(service.feed(ORG, festivals())).resolves.toEqual({
      kind: 'festivals',
      locality: { ...CHENNAI, newsLanguages: ['ta', 'en'] },
      language: 'ta',
      unavailable: [],
      today: '2026-11-05',
      groups: [
        {
          id: 'festivals',
          title: 'Festivals And Holidays In India',
          subtitle: 'Dates from public holiday calendars and date-holidays (CC BY-SA).',
          // The source's own, since only it knows which calendar it read.
          attribution: { name: 'Calendars', url: 'https://calendar.example/in' },
          items: [
            {
              id: itemId('holidays', '2026-11-08|A festival'),
              kind: 'festival',
              source: { id: 'holidays', name: 'Google Calendar' },
              title: 'A festival',
              date: '2026-11-08',
              observance: false,
              brief:
                'Festival in Chennai, Tamil Nadu: "A festival" on Sunday 8 November 2026 (public holiday).',
            },
          ],
          stale: false,
          fetchedAt: NOW.toISOString(),
        },
      ],
    });
  });
});

describe('Trending, load by load', () => {
  const SEARCHES = 'discover:feed:v1:trending:IN:IN-TN:-:-:-';
  const EDITION = 'discover:feed:v1:wiki:ta.wikipedia';
  const BLUESKY = 'discover:feed:v1:social:bluesky';
  const MASTODON = 'discover:feed:v1:social:mastodon';

  it('keeps each load under a key of its own, for as long as its own window says', async () => {
    const { service, redis } = build();
    const kept = jest.spyOn(redis, 'set');

    await service.feed(ORG, trending());

    expect(Object.fromEntries(kept.mock.calls.map(([key, , seconds]) => [key, seconds]))).toEqual({
      [SEARCHES]: 6 * 60 * 60,
      [EDITION]: 48 * 60 * 60,
      [BLUESKY]: 2 * 60 * 60,
      [MASTODON]: 2 * 60 * 60,
    });

    // And each is really gone when its window is over, not when the tab's longest one is.
    await jest.advanceTimersByTimeAsync(2 * HOUR - 1_000);
    expect(feedKeys(redis).sort()).toEqual([BLUESKY, MASTODON, SEARCHES, EDITION]);
    await jest.advanceTimersByTimeAsync(1_000);
    expect(feedKeys(redis).sort()).toEqual([SEARCHES, EDITION]);
    await jest.advanceTimersByTimeAsync(4 * HOUR);
    expect(feedKeys(redis)).toEqual([EDITION]);
    await jest.advanceTimersByTimeAsync(42 * HOUR);
    expect(feedKeys(redis)).toEqual([]);
  });

  it('asks each load again on its own clock', async () => {
    const { service, engine } = build();
    const asked = () =>
      [engine.trends, engine.wikipedia, engine.bluesky, engine.mastodon].map(
        (source) => source.fetch.mock.calls.length,
      );
    const askAgain = async () => {
      await service.feed(ORG, trending());
      await settle();
    };

    await service.feed(ORG, trending());
    expect(asked()).toEqual([1, 1, 1, 1]);

    await jest.advanceTimersByTimeAsync(10 * MINUTE - 1_000);
    await askAgain();
    expect(asked()).toEqual([1, 1, 1, 1]);

    // Ten minutes: the networks, and nothing else.
    await jest.advanceTimersByTimeAsync(1_000);
    await askAgain();
    expect(asked()).toEqual([1, 1, 2, 2]);

    await jest.advanceTimersByTimeAsync(10 * MINUTE - 1_000);
    await askAgain();
    expect(asked()).toEqual([1, 1, 2, 2]);

    // Twenty: the searches, and the networks for the second time.
    await jest.advanceTimersByTimeAsync(1_000);
    await askAgain();
    expect(asked()).toEqual([2, 1, 3, 3]);

    // The edition's list changes once a day, so it is asked once a day.
    await jest.advanceTimersByTimeAsync(24 * HOUR - 20 * MINUTE - 1_000);
    await askAgain();
    expect(engine.wikipedia.fetch).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(1_000);
    await askAgain();
    expect(engine.wikipedia.fetch).toHaveBeenCalledTimes(2);
  });

  it("judges each group against its own window, never the tab's", async () => {
    const { service, engine } = build();
    fillTrending(engine);
    await service.feed(ORG, trending());

    await jest.advanceTimersByTimeAsync(11 * MINUTE);
    const result = await service.feed(ORG, trending());

    expect(result.groups.map((group) => [group.id, group.stale])).toEqual([
      ['trends', false],
      ['wikipedia', false],
      ['social', true],
    ]);
    expect(result.groups[2].subtitle).toBe(
      'Not local: what the whole network is talking about. Showing what we had from 11 minutes ago.',
    );
    expect(result.groups[0].subtitle).toBe('Via Google Trends.');
  });

  it('names only the load nobody finished, when the others answered', async () => {
    const { service, engine, redis } = build();
    fillTrending(engine);
    await redis.setIfAbsent(`discover:lock:${EDITION}`, '1', 20);

    const waiting = service.feed(ORG, trending());
    await jest.advanceTimersByTimeAsync(3_000);
    const result = await waiting;

    expect(result.groups.map((group) => group.id)).toEqual(['trends', 'social']);
    expect(result.unavailable).toEqual(['wikipedia']);
    expect(engine.wikipedia.fetch).not.toHaveBeenCalled();
  });

  it('answers English Wikipedia and the networks for Worldwide, and asks Google Trends nothing', async () => {
    const { service, engine, redis } = build();
    fillTrending(engine);

    const result = await service.feed(ORG, trending({ ...WORLDWIDE }, 'en'));

    expect(result.groups.map((group) => [group.id, group.title])).toEqual([
      ['wikipedia', 'What People Are Reading On English Wikipedia'],
      ['social', 'Worldwide On Bluesky And Mastodon'],
    ]);
    expect(result.groups[0].attribution).toEqual({
      name: 'Wikipedia',
      url: 'https://en.wikipedia.org',
    });
    expect(result.unavailable).toEqual([]);
    expect(engine.wikipedia.fetch.mock.calls[0][0].language).toBe('en');
    expect(engine.trends.fetch).not.toHaveBeenCalled();
    expect(feedKeys(redis).sort()).toEqual([
      BLUESKY,
      MASTODON,
      'discover:feed:v1:wiki:en.wikipedia',
    ]);
  });

  it('shares the networks with every place, since they belong to none', async () => {
    const { service, engine } = build();

    await service.feed(ORG, trending(TAMIL_NADU, 'ta'));
    await service.feed(ORG, trending(PARIS, 'fr'));
    await service.feed(ORG, trending({ ...WORLDWIDE }, 'en'));

    expect(engine.bluesky.fetch).toHaveBeenCalledTimes(1);
    expect(engine.mastodon.fetch).toHaveBeenCalledTimes(1);
    expect(engine.wikipedia.fetch).toHaveBeenCalledTimes(3);
  });
});

describe('which Wikipedia a request reads', () => {
  const TAMIL = 'discover:feed:v1:wiki:ta.wikipedia';
  const ENGLISH = 'discover:feed:v1:wiki:en.wikipedia';

  it("reads the place's own edition for a language nobody there speaks, at no cost", async () => {
    const { service, engine, redis } = build();
    fillTrending(engine);
    await service.feed(ORG, trending(TAMIL_NADU, 'ta'));

    const madeUp = await service.feed(ORG, trending(TAMIL_NADU, 'xx'));
    const farAway = await service.feed(ORG, trending(TAMIL_NADU, 'fr'));

    expect(engine.wikipedia.fetch).toHaveBeenCalledTimes(1);
    expect(feedKeys(redis, 'wiki')).toEqual([TAMIL]);
    for (const result of [madeUp, farAway]) {
      expect(result.groups[1].title).toBe('What People Are Reading On Tamil Wikipedia');
      expect(result.groups[1].attribution).toEqual({
        name: 'Wikipedia',
        url: 'https://ta.wikipedia.org',
      });
    }
  });

  it('asks for the edition it will keep, when the made-up language comes first', async () => {
    const { service, engine, redis } = build();

    await service.feed(ORG, trending(TAMIL_NADU, 'xx'));

    expect(engine.wikipedia.fetch.mock.calls[0][0].language).toBe('ta');
    expect(feedKeys(redis, 'wiki')).toEqual([TAMIL]);
  });

  it('gives a language the place speaks an edition of its own, whatever its region tag', async () => {
    const { service, engine, redis } = build();

    await service.feed(ORG, trending(TAMIL_NADU, 'ta'));
    await service.feed(ORG, trending(TAMIL_NADU, 'ta-IN'));
    await service.feed(ORG, trending(TAMIL_NADU, 'en'));

    expect(engine.wikipedia.fetch).toHaveBeenCalledTimes(2);
    expect(feedKeys(redis, 'wiki').sort()).toEqual([ENGLISH, TAMIL]);
  });

  it('always allows English, even where the place does not list it', async () => {
    const { service, engine, redis } = build();
    fillTrending(engine);
    const japan: Locality = { ...buildLocality({ countryCode: 'JP' }), languages: ['ja'] };

    const english = await service.feed(ORG, trending(japan, 'en'));
    await service.feed(ORG, trending(japan, 'en-GB'));

    expect(engine.wikipedia.fetch).toHaveBeenCalledTimes(1);
    expect(feedKeys(redis, 'wiki')).toEqual([ENGLISH]);
    expect(english.groups[1].title).toBe('What People Are Reading On English Wikipedia');

    // Tamil is a real language with a real edition, and still not Japan's.
    await service.feed(ORG, trending(japan, 'ta'));
    expect(feedKeys(redis, 'wiki').sort()).toEqual([ENGLISH, 'discover:feed:v1:wiki:ja.wikipedia']);
  });

  it('shares an edition across places, since it belongs to a language', async () => {
    const { service, engine } = build();

    await service.feed(ORG, trending(TAMIL_NADU, 'en'));
    await service.feed(ORG, trending(SAN_FRANCISCO, 'en'));

    expect(engine.wikipedia.fetch).toHaveBeenCalledTimes(1);
  });
});

describe("the day Wikipedia's list is for", () => {
  /** Two in the morning UTC: the 9th is not published yet, so the 8th is the newest there is. */
  const EARLY = new Date('2026-11-10T02:00:00.000Z');
  const wikipediaOf = (result: { groups: { id: string; subtitle: string; stale: boolean }[] }) =>
    result.groups.find((group) => group.id === 'wikipedia');

  beforeEach(() => {
    jest.setSystemTime(EARLY);
  });

  it('says yesterday for yesterday, and leaves it alone while it still is', async () => {
    const { service, engine } = build();
    engine.wikipedia.fetch.mockResolvedValue(
      answer([article('An article')], { answeredDay: '2026-11-09' }),
    );

    const result = await service.feed(ORG, trending());

    expect(wikipediaOf(result)?.subtitle).toBe(
      "Yesterday's most-read articles. Wikipedia, text CC BY-SA.",
    );

    // Eleven at night on the 10th: the 9th is still yesterday.
    await jest.advanceTimersByTimeAsync(21 * HOUR);
    await service.feed(ORG, trending());
    await settle();
    expect(engine.wikipedia.fetch).toHaveBeenCalledTimes(1);
  });

  it('asks again once its list has stopped being yesterday, not a day after it was fetched', async () => {
    // Fetched late in the evening: a day's wait would hide the 10th's list until the next evening.
    jest.setSystemTime(new Date('2026-11-10T23:30:00.000Z'));
    const { service, engine } = build();
    engine.wikipedia.fetch.mockResolvedValue(
      answer([article('An article')], { answeredDay: '2026-11-09' }),
    );
    await service.feed(ORG, trending());

    // Ten past midnight: the copy is 40 minutes old, so not yet.
    await jest.advanceTimersByTimeAsync(40 * MINUTE);
    await service.feed(ORG, trending());
    await settle();
    expect(engine.wikipedia.fetch).toHaveBeenCalledTimes(1);

    // An hour after it was fetched, and no longer yesterday's: worth asking.
    await jest.advanceTimersByTimeAsync(20 * MINUTE);
    await service.feed(ORG, trending());
    await settle();
    expect(engine.wikipedia.fetch).toHaveBeenCalledTimes(2);
  });

  it('names the day when the day before answered, and asks again after an hour', async () => {
    const { service, engine } = build();
    engine.wikipedia.fetch.mockResolvedValue(
      answer([article('An older article')], { answeredDay: '2026-11-08' }),
    );

    const early = await service.feed(ORG, trending());

    expect(wikipediaOf(early)?.subtitle).toBe(
      'The most-read articles from 8 November. Wikipedia, text CC BY-SA.',
    );
    // Old numbers, honestly labelled, are not a stale copy.
    expect(wikipediaOf(early)?.stale).toBe(false);
    expect(early.unavailable).toEqual([]);

    await jest.advanceTimersByTimeAsync(60 * MINUTE - 1_000);
    await service.feed(ORG, trending());
    await settle();
    expect(engine.wikipedia.fetch).toHaveBeenCalledTimes(1);

    engine.wikipedia.fetch.mockResolvedValue(
      answer([article('A newer article')], { answeredDay: '2026-11-09' }),
    );
    await jest.advanceTimersByTimeAsync(1_000);
    await service.feed(ORG, trending());
    await settle();
    expect(engine.wikipedia.fetch).toHaveBeenCalledTimes(2);

    const later = await service.feed(ORG, trending());
    expect(wikipediaOf(later)?.subtitle).toBe(
      "Yesterday's most-read articles. Wikipedia, text CC BY-SA.",
    );
    expect(titles(later)).toContainEqual(['A newer article']);

    // Yesterday's numbers have arrived, so nothing is asked for the rest of the day.
    await jest.advanceTimersByTimeAsync(20 * HOUR);
    await service.feed(ORG, trending());
    await settle();
    expect(engine.wikipedia.fetch).toHaveBeenCalledTimes(2);
  });

  it("stops calling a list yesterday's once midnight UTC has passed", async () => {
    const { service, engine } = build();
    engine.wikipedia.fetch.mockResolvedValue(
      answer([article('An article')], { answeredDay: '2026-11-09' }),
    );
    await service.feed(ORG, trending());

    // One in the morning on the 11th: the same copy, inside its day, about the 9th.
    await jest.advanceTimersByTimeAsync(23 * HOUR);
    const result = await service.feed(ORG, trending());

    expect(wikipediaOf(result)?.subtitle).toBe(
      'The most-read articles from 9 November. Wikipedia, text CC BY-SA.',
    );
    expect(wikipediaOf(result)?.stale).toBe(false);
  });

  it('keeps the day with a copy it had to keep', async () => {
    const { service, engine } = build();
    engine.wikipedia.fetch.mockResolvedValue(
      answer([article('An article')], { answeredDay: '2026-11-09' }),
    );
    await service.feed(ORG, trending());
    engine.wikipedia.fetch.mockResolvedValue(failure('upstream'));

    await jest.advanceTimersByTimeAsync(24 * HOUR + MINUTE);
    await service.feed(ORG, trending());
    await settle();
    const result = await service.feed(ORG, trending());

    expect(wikipediaOf(result)?.stale).toBe(true);
    expect(wikipediaOf(result)?.subtitle).toBe(
      'The most-read articles from 9 November. Wikipedia, text CC BY-SA. Showing what we had from 24 hours ago.',
    );
    expect(result.unavailable).toEqual(['wikipedia']);
  });

  it('does not guess a day for a copy that has none', async () => {
    const { service, engine } = build();
    engine.wikipedia.fetch.mockResolvedValue(answer([article('An article')]));

    const result = await service.feed(ORG, trending());

    expect(wikipediaOf(result)?.subtitle).toBe('The most-read articles. Wikipedia, text CC BY-SA.');
  });
});

describe('the Worldwide group', () => {
  const socialOf = <T extends { id: string }>(result: { groups: T[] }) =>
    result.groups.filter((group) => group.id === 'social');

  function withBoth({ engine }: ReturnType<typeof build>): void {
    engine.bluesky.fetch.mockResolvedValue(
      answer([chip('bluesky', 'First on Bluesky'), chip('bluesky', 'Second on Bluesky')]),
    );
    engine.mastodon.fetch.mockResolvedValue(answer([chip('mastodon', '#onmastodon')]));
  }

  it("is one group: Bluesky's and then Mastodon's", async () => {
    const built = build();
    withBoth(built);

    const result = await built.service.feed(ORG, trending());

    expect(socialOf(result)).toEqual([
      {
        id: 'social',
        title: 'Worldwide On Bluesky And Mastodon',
        subtitle: 'Not local: what the whole network is talking about.',
        attribution: { name: 'Bluesky and Mastodon' },
        items: [
          expect.objectContaining({
            title: 'First on Bluesky',
            source: { id: 'bluesky', name: 'Bluesky' },
            brief: 'Trending worldwide on Bluesky: "First on Bluesky" (273 posts).',
          }),
          expect.objectContaining({ title: 'Second on Bluesky' }),
          expect.objectContaining({
            title: '#onmastodon',
            source: { id: 'mastodon', name: 'Mastodon' },
          }),
        ],
        stale: false,
        fetchedAt: NOW.toISOString(),
      },
    ]);
    expect(result.groups.at(-1)?.id).toBe('social');
  });

  it('hides only the chips of a network that is down, and names the one that answered', async () => {
    const built = build();
    withBoth(built);
    built.engine.bluesky.fetch.mockResolvedValue(failure('upstream'));

    const result = await built.service.feed(ORG, trending());

    expect(socialOf(result)).toEqual([
      expect.objectContaining({
        id: 'social',
        title: 'Worldwide On Mastodon',
        subtitle: 'Not local: what the whole network is talking about.',
        attribution: { name: 'Mastodon', url: 'https://mastodon.social' },
        stale: false,
      }),
    ]);
    expect(titles({ groups: socialOf(result) })).toEqual([['#onmastodon']]);
    expect(result.unavailable).toEqual(['bluesky']);
    // The searches are no worse off for it.
    expect(result.groups[0].id).toBe('trends');
  });

  it('names Bluesky alone when Mastodon is the one that is down', async () => {
    const built = build();
    withBoth(built);
    built.engine.mastodon.fetch.mockResolvedValue(failure('upstream'));

    const result = await built.service.feed(ORG, trending());

    expect(socialOf(result)[0].title).toBe('Worldwide On Bluesky');
    expect(socialOf(result)[0].attribution).toEqual({ name: 'Bluesky', url: 'https://bsky.app' });
    expect(result.unavailable).toEqual(['mastodon']);
  });

  it('does not name a network that is fine and has nothing to say', async () => {
    const built = build();
    withBoth(built);
    built.engine.bluesky.fetch.mockResolvedValue(answer([]));

    const result = await built.service.feed(ORG, trending());

    expect(socialOf(result)[0].title).toBe('Worldwide On Mastodon');
    expect(result.unavailable).toEqual([]);
  });

  it('is not shown at all when both are down, and says so', async () => {
    const built = build();
    built.engine.bluesky.fetch.mockResolvedValue(failure('upstream'));
    built.engine.mastodon.fetch.mockResolvedValue(failure('upstream'));

    const result = await built.service.feed(ORG, trending());

    expect(socialOf(result)).toEqual([]);
    expect(result.unavailable).toEqual(['bluesky', 'mastodon']);
  });

  it('is as old as its older half, and stale when either half is', async () => {
    const built = build();
    const { service, engine } = built;
    withBoth(built);
    await service.feed(ORG, trending());

    await jest.advanceTimersByTimeAsync(11 * MINUTE);
    engine.bluesky.fetch.mockResolvedValue(answer([chip('bluesky', 'Newer on Bluesky')]));
    engine.mastodon.fetch.mockResolvedValue(failure('upstream'));
    await service.feed(ORG, trending());
    await settle();

    const result = await service.feed(ORG, trending());

    // Bluesky's half is seconds old. Mastodon's is the copy from eleven minutes ago.
    expect(socialOf(result)).toEqual([
      expect.objectContaining({
        title: 'Worldwide On Bluesky And Mastodon',
        subtitle:
          'Not local: what the whole network is talking about. Showing what we had from 11 minutes ago.',
        stale: true,
        fetchedAt: NOW.toISOString(),
      }),
    ]);
    expect(titles({ groups: socialOf(result) })).toEqual([['Newer on Bluesky', '#onmastodon']]);
    expect(result.unavailable).toEqual(['mastodon']);
  });

  it('is fresh again once both halves are', async () => {
    const built = build();
    const { service, engine } = built;
    withBoth(built);
    await service.feed(ORG, trending());

    await jest.advanceTimersByTimeAsync(11 * MINUTE);
    engine.bluesky.fetch.mockResolvedValue(answer([chip('bluesky', 'Newer on Bluesky')]));
    await service.feed(ORG, trending());
    await settle();

    const result = await service.feed(ORG, trending());

    expect(socialOf(result)[0].stale).toBe(false);
    expect(socialOf(result)[0].fetchedAt).toBe(new Date(NOW.getTime() + 11 * MINUTE).toISOString());
  });
});

describe('Videos', () => {
  it('keeps one copy a country, whatever the region or the language', async () => {
    const { service, engine, redis } = build();
    const kept = jest.spyOn(redis, 'set');
    const kerala = buildLocality({ countryCode: 'IN', regionCode: 'IN-KL' });

    await service.feed(ORG, videos(TAMIL_NADU, 'ta'));
    await service.feed(ORG, videos(kerala, 'ml'));
    await service.feed(ORG, videos(CHENNAI, 'en'));

    expect(youtube(engine).fetch).toHaveBeenCalledTimes(1);
    expect(feedKeys(redis)).toEqual(['discover:feed:v1:videos:IN']);
    expect(kept).toHaveBeenCalledWith(
      'discover:feed:v1:videos:IN',
      expect.any(String),
      6 * 60 * 60,
    );
  });

  it('asks again after an hour, since every call costs a unit', async () => {
    const { service, engine } = build();
    await service.feed(ORG, videos());

    await jest.advanceTimersByTimeAsync(HOUR - 1_000);
    const fresh = await service.feed(ORG, videos());
    await settle();
    expect(fresh.groups[0].stale).toBe(false);
    expect(youtube(engine).fetch).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(1_000);
    const stale = await service.feed(ORG, videos());
    await settle();
    expect(stale.groups[0].stale).toBe(true);
    expect(stale.groups[0].subtitle).toBe('Via YouTube. Showing what we had from 60 minutes ago.');
    expect(youtube(engine).fetch).toHaveBeenCalledTimes(2);
  });

  it('has nothing for Worldwide, and no reason to give for it', async () => {
    const { service, engine, redis } = build();

    const result = await service.feed(ORG, videos({ ...WORLDWIDE }, 'en'));

    // There is a key and the budget is whole: the tab is neither off nor resting.
    expect(result.groups).toEqual([]);
    expect(result.unavailable).toEqual([]);
    expect(result).not.toHaveProperty('reason');
    expect(youtube(engine).fetch).not.toHaveBeenCalled();
    expect(redis.keys).toEqual([]);
  });
});

describe("YouTube's daily budget", () => {
  const COUNTRIES = ['IN', 'US', 'FR', 'DE', 'JP', 'BR'].map((countryCode) =>
    buildLocality({ countryCode }),
  );
  /** Midnight in California on the 5th, which is eight in the morning UTC. */
  const PACIFIC_MIDNIGHT = new Date('2026-11-05T08:00:00.000Z');

  it('counts a unit a call, under the day it is in California', async () => {
    const { service, redis } = build();
    const counted = jest.spyOn(redis, 'incrementWithTtl');

    await service.feed(ORG, videos());

    // The 5th has begun in UTC. The quota's day is still the 4th.
    expect(new Date().toISOString().slice(0, 10)).toBe('2026-11-05');
    expect(redis.keys.filter((key) => key.includes(':budget:'))).toEqual([BUDGET]);
    expect(redis.read(BUDGET)).toBe('1');
    // Two days: long enough to outlive the day it names, in any zone.
    expect(counted).toHaveBeenCalledWith(BUDGET, BUDGET_SECONDS);
  });

  it('starts a new count at midnight Pacific', async () => {
    const { service, redis } = build();
    await service.feed(ORG, videos(COUNTRIES[0]));

    jest.setSystemTime(new Date(PACIFIC_MIDNIGHT.getTime() - MINUTE));
    await service.feed(ORG, videos(COUNTRIES[1]));
    expect(redis.read(BUDGET)).toBe('2');

    jest.setSystemTime(PACIFIC_MIDNIGHT);
    await service.feed(ORG, videos(COUNTRIES[2]));
    expect(redis.read(BUDGET)).toBe('2');
    expect(redis.read('discover:budget:youtube:2026-11-05')).toBe('1');
  });

  it('stops at 8,000 units, and asks nobody past it', async () => {
    const { service, engine, redis } = build();
    spend(redis, YOUTUBE_DAILY_UNITS - 1);

    const last = await service.feed(ORG, videos(COUNTRIES[0]));
    const refused = await service.feed(ORG, videos(COUNTRIES[1]));

    expect(YOUTUBE_DAILY_UNITS).toBe(8_000);
    expect(titles(last)).toEqual([['A popular video']]);
    expect(refused.groups).toEqual([]);
    expect(youtube(engine).fetch).toHaveBeenCalledTimes(1);
    // A spent budget's count does not climb with every request that is turned away.
    expect(redis.read(BUDGET)).toBe('8000');
  });

  it('cannot be passed by requests that race for the last units', async () => {
    const { service, engine, redis } = build({ gate: new DiscoverGate(COUNTRIES.length, 4_000) });
    spend(redis, YOUTUBE_DAILY_UNITS - 2);

    const results = await Promise.all(COUNTRIES.map((place) => service.feed(ORG, videos(place))));

    expect(youtube(engine).fetch).toHaveBeenCalledTimes(2);
    expect(results.filter((result) => result.groups.length === 1)).toHaveLength(2);
    expect(results.filter((result) => result.reason === 'resting')).toHaveLength(4);
    // All six had read "two left" before the first of them counted itself: that is
    // the race. The count went past the limit, and the calls did not.
    expect(Number(redis.read(BUDGET))).toBeGreaterThan(YOUTUBE_DAILY_UNITS);
  });

  it('charges for a call that failed', async () => {
    const { service, engine, redis } = build();
    youtube(engine).fetch.mockResolvedValue(answer([], { failed: 'upstream', unitsUsed: 1 }));

    await service.feed(ORG, videos());

    expect(redis.read(BUDGET)).toBe('1');
  });

  it('charges for a call that threw, or never said what it cost', async () => {
    const { service, engine, redis } = build();
    youtube(engine).fetch.mockRejectedValueOnce(new Error('a bug'));
    youtube(engine).fetch.mockResolvedValueOnce(failure('upstream'));

    await service.feed(ORG, videos(COUNTRIES[0]));
    await service.feed(ORG, videos(COUNTRIES[1]));

    expect(redis.read(BUDGET)).toBe('2');
  });

  it('adds what a dearer call says it cost', async () => {
    const { service, engine, redis } = build();
    youtube(engine).fetch.mockResolvedValue(answer([video('A popular video')], { unitsUsed: 3 }));

    await service.feed(ORG, videos());

    expect(redis.read(BUDGET)).toBe('3');
  });

  it('cannot be kept counting by a source that says nonsense', async () => {
    const { service, engine, redis, gate } = build();
    youtube(engine).fetch.mockResolvedValueOnce(
      answer([video('A popular video')], { unitsUsed: Number.POSITIVE_INFINITY }),
    );
    youtube(engine).fetch.mockResolvedValueOnce(
      answer([video('A popular video')], { unitsUsed: Number.NaN }),
    );

    await service.feed(ORG, videos(COUNTRIES[0]));

    // Everything it could say it cost is the whole day, and no more than that.
    expect(Number(redis.read(BUDGET))).toBe(YOUTUBE_DAILY_UNITS + 1);
    expect(gate.running).toBe(0);

    jest.setSystemTime(PACIFIC_MIDNIGHT);
    await service.feed(ORG, videos(COUNTRIES[1]));
    expect(redis.read('discover:budget:youtube:2026-11-05')).toBe('1');
  });

  it('is not a failure of the source: no breaker, no warning, and back the next day', async () => {
    const { service, engine, redis } = build();
    spend(redis, YOUTUBE_DAILY_UNITS);

    for (const place of COUNTRIES) {
      await expect(service.feed(ORG, videos(place))).resolves.toMatchObject({
        reason: 'resting',
      });
    }

    expect(youtube(engine).fetch).not.toHaveBeenCalled();
    expect(breakers(redis)).toEqual([]);
    expect(warnLine).not.toHaveBeenCalled();

    jest.setSystemTime(PACIFIC_MIDNIGHT);
    const back = await service.feed(ORG, videos(buildLocality({ countryCode: 'GB' })));
    expect(titles(back)).toEqual([['A popular video']]);
    expect(back).not.toHaveProperty('reason');
  });

  it('is not spent while the breaker has the source resting', async () => {
    const { service, engine, redis } = build();
    youtube(engine).fetch.mockResolvedValue(answer([], { failed: 'upstream', unitsUsed: 1 }));

    for (const place of COUNTRIES) await service.feed(ORG, videos(place));

    // Three calls opened the breaker, and the three after them cost nothing.
    expect(youtube(engine).fetch).toHaveBeenCalledTimes(3);
    expect(redis.read(BUDGET)).toBe('3');
  });

  it('says it is resting when it has nothing to show, and keeps no call waiting', async () => {
    const { service, engine, redis, gate } = build();
    spend(redis, YOUTUBE_DAILY_UNITS);

    const result = await service.feed(ORG, videos());

    expect(result).toEqual({
      kind: 'videos',
      locality: { ...TAMIL_NADU, newsLanguages: ['ta', 'en'] },
      language: 'ta',
      groups: [],
      unavailable: ['youtube'],
      reason: 'resting',
    });
    expect(youtube(engine).fetch).not.toHaveBeenCalled();
    expect(gate.running).toBe(0);
  });

  it('looks again ten minutes on, so a new day is not missed for longer', async () => {
    const { service, engine, redis } = build();
    // Five to midnight in California, with the day's budget gone.
    jest.setSystemTime(new Date(PACIFIC_MIDNIGHT.getTime() - 5 * MINUTE));
    spend(redis, YOUTUBE_DAILY_UNITS);
    await service.feed(ORG, videos());

    // Four minutes into the new day the answer is still the one from before it.
    await jest.advanceTimersByTimeAsync(10 * MINUTE - 1_000);
    const before = await service.feed(ORG, videos());
    await settle();
    expect(before.reason).toBe('resting');
    expect(youtube(engine).fetch).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(1_000);
    await service.feed(ORG, videos());
    await settle();
    const after = await service.feed(ORG, videos());

    expect(youtube(engine).fetch).toHaveBeenCalledTimes(1);
    expect(titles(after)).toEqual([['A popular video']]);
    expect(after.groups[0].stale).toBe(false);
    expect(after.groups[0].subtitle).toBe('Via YouTube.');
    expect(after.unavailable).toEqual([]);
    expect(after).not.toHaveProperty('reason');
  });

  it('shows what it had, and says why it is not newer', async () => {
    const { service, engine, redis } = build();
    await service.feed(ORG, videos());
    spend(redis, YOUTUBE_DAILY_UNITS);

    // An hour on the copy is due, and there is nothing left to ask with.
    await jest.advanceTimersByTimeAsync(61 * MINUTE);
    await service.feed(ORG, videos());
    await settle();
    const result = await service.feed(ORG, videos());

    expect(result.groups).toEqual([
      {
        id: 'videos',
        title: 'Trending On YouTube In India',
        subtitle: 'YouTube is resting until tomorrow. Showing what we had.',
        attribution: { name: 'YouTube', url: 'https://www.youtube.com' },
        items: [expect.objectContaining({ title: 'A popular video' })],
        stale: true,
        fetchedAt: NOW.toISOString(),
      },
    ]);
    expect(result.unavailable).toEqual(['youtube']);
    // There is something to show, so the page needs no sentence of its own.
    expect(result).not.toHaveProperty('reason');
    expect(youtube(engine).fetch).toHaveBeenCalledTimes(1);
    expect(breakers(redis)).toEqual([]);
  });

  it("is fresh again with the next day's budget", async () => {
    const { service, engine, redis } = build();
    await service.feed(ORG, videos());
    spend(redis, YOUTUBE_DAILY_UNITS);
    await jest.advanceTimersByTimeAsync(61 * MINUTE);
    await service.feed(ORG, videos());
    await settle();
    youtube(engine).fetch.mockResolvedValue(answer([video('A newer video')], { unitsUsed: 1 }));

    jest.setSystemTime(new Date(PACIFIC_MIDNIGHT.getTime() + 5 * MINUTE));
    await service.feed(ORG, videos());
    await settle();
    const result = await service.feed(ORG, videos());

    expect(titles(result)).toEqual([['A newer video']]);
    expect(result.groups[0].stale).toBe(false);
    expect(result.groups[0].subtitle).toBe('Via YouTube.');
    expect(result.unavailable).toEqual([]);
  });

  it('drops the copy it had once that is six hours old, and then says resting', async () => {
    const { service, redis } = build();
    await service.feed(ORG, videos());
    // Both days' budgets, so the clock can run on past midnight in California.
    spend(redis, YOUTUBE_DAILY_UNITS);
    spend(redis, YOUTUBE_DAILY_UNITS, 'discover:budget:youtube:2026-11-05');

    // Kept once, an hour on, which also keeps the entry itself alive in Redis.
    await jest.advanceTimersByTimeAsync(61 * MINUTE);
    await service.feed(ORG, videos());
    await settle();
    expect(titles(await service.feed(ORG, videos()))).toEqual([['A popular video']]);

    await jest.advanceTimersByTimeAsync(5 * HOUR);
    await service.feed(ORG, videos());
    await settle();
    const result = await service.feed(ORG, videos());

    expect(result.groups).toEqual([]);
    expect(result.reason).toBe('resting');
  });
});

describe('Videos without a key', () => {
  it('says it is not set up, and touches nothing', async () => {
    const { service, engine, redis } = build({ videos: false });

    const result = await service.feed(ORG, videos());

    expect(result).toEqual({
      kind: 'videos',
      locality: { ...TAMIL_NADU, newsLanguages: ['ta', 'en'] },
      language: 'ta',
      groups: [],
      unavailable: [],
      reason: 'not_set_up',
    });
    // No copy, no lock, no count of new places, no budget: nothing was asked.
    expect(redis.keys).toEqual([]);
    expect(logLine).not.toHaveBeenCalled();
    for (const source of [engine.trends, engine.wikipedia, engine.bluesky, engine.mastodon]) {
      expect(source.fetch).not.toHaveBeenCalled();
    }
    expect(engine.holidays.fetch).not.toHaveBeenCalled();
  });

  it('says the same for Worldwide, and however often it is asked', async () => {
    const { service, redis } = build({ videos: false });

    for (let index = 0; index < NEW_PLACES_PER_MINUTE + 5; index += 1) {
      await expect(service.feed(ORG, videos(placeIn(index)))).resolves.toMatchObject({
        reason: 'not_set_up',
      });
    }
    await expect(service.feed(ORG, videos({ ...WORLDWIDE }, 'en'))).resolves.toMatchObject({
      groups: [],
      unavailable: [],
      reason: 'not_set_up',
    });
    expect(redis.keys).toEqual([]);
  });

  it('leaves the other tabs as they are', async () => {
    const { service } = build({ videos: false });

    const result = await service.feed(ORG, festivals());

    expect(result.groups.map((group) => group.id)).toEqual(['festivals']);
    expect(result).not.toHaveProperty('reason');
  });
});

describe('the YouTube key', () => {
  const COUNTRIES = ['IN', 'US', 'FR', 'DE', 'JP'].map((countryCode) =>
    buildLocality({ countryCode }),
  );

  /** The real source, holding a key that is easy to spot, over an outside that misbehaves. */
  function withRealSource(outside: DiscoverFetch) {
    const built = build();
    built.engine.videos = createYoutubeSource({
      fetch: outside,
      apiKey: YOUTUBE_KEY,
    }) as jest.Mocked<DiscoverSource>;
    return built;
  }

  /** Every key and every value in Redis, as one string to search. */
  function everythingKept(redis: FakeRedis): string {
    return JSON.stringify(redis.keys.map((key) => [key, redis.read(key)]));
  }

  it('is in no log line, no Redis key, no kept copy and no answer', async () => {
    const outside = jest
      .fn<ReturnType<DiscoverFetch>, Parameters<DiscoverFetch>>()
      .mockImplementationOnce(async (url) => ({
        status: 200,
        body: recorded('chennai/youtube-IN.sample.json'),
        finalUrl: url,
      }))
      // Each failure quotes the address back, key and all, the way a real one can.
      .mockImplementationOnce(async (url) => ({
        status: 403,
        body: `The request to ${url} was refused.`,
        finalUrl: url,
      }))
      .mockImplementationOnce(async (url) => {
        throw new Error(`connect ECONNRESET ${url}`);
      })
      .mockImplementation(async (url) => ({ status: 500, body: url, finalUrl: url }));
    const { service, redis } = withRealSource(outside);

    const answers: FeedAnswer[] = [];
    for (const place of COUNTRIES) answers.push(await service.feed(ORG, videos(place)));

    // The key really was in play: every call carried it, which is the one place it belongs.
    expect(outside).toHaveBeenCalledTimes(4);
    for (const [url] of outside.mock.calls) expect(url).toContain(`key=${YOUTUBE_KEY}`);
    expect(answers[0].groups[0].items).toHaveLength(5);
    expect(answers.slice(1).map((result) => result.unavailable)).toEqual([
      ['youtube'],
      ['youtube'],
      ['youtube'],
      ['youtube'],
    ]);

    // And there was plenty said and kept to find it in: refreshes, and a breaker opening.
    expect(everythingLogged()).toContain('discover.feed.refresh');
    expect(everythingLogged()).toContain('discover.breaker_open');
    expect(redis.keys).toContain('discover:breaker:youtube');
    expect(redis.keys).toContain(BUDGET);

    expect(everythingLogged()).not.toContain(YOUTUBE_KEY);
    expect(everythingKept(redis)).not.toContain(YOUTUBE_KEY);
    expect(JSON.stringify(answers)).not.toContain(YOUTUBE_KEY);
  });

  it('is not in what is logged when the source throws with the address in its message', async () => {
    const { service, engine, redis } = build();
    youtube(engine).fetch.mockRejectedValue(
      new Error(`boom at ${youtubePopularUrl('IN', YOUTUBE_KEY)}`),
    );

    const result = await service.feed(ORG, videos());

    expect(errorLine.mock.calls[0][0]).toContain('discover.feed.group_threw');
    expect(everythingLogged()).not.toContain(YOUTUBE_KEY);
    expect(everythingKept(redis)).not.toContain(YOUTUBE_KEY);
    expect(JSON.stringify(result)).not.toContain(YOUTUBE_KEY);
  });

  it('is not in the status either', () => {
    const { service } = withRealSource(jest.fn());

    expect(service.status().sources.videos).toBe(true);
    expect(JSON.stringify(service.status())).not.toContain(YOUTUBE_KEY);
  });
});

describe('Festivals', () => {
  /** Evening of the 10th in UTC: already the 11th in Chennai, still the 10th in San Francisco. */
  const EVENING = new Date('2026-11-10T20:00:00.000Z');
  const TAMIL_NADU_COPY = 'discover:feed:v1:festivals:IN:IN-TN';
  const SUBTITLE = 'Dates from public holiday calendars and date-holidays (CC BY-SA).';

  beforeEach(() => {
    jest.setSystemTime(EVENING);
  });

  it('needs a country: Worldwide has no festivals, asks for none, and has nothing wrong', async () => {
    const { service, engine, redis } = build();

    const result = await service.feed(ORG, festivals({ ...WORLDWIDE }, 'en'));

    expect(result.groups).toEqual([]);
    expect(result.unavailable).toEqual([]);
    expect(result.today).toBe('2026-11-10');
    expect(result).not.toHaveProperty('reason');
    expect(engine.holidays.fetch).not.toHaveBeenCalled();
    expect(redis.keys).toEqual([]);
  });

  it('keeps everything it was given, and shows a week back and a month ahead', async () => {
    const { service, engine, redis } = build();
    const kept = jest.spyOn(redis, 'set');
    engine.holidays.fetch.mockResolvedValue(
      answer([
        festival('Next year', '2027-10-29'),
        festival('A day too late', '2026-12-12'),
        festival('The last day shown', '2026-12-11'),
        festival('Today', '2026-11-11', true),
        festival('The first day shown', '2026-11-04'),
        festival('A day too early', '2026-11-03'),
      ]),
    );

    const result = await service.feed(ORG, festivals());

    expect(result.today).toBe('2026-11-11');
    expect(titles(result)).toEqual([['The first day shown', 'Today', 'The last day shown']]);
    expect(stored(redis, TAMIL_NADU_COPY).groups[0].items.map((item) => item.title)).toEqual([
      'Next year',
      'A day too late',
      'The last day shown',
      'Today',
      'The first day shown',
      'A day too early',
    ]);
    expect(kept).toHaveBeenCalledWith(TAMIL_NADU_COPY, expect.any(String), 30 * 24 * 60 * 60);
  });

  it('is good for a week, and asked again after it', async () => {
    const { service, engine } = build();
    engine.holidays.fetch.mockResolvedValue(answer([festival('A festival', '2026-11-16')]));
    await service.feed(ORG, festivals());

    await jest.advanceTimersByTimeAsync(7 * DAY - 1_000);
    const fresh = await service.feed(ORG, festivals());
    await settle();
    expect(fresh.groups[0].stale).toBe(false);
    expect(engine.holidays.fetch).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(1_000);
    await service.feed(ORG, festivals());
    await settle();
    expect(engine.holidays.fetch).toHaveBeenCalledTimes(2);
  });

  it('cuts the window again on every request, so one copy serves a month', async () => {
    const { service, engine } = build();
    engine.holidays.fetch.mockResolvedValue(
      answer([festival('In November', '2026-11-12'), festival('In January', '2027-01-08')]),
    );
    const first = await service.feed(ORG, festivals());
    engine.holidays.fetch.mockResolvedValue(failure('upstream'));

    await jest.advanceTimersByTimeAsync(29 * DAY);
    await service.feed(ORG, festivals());
    await settle();
    const later = await service.feed(ORG, festivals());

    expect(titles(first)).toEqual([['In November']]);
    expect(later.today).toBe('2026-12-10');
    expect(titles(later)).toEqual([['In January']]);
    expect(later.groups[0].stale).toBe(true);
    expect(later.groups[0].subtitle).toBe(`${SUBTITLE} Showing what we had from 29 days ago.`);
    expect(later.groups[0].fetchedAt).toBe(EVENING.toISOString());
    expect(later.unavailable).toEqual(['holidays']);
  });

  it("counts from the place's own today", async () => {
    const { service } = build();

    const chennai = await service.feed(ORG, festivals(CHENNAI));
    const sanFrancisco = await service.feed(ORG, festivals(SAN_FRANCISCO, 'en'));

    expect(CHENNAI.timeZone).toBe('Asia/Kolkata');
    expect(chennai.today).toBe('2026-11-11');
    expect(SAN_FRANCISCO.timeZone).toBe('America/Los_Angeles');
    expect(sanFrancisco.today).toBe('2026-11-10');
    expect(sanFrancisco.groups[0].title).toBe('Festivals And Holidays In United States');
  });

  it('shares one copy between two clocks, and cuts it for each', async () => {
    const { service, engine } = build();
    engine.holidays.fetch.mockResolvedValue(
      answer([
        festival('Only from the 11th', '2026-12-11'),
        festival('Only from the 10th', '2026-11-03'),
      ]),
    );
    const viewedFromCalifornia: Locality = { ...CHENNAI, timeZone: 'America/Los_Angeles' };

    const there = await service.feed(ORG, festivals(CHENNAI));
    const here = await service.feed(ORG, festivals(viewedFromCalifornia));

    expect(titles(there)).toEqual([['Only from the 11th']]);
    expect(titles(here)).toEqual([['Only from the 10th']]);
    expect(engine.holidays.fetch).toHaveBeenCalledTimes(1);
  });

  it("reads the country's main zone when the place has none", async () => {
    const { service } = build();

    const result = await service.feed(ORG, festivals({ ...CHENNAI, timeZone: null }));

    expect(result.today).toBe('2026-11-11');
  });

  it.each(['Not/AZone', 'Mars/Olympus_Mons', 'x', '+++'])(
    'reads UTC for the zone %s rather than throwing',
    async (timeZone) => {
      const { service } = build();

      const result = await service.feed(ORG, festivals({ ...CHENNAI, timeZone }));

      expect(result.today).toBe('2026-11-10');
      expect(result.groups.map((group) => group.id)).toEqual(['festivals']);
    },
  );

  it('keeps the same festival in two years, and twice in a month, as rows of their own', async () => {
    const { service, engine, redis } = build();
    engine.holidays.fetch.mockResolvedValue(
      answer([
        festival('Diwali/Deepavali', '2026-11-08'),
        festival('Diwali/Deepavali', '2027-10-29'),
        festival('Ekadashi', '2026-11-20', true),
        festival('Ekadashi', '2026-12-04', true),
      ]),
    );

    const result = await service.feed(ORG, festivals());

    const kept = stored(redis, TAMIL_NADU_COPY).groups[0].items;
    expect(kept.map((item) => [item.title, item.date])).toEqual([
      ['Diwali/Deepavali', '2026-11-08'],
      ['Diwali/Deepavali', '2027-10-29'],
      ['Ekadashi', '2026-11-20'],
      ['Ekadashi', '2026-12-04'],
    ]);
    expect(new Set(kept.map((item) => item.id)).size).toBe(4);
    expect(kept[0].id).toBe(itemId('holidays', '2026-11-08|Diwali/Deepavali'));
    expect(kept[1].id).toBe(itemId('holidays', '2027-10-29|Diwali/Deepavali'));

    const shown = result.groups[0].items;
    expect(shown.map((item) => [item.title, item.date])).toEqual([
      ['Diwali/Deepavali', '2026-11-08'],
      ['Ekadashi', '2026-11-20'],
      ['Ekadashi', '2026-12-04'],
    ]);
    expect(shown[1].id).not.toBe(shown[2].id);
  });

  it('gives a festival the same id every time it is fetched', async () => {
    const { service, engine } = build();
    engine.holidays.fetch.mockResolvedValue(
      answer([festival('A lasting festival', '2026-11-16')], {
        attribution: { name: 'Calendars', url: 'https://calendar.example/in' },
      }),
    );
    const first = await service.feed(ORG, festivals());

    await jest.advanceTimersByTimeAsync(7 * DAY);
    engine.holidays.fetch.mockResolvedValue(failure('upstream'));
    await service.feed(ORG, festivals());
    await settle();
    const kept = await service.feed(ORG, festivals());

    expect(kept.groups[0].items[0].id).toBe(first.groups[0].items[0].id);
    // The copy it had to keep still says which calendar it came from.
    expect(kept.groups[0].attribution).toEqual(first.groups[0].attribution);
  });

  it('writes a brief for each, with its day and its badge', async () => {
    const { service, engine } = build();
    engine.holidays.fetch.mockResolvedValue(
      answer([
        festival('Diwali/Deepavali', '2026-11-08'),
        festival('Bhai Duj', '2026-11-11', true),
      ]),
    );

    const result = await service.feed(ORG, festivals());

    expect(result.groups[0].items.map((item) => item.brief)).toEqual([
      'Festival in Chennai, Tamil Nadu: "Diwali/Deepavali" on Sunday 8 November 2026 (public holiday).',
      'Festival in Chennai, Tamil Nadu: "Bhai Duj" on Wednesday 11 November 2026 (observance).',
    ]);
  });

  it("reads the country's copy for a region the holiday rules do not know", async () => {
    const { service, engine, redis } = build();
    const made = (code: string) => buildLocality({ countryCode: 'IN', regionCode: code });

    await service.feed(ORG, festivals(INDIA));
    await service.feed(ORG, festivals(made('IN-ZZ1')));
    await service.feed(ORG, festivals(made('IN-ZZ2')));

    // A made-up region must not cost a fetch and a month-long copy of its own.
    expect(engine.holidays.fetch).toHaveBeenCalledTimes(1);
    expect(feedKeys(redis)).toEqual(['discover:feed:v1:festivals:IN:-']);
  });

  it('keeps a copy for each region, since a state has days off of its own', async () => {
    const { service, engine, redis } = build();

    await service.feed(ORG, festivals(CHENNAI));
    await service.feed(ORG, festivals(TAMIL_NADU));
    await service.feed(ORG, festivals(buildLocality({ countryCode: 'IN', regionCode: 'IN-KL' })));
    await service.feed(ORG, festivals(INDIA));

    expect(engine.holidays.fetch).toHaveBeenCalledTimes(3);
    expect(feedKeys(redis).sort()).toEqual([
      'discover:feed:v1:festivals:IN:-',
      'discover:feed:v1:festivals:IN:IN-KL',
      TAMIL_NADU_COPY,
    ]);
  });

  it('does not call a quiet month a failure', async () => {
    const { service, engine } = build();
    engine.holidays.fetch.mockResolvedValue(answer([festival('Next spring', '2027-03-01')]));

    const result = await service.feed(ORG, festivals());

    expect(result.groups).toEqual([]);
    expect(result.unavailable).toEqual([]);
    expect(result.today).toBe('2026-11-11');
  });

  it('reads the recorded calendar through the real source, from fetch to answer', async () => {
    const built = build();
    const outside = jest.fn<ReturnType<DiscoverFetch>, Parameters<DiscoverFetch>>(async (url) => ({
      status: 200,
      body: recorded('chennai/holidays-IN.2026-11-10.ics'),
      finalUrl: url,
    }));
    built.engine.holidays = createHolidaysSource({ fetch: outside }) as jest.Mocked<DiscoverSource>;

    const result = await built.service.feed(ORG, festivals());

    expect(outside).toHaveBeenCalledTimes(1);
    expect(result.unavailable).toEqual([]);
    expect(result.today).toBe('2026-11-11');
    const [group] = result.groups;
    expect(group.attribution).toEqual({
      name: 'Public holiday calendars and date-holidays',
      url: expect.stringContaining('https://calendar.google.com/calendar/embed?src=en.indian'),
    });
    expect(group.items).toContainEqual(
      expect.objectContaining({
        kind: 'festival',
        title: 'Diwali/Deepavali',
        date: '2026-11-08',
        observance: false,
      }),
    );
    // Only the weeks around today, in date order.
    const dates = group.items.map((item) => item.date as string);
    expect(dates.length).toBeGreaterThan(3);
    expect(dates).toEqual([...dates].sort());
    expect(dates.every((date) => date >= '2026-11-04' && date <= '2026-12-11')).toBe(true);

    // The copy holds next year's Diwali too, as a row of its own.
    const diwali = stored(built.redis, TAMIL_NADU_COPY).groups[0].items.filter(
      (item) => item.title === 'Diwali/Deepavali',
    );
    expect(diwali.map((item) => item.date).sort()).toEqual(['2026-11-08', '2027-10-29']);
    expect(diwali[0].id).not.toBe(diwali[1].id);
  });

  describe('half an answer', () => {
    const half = (items: SourceItem[]) => answer(items, { partial: true });

    it('is shown when there is nothing else, and asked for again in ten minutes', async () => {
      const { service, engine } = build();
      engine.holidays.fetch.mockResolvedValue(half([festival('Republic Day', '2026-11-12')]));

      const result = await service.feed(ORG, festivals());

      expect(titles(result)).toEqual([['Republic Day']]);
      expect(result.groups[0].stale).toBe(false);
      // One of two readers answered, so the source is not down.
      expect(result.unavailable).toEqual([]);

      await jest.advanceTimersByTimeAsync(10 * MINUTE - 1_000);
      await service.feed(ORG, festivals());
      await settle();
      expect(engine.holidays.fetch).toHaveBeenCalledTimes(1);

      engine.holidays.fetch.mockResolvedValue(
        answer([festival('Republic Day', '2026-11-12'), festival('Bhai Duj', '2026-11-11', true)]),
      );
      await jest.advanceTimersByTimeAsync(1_000);
      await service.feed(ORG, festivals());
      await settle();
      expect(engine.holidays.fetch).toHaveBeenCalledTimes(2);

      // The whole answer takes the half's place, and is then good for its week.
      const whole = await service.feed(ORG, festivals());
      expect(titles(whole)).toEqual([['Bhai Duj', 'Republic Day']]);
      await jest.advanceTimersByTimeAsync(6 * DAY);
      await service.feed(ORG, festivals());
      await settle();
      expect(engine.holidays.fetch).toHaveBeenCalledTimes(2);
    });

    it('never takes the place of a whole copy, and the rest is asked for again soon', async () => {
      const { service, engine } = build();
      engine.holidays.fetch.mockResolvedValue(
        answer([
          festival('From the calendar', '2026-11-20', true),
          festival('From both', '2026-11-25'),
        ]),
      );
      await service.feed(ORG, festivals());

      await jest.advanceTimersByTimeAsync(7 * DAY + MINUTE);
      engine.holidays.fetch.mockResolvedValue(half([festival('From both', '2026-11-25')]));
      await service.feed(ORG, festivals());
      await settle();
      const result = await service.feed(ORG, festivals());

      expect(titles(result)).toEqual([['From the calendar', 'From both']]);
      expect(result.groups[0].fetchedAt).toBe(EVENING.toISOString());
      expect(result.groups[0].stale).toBe(true);
      expect(result.groups[0].subtitle).toBe(`${SUBTITLE} Showing what we had from 7 days ago.`);

      await jest.advanceTimersByTimeAsync(10 * MINUTE - 1_000);
      await service.feed(ORG, festivals());
      await settle();
      expect(engine.holidays.fetch).toHaveBeenCalledTimes(2);

      await jest.advanceTimersByTimeAsync(1_000);
      await service.feed(ORG, festivals());
      await settle();
      expect(engine.holidays.fetch).toHaveBeenCalledTimes(3);
    });

    it('is replaced by a newer half, which is no worse', async () => {
      const { service, engine } = build();
      engine.holidays.fetch.mockResolvedValue(half([festival('An older half', '2026-11-12')]));
      await service.feed(ORG, festivals());

      await jest.advanceTimersByTimeAsync(10 * MINUTE);
      engine.holidays.fetch.mockResolvedValue(half([festival('A newer half', '2026-11-12')]));
      await service.feed(ORG, festivals());
      await settle();

      expect(titles(await service.feed(ORG, festivals()))).toEqual([['A newer half']]);
    });

    it('takes the place of a whole copy that had nothing in it', async () => {
      const { service, engine } = build();
      engine.holidays.fetch.mockResolvedValue(answer([]));
      await service.feed(ORG, festivals());

      await jest.advanceTimersByTimeAsync(7 * DAY);
      engine.holidays.fetch.mockResolvedValue(half([festival('Something', '2026-11-20')]));
      await service.feed(ORG, festivals());
      await settle();

      expect(titles(await service.feed(ORG, festivals()))).toEqual([['Something']]);
    });

    it('says nothing about the source: it neither opens the breaker nor clears it', async () => {
      // Countries, not regions: a region the holiday rules do not know shares its country's copy.
      const COUNTRIES = 'IN US FR DE GB JP BR AU CA IT ES MX NL SE NO DK FI PL PT IE AT'.split(' ');
      const countryAt = (index: number) => buildLocality({ countryCode: COUNTRIES[index] });
      const { service, engine, redis } = build();
      engine.holidays.fetch.mockResolvedValue(half([festival('Republic Day', '2026-11-12')]));

      for (let index = 0; index < 5; index += 1) {
        await service.feed(ORG, festivals(countryAt(index)));
      }
      expect(engine.holidays.fetch).toHaveBeenCalledTimes(5);
      expect(breakers(redis)).toEqual([]);

      // Two failures, a half, and a third failure: still three failures in a row.
      const results = [
        failure('upstream'),
        failure('upstream'),
        half([festival('Republic Day', '2026-11-12')]),
        failure('upstream'),
      ];
      for (const [index, result] of results.entries()) {
        engine.holidays.fetch.mockResolvedValueOnce(result);
        await service.feed(ORG, festivals(countryAt(10 + index)));
      }
      expect(redis.read('discover:breaker:holidays')).toBe('3');

      await service.feed(ORG, festivals(countryAt(20)));
      expect(engine.holidays.fetch).toHaveBeenCalledTimes(9);
    });
  });
});

describe('what counts as a new place', () => {
  const counted = (redis: FakeRedis) => redis.read(workspaceKeys.feedMisses(ORG));

  function atTheLimit(redis: FakeRedis): void {
    redis.write(workspaceKeys.feedMisses(ORG), String(NEW_PLACES_PER_MINUTE), 60);
  }

  it('counts the loads that belong to a place, and not an edition or a network', async () => {
    const { service, redis } = build();

    // Three new copies, and none of them is anybody's place.
    await service.feed(ORG, trending({ ...WORLDWIDE }, 'en'));
    expect(counted(redis)).toBeNull();

    // Two new copies (the searches and the Tamil edition), one of them a place.
    await service.feed(ORG, trending());
    expect(counted(redis)).toBe('1');

    await service.feed(ORG, news());
    expect(counted(redis)).toBe('2');
    await service.feed(ORG, videos());
    expect(counted(redis)).toBe('3');
    await service.feed(ORG, festivals());
    expect(counted(redis)).toBe('4');

    // All of it is there now, so asking again counts nothing.
    await service.feed(ORG, trending());
    await service.feed(ORG, videos());
    await service.feed(ORG, festivals());
    expect(counted(redis)).toBe('4');
  });

  it.each([
    ['trending', trending],
    ['news', news],
    ['videos', videos],
    ['festivals', festivals],
  ] as const)('refuses a new place for %s at the limit', async (_kind, request) => {
    const { service, redis, gate } = build();
    atTheLimit(redis);

    const error = await service.feed(ORG, request()).catch((caught: unknown) => caught);

    expect((error as HttpException).getStatus()).toBe(429);
    expect((error as HttpException).getResponse()).toMatchObject({ code: 'feed_throttled' });
    // Refused whole, with nothing left running behind the refusal.
    expect(gate.running).toBe(0);
  });

  it('still answers what belongs to no place at the limit, however new', async () => {
    const { service, engine, redis } = build();
    fillTrending(engine);
    atTheLimit(redis);

    const result = await service.feed(ORG, trending({ ...WORLDWIDE }, 'en'));

    expect(result.groups.map((group) => group.id)).toEqual(['wikipedia', 'social']);
    expect(result.unavailable).toEqual([]);
    expect(counted(redis)).toBe(String(NEW_PLACES_PER_MINUTE));
  });

  it('does not let a made-up language be a way round the limit', async () => {
    const { service, engine, redis } = build();
    await service.feed(ORG, trending());
    atTheLimit(redis);

    for (const language of ['xx', 'zz', 'qqq', 'fr', 'ja']) {
      await expect(service.feed(ORG, trending(TAMIL_NADU, language))).resolves.toBeDefined();
    }

    expect(engine.wikipedia.fetch).toHaveBeenCalledTimes(1);
    expect(engine.trends.fetch).toHaveBeenCalledTimes(1);
  });
});

describe('simulated and real, on one Redis', () => {
  const REAL = [
    'discover:budget:youtube:2026-11-04',
    'discover:feed:v1:festivals:IN:IN-TN',
    'discover:feed:v1:social:bluesky',
    'discover:feed:v1:social:mastodon',
    'discover:feed:v1:trending:IN:IN-TN:-:-:-',
    'discover:feed:v1:videos:IN',
    'discover:feed:v1:wiki:ta.wikipedia',
  ];

  /** Everything kept that is an answer or a count of one: not the locks, not the workspace's own counter. */
  function kept(redis: FakeRedis): string[] {
    return redis.keys.filter((key) => !key.includes(':lock:') && !key.includes('feedmiss')).sort();
  }

  async function askForEverything({ service }: ReturnType<typeof build>): Promise<void> {
    await service.feed(ORG, trending());
    await service.feed(ORG, videos());
    await service.feed(ORG, festivals());
  }

  it('keeps every new copy, and the budget, under a name of its own', async () => {
    const redis = new FakeRedis();
    const real = build({ redis });
    const simulated = build({ redis, simulation: true });

    await askForEverything(real);
    expect(kept(redis)).toEqual(REAL);

    await askForEverything(simulated);
    expect(kept(redis)).toEqual(
      [...REAL, ...REAL.map((key) => key.replace(/^discover:/, 'discover:sim:'))].sort(),
    );
    // Nothing the real one had kept was read: every simulated source was asked.
    for (const source of [
      simulated.engine.trends,
      simulated.engine.wikipedia,
      simulated.engine.bluesky,
      simulated.engine.mastodon,
      simulated.engine.holidays,
      youtube(simulated.engine),
    ]) {
      expect(source.fetch).toHaveBeenCalledTimes(1);
    }
  });

  it('answers each from its own copy', async () => {
    const redis = new FakeRedis();
    const real = build({ redis });
    const simulated = build({ redis, simulation: true });
    real.engine.wikipedia.fetch.mockResolvedValue(answer([article('A real article')]));
    simulated.engine.wikipedia.fetch.mockResolvedValue(answer([article('A recorded article')]));
    youtube(simulated.engine).fetch.mockResolvedValue(answer([video('A sample video')]));
    simulated.engine.holidays.fetch.mockResolvedValue(
      answer([festival('A recorded festival', '2026-11-08')]),
    );
    await askForEverything(real);
    await askForEverything(simulated);

    expect(titles(await real.service.feed(ORG, trending()))).toContainEqual(['A real article']);
    expect(titles(await simulated.service.feed(ORG, trending()))).toContainEqual([
      'A recorded article',
    ]);
    expect(titles(await real.service.feed(ORG, videos()))).toEqual([['A popular video']]);
    expect(titles(await simulated.service.feed(ORG, videos()))).toEqual([['A sample video']]);
    expect(titles(await real.service.feed(ORG, festivals()))).toEqual([['A festival']]);
    expect(titles(await simulated.service.feed(ORG, festivals()))).toEqual([
      ['A recorded festival'],
    ]);
  });

  it('does not let a budget spent in one world rest the other', async () => {
    const redis = new FakeRedis();
    const real = build({ redis });
    const simulated = build({ redis, simulation: true });
    spend(redis, YOUTUBE_DAILY_UNITS, 'discover:sim:budget:youtube:2026-11-04');

    await expect(simulated.service.feed(ORG, videos())).resolves.toMatchObject({
      reason: 'resting',
    });
    const result = await real.service.feed(ORG, videos());

    expect(titles(result)).toEqual([['A popular video']]);
    expect(redis.read(BUDGET)).toBe('1');
  });

  it('does not let a network down in one world open the breaker of the other', async () => {
    const redis = new FakeRedis();
    const real = build({ redis });
    const simulated = build({ redis, simulation: true });
    simulated.engine.bluesky.fetch.mockResolvedValue(failure('upstream'));

    await simulated.service.feed(ORG, trending());
    await real.service.feed(ORG, trending());

    expect(breakers(redis)).toEqual(['discover:sim:breaker:bluesky']);
    expect(real.engine.bluesky.fetch).toHaveBeenCalledTimes(1);
  });
});
