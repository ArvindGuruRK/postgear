import type { SourceItem } from '../../types';
import {
  type HolidaysLibrary,
  holidayRegion,
  type LibraryQuery,
  libraryFestivals,
} from './date-holidays';

const CURLY_APOSTROPHE = String.fromCodePoint(0x2019);

/** What the source asks for on 2026-11-10: 45 days back, 400 ahead. */
const SPAN = { from: '2026-09-26', to: '2027-12-15' };

const shown = (items: SourceItem[]) =>
  items.map((item) => `${item.date} ${item.title} (${item.observance ? 'observance' : 'holiday'})`);

const ask = (countryCode: string, regionCode?: string | null, span = SPAN) =>
  libraryFestivals({ countryCode, regionCode, ...span });

interface FakeHoliday {
  date?: unknown;
  name?: unknown;
  type?: unknown;
}

/**
 * A stand-in for the library, for what the real one cannot be made to do on
 * demand: placeholder names, a year that throws, a list of states.
 */
function fakeLibrary(
  years: Record<number, FakeHoliday[] | Error>,
  known: { countries?: Record<string, string>; states?: Record<string, string> } = {},
) {
  const built: unknown[][] = [];
  const asked: number[] = [];

  class Fake {
    constructor(...args: unknown[]) {
      built.push(args);
    }

    getCountries() {
      return known.countries ?? { XX: 'Testland' };
    }

    getStates() {
      return known.states;
    }

    getHolidays(year: number) {
      asked.push(year);
      const answer = years[year] ?? [];
      if (answer instanceof Error) throw answer;
      return answer;
    }
  }

  const load = jest.fn(() => Fake as unknown as HolidaysLibrary);
  const run = (query: Partial<LibraryQuery> = {}) =>
    libraryFestivals({ countryCode: 'XX', ...SPAN, ...query }, load);

  return { load, run, built, asked };
}

const holiday = (date: string, name: unknown, type: unknown = 'public'): FakeHoliday => ({
  date: `${date} 00:00:00`,
  name,
  type,
});

describe('the real library', () => {
  it('answers France in English, as rows the merge can read', () => {
    const rows = ask('FR');

    expect(rows).toContainEqual({
      kind: 'festival',
      source: { id: 'holidays', name: 'date-holidays' },
      title: 'Armistice Day',
      date: '2026-11-11',
      observance: false,
    });
    expect(shown(rows)).toEqual(
      expect.arrayContaining([
        `2026-11-01 All Saints${CURLY_APOSTROPHE} Day (holiday)`,
        '2026-12-25 Christmas Day (holiday)',
        `2027-01-01 New Year${CURLY_APOSTROPHE}s Day (holiday)`,
        '2027-05-16 Pentecost (observance)',
        '2027-07-14 Bastille Day (holiday)',
      ]),
    );
    expect(rows.map((item) => item.title)).not.toContain('Toussaint');
    expect(rows.map((item) => item.title)).not.toContain('Armistice 1918');
  });

  it('answers only the days inside the span, from every year it touches', () => {
    const rows = ask('FR');

    for (const item of rows) {
      expect(item.date && item.date >= SPAN.from && item.date <= SPAN.to).toBe(true);
    }
    const years = new Set(rows.map((item) => item.date?.slice(0, 4)));
    expect([...years].sort()).toEqual(['2026', '2027']);
    // Bastille Day 2026 is before the span, and Christmas 2027 after it.
    expect(shown(rows)).not.toContain('2026-07-14 Bastille Day (holiday)');
    expect(shown(rows)).not.toContain('2027-12-25 Christmas Day (holiday)');
  });

  it('includes both ends of the span', () => {
    const rows = ask('FR', null, { from: '2026-11-11', to: '2026-12-25' });
    expect(shown(rows)).toEqual([
      '2026-11-11 Armistice Day (holiday)',
      '2026-12-25 Christmas Day (holiday)',
    ]);
  });

  it('gives every row the same shape, and no link', () => {
    for (const item of [...ask('FR'), ...ask('US', 'US-CA'), ...ask('IN', 'IN-TN')]) {
      expect(Object.keys(item).sort()).toEqual(['date', 'kind', 'observance', 'source', 'title']);
      expect(item.source).toEqual({ id: 'holidays', name: 'date-holidays' });
    }
  });

  it('knows the day after Thanksgiving is a day off in California, and not in the whole country', () => {
    expect(shown(ask('US', 'US-CA'))).toContain('2026-11-27 Day after Thanksgiving Day (holiday)');
    expect(shown(ask('US'))).toContain('2026-11-27 Day after Thanksgiving Day (observance)');
  });

  it('reads the country when the library does not list the region', () => {
    expect(ask('FR', 'FR-IDF')).toEqual(ask('FR'));
    expect(ask('FR', 'FR-IDF').length).toBeGreaterThan(10);
  });

  it('ignores a region that belongs to another country, or is not a region code', () => {
    expect(ask('US', 'IN-TN')).toEqual(ask('US'));
    expect(ask('US', 'California')).toEqual(ask('US'));
    expect(ask('US', 'us-ca')).toEqual(ask('US'));
    expect(ask('US', '')).toEqual(ask('US'));
    expect(ask('US', null)).toEqual(ask('US'));
  });

  it("gives Tamil Nadu no nameless row, and the state's own day", () => {
    const tamilNadu = ask('IN', 'IN-TN', { from: '2026-01-01', to: '2028-12-31' });

    expect(tamilNadu.length).toBeGreaterThan(15);
    for (const item of tamilNadu) {
      expect(item.title).toMatch(/\p{L}{3,}/u);
      expect(item.title).toBe(item.title.trim());
    }
    expect(shown(tamilNadu)).toContain('2027-05-01 Labour Day (holiday)');
    expect(shown(ask('IN', null, { from: '2026-01-01', to: '2028-12-31' }))).not.toContain(
      '2027-05-01 Labour Day (holiday)',
    );
  });

  it('has only six national days for India, which is why the calendar comes first', () => {
    const india = ask('IN', null, { from: '2027-01-01', to: '2027-12-31' });
    expect(india.map((item) => item.title)).toEqual([
      'Republic Day',
      'Good Friday',
      'Ambedkar Jayanti',
      'Independence Day',
      'Gandhi Jayanti',
      'Christmas Day',
    ]);
  });

  it('calls a bank holiday a day off and an optional one an observance', () => {
    // Bavaria closes its banks on Christmas Eve; the United States lists it as optional.
    expect(shown(ask('DE', 'DE-BY'))).toContain('2026-12-24 Christmas Eve (holiday)');
    expect(shown(ask('US'))).toContain('2026-12-24 Christmas Eve (observance)');
  });

  it('leaves out a school holiday', () => {
    // The Day of Prayer and Repentance is a day off in Saxony and a school day off in Bavaria.
    const name = 'Day of Prayer and Repentance';
    expect(shown(ask('DE', 'DE-SN'))).toContain(`2026-11-18 ${name} (holiday)`);
    expect(ask('DE', 'DE-BY').map((item) => item.title)).not.toContain(name);
  });

  it('reads the day of a holiday that starts in the evening', () => {
    expect(shown(ask('US'))).toContain('2026-10-31 Halloween (observance)');
  });

  it.each(['ZZ', 'XX', 'QQ'])('gives nothing for %s, a country it does not know', (country) => {
    expect(ask(country)).toEqual([]);
  });

  it('gives nothing, and does not throw, for a country its rules fail on', () => {
    // Singapore's rules use the Chinese calendar, which throws inside the library
    // under `require` (3.39.1). If a later version mends that, rows are fine too.
    expect(() => ask('SG')).not.toThrow();
    expect(Array.isArray(ask('SG'))).toBe(true);
  });
});

describe('what it is asked', () => {
  it('asks in English', () => {
    const fake = fakeLibrary({});
    fake.run();

    expect(fake.built).toEqual([[], ['XX', { languages: ['en'] }]]);
  });

  it('passes the state only when the library lists it for that country', () => {
    const listed = fakeLibrary({}, { states: { TN: 'Tamil Nadu' } });
    listed.run({ regionCode: 'XX-TN' });
    expect(listed.built.at(-1)).toEqual(['XX', 'TN', { languages: ['en'] }]);

    const unlisted = fakeLibrary({}, { states: { KA: 'Karnataka' } });
    unlisted.run({ regionCode: 'XX-TN' });
    expect(unlisted.built.at(-1)).toEqual(['XX', { languages: ['en'] }]);

    const none = fakeLibrary({});
    none.run({ regionCode: 'XX-TN' });
    expect(none.built.at(-1)).toEqual(['XX', { languages: ['en'] }]);
  });

  it('does not read a state name off the prototype of the list', () => {
    const fake = fakeLibrary({}, { states: Object.create({ TN: 'inherited' }) });
    fake.run({ regionCode: 'XX-TN' });
    expect(fake.built.at(-1)).toEqual(['XX', { languages: ['en'] }]);
  });

  it('reads region codes of one to three characters', () => {
    const fake = fakeLibrary({}, { states: { NSW: 'New South Wales', '1': 'Burgenland' } });
    fake.run({ regionCode: 'XX-NSW' });
    expect(fake.built.at(-1)).toEqual(['XX', 'NSW', { languages: ['en'] }]);
    fake.run({ regionCode: 'XX-1' });
    expect(fake.built.at(-1)).toEqual(['XX', '1', { languages: ['en'] }]);
  });

  it('asks for every calendar year the span touches', () => {
    const fake = fakeLibrary({});
    fake.run({ from: '2026-12-20', to: '2028-01-05' });
    expect(fake.asked).toEqual([2026, 2027, 2028]);

    const oneYear = fakeLibrary({});
    oneYear.run({ from: '2027-02-01', to: '2027-03-01' });
    expect(oneYear.asked).toEqual([2027]);
  });

  it('does not spin on a span that makes no sense', () => {
    const endless = fakeLibrary({});
    endless.run({ from: '2026-01-01', to: '9999-12-31' });
    expect(endless.asked).toEqual([2026, 2027, 2028, 2029, 2030]);

    const backwards = fakeLibrary({});
    expect(backwards.run({ from: '2027-01-01', to: '2026-01-01' })).toEqual([]);
    expect(backwards.asked).toEqual([]);

    for (const span of [
      { from: 'soon', to: 'later' },
      { from: '', to: '2027-01-01' },
      { from: '2026-01-01', to: '' },
      { from: '2026-02-31', to: '2027-01-01' },
    ]) {
      const nonsense = fakeLibrary({});
      expect(nonsense.run(span)).toEqual([]);
      expect(nonsense.load).not.toHaveBeenCalled();
    }
  });

  it.each(['india', 'in', 'I', '', 'IN-TN', '__proto__'])(
    'does not load the library for %j, which is not a country code',
    (countryCode) => {
      const fake = fakeLibrary({ 2026: [holiday('2026-11-08', 'Diwali')] });
      expect(fake.run({ countryCode })).toEqual([]);
      expect(fake.load).not.toHaveBeenCalled();
    },
  );

  it('gives nothing for a country the library does not list', () => {
    const fake = fakeLibrary(
      { 2026: [holiday('2026-11-08', 'Diwali')] },
      { countries: { YY: 'Elsewhere' } },
    );
    expect(fake.run()).toEqual([]);
    expect(fake.asked).toEqual([]);
  });
});

describe('what it makes of the answer', () => {
  it('ignores a name that is empty or has no letters', () => {
    const fake = fakeLibrary({
      2027: [
        holiday('2027-01-14', ''),
        holiday('2027-01-14', '   '),
        holiday('2027-01-14', '01-14'),
        holiday('2027-01-14', '2027'),
        holiday('2027-01-14', '***'),
        holiday('2027-01-14', undefined),
        holiday('2027-01-14', null),
        holiday('2027-01-14', { en: 'Pongal' }),
        holiday('2027-01-14', 42),
        holiday('2027-01-15', 'Pongal'),
      ],
    });

    expect(shown(fake.run())).toEqual(['2027-01-15 Pongal (holiday)']);
  });

  it('maps the five types, and ignores one it does not know', () => {
    const fake = fakeLibrary({
      2027: [
        holiday('2027-03-01', 'Public', 'public'),
        holiday('2027-03-02', 'Bank', 'bank'),
        holiday('2027-03-03', 'Observance', 'observance'),
        holiday('2027-03-04', 'Optional', 'optional'),
        holiday('2027-03-05', 'School', 'school'),
        holiday('2027-03-06', 'Unknown', 'something new'),
        holiday('2027-03-07', 'Inherited', 'constructor'),
        { date: '2027-03-08 00:00:00', name: 'Untyped' },
        { date: '2027-03-09 00:00:00', name: 'Null Type', type: null },
      ],
    });

    expect(shown(fake.run())).toEqual([
      '2027-03-01 Public (holiday)',
      '2027-03-02 Bank (holiday)',
      '2027-03-03 Observance (observance)',
      '2027-03-04 Optional (observance)',
    ]);
  });

  it('reads the day from the first ten characters, whatever follows', () => {
    const fake = fakeLibrary({
      2027: [
        { date: '2027-03-10 00:00:00 -0600', name: 'End of Ramadan (Eid al-Fitr)', type: 'public' },
        { date: '2027-10-31 18:00:00', name: 'Halloween', type: 'observance' },
        { date: '2027-12-25', name: 'Christmas Day', type: 'public' },
      ],
    });

    expect(shown(fake.run({ from: '2027-01-01', to: '2027-12-31' }))).toEqual([
      '2027-03-10 End of Ramadan (Eid al-Fitr) (holiday)',
      '2027-10-31 Halloween (observance)',
      '2027-12-25 Christmas Day (holiday)',
    ]);
  });

  it('leaves out a date it cannot read', () => {
    const fake = fakeLibrary({
      2027: [
        { date: 'soon', name: 'Someday', type: 'public' },
        { date: undefined, name: 'Undated', type: 'public' },
        { date: '2027-02-31 00:00:00', name: 'Impossible', type: 'public' },
        { date: 20270115, name: 'A Number', type: 'public' },
        holiday('2027-01-15', 'Pongal'),
      ],
    });

    expect(shown(fake.run())).toEqual(['2027-01-15 Pongal (holiday)']);
  });

  it('keeps one year when another throws', () => {
    const fake = fakeLibrary({
      2026: new Error('Cannot convert undefined or null to object'),
      2027: [holiday('2027-01-15', 'Pongal')],
    });

    expect(shown(fake.run())).toEqual(['2027-01-15 Pongal (holiday)']);
    expect(fake.asked).toEqual([2026, 2027]);
  });

  it('gives nothing when every year throws', () => {
    const fake = fakeLibrary({ 2026: new Error('no'), 2027: new Error('no') });
    expect(fake.run()).toEqual([]);
  });

  it('gives nothing when the library will not load', () => {
    const load = jest.fn(() => {
      throw new Error("Cannot find module 'date-holidays'");
    });
    expect(libraryFestivals({ countryCode: 'FR', ...SPAN }, load)).toEqual([]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('gives nothing when the library cannot be built or answers something odd', () => {
    class Throws {
      constructor() {
        throw new Error('broken build');
      }
    }
    class Odd {
      getCountries() {
        return undefined;
      }
    }
    class NoList {
      getCountries() {
        return { XX: 'Testland' };
      }
      getStates() {
        return undefined;
      }
      getHolidays() {
        return undefined;
      }
    }

    for (const Library of [Throws, Odd, NoList]) {
      const load = () => Library as unknown as HolidaysLibrary;
      expect(libraryFestivals({ countryCode: 'XX', ...SPAN }, load)).toEqual([]);
    }
  });

  it('makes a name plain text', () => {
    const fake = fakeLibrary({
      2027: [holiday('2027-01-15', '<b>Pongal</b> &amp; <i>Harvest</i>')],
    });
    expect(fake.run().map((item) => item.title)).toEqual(['Pongal & Harvest']);
  });

  it('keeps a substitute day, which is a real day off', () => {
    const fake = fakeLibrary({
      2027: [
        holiday('2027-07-04', 'Independence Day'),
        holiday('2027-07-05', 'Independence Day (substitute day)'),
      ],
    });
    expect(shown(fake.run())).toEqual([
      '2027-07-04 Independence Day (holiday)',
      '2027-07-05 Independence Day (substitute day) (holiday)',
    ]);
  });
});

describe('a build that wraps the class in `default`', () => {
  afterEach(() => {
    jest.dontMock('date-holidays');
    jest.resetModules();
  });

  it('is read the same way', async () => {
    class Wrapped {
      getCountries() {
        return { XX: 'Testland' };
      }
      getStates() {
        return undefined;
      }
      getHolidays(year: number) {
        return year === 2027 ? [holiday('2027-01-15', 'Pongal')] : [];
      }
    }

    await jest.isolateModulesAsync(async () => {
      jest.doMock('date-holidays', () => ({ __esModule: true, default: Wrapped }));
      const isolated = await import('./date-holidays');

      expect(shown(isolated.libraryFestivals({ countryCode: 'XX', ...SPAN }))).toEqual([
        '2027-01-15 Pongal (holiday)',
      ]);
    });
  });
});

describe('holidayRegion', () => {
  it('keeps a region the library has rules for', () => {
    expect(holidayRegion('US', 'US-CA')).toBe('US-CA');
    expect(holidayRegion('IN', 'IN-TN')).toBe('IN-TN');
  });

  it('gives null for a region it does not know, so it reads as the country', () => {
    expect(holidayRegion('IN', 'IN-ZZ1')).toBeNull();
    expect(holidayRegion('FR', 'FR-IDF')).toBeNull();
    expect(holidayRegion('US', 'IN-TN')).toBeNull();
    expect(holidayRegion('US', null)).toBeNull();
    expect(holidayRegion('US', undefined)).toBeNull();
  });

  it('never throws, whatever it is handed or however the library fails', () => {
    expect(holidayRegion('not a country', 'US-CA')).toBeNull();
    expect(holidayRegion('US', 'nonsense')).toBeNull();
    expect(
      holidayRegion('US', 'US-CA', () => {
        throw new Error('the library would not load');
      }),
    ).toBeNull();
  });
});
