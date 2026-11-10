/**
 * What each route accepts. Two rules are the point here: a position with more than
 * two decimals is refused, because the browser is what must round it, and every
 * object is strict.
 */
import {
  feedQuerySchema,
  LOCALITY_SEARCH_MAX,
  localityQuerySchema,
  localitySearchQuerySchema,
} from './dto/discover.schema';

describe('localityQuerySchema', () => {
  it('reads a rounded position into numbers', () => {
    expect(localityQuerySchema.parse({ lat: '13.08', lng: '80.27' })).toEqual({
      lat: 13.08,
      lng: 80.27,
    });
    expect(localityQuerySchema.parse({ lat: '-33.9', lng: '151' })).toEqual({
      lat: -33.9,
      lng: 151,
    });
  });

  it('refuses a position that was not rounded', () => {
    expect(localityQuerySchema.safeParse({ lat: '13.081', lng: '80.27' }).success).toBe(false);
    expect(localityQuerySchema.safeParse({ lat: '13.08', lng: '80.2707' }).success).toBe(false);
  });

  it.each([
    ['off the planet', { lat: '91', lng: '80.27' }],
    ['off the planet the other way', { lat: '13.08', lng: '181' }],
    ['half a position', { lat: '13.08' }],
    ['not a number', { lat: 'north', lng: '80.27' }],
    ['exponent notation', { lat: '1e1', lng: '80.27' }],
    ['a repeated parameter', { lat: ['13.08', '13.09'], lng: '80.27' }],
    ['a position and a zone together', { lat: '13.08', lng: '80.27', tz: 'Asia/Kolkata' }],
    ['something else entirely', { city: 'Chennai' }],
    ['nothing', {}],
  ])('refuses %s', (_name, query) => {
    expect(localityQuerySchema.safeParse(query).success).toBe(false);
  });

  it('accepts a zone by its name, with any of the characters real names use', () => {
    for (const tz of ['Asia/Kolkata', 'America/Port-au-Prince', 'Etc/GMT+5', 'UTC']) {
      expect(localityQuerySchema.parse({ tz })).toEqual({ tz });
    }
  });

  it('refuses a zone that is not shaped like one', () => {
    expect(localityQuerySchema.safeParse({ tz: 'Asia/Kolkata; DROP' }).success).toBe(false);
    expect(localityQuerySchema.safeParse({ tz: '../../etc/passwd' }).success).toBe(false);
    expect(localityQuerySchema.safeParse({ tz: 'A'.repeat(65) }).success).toBe(false);
  });
});

describe('localitySearchQuerySchema', () => {
  it('cleans the text before judging how long it is', () => {
    expect(localitySearchQuerySchema.parse({ q: '  san   francisco ' })).toEqual({
      q: 'san francisco',
    });
    expect(localitySearchQuerySchema.parse({ q: `${' '.repeat(100)}Paris` })).toEqual({
      q: 'Paris',
    });
  });

  it('keeps a city written in its own script', () => {
    expect(localitySearchQuerySchema.parse({ q: 'சென்னை' })).toEqual({ q: 'சென்னை' });
  });

  it('refuses one character, too many, and nothing', () => {
    expect(localitySearchQuerySchema.safeParse({ q: ' a ' }).success).toBe(false);
    expect(
      localitySearchQuerySchema.safeParse({ q: 'x'.repeat(LOCALITY_SEARCH_MAX + 1) }).success,
    ).toBe(false);
    expect(localitySearchQuerySchema.safeParse({}).success).toBe(false);
  });

  it('refuses a key it does not know', () => {
    expect(localitySearchQuerySchema.safeParse({ q: 'Paris', limit: '50' }).success).toBe(false);
  });
});

describe('feedQuerySchema', () => {
  it('accepts a whole place', () => {
    const query = {
      kind: 'news',
      country: 'IN',
      region: 'IN-TN',
      regionName: 'Tamil Nadu',
      city: 'Chennai',
      lang: 'ta',
      tz: 'Asia/Kolkata',
      topic: 'SPORTS',
    };
    expect(feedQuerySchema.parse(query)).toEqual(query);
  });

  it('takes no country as Worldwide', () => {
    expect(feedQuerySchema.parse({ kind: 'news' })).toEqual({ kind: 'news' });
  });

  it('knows all four kinds, and refuses a fifth', () => {
    for (const kind of ['trending', 'news', 'videos', 'festivals']) {
      expect(feedQuerySchema.safeParse({ kind }).success).toBe(true);
    }
    expect(feedQuerySchema.safeParse({ kind: 'gossip' }).success).toBe(false);
    expect(feedQuerySchema.safeParse({}).success).toBe(false);
  });

  it.each([
    ['a lower-case country', { country: 'in' }],
    ['a country that does not exist', { country: 'ZZ' }],
    ['a three letter country', { country: 'IND' }],
    ['a region with no country', { region: 'IN-TN' }],
    ['a region in another country', { country: 'FR', region: 'IN-TN' }],
    ['a region that is not shaped like one', { country: 'IN', region: 'IN/../TN' }],
    ['a city with no country', { city: 'Chennai' }],
    ['a region name with no country', { regionName: 'Tamil Nadu' }],
    ['a topic Google News does not have', { country: 'IN', topic: 'GOSSIP' }],
    ['a language that is not a tag', { country: 'IN', lang: 'tamil language' }],
    ['a key it does not know', { country: 'IN', orgId: 'someone-else' }],
  ])('refuses %s', (_name, query) => {
    expect(feedQuerySchema.safeParse({ kind: 'news', ...query }).success).toBe(false);
  });

  it('accepts the shapes real language tags have', () => {
    for (const lang of ['ta', 'en-IN', 'es-419', 'zh-Hant', 'fil']) {
      expect(feedQuerySchema.safeParse({ kind: 'news', country: 'IN', lang }).success).toBe(true);
    }
  });

  it('cleans a place name, since it ends up in a heading and in what goes to the AI', () => {
    const query = feedQuerySchema.parse({
      kind: 'news',
      country: 'IN',
      city: '  <b>Chennai</b>  ',
    });
    expect(query.city).toBe('Chennai');
  });

  it('refuses a place name with nothing left after cleaning', () => {
    expect(feedQuerySchema.safeParse({ kind: 'news', country: 'IN', city: '   ' }).success).toBe(
      false,
    );
  });
});
