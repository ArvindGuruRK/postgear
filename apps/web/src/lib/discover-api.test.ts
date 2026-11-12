/**
 * The Discover client: the position is rounded to two decimals here and
 * nowhere else, and the feed query sends only what the API accepts. Module
 * 06: every feed call asks for the workspace's switches, and the settings are
 * read and saved through one route.
 */
import type { DiscoverSettings, Locality } from '@/types/discover';
import { api } from './api';
import {
  feedQuery,
  getDiscoverSettings,
  getFeed,
  localityFromPosition,
  localityFromTimeZone,
  roundCoordinate,
  saveDiscoverSettings,
  searchPlaces,
} from './discover-api';

jest.mock('./api', () => ({
  api: jest.fn(() => Promise.resolve({ locality: {}, localities: [] })),
}));

const mockedApi = api as jest.MockedFunction<typeof api>;

const CHENNAI: Locality = {
  countryCode: 'IN',
  countryName: 'India',
  regionCode: 'IN-TN',
  regionName: 'Tamil Nadu',
  city: 'Chennai',
  timeZone: 'Asia/Kolkata',
  languages: ['ta', 'en'],
  newsLanguages: ['ta', 'en'],
};

const WORLD: Locality = {
  countryCode: null,
  countryName: null,
  regionCode: null,
  regionName: null,
  city: null,
  timeZone: null,
  languages: ['en'],
  newsLanguages: ['en'],
};

beforeEach(() => mockedApi.mockClear());

describe('roundCoordinate', () => {
  it('keeps two decimals, about a kilometre', () => {
    expect(roundCoordinate(13.082_712)).toBe('13.08');
    expect(roundCoordinate(80.270_718)).toBe('80.27');
    expect(roundCoordinate(-33.868_82)).toBe('-33.87');
    expect(roundCoordinate(80)).toBe('80.00');
  });

  it('writes a negative zero as a plain zero', () => {
    expect(roundCoordinate(-0.001)).toBe('0.00');
  });

  it('refuses anything that is not a real number', () => {
    expect(() => roundCoordinate(Number.NaN)).toThrow(RangeError);
    expect(() => roundCoordinate(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('the place routes', () => {
  it('sends a rounded position, never the raw one', async () => {
    await localityFromPosition(13.082_712_3, 80.270_718_4);

    const path = mockedApi.mock.calls[0]?.[0] ?? '';
    expect(path).toBe('/discover/locality?lat=13.08&lng=80.27');
    expect(path).not.toContain('13.0827');
  });

  it('asks by time zone, encoded', async () => {
    await localityFromTimeZone('America/Argentina/Buenos_Aires');
    expect(mockedApi).toHaveBeenCalledWith(
      '/discover/locality?tz=America%2FArgentina%2FBuenos_Aires',
      expect.objectContaining({ timeoutMs: expect.any(Number) }),
    );
  });

  it('searches with the typed text, encoded', async () => {
    await searchPlaces('São Paulo & co');
    expect(mockedApi).toHaveBeenCalledWith(
      '/discover/locality/search?q=S%C3%A3o+Paulo+%26+co',
      expect.objectContaining({ timeoutMs: expect.any(Number) }),
    );
  });
});

describe('feedQuery', () => {
  it('sends the place, its names for the headings, the language and the time zone', () => {
    const query = feedQuery('trending', CHENNAI, 'ta');
    expect(Object.fromEntries(query)).toEqual({
      kind: 'trending',
      country: 'IN',
      region: 'IN-TN',
      regionName: 'Tamil Nadu',
      city: 'Chennai',
      lang: 'ta',
      useWorkspaceSources: '1',
      tz: 'Asia/Kolkata',
    });
  });

  it('sends no country, region or city for Worldwide', () => {
    expect(Object.fromEntries(feedQuery('news', WORLD, 'en'))).toEqual({
      kind: 'news',
      lang: 'en',
      useWorkspaceSources: '1',
    });
  });

  it('leaves out what a country-level place does not have', () => {
    const india = { ...CHENNAI, regionCode: null, regionName: null, city: null };
    expect(Object.fromEntries(feedQuery('news', india, 'hi'))).toEqual({
      kind: 'news',
      country: 'IN',
      lang: 'hi',
      useWorkspaceSources: '1',
      tz: 'Asia/Kolkata',
    });
  });

  it('asks every tab to leave out what the workspace switched off', () => {
    for (const kind of ['trending', 'news', 'videos', 'festivals'] as const) {
      expect(feedQuery(kind, CHENNAI, 'ta').get('useWorkspaceSources')).toBe('1');
    }
    expect(feedQuery('videos', WORLD, 'en').toString()).toContain('useWorkspaceSources=1');
  });

  it('adds a topic only when one is asked for', () => {
    expect(feedQuery('news', CHENNAI, 'ta', 'SPORTS').get('topic')).toBe('SPORTS');
    expect(feedQuery('news', CHENNAI, 'ta').has('topic')).toBe(false);
  });

  it('is what getFeed asks for', async () => {
    await getFeed('news', CHENNAI, 'ta');
    expect(mockedApi).toHaveBeenCalledWith(
      `/discover/feed?${feedQuery('news', CHENNAI, 'ta').toString()}`,
      expect.objectContaining({ timeoutMs: expect.any(Number) }),
    );
  });

  it('carries the News topic through getFeed', async () => {
    await getFeed('news', CHENNAI, 'ta', 'BUSINESS');
    expect(mockedApi.mock.calls[0]?.[0]).toContain('&topic=BUSINESS');
  });
});

describe('the workspace settings routes (Module 06)', () => {
  const SETTINGS: DiscoverSettings = {
    countryCode: 'IN',
    regionCode: 'IN-TN',
    regionName: 'Tamil Nadu',
    city: 'Chennai',
    timeZone: 'Asia/Kolkata',
    languages: ['ta', 'en'],
    topics: ['BUSINESS'],
    sources: null,
    interests: [],
    weeklyDigest: false,
    locationSource: 'SEARCH',
    place: CHENNAI,
    updatedAt: '2026-11-10T08:00:00.000Z',
  };

  it('reads the settings and hands back what is inside the answer', async () => {
    mockedApi.mockResolvedValueOnce({ settings: SETTINGS });

    await expect(getDiscoverSettings()).resolves.toEqual(SETTINGS);
    expect(mockedApi).toHaveBeenCalledWith(
      '/discover/settings',
      expect.objectContaining({ timeoutMs: expect.any(Number) }),
    );
  });

  it('saves a patch as one PATCH and hands back all the settings', async () => {
    mockedApi.mockResolvedValueOnce({ settings: { ...SETTINGS, languages: ['en', 'ta'] } });

    const saved = await saveDiscoverSettings({ languages: ['en', 'ta'] });

    expect(saved.languages).toEqual(['en', 'ta']);
    expect(mockedApi).toHaveBeenCalledTimes(1);
    expect(mockedApi).toHaveBeenCalledWith('/discover/settings', {
      method: 'PATCH',
      body: { languages: ['en', 'ta'] },
      timeoutMs: expect.any(Number),
    });
  });
});
