/**
 * The feed: what each kind asks for, what is shared and what never is, and how it
 * behaves when a source is struggling. The sources are fakes and the clock is too,
 * so a whole outage can be walked through in a test, and nothing opens a socket.
 */
import { HttpException, Logger } from '@nestjs/common';
import {
  buildLocality,
  CHENNAI,
  type DiscoverSource,
  type GoogleNewsSource,
  type Locality,
  PARIS,
  type SourceFailure,
  type SourceItem,
  type SourceResult,
  WORLDWIDE,
} from '@postgear/discover-engine';
import { securityLogger } from '../../common/logging/security-logger';
import { DiscoverCache } from './discover.cache';
import type { DiscoverEngine } from './discover.engine';
import { DiscoverGate } from './discover.gate';
import { discoverKeys } from './discover.keys';
import { DISCOVER_MESSAGES } from './discover.messages';
import {
  BREAKER_SECONDS,
  DiscoverService,
  type FeedRequest,
  NEW_PLACES_PER_MINUTE,
} from './discover.service';
import { FakeRedis } from './testing/fake-redis';

const NOW = new Date('2026-11-05T06:00:00.000Z');
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const ORG = 'org-1';

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

function answer(items: SourceItem[], extra: Partial<SourceResult> = {}): SourceResult {
  return { items, attribution: { name: 'Source' }, warnings: [], ...extra };
}

function failure(failed: SourceFailure): SourceResult {
  return answer([], { failed });
}

type FakeEngine = Omit<DiscoverEngine, 'trends' | 'news'> & {
  trends: jest.Mocked<DiscoverSource>;
  news: jest.Mocked<GoogleNewsSource>;
};

function fakeEngine(simulation: boolean): FakeEngine {
  return {
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

function build(options: { simulation?: boolean; gate?: DiscoverGate } = {}) {
  const redis = new FakeRedis();
  const engine = fakeEngine(options.simulation ?? false);
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

function feedKeys(redis: FakeRedis): string[] {
  return redis.keys.filter((key) => key.includes(':feed:v1:') && !key.includes(':lock:'));
}

function titles(result: { groups: { items: { title: string }[] }[] }): string[][] {
  return result.groups.map((group) => group.items.map((item) => item.title));
}

/** Lets a refresh started in the background finish. */
async function settle(): Promise<void> {
  await jest.advanceTimersByTimeAsync(0);
}

let logLine: jest.SpyInstance;
let securityWarn: jest.SpyInstance;

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
  logLine = jest.spyOn(Logger.prototype, 'log').mockImplementation();
  jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  jest.spyOn(Logger.prototype, 'error').mockImplementation();
  securityWarn = jest.spyOn(securityLogger, 'warn').mockImplementation();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('status', () => {
  it('says which world it is in, and which sources exist so far', () => {
    expect(build({ simulation: true }).service.status()).toEqual({
      simulation: true,
      geocoder: 'off',
      sources: {
        trends: true,
        news: true,
        wikipedia: false,
        videos: false,
        holidays: false,
        social: false,
      },
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

  it('has nothing for Worldwide yet, and neither asks nor keeps anything', async () => {
    const { service, engine, redis } = build();

    const result = await service.feed(ORG, trending({ ...WORLDWIDE }, 'en'));

    expect(result.groups).toEqual([]);
    expect(result.unavailable).toEqual([]);
    expect(result.locality.countryCode).toBeNull();
    expect(engine.trends.fetch).not.toHaveBeenCalled();
    expect(redis.keys).toEqual([]);
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
    expect(logLine).toHaveBeenCalledTimes(1);
    const refresh = JSON.parse(logLine.mock.calls[0][0] as string);
    expect(refresh).toMatchObject({
      event: 'discover.feed.refresh',
      key: 'discover:feed:v1:trending:IN:IN-TN:-:-:-',
      unavailable: [],
    });
    expect(refresh.ms).toEqual(expect.any(Number));

    await jest.advanceTimersByTimeAsync(19 * MINUTE);
    await service.feed('org-2', trending());

    expect(engine.trends.fetch).toHaveBeenCalledTimes(1);
    expect(logLine).toHaveBeenCalledTimes(1);
  });

  it('shares Trending across languages and cities, since Trends has neither', async () => {
    const { service, engine, redis } = build();
    const chennai = buildLocality({ countryCode: 'IN', regionCode: 'IN-TN', city: 'Chennai' });
    const madurai = buildLocality({ countryCode: 'IN', regionCode: 'IN-TN', city: 'Madurai' });

    await service.feed(ORG, trending(chennai, 'ta'));
    await service.feed(ORG, trending(madurai, 'en'));

    expect(engine.trends.fetch).toHaveBeenCalledTimes(1);
    expect(feedKeys(redis)).toEqual(['discover:feed:v1:trending:IN:IN-TN:-:-:-']);
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

    expect(result.unavailable).toEqual(['google-trends']);
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
