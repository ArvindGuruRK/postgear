/**
 * The Discover client: the position is rounded to two decimals here and
 * nowhere else, and the feed query sends only what the API accepts.
 */
import type { Locality } from '@/types/discover';
import { api } from './api';
import {
  feedQuery,
  getFeed,
  localityFromPosition,
  localityFromTimeZone,
  roundCoordinate,
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
    );
  });

  it('searches with the typed text, encoded', async () => {
    await searchPlaces('São Paulo & co');
    expect(mockedApi).toHaveBeenCalledWith('/discover/locality/search?q=S%C3%A3o+Paulo+%26+co');
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
      tz: 'Asia/Kolkata',
    });
  });

  it('sends no country, region or city for Worldwide', () => {
    expect(Object.fromEntries(feedQuery('news', WORLD, 'en'))).toEqual({
      kind: 'news',
      lang: 'en',
    });
  });

  it('leaves out what a country-level place does not have', () => {
    const india = { ...CHENNAI, regionCode: null, regionName: null, city: null };
    expect(Object.fromEntries(feedQuery('news', india, 'hi'))).toEqual({
      kind: 'news',
      country: 'IN',
      lang: 'hi',
      tz: 'Asia/Kolkata',
    });
  });

  it('adds a topic only when one is asked for', () => {
    expect(feedQuery('news', CHENNAI, 'ta', 'SPORTS').get('topic')).toBe('SPORTS');
    expect(feedQuery('news', CHENNAI, 'ta').has('topic')).toBe(false);
  });

  it('is what getFeed asks for', async () => {
    await getFeed('news', CHENNAI, 'ta');
    expect(mockedApi).toHaveBeenCalledWith(
      `/discover/feed?${feedQuery('news', CHENNAI, 'ta').toString()}`,
    );
  });
});
