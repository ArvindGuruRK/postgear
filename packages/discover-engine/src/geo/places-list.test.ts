import { buildLocalityFromPicker, listCountries, listRegions } from './places-list';

describe('listCountries', () => {
  it('names every pickable country in the asked language, sorted, and only real places', () => {
    const english = listCountries();
    const codes = english.map((country) => country.code);

    expect(english.find((country) => country.code === 'IN')?.name).toBe('India');
    expect(english.find((country) => country.code === 'US')?.name).toBe('United States');
    // CLDR's codes for things that are not countries, and the uninhabited ones.
    for (const code of ['AC', 'DG', 'EA', 'IC', 'TA', 'XK', 'AQ', 'HM']) {
      expect([code, codes.includes(code)]).toEqual([code, false]);
    }
    expect(english.length).toBeGreaterThan(230);

    const names = english.map((country) => country.name);
    expect(names).toEqual([...names].sort(new Intl.Collator('en').compare));
    expect(listCountries('fr').find((country) => country.code === 'DE')?.name).toBe('Allemagne');
  });

  it('reads a language tag it cannot use as English, and never throws', () => {
    expect(listCountries('not a language!')).toEqual(listCountries('en'));
    expect(listCountries('')).toEqual(listCountries('en'));
  });
});

describe('listRegions', () => {
  it('gives the codes Trends takes for India and the United States, and ISO ones for France', () => {
    const india = listRegions('IN').map((region) => region.code);
    expect(india).toHaveLength(37);
    expect(india).toEqual(expect.arrayContaining(['IN-TN', 'IN-OR', 'IN-TG', 'IN-JH']));
    expect(listRegions('US')).toContainEqual({ code: 'US-CA', name: 'California' });
    expect(listRegions('us')).toHaveLength(51);
    expect(listRegions('FR')).toContainEqual({ code: 'FR-IDF', name: 'Île-de-France' });
  });

  it('is empty for a country with no whole list, and for nonsense', () => {
    expect(listRegions('IT')).toEqual([]);
    expect(listRegions('ZZ')).toEqual([]);
    expect(listRegions('../IN')).toEqual([]);
  });
});

describe('buildLocalityFromPicker', () => {
  it('builds the place a choice stands for, named, and refuses one the lists do not have', () => {
    expect(buildLocalityFromPicker('IN', 'IN-TN')).toEqual({
      countryCode: 'IN',
      countryName: 'India',
      regionCode: 'IN-TN',
      regionName: 'Tamil Nadu',
      city: null,
      timeZone: 'Asia/Kolkata',
      languages: ['ta', 'en'],
    });
    expect(buildLocalityFromPicker('de', 'de-by')?.regionName).toBe('Bayern');
    expect(buildLocalityFromPicker('FR', null)?.regionCode).toBeNull();

    expect(buildLocalityFromPicker('US', 'IN-TN')).toBeNull();
    expect(buildLocalityFromPicker('XK', null)).toBeNull();
    expect(buildLocalityFromPicker('IN', 'IN-ZZ')).toBeNull();
  });
});
