import { editionFor, languagesWithEdition, NEWS_EDITIONS, newsLanguagesFor } from './editions';
import { countryOf, isCountryCode, isRegionCode, trendsGeo } from './iso3166';
import { resolveLanguages } from './languages';
import { COUNTRY_LANGUAGES } from './languages.generated';
import { buildLocality, localityFromTimeZone, WORLDWIDE } from './locality';
import { REGION_LANGUAGES } from './region-languages';
import { countryFromTimeZone, countryName, defaultTimeZone, isKnownCountry } from './timezone';

describe('resolveLanguages', () => {
  it('gives Chennai Tamil first and Paris French first, as the module promises', () => {
    expect(resolveLanguages({ countryCode: 'IN', regionCode: 'IN-TN' })).toEqual(['ta', 'en']);
    expect(resolveLanguages({ countryCode: 'FR', regionCode: 'FR-IDF' })).toEqual(['fr', 'en']);
  });

  it('lets the region decide where the country alone would be wrong', () => {
    expect(resolveLanguages({ countryCode: 'CA', regionCode: 'CA-QC' })).toEqual(['fr', 'en']);
    expect(resolveLanguages({ countryCode: 'CH', regionCode: 'CH-TI' })).toEqual(['it', 'en']);
  });

  it('falls back to the override for the whole country when the region has none', () => {
    expect(resolveLanguages({ countryCode: 'SG', regionCode: 'SG-01' })).toEqual([
      'en',
      'zh',
      'ms',
      'ta',
    ]);
  });

  it('uses CLDR order for a country with no override', () => {
    expect(resolveLanguages({ countryCode: 'US', regionCode: 'US-CA' })).toEqual(
      COUNTRY_LANGUAGES.US,
    );
    expect(COUNTRY_LANGUAGES.US[0]).toBe('en');
  });

  it('appends English last when the place does not have it', () => {
    expect(resolveLanguages({ countryCode: 'JP', regionCode: null })).toEqual(['ja', 'en']);
  });

  it('never repeats English when the place lists a regional form of it', () => {
    const languages = resolveLanguages({ countryCode: 'IN', regionCode: 'IN-TG' });
    expect(languages.filter((language) => language === 'en')).toHaveLength(1);
  });

  it('answers just English for an unknown country and for Worldwide', () => {
    expect(resolveLanguages({ countryCode: 'ZZ', regionCode: null })).toEqual(['en']);
    expect(resolveLanguages({ countryCode: null, regionCode: null })).toEqual(['en']);
  });

  it('has no empty or repeating rows in the override table', () => {
    for (const [key, languages] of Object.entries(REGION_LANGUAGES)) {
      expect(languages.length).toBeGreaterThan(0);
      expect(new Set(languages).size).toBe(languages.length);
      expect(isCountryCode(key) || isRegionCode(key)).toBe(true);
    }
  });
});

describe('the generated CLDR table', () => {
  it('orders a country by share of its population', () => {
    expect(COUNTRY_LANGUAGES.IN[0]).toBe('hi');
    expect(COUNTRY_LANGUAGES.IN).toEqual(expect.arrayContaining(['ta', 'te', 'ml', 'en']));
    expect(COUNTRY_LANGUAGES.JP).toEqual(['ja']);
  });

  it('keeps a script variant only when the plain language is absent', () => {
    expect(COUNTRY_LANGUAGES.TW[0]).toBe('zh-Hant');
    for (const languages of Object.values(COUNTRY_LANGUAGES)) {
      for (const language of languages) {
        const base = language.split('-')[0];
        if (language !== base) expect(languages).not.toContain(base);
      }
    }
  });
});

describe('editionFor', () => {
  it('returns the three locale parameters in agreement', () => {
    expect(editionFor('IN', 'ta')).toEqual({ hl: 'ta', gl: 'IN', ceid: 'IN:ta', language: 'ta' });
    expect(editionFor('IN', 'en')).toEqual({
      hl: 'en-IN',
      gl: 'IN',
      ceid: 'IN:en',
      language: 'en',
    });
  });

  it('finds an edition by the primary subtag', () => {
    expect(editionFor('MX', 'es').ceid).toBe('MX:es-419');
    expect(editionFor('BR', 'pt').ceid).toBe('BR:pt-419');
    expect(editionFor('US', 'es-419').ceid).toBe('US:es-419');
  });

  it("reads the country's own first edition before leaving the country", () => {
    expect(editionFor('IN', 'kok').ceid).toBe('IN:en');
  });

  it('falls back to US English with no edition, and for Worldwide', () => {
    expect(editionFor('ZZ', 'en').ceid).toBe('US:en');
    expect(editionFor(null, 'ta').ceid).toBe('US:en');
  });

  it('lists what Google News really has for a country', () => {
    expect(languagesWithEdition('IN')).toHaveLength(10);
    expect(languagesWithEdition('IN')).toContain('ta');
    expect(languagesWithEdition('ZZ')).toEqual([]);
  });

  it('offers the place languages that have an edition, as the edition writes them', () => {
    expect(newsLanguagesFor('IN', ['ta', 'en'])).toEqual(['ta', 'en']);
    expect(newsLanguagesFor('IN', ['kok', 'en', 'mr'])).toEqual(['en', 'mr']);
    expect(newsLanguagesFor('US', ['en', 'es', 'haw'])).toEqual(['en', 'es-419']);
    expect(newsLanguagesFor('JP', ['ja', 'en'])).toEqual(['ja']);
  });

  it("offers the country's first edition when none of its languages has one", () => {
    expect(newsLanguagesFor('MA', ['ary'])).toEqual(['fr']);
  });

  it('offers English where the feed is the US English one', () => {
    expect(newsLanguagesFor(null, ['en'])).toEqual(['en']);
    expect(newsLanguagesFor('ZZ', ['xx'])).toEqual(['en']);
  });

  it('has no duplicate editions, and every country is real', () => {
    const editions = NEWS_EDITIONS.map((row) => row.ceid);
    expect(new Set(editions).size).toBe(editions.length);
    for (const row of NEWS_EDITIONS) {
      expect(isKnownCountry(row.country)).toBe(true);
      expect(row.ceid).toBe(`${row.country}:${row.language}`);
    }
  });
});

describe('iso3166', () => {
  it('reads the real shapes of region codes', () => {
    for (const code of ['IN-TN', 'US-CA', 'AT-1', 'CN-34', 'ZA-KZN', 'BE-BRU']) {
      expect(isRegionCode(code)).toBe(true);
    }
    for (const code of ['IN', 'in-tn', 'IN-', 'IN-TOOLONG', 'IN TN', '../etc']) {
      expect(isRegionCode(code)).toBe(false);
    }
  });

  it('reads country codes', () => {
    expect(isCountryCode('IN')).toBe(true);
    expect(isCountryCode('in')).toBe(false);
    expect(isCountryCode('IND')).toBe(false);
  });

  it('finds the country of a region', () => {
    expect(countryOf('IN-TN')).toBe('IN');
  });

  it('asks Trends for the region first, then the country, and nothing for Worldwide', () => {
    expect(trendsGeo({ countryCode: 'IN', regionCode: 'IN-TN' })).toBe('IN-TN');
    expect(trendsGeo({ countryCode: 'IN', regionCode: null })).toBe('IN');
    expect(trendsGeo({ countryCode: null, regionCode: null })).toBeNull();
  });
});

describe('timezone', () => {
  it('finds a country from a zone, including an old spelling', () => {
    expect(countryFromTimeZone('Asia/Kolkata')).toBe('IN');
    expect(countryFromTimeZone('Asia/Calcutta')).toBe('IN');
    expect(countryFromTimeZone('Europe/Paris')).toBe('FR');
  });

  it('answers null for a zone with no country', () => {
    expect(countryFromTimeZone('Etc/UTC')).toBeNull();
    expect(countryFromTimeZone('Not/AZone')).toBeNull();
  });

  it('gives the main zone, not the alphabetically first one', () => {
    expect(defaultTimeZone('US')).toBe('America/New_York');
    expect(defaultTimeZone('PT')).toBe('Europe/Lisbon');
    expect(defaultTimeZone('IN')).toBe('Asia/Kolkata');
    expect(defaultTimeZone('ZZ')).toBeNull();
  });

  it('names and recognises countries', () => {
    expect(countryName('IN')).toBe('India');
    expect(countryName('US')).toBe('United States');
    expect(countryName('ZZ')).toBeNull();
    expect(isKnownCountry('IN')).toBe(true);
    expect(isKnownCountry('ZZ')).toBe(false);
  });
});

describe('building a locality', () => {
  it('fills what the caller left out', () => {
    expect(buildLocality({ countryCode: 'IN', regionCode: 'IN-TN', city: 'Chennai' })).toEqual({
      countryCode: 'IN',
      countryName: 'India',
      regionCode: 'IN-TN',
      regionName: 'Tamil Nadu',
      city: 'Chennai',
      timeZone: 'Asia/Kolkata',
      languages: ['ta', 'en'],
    });
  });

  it("keeps the caller's names over the tables", () => {
    const locality = buildLocality({
      countryCode: 'IN',
      countryName: 'Bharat',
      regionCode: 'IN-TN',
      regionName: 'TN',
      timeZone: 'Asia/Calcutta',
    });
    expect(locality.countryName).toBe('Bharat');
    expect(locality.regionName).toBe('TN');
    expect(locality.timeZone).toBe('Asia/Calcutta');
  });

  it('reads a country-level place from the browser zone, keeping that zone', () => {
    const locality = localityFromTimeZone('America/Los_Angeles');
    expect(locality.countryCode).toBe('US');
    expect(locality.regionCode).toBeNull();
    expect(locality.timeZone).toBe('America/Los_Angeles');
  });

  it('is Worldwide for a zone with no country', () => {
    expect(localityFromTimeZone('Etc/UTC')).toEqual(WORLDWIDE);
  });

  it('cannot be changed through the shared Worldwide value', () => {
    expect(Object.isFrozen(WORLDWIDE)).toBe(true);
  });
});
