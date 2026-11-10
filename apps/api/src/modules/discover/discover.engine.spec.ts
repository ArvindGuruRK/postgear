/**
 * The two worlds, and the one door out of the process.
 *
 * The guarded fetch is mocked, so nothing here can open a socket: a real address
 * reaching it is exactly what these tests want to see, and a simulated one reaching
 * it is exactly what they must never see.
 *
 * Then the one key: where it goes (YouTube's address, and nowhere else), and what
 * the boot line says about it (whether there is one).
 */
import { type FactoryProvider, Logger, type Provider } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import {
  BLUESKY_TRENDS_URL,
  buildLocality,
  CHENNAI,
  createYoutubeSource,
  holidayCalendarUrl,
  mastodonTrendsUrl,
  PARIS,
  SAN_FRANCISCO,
  WORLDWIDE,
  wikipediaTopPrefix,
  youtubePopularPrefix,
} from '@postgear/discover-engine';

jest.mock('@postgear/seo-engine', () => ({ fetchUrlSafely: jest.fn() }));
// The real source, watched: the key it is built with is the one thing nothing else shows.
jest.mock('@postgear/discover-engine', () => {
  const actual = jest.requireActual('@postgear/discover-engine');
  return { ...actual, createYoutubeSource: jest.fn(actual.createYoutubeSource) };
});

import {
  createDiscoverEngine,
  createSafeDiscoverFetch,
  DISCOVER_ENGINE,
  type DiscoverEngine,
  type DiscoverEnv,
  describeEngine,
} from './discover.engine';
import { DiscoverModule } from './discover.module';

const { fetchUrlSafely } = jest.requireMock('@postgear/seo-engine') as {
  fetchUrlSafely: jest.Mock;
};

const USER_AGENT = 'PostGear/1.0 (+https://postgear.rkay.in)';
const YOUTUBE_KEY = 'yt-key-that-must-stay-home';
/** The morning the Module 05 answers were recorded, so the festival span never moves. */
const RECORDED_ON = new Date('2026-11-10T08:00:00.000Z');
const TAMIL_NADU = buildLocality({ countryCode: 'IN', regionCode: 'IN-TN' });
const EMPTY_RSS =
  '<?xml version="1.0"?><rss version="2.0"><channel><title>x</title></channel></rss>';

function env(overrides: Partial<DiscoverEnv> = {}): DiscoverEnv {
  return {
    DISCOVER_SIMULATION: 'false',
    DISCOVER_GEOCODER: 'nominatim',
    DISCOVER_GEOCODER_USER_AGENT: USER_AGENT,
    ...overrides,
  };
}

/** What the guarded fetch hands back, with only the fields the adapter reads. */
function answer(statusCode: number, body: string, finalUrl = 'https://example.test/final') {
  return { statusCode, body, finalUrl };
}

beforeEach(() => {
  fetchUrlSafely.mockReset();
});

describe('createSafeDiscoverFetch', () => {
  const init = { accept: 'application/rss+xml', maxBytes: 1024, signal: AbortSignal.timeout(1000) };

  it('goes through the guarded fetch, within limits, checking the certificate', async () => {
    fetchUrlSafely.mockResolvedValue(answer(200, '<rss/>'));

    const response = await createSafeDiscoverFetch(USER_AGENT)('https://example.test/feed', init);

    expect(response).toEqual({
      status: 200,
      body: '<rss/>',
      finalUrl: 'https://example.test/final',
    });
    expect(fetchUrlSafely).toHaveBeenCalledWith('https://example.test/feed', {
      signal: init.signal,
      timeoutMs: 8000,
      maxBytes: 1024,
      accept: 'application/rss+xml',
      userAgent: USER_AGENT,
      requireHtml: false,
      rejectBadStatus: false,
      verifyCertificate: true,
    });
  });

  it('hands a bad status back as an answer, since the sources tell them apart', async () => {
    fetchUrlSafely.mockResolvedValue(answer(429, 'slow down'));

    const response = await createSafeDiscoverFetch(USER_AGENT)('https://example.test/feed', init);

    expect(response.status).toBe(429);
  });

  it('lets a caller say who it is', async () => {
    fetchUrlSafely.mockResolvedValue(answer(200, ''));

    await createSafeDiscoverFetch(USER_AGENT)('https://example.test/feed', {
      ...init,
      userAgent: 'Someone/1.0',
    });

    expect(fetchUrlSafely.mock.calls[0][1].userAgent).toBe('Someone/1.0');
  });

  it('lets a refused address throw, which is what a source reads as trouble', async () => {
    fetchUrlSafely.mockRejectedValue(new Error('unsafe address'));

    await expect(
      createSafeDiscoverFetch(USER_AGENT)('http://169.254.169.254/', init),
    ).rejects.toThrow('unsafe address');
  });
});

describe('createDiscoverEngine', () => {
  it('reads recordings, and never the guarded fetch, under simulation', async () => {
    const engine = createDiscoverEngine(env({ DISCOVER_SIMULATION: 'true' }));

    const trends = await engine.trends.fetch({ locality: TAMIL_NADU, language: 'ta' });
    const place = await engine.geocoder?.reverse(13.08, 80.27);

    expect(engine.simulation).toBe(true);
    expect(trends.items).toHaveLength(10);
    expect(place?.regionCode).toBe('IN-TN');
    expect(fetchUrlSafely).not.toHaveBeenCalled();
  });

  it('reads the real feeds through the guarded fetch otherwise, saying who it is', async () => {
    fetchUrlSafely.mockResolvedValue(answer(200, EMPTY_RSS));
    const engine = createDiscoverEngine(env());

    await engine.trends.fetch({ locality: TAMIL_NADU, language: 'ta' });

    expect(engine.simulation).toBe(false);
    const [url, options] = fetchUrlSafely.mock.calls[0];
    expect(url).toContain('https://trends.google.com/');
    expect(options.userAgent).toBe(USER_AGENT);
    expect(options.verifyCertificate).toBe(true);
  });

  it('asks OpenStreetMap through the same door, in English', async () => {
    fetchUrlSafely.mockResolvedValue(
      answer(
        200,
        JSON.stringify({
          address: { country_code: 'in', state: 'Tamil Nadu', 'ISO3166-2-lvl4': 'IN-TN' },
        }),
      ),
    );
    const engine = createDiscoverEngine(env());

    const place = await engine.geocoder?.reverse(13.08, 80.27);

    expect(place?.regionCode).toBe('IN-TN');
    const [url, options] = fetchUrlSafely.mock.calls[0];
    expect(new URL(url).hostname).toBe('nominatim.openstreetmap.org');
    expect(new URL(url).searchParams.get('accept-language')).toBe('en');
    expect(options.userAgent).toBe(USER_AGENT);
  });

  it('turns finding places off in both worlds, and leaves the feeds on', () => {
    for (const DISCOVER_SIMULATION of ['true', 'false'] as const) {
      const engine = createDiscoverEngine(env({ DISCOVER_SIMULATION, DISCOVER_GEOCODER: 'off' }));
      expect(engine.geocoder).toBeNull();
      expect(engine.trends.id).toBe('google-trends');
      expect(engine.news.id).toBe('google-news');
    }
  });

  it('builds every source in both worlds, and videos only with a key', () => {
    for (const DISCOVER_SIMULATION of ['true', 'false'] as const) {
      const without = createDiscoverEngine(env({ DISCOVER_SIMULATION }));
      const withKey = createDiscoverEngine(
        env({ DISCOVER_SIMULATION, YOUTUBE_API_KEY: YOUTUBE_KEY }),
      );

      for (const engine of [without, withKey]) {
        expect(engine.wikipedia.id).toBe('wikipedia');
        expect(engine.bluesky.id).toBe('bluesky');
        expect(engine.mastodon.id).toBe('mastodon');
        expect(engine.holidays.id).toBe('holidays');
      }
      expect(without.videos).toBeNull();
      expect(withKey.videos?.id).toBe('youtube');
    }
  });

  it('fetches nothing while it is being built, in either world', () => {
    createDiscoverEngine(env({ YOUTUBE_API_KEY: YOUTUBE_KEY }));
    createDiscoverEngine(env({ DISCOVER_SIMULATION: 'true', YOUTUBE_API_KEY: YOUTUBE_KEY }));

    expect(fetchUrlSafely).not.toHaveBeenCalled();
  });
});

describe('the recorded answers, through the engine the API builds', () => {
  /** The festival span and "yesterday" are counted from now, so now is the day of the recordings. */
  beforeEach(() => {
    // Only the date is faked: the recordings are read from disk, which needs the real timers.
    jest.useFakeTimers({
      now: RECORDED_ON,
      doNotFake: [
        'hrtime',
        'nextTick',
        'performance',
        'queueMicrotask',
        'setImmediate',
        'clearImmediate',
        'setInterval',
        'clearInterval',
        'setTimeout',
        'clearTimeout',
      ],
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    // Whatever was asked for in this block, none of it left the process.
    expect(fetchUrlSafely).not.toHaveBeenCalled();
  });

  function simulated(overrides: Partial<DiscoverEnv> = {}) {
    return createDiscoverEngine(env({ DISCOVER_SIMULATION: 'true', ...overrides }));
  }

  it('reads Tamil Wikipedia for Chennai: ten articles, for yesterday', async () => {
    const result = await simulated().wikipedia.fetch({ locality: CHENNAI, language: 'ta' });

    expect(result.failed).toBeUndefined();
    expect(result.items).toHaveLength(10);
    expect(result.answeredDay).toBe('2026-11-09');
    expect(result.attribution).toEqual({ name: 'Wikipedia', url: 'https://ta.wikipedia.org' });
    expect(result.items.map((item) => item.signal?.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    for (const item of result.items) {
      expect(item.kind).toBe('wiki');
      expect(item.language).toBe('ta');
      expect(item.url).toMatch(/^https:\/\/ta\.wikipedia\.org\/wiki\/\S+$/);
      // Neither the search page nor the main page, which the recording lists first.
      expect(item.title).not.toMatch(/:(?! )/);
      expect(item.title).not.toBe('முதற்பக்கம்');
    }
  });

  it('reads English Wikipedia for Worldwide, and each place its own edition', async () => {
    const { wikipedia } = simulated();

    const worldwide = await wikipedia.fetch({ locality: { ...WORLDWIDE }, language: 'en' });
    const paris = await wikipedia.fetch({ locality: PARIS, language: 'fr' });

    expect(worldwide.items).toHaveLength(10);
    expect(worldwide.items.every((item) => item.url?.startsWith('https://en.wikipedia.org/'))).toBe(
      true,
    );
    expect(paris.items).toHaveLength(10);
    expect(paris.items.every((item) => item.language === 'fr')).toBe(true);
  });

  it('reads ten trends from Bluesky and ten tags from Mastodon', async () => {
    const engine = simulated();
    const input = { locality: { ...WORLDWIDE }, language: 'en' };

    const bluesky = await engine.bluesky.fetch(input);
    const mastodon = await engine.mastodon.fetch(input);

    expect(bluesky.failed).toBeUndefined();
    expect(bluesky.items).toHaveLength(10);
    expect(mastodon.failed).toBeUndefined();
    expect(mastodon.items).toHaveLength(10);
    for (const item of bluesky.items) {
      expect(item.kind).toBe('social');
      expect(item.source).toEqual({ id: 'bluesky', name: 'Bluesky', url: 'https://bsky.app' });
      expect(item.url).toMatch(/^https:\/\/bsky\.app\//);
    }
    for (const item of mastodon.items) {
      expect(item.kind).toBe('social');
      expect(item.source.id).toBe('mastodon');
      expect(item.title).toMatch(/^#\S+$/);
      expect(item.url).toMatch(/^https:\/\/mastodon\.social\/tags\//);
    }
  });

  it("reads India's festivals whole, with Diwali as a public holiday", async () => {
    const result = await simulated().holidays.fetch({ locality: CHENNAI, language: 'ta' });

    expect(result.failed).toBeUndefined();
    expect(result.partial).toBeUndefined();
    expect(result.attribution.name).toBe('Public holiday calendars and date-holidays');
    expect(result.items).toContainEqual(
      expect.objectContaining({
        kind: 'festival',
        title: 'Diwali/Deepavali',
        date: '2026-11-08',
        observance: false,
      }),
    );
    // More than the tab shows: next year's is in the same answer.
    expect(result.items).toContainEqual(
      expect.objectContaining({ title: 'Diwali/Deepavali', date: '2027-10-29' }),
    );
  });

  it('reads the calendars of the other two recorded places too', async () => {
    const { holidays } = simulated();

    const france = await holidays.fetch({ locality: PARIS, language: 'fr' });
    const unitedStates = await holidays.fetch({ locality: SAN_FRANCISCO, language: 'en' });

    expect(france.items).toContainEqual(
      expect.objectContaining({ title: 'Armistice Day', date: '2026-11-11', observance: false }),
    );
    expect(unitedStates.items).toContainEqual(
      expect.objectContaining({ title: 'Thanksgiving Day', date: '2026-11-26', observance: false }),
    );
  });

  it('has no videos without a key, recordings or not', () => {
    expect(simulated().videos).toBeNull();
  });

  it('serves the five sample videos with a key, and charges a unit for them', async () => {
    const engine = simulated({ YOUTUBE_API_KEY: YOUTUBE_KEY });

    const result = await engine.videos?.fetch({ locality: CHENNAI, language: 'ta' });

    expect(result?.failed).toBeUndefined();
    expect(result?.items).toHaveLength(5);
    expect(result?.unitsUsed).toBe(1);
    for (const item of result?.items ?? []) {
      expect(item.kind).toBe('video');
      expect(item.url).toMatch(/^https:\/\/www\.youtube\.com\/watch\?v=[\w-]+$/);
      expect(item.image).toMatch(/^https:\/\/i\.ytimg\.com\/vi\//);
    }
    expect(JSON.stringify(result)).not.toContain(YOUTUBE_KEY);
  });

  it('says a place with no recording has nothing, rather than reaching for the network', async () => {
    const engine = simulated({ YOUTUBE_API_KEY: YOUTUBE_KEY });
    const japan = buildLocality({ countryCode: 'JP' });

    const wikipedia = await engine.wikipedia.fetch({ locality: japan, language: 'ja' });
    const videos = await engine.videos?.fetch({ locality: japan, language: 'ja' });

    expect(wikipedia).toMatchObject({ items: [], failed: 'not_found' });
    expect(videos).toMatchObject({ items: [], failed: 'not_found' });
  });
});

describe('the real sources, through the one door', () => {
  beforeEach(() => {
    fetchUrlSafely.mockResolvedValue(answer(404, ''));
  });

  /** The addresses that reached the guarded fetch. */
  function asked(): string[] {
    return fetchUrlSafely.mock.calls.map(([url]) => url as string);
  }

  it('asks Wikimedia, Bluesky and Mastodon through the guarded fetch, saying who it is', async () => {
    const engine = createDiscoverEngine(env());
    const input = { locality: TAMIL_NADU, language: 'ta' };

    await engine.wikipedia.fetch(input);
    await engine.bluesky.fetch(input);
    await engine.mastodon.fetch(input);

    // Wikipedia asks twice: yesterday was a 404, so the day before.
    expect(
      asked().filter((url) => url.startsWith(wikipediaTopPrefix('ta.wikipedia'))),
    ).toHaveLength(2);
    expect(asked()).toContain(BLUESKY_TRENDS_URL);
    expect(asked()).toContain(mastodonTrendsUrl());
    expect(asked()).toHaveLength(4);
    for (const [, options] of fetchUrlSafely.mock.calls) {
      expect(options.userAgent).toBe(USER_AGENT);
      expect(options.verifyCertificate).toBe(true);
      expect(options.rejectBadStatus).toBe(false);
    }
  });

  it("asks for the country's calendar through the same door", async () => {
    const engine = createDiscoverEngine(env());

    await engine.holidays.fetch({ locality: TAMIL_NADU, language: 'ta' });

    expect(asked()).toEqual([holidayCalendarUrl('en.indian')]);
  });

  it('sends the key to YouTube, and only there, when it is not simulating', async () => {
    const engine = createDiscoverEngine(env({ YOUTUBE_API_KEY: YOUTUBE_KEY }));

    const result = await engine.videos?.fetch({ locality: TAMIL_NADU, language: 'ta' });

    expect(asked()).toEqual([`${youtubePopularPrefix('IN')}${YOUTUBE_KEY}`]);
    expect(result).toMatchObject({ items: [], failed: 'not_found', unitsUsed: 1 });
    expect(JSON.stringify(result)).not.toContain(YOUTUBE_KEY);
  });

  it('keeps a refused key out of what the source says about it', async () => {
    fetchUrlSafely.mockImplementation(async (url: string) =>
      answer(403, `The request to ${url} was refused: API key not valid.`, url),
    );
    const engine = createDiscoverEngine(env({ YOUTUBE_API_KEY: YOUTUBE_KEY }));

    const result = await engine.videos?.fetch({ locality: TAMIL_NADU, language: 'ta' });

    expect(result?.failed).toBe('upstream');
    expect(JSON.stringify(result)).not.toContain(YOUTUBE_KEY);
  });
});

describe('describeEngine', () => {
  it('says whether videos are set up, and never with what', () => {
    const engine = createDiscoverEngine(env({ YOUTUBE_API_KEY: YOUTUBE_KEY }));

    expect(describeEngine(engine)).toEqual({
      event: 'discover.boot',
      simulation: false,
      geocoder: 'nominatim',
      userAgent: USER_AGENT,
      videos: true,
    });
    expect(JSON.stringify(describeEngine(engine))).not.toContain(YOUTUBE_KEY);
    // The engine as a whole has nowhere to read the key from either.
    expect(JSON.stringify(engine)).not.toContain(YOUTUBE_KEY);
  });

  it('says so when there is no key, in simulation too', () => {
    expect(describeEngine(createDiscoverEngine(env())).videos).toBe(false);
    expect(
      describeEngine(createDiscoverEngine(env({ DISCOVER_SIMULATION: 'true' }))),
    ).toMatchObject({ simulation: true, videos: false });
  });

  it('builds the videos source with a stand-in key under simulation, and the real one otherwise', () => {
    const built = jest.mocked(createYoutubeSource);

    const simulated = createDiscoverEngine(
      env({ DISCOVER_SIMULATION: 'true', YOUTUBE_API_KEY: YOUTUBE_KEY }),
    );
    expect(built).toHaveBeenCalledTimes(1);
    expect(built.mock.calls[0][0].apiKey).toBe('simulation');
    expect(describeEngine(simulated)).toMatchObject({ simulation: true, videos: true });

    createDiscoverEngine(env({ YOUTUBE_API_KEY: YOUTUBE_KEY }));
    expect(built).toHaveBeenCalledTimes(2);
    expect(built.mock.calls[1][0].apiKey).toBe(YOUTUBE_KEY);
  });

  it('builds no videos source at all without a key', () => {
    createDiscoverEngine(env());
    createDiscoverEngine(env({ DISCOVER_SIMULATION: 'true' }));

    expect(createYoutubeSource).not.toHaveBeenCalled();
  });
});

describe('the module, at boot', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  /** Builds the engine the way Nest does: through the module's own factory, from the config. */
  function boot(values: Partial<DiscoverEnv>): DiscoverEngine {
    const providers = Reflect.getMetadata('providers', DiscoverModule) as Provider[];
    const provider = providers.find(
      (entry): entry is FactoryProvider<DiscoverEngine> =>
        typeof entry === 'object' && 'useFactory' in entry && entry.provide === DISCOVER_ENGINE,
    );
    const settings = env(values);
    const config = { get: (key: keyof DiscoverEnv) => settings[key] } as unknown as ConfigService;
    if (!provider) throw new Error('The module does not provide the engine.');
    // Nest's type allows a promise. This factory builds the engine there and then.
    return provider.useFactory(config) as DiscoverEngine;
  }

  it('hands the key to the engine, and says in the log only that there is one', () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();

    const engine = boot({ YOUTUBE_API_KEY: YOUTUBE_KEY });

    expect(engine.videos?.id).toBe('youtube');
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(log.mock.calls[0][0] as string)).toEqual({
      event: 'discover.boot',
      simulation: false,
      geocoder: 'nominatim',
      userAgent: USER_AGENT,
      videos: true,
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain(YOUTUBE_KEY);
    expect(fetchUrlSafely).not.toHaveBeenCalled();
  });

  it('says videos are off when there is no key, and builds no source for them', () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();

    const engine = boot({ DISCOVER_SIMULATION: 'true' });

    expect(engine.videos).toBeNull();
    expect(JSON.parse(log.mock.calls[0][0] as string)).toMatchObject({
      simulation: true,
      videos: false,
    });
  });
});
