/**
 * What `PATCH /discover/settings` accepts. The rules that matter most: a place
 * goes in whole, with its country and how it was found; a region belongs to its
 * country; the switches are the five there are and nothing else; and an empty
 * body saves nothing, so it is refused.
 */
import { NEWS_TOPICS } from '@postgear/discover-engine';
import { MAX_LANGUAGES, updateSettingsSchema } from './dto/settings.schema';

const CHENNAI = {
  countryCode: 'IN',
  regionCode: 'IN-TN',
  regionName: 'Tamil Nadu',
  city: 'Chennai',
  timeZone: 'Asia/Kolkata',
  locationSource: 'SEARCH',
};

function accepts(body: unknown): boolean {
  return updateSettingsSchema.safeParse(body).success;
}

describe('updateSettingsSchema', () => {
  it('accepts everything at once, and hands it back as it came', () => {
    const body = {
      ...CHENNAI,
      languages: ['ta', 'en'],
      topics: ['BUSINESS', 'SPORTS'],
      sources: { trends: true, wikipedia: true, social: false, videos: true, festivals: true },
    };

    expect(updateSettingsSchema.parse(body)).toEqual(body);
  });

  it.each([
    ['the languages', { languages: ['ta', 'en'] }],
    ['the topics', { topics: ['BUSINESS'] }],
    ['the switches', { sources: { social: false } }],
    ['a place', CHENNAI],
  ])('accepts %s on their own, and adds no key that was not sent', (_name, body) => {
    expect(Object.keys(updateSettingsSchema.parse(body)).sort()).toEqual(Object.keys(body).sort());
  });

  it('refuses an empty body, since it saves nothing', () => {
    expect(accepts({})).toBe(false);
  });

  it.each([
    ['nothing at all', undefined],
    ['null', null],
    ['a list', [CHENNAI]],
    ['text', 'Chennai'],
  ])('refuses %s', (_name, body) => {
    expect(accepts(body)).toBe(false);
  });

  it.each([
    ['the workspace', { organizationId: 'someone-else' }],
    ['who saved', { updatedById: 'someone-else' }],
    ['when it was saved', { updatedAt: '2026-01-01T00:00:00.000Z' }],
    ['the built place', { place: { countryCode: 'FR' } }],
    ['a country name', { countryName: 'India' }],
  ])('refuses a body that names %s, which is not its to say', (_name, extra) => {
    expect(accepts({ ...CHENNAI, ...extra })).toBe(false);
  });

  describe('a place', () => {
    it.each(['SEARCH', 'BROWSER', 'TIMEZONE'])('is accepted however it was found: %s', (source) => {
      expect(accepts({ ...CHENNAI, locationSource: source })).toBe(true);
    });

    it('is accepted as a country alone', () => {
      expect(accepts({ countryCode: 'IN', locationSource: 'TIMEZONE' })).toBe(true);
    });

    it('is accepted with the fields it does not have spelled out as null', () => {
      const body = {
        countryCode: 'FR',
        regionCode: null,
        regionName: null,
        city: 'Paris',
        timeZone: null,
        locationSource: 'SEARCH',
      };

      expect(updateSettingsSchema.parse(body)).toEqual(body);
    });

    it.each([
      ['a city alone', { city: 'Chennai' }],
      ['a zone alone', { timeZone: 'Asia/Kolkata' }],
      ['a region alone', { regionCode: 'IN-TN' }],
      ['a null region alone', { regionCode: null }],
      ['a country that does not say how it was found', { countryCode: 'IN' }],
      [
        'a whole place that does not say how it was found',
        { ...CHENNAI, locationSource: undefined },
      ],
      [
        'a city with how it was found and no country',
        { city: 'Chennai', locationSource: 'SEARCH' },
      ],
      [
        'a zone with how it was found and no country',
        { timeZone: 'UTC', locationSource: 'SEARCH' },
      ],
      ['how it was found and nothing found', { locationSource: 'SEARCH' }],
      ['a browser position and nothing found', { locationSource: 'BROWSER' }],
    ])('refuses %s: a place is saved whole', (_name, body) => {
      expect(accepts(body)).toBe(false);
    });

    it.each([
      ['a lower-case country', { countryCode: 'in' }],
      ['a country that does not exist', { countryCode: 'ZZ' }],
      ['a three letter country', { countryCode: 'IND' }],
      ['a country that is not text', { countryCode: 91 }],
      ['a region in another country', { regionCode: 'FR-IDF' }],
      ['a region that is not shaped like one', { regionCode: 'IN/../TN' }],
      ['a region that is only its country', { regionCode: 'IN' }],
      ['a zone that is not shaped like one', { timeZone: 'Asia/Kolkata; DROP' }],
      ['a zone that is too long', { timeZone: 'A'.repeat(65) }],
      ['a city with nothing left after cleaning', { city: '   ' }],
      ['a city that is far too long', { city: 'x'.repeat(81) }],
      ['a city that is not text', { city: ['Chennai'] }],
      ['a region name with nothing left after cleaning', { regionName: '<b></b>' }],
      ['a way of finding it nobody knows', { locationSource: 'GPS' }],
      ['a lower-case way of finding it', { locationSource: 'search' }],
    ])('refuses %s', (_name, change) => {
      expect(accepts({ ...CHENNAI, ...change })).toBe(false);
    });

    it('cleans a name, since it ends up in a heading and in what goes to the AI', () => {
      const saved = updateSettingsSchema.parse({
        ...CHENNAI,
        regionName: '  Tamil   Nadu ',
        city: '  <b>Chennai</b>  ',
      });

      expect(saved.regionName).toBe('Tamil Nadu');
      expect(saved.city).toBe('Chennai');
    });

    it('keeps a city written in its own script', () => {
      expect(updateSettingsSchema.parse({ ...CHENNAI, city: 'சென்னை' }).city).toBe('சென்னை');
    });
  });

  describe('Worldwide', () => {
    it.each(['SEARCH', 'BROWSER', 'TIMEZONE'])(
      'is a null country that was saved on purpose: %s',
      (source) => {
        expect(accepts({ countryCode: null, locationSource: source })).toBe(true);
      },
    );

    it('is accepted with every field spelled out as null, and with a zone', () => {
      const spelledOut = {
        countryCode: null,
        regionCode: null,
        regionName: null,
        city: null,
        timeZone: null,
        locationSource: 'SEARCH',
      };

      expect(accepts(spelledOut)).toBe(true);
      expect(accepts({ ...spelledOut, timeZone: 'Asia/Kolkata' })).toBe(true);
    });

    it.each([
      ['a region', { regionCode: 'IN-TN' }],
      ['a region name', { regionName: 'Tamil Nadu' }],
      ['a city', { city: 'Chennai' }],
    ])('refuses %s with no country to be in', (_name, field) => {
      expect(accepts({ countryCode: null, locationSource: 'SEARCH', ...field })).toBe(false);
    });
  });

  describe('clearing the place', () => {
    const NOTHING = {
      countryCode: null,
      regionCode: null,
      regionName: null,
      city: null,
      timeZone: null,
      locationSource: 'NONE',
    };

    it('is accepted with every field null, or with none of them sent', () => {
      expect(accepts(NOTHING)).toBe(true);
      expect(accepts({ countryCode: null, locationSource: 'NONE' })).toBe(true);
      expect(accepts({ locationSource: 'NONE' })).toBe(true);
    });

    it.each([
      ['a country', { countryCode: 'IN' }],
      ['a region', { regionCode: 'IN-TN' }],
      ['a region name', { regionName: 'Tamil Nadu' }],
      ['a city', { city: 'Chennai' }],
      ['a zone', { timeZone: 'Asia/Kolkata' }],
      ['a whole place', CHENNAI],
    ])('refuses %s that is said to be no place', (_name, field) => {
      expect(accepts({ ...NOTHING, ...field, locationSource: 'NONE' })).toBe(false);
    });
  });

  describe('languages', () => {
    it('accepts the shapes real language tags have, in the order sent', () => {
      const languages = ['ta', 'en-IN', 'es-419', 'zh-Hant', 'fil'];

      expect(updateSettingsSchema.parse({ languages }).languages).toEqual(languages);
    });

    it('accepts none, which goes back to the place deciding', () => {
      expect(accepts({ languages: [] })).toBe(true);
    });

    it(`accepts ${MAX_LANGUAGES} and refuses one more`, () => {
      const seven = ['ta', 'en', 'hi', 'te', 'ml', 'kn', 'mr'];

      expect(seven).toHaveLength(MAX_LANGUAGES + 1);
      expect(accepts({ languages: seven.slice(0, MAX_LANGUAGES) })).toBe(true);
      expect(accepts({ languages: seven })).toBe(false);
    });

    it.each([
      ['a repeat', ['ta', 'en', 'ta']],
      ['a repeat in another case', ['en-IN', 'ta', 'EN-in']],
      ['something that is not a tag', ['tamil language']],
      ['an empty tag', ['ta', '']],
      ['a tag that is not text', ['ta', 7]],
      ['one language that is not in a list', 'ta'],
      ['null', null],
    ])('refuses %s', (_name, languages) => {
      expect(accepts({ languages })).toBe(false);
    });
  });

  describe('topics', () => {
    it('accepts every topic Google News has, in the order sent', () => {
      const topics = [...NEWS_TOPICS].reverse();

      expect(updateSettingsSchema.parse({ topics }).topics).toEqual(topics);
      expect(NEWS_TOPICS).toHaveLength(8);
    });

    it('accepts none', () => {
      expect(accepts({ topics: [] })).toBe(true);
    });

    it.each([
      ['a topic Google News does not have', ['GOSSIP']],
      ['a lower-case topic', ['business']],
      ['a repeat', ['SPORTS', 'WORLD', 'SPORTS']],
      ['more than there are', [...NEWS_TOPICS, 'WORLD']],
      ['a topic that is not text', [3]],
      ['one topic that is not in a list', 'SPORTS'],
      ['null', null],
    ])('refuses %s', (_name, topics) => {
      expect(accepts({ topics })).toBe(false);
    });
  });

  describe('switches', () => {
    it('accepts all five, some of them, none of them, and null for every group on', () => {
      const all = { trends: false, wikipedia: true, social: false, videos: true, festivals: false };

      expect(updateSettingsSchema.parse({ sources: all }).sources).toEqual(all);
      expect(accepts({ sources: { videos: false } })).toBe(true);
      expect(accepts({ sources: {} })).toBe(true);
      expect(updateSettingsSchema.parse({ sources: null }).sources).toBeNull();
    });

    it.each(['news', 'google-trends', 'bluesky', 'youtube', 'holidays', 'top', 'everything'])(
      'refuses a source id it does not know: %s',
      (id) => {
        expect(accepts({ sources: { [id]: false } })).toBe(false);
        expect(accepts({ sources: { videos: false, [id]: true } })).toBe(false);
      },
    );

    it('refuses a key that only looks like nothing', () => {
      expect(accepts({ sources: JSON.parse('{"__proto__":{"videos":false}}') })).toBe(false);
    });

    it.each([
      ['text', { videos: 'false' }],
      ['a number', { videos: 0 }],
      ['null', { videos: null }],
      ['a list', { videos: [false] }],
    ])('refuses a switch set to %s', (_name, sources) => {
      expect(accepts({ sources })).toBe(false);
    });

    it.each([
      ['a list of ids', ['videos']],
      ['text', 'videos'],
      ['a boolean', false],
    ])('refuses %s in place of the switches', (_name, sources) => {
      expect(accepts({ sources })).toBe(false);
    });
  });
});
