import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildLocality, WORLDWIDE } from '../../geo/locality';
import type {
  DiscoverFetch,
  DiscoverFetchResponse,
  Locality,
  SourceItem,
  SourceResult,
} from '../../types';
import { libraryFestivals } from './date-holidays';
import { addDays } from './dates';
import { HOLIDAY_CALENDAR_IDS, holidayCalendarUrl } from './google-calendar';
import {
  createHolidaysSource,
  daysUntil,
  FESTIVAL_DAYS_AHEAD,
  FESTIVAL_DAYS_BACK,
  FESTIVAL_SPAN_DAYS_AHEAD,
  FESTIVAL_SPAN_DAYS_BACK,
  festivalsInWindow,
  todayIn,
} from './index';
import { type FestivalOrigin, festivalItem } from './merge';

/**
 * The real adapter with a spy around it. Most tests let it through to the real
 * library; the ones about a reader being missing stand in for it once.
 */
jest.mock('./date-holidays', () => {
  const actual = jest.requireActual('./date-holidays');
  return { ...actual, libraryFestivals: jest.fn(actual.libraryFestivals) };
});
const libraryMock = jest.mocked(libraryFestivals);

/**
 * These tests are about the two readers. The hand-kept state lists, which give
 * Chennai days of its own, have their tests in `curated.test.ts`.
 */
jest.mock('./curated', () => {
  const actual = jest.requireActual('./curated');
  return { ...actual, curatedFestivals: jest.fn(() => []) };
});

const FIXTURES = join(__dirname, '..', '..', '..', 'fixtures');
const recording = (file: string) => readFileSync(join(FIXTURES, file), 'utf8');

const RECORDED: Record<string, string> = {
  IN: recording('chennai/holidays-IN.2026-11-10.ics'),
  US: recording('san-francisco/holidays-US.2026-11-10.ics'),
  FR: recording('paris/holidays-FR.2026-11-10.ics'),
};

/** The day the calendars were recorded. Fixed, so the tests do not rot. */
const NOW = new Date('2026-11-10T08:00:00Z');
const TODAY = '2026-11-10';

const chennai = buildLocality({ countryCode: 'IN', regionCode: 'IN-TN', city: 'Chennai' });
const india = buildLocality({ countryCode: 'IN' });
const sanFrancisco = buildLocality({
  countryCode: 'US',
  regionCode: 'US-CA',
  city: 'San Francisco',
  timeZone: 'America/Los_Angeles',
});
const unitedStates = buildLocality({ countryCode: 'US' });
const paris = buildLocality({ countryCode: 'FR', regionCode: 'FR-IDF', city: 'Paris' });
const netherlands = buildLocality({ countryCode: 'NL' });

const EMPTY_CALENDAR = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n';
const SIGN_IN_PAGE = '<!doctype html><html><body>Sign in to continue</body></html>';

type Answer = Partial<DiscoverFetchResponse> | Error;

/**
 * Answers a country's calendar address with its recording, unless the test says
 * otherwise. A country with an id and no recording answers 404, and an address
 * that is no calendar's is a test bug and fails loudly.
 */
function sourceAnswering(overrides: Record<string, Answer> = {}, now: Date = NOW) {
  const fetchMock = jest.fn<ReturnType<DiscoverFetch>, Parameters<DiscoverFetch>>(async (url) => {
    const country = Object.keys(HOLIDAY_CALENDAR_IDS).find(
      (code) => holidayCalendarUrl(HOLIDAY_CALENDAR_IDS[code]) === url,
    );
    if (!country) throw new Error(`Unexpected request for ${url}`);

    const recorded = RECORDED[country];
    const answer = overrides[country] ?? (recorded ? { body: recorded } : { status: 404 });
    if (answer instanceof Error) throw answer;
    return { status: 200, body: '', finalUrl: url, ...answer };
  });
  return { fetchMock, source: createHolidaysSource({ fetch: fetchMock, now: () => now }) };
}

async function festivalsFor(locality: Locality, now: Date = NOW): Promise<SourceResult> {
  return sourceAnswering({}, now).source.fetch({ locality, language: 'en' });
}

const on = (items: SourceItem[], date: string) => items.filter((item) => item.date === date);

const shown = (items: SourceItem[]) =>
  items.map((item) => `${item.date} ${item.title} (${item.observance ? 'observance' : 'holiday'})`);

function row(
  origin: FestivalOrigin,
  date: string,
  name: string,
  badge: 'holiday' | 'observance' = 'holiday',
): SourceItem {
  const item = festivalItem({ name, date, observance: badge === 'observance', origin });
  if (!item) throw new Error(`"${name}" on ${date} is not a festival row`);
  return item;
}

describe('the holidays source', () => {
  it('says what it is', () => {
    const { source } = sourceAnswering();
    expect(source.id).toBe('holidays');
    expect(source.name).toBe('Public holiday calendars and date-holidays');
  });

  it('answers a complete result for a place both readers know', async () => {
    const result = await festivalsFor(chennai);

    expect(result.failed).toBeUndefined();
    expect(result.partial).toBeUndefined();
    expect(result.warnings).toEqual([]);
    expect(result.attribution).toEqual({
      name: 'Public holiday calendars and date-holidays',
      url: 'https://calendar.google.com/calendar/embed?src=en.indian%23holiday%40group.v.calendar.google.com',
    });
  });

  it('asks for the country calendar once, as a calendar', async () => {
    const { fetchMock, source } = sourceAnswering();
    const controller = new AbortController();
    await source.fetch({ locality: chennai, language: 'ta', signal: controller.signal });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      'https://calendar.google.com/calendar/ical/en.indian%23holiday%40group.v.calendar.google.com/public/basic.ics',
    );
    expect(init.accept).toBe('text/calendar, text/plain;q=0.9');
    expect(init.maxBytes).toBe(1024 * 1024);
    expect(init.signal).toBe(controller.signal);
  });

  it('applies a deadline of its own when the caller has none', async () => {
    const { fetchMock, source } = sourceAnswering();
    await source.fetch({ locality: chennai, language: 'ta' });

    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it('gives every row the same shape: a date, a name, a badge, and no link', async () => {
    for (const locality of [chennai, sanFrancisco, paris, netherlands]) {
      const { items } = await festivalsFor(locality);

      expect(items.length).toBeGreaterThan(20);
      for (const item of items) {
        expect(Object.keys(item).sort()).toEqual(['date', 'kind', 'observance', 'source', 'title']);
        expect(item.kind).toBe('festival');
        expect(item.source.id).toBe('holidays');
        expect(['Google Calendar', 'date-holidays']).toContain(item.source.name);
        expect(Object.keys(item.source).sort()).toEqual(['id', 'name']);
        expect(item.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(typeof item.observance).toBe('boolean');
        expect(item.title).toMatch(/\p{L}/u);
      }
    }
  });

  it('answers by date then name, with no row twice', async () => {
    for (const locality of [chennai, sanFrancisco, paris]) {
      const { items } = await festivalsFor(locality);
      const keys = items.map((item) => `${item.date}|${item.title.toLowerCase()}`);

      expect(keys).toEqual([...keys].sort());
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});

describe('India, from the recorded calendar and the library', () => {
  it('holds Diwali/Deepavali on 2026-11-08 as a public holiday, next to the other festival that day', async () => {
    const { items } = await festivalsFor(chennai);

    expect(on(items, '2026-11-08')).toEqual([
      {
        kind: 'festival',
        source: { id: 'holidays', name: 'Google Calendar' },
        title: 'Diwali/Deepavali',
        date: '2026-11-08',
        observance: false,
      },
      {
        kind: 'festival',
        source: { id: 'holidays', name: 'Google Calendar' },
        title: 'Naraka Chaturdasi',
        date: '2026-11-08',
        observance: true,
      },
    ]);
  });

  it('keeps Pongal an observance, and both names on its date', async () => {
    const { items } = await festivalsFor(chennai);

    expect(shown(on(items, '2027-01-15'))).toEqual([
      '2027-01-15 Guru Govind Singh Jayanti (observance)',
      '2027-01-15 Pongal (observance)',
    ]);
  });

  it('keeps every name on a date the calendar gives four', async () => {
    const { items } = await festivalsFor(chennai);

    expect(shown(on(items, '2027-04-07'))).toEqual([
      '2027-04-07 Chaitra Sukhladi (observance)',
      '2027-04-07 Cheti Chand (observance)',
      '2027-04-07 Gudi Padwa (observance)',
      '2027-04-07 Ugadi (observance)',
    ]);
  });

  it('shows a day both readers know once, under the calendar name', async () => {
    const { items } = await festivalsFor(chennai);

    expect(on(items, '2026-12-25')).toEqual([row('Google Calendar', '2026-12-25', 'Christmas')]);
    expect(on(items, '2027-01-26')).toEqual([row('Google Calendar', '2027-01-26', 'Republic Day')]);
    expect(shown(on(items, '2027-08-15'))).toEqual([
      '2027-08-15 Independence Day (holiday)',
      '2027-08-15 Milad un-Nabi (tentative) (holiday)',
      '2027-08-15 Parsi New Year (observance)',
    ]);
  });

  it('adds the day off that only Tamil Nadu has, from the library', async () => {
    const labourDay = row('date-holidays', '2027-05-01', 'Labour Day');

    expect(on((await festivalsFor(chennai)).items, '2027-05-01')).toEqual([labourDay]);
    expect(on((await festivalsFor(india)).items, '2027-05-01')).toEqual([]);
  });

  it('shows Janmashtami once, as the day off, though the calendar lists it twice', async () => {
    const { items } = await festivalsFor(chennai);
    expect(shown(on(items, '2027-08-25'))).toEqual(['2027-08-25 Janmashtami (holiday)']);
  });

  it('keeps a tentative date tentative', async () => {
    const { items } = await festivalsFor(chennai);
    expect(shown(on(items, '2027-03-10'))).toContain('2027-03-10 Ramzan Id (tentative) (holiday)');
  });

  it('takes nearly everything from the calendar: the library has six national days', async () => {
    const { items } = await festivalsFor(india);
    const fromLibrary = items.filter((item) => item.source.name === 'date-holidays');

    expect(items.length).toBeGreaterThan(70);
    // The one name the two readers do not agree on, so it shows twice. See merge.ts.
    expect(shown(fromLibrary)).toEqual([
      '2026-10-02 Gandhi Jayanti (holiday)',
      '2027-10-02 Gandhi Jayanti (holiday)',
    ]);
  });
});

describe('France', () => {
  it('has ONE row on 2026-11-11, named Armistice Day, a public holiday', async () => {
    const { items } = await festivalsFor(paris);

    expect(on(items, '2026-11-11')).toEqual([
      {
        kind: 'festival',
        source: { id: 'holidays', name: 'Google Calendar' },
        title: 'Armistice Day',
        date: '2026-11-11',
        observance: false,
      },
    ]);
  });

  it('reads the country from the library when it does not know the region', async () => {
    await festivalsFor(paris);

    expect(libraryMock).toHaveBeenCalledWith({
      countryCode: 'FR',
      regionCode: 'FR-IDF',
      from: '2026-09-26',
      to: '2027-12-15',
    });
    expect(libraryMock.mock.results[0].value.length).toBeGreaterThan(10);
  });

  it('shows the days both readers know once each', async () => {
    const { items } = await festivalsFor(paris);

    for (const date of ['2026-11-01', '2026-12-25', '2027-01-01', '2027-05-01', '2027-07-14']) {
      expect(on(items, date)).toHaveLength(1);
      expect(on(items, date)[0].source.name).toBe('Google Calendar');
      expect(on(items, date)[0].observance).toBe(false);
    }
    expect(on(items, '2027-05-01')[0].title).toBe('Labor Day');
  });
});

describe('the United States', () => {
  it('has both Black Friday and Day after Thanksgiving Day on 2026-11-27 for California', async () => {
    const { items } = await festivalsFor(sanFrancisco);

    expect(on(items, '2026-11-27')).toEqual([
      row('Google Calendar', '2026-11-27', 'Black Friday', 'observance'),
      row('date-holidays', '2026-11-27', 'Day after Thanksgiving Day', 'holiday'),
    ]);
  });

  it('knows the day after Thanksgiving is not a day off for the whole country', async () => {
    const { items } = await festivalsFor(unitedStates);

    expect(shown(on(items, '2026-11-27'))).toEqual([
      '2026-11-27 Black Friday (observance)',
      '2026-11-27 Day after Thanksgiving Day (observance)',
    ]);
  });

  it('holds Thanksgiving Day and Veterans Day once each, as public holidays', async () => {
    const { items } = await festivalsFor(sanFrancisco);

    expect(on(items, '2026-11-26')).toEqual([
      row('Google Calendar', '2026-11-26', 'Thanksgiving Day'),
    ]);
    expect(on(items, '2026-11-11')).toEqual([row('Google Calendar', '2026-11-11', 'Veterans Day')]);
  });

  it('has one Labor Day, though the two readers spell it differently', async () => {
    const { items } = await festivalsFor(sanFrancisco);
    expect(on(items, '2027-09-06')).toEqual([row('Google Calendar', '2027-09-06', 'Labor Day')]);
  });

  it('reads the regional holiday as an observance: three states are not the country', async () => {
    const { items } = await festivalsFor(sanFrancisco, new Date('2028-12-10T08:00:00Z'));

    expect(on(items, '2029-01-20')).toEqual([
      row('Google Calendar', '2029-01-20', 'Inauguration Day (regional holiday)', 'observance'),
    ]);
  });
});

describe('the span the source hands over', () => {
  it('is 45 days back and 400 ahead, and the tab window is 7 and 30', () => {
    expect([FESTIVAL_SPAN_DAYS_BACK, FESTIVAL_SPAN_DAYS_AHEAD]).toEqual([45, 400]);
    expect([FESTIVAL_DAYS_BACK, FESTIVAL_DAYS_AHEAD]).toEqual([7, 30]);
  });

  it('holds every festival in the span, not only the window', async () => {
    const { items } = await festivalsFor(chennai);

    for (const item of items) {
      expect(item.date && item.date >= '2026-09-26' && item.date <= '2027-12-15').toBe(true);
    }
    // Three weeks back and nearly a year ahead: both far outside the window.
    expect(shown(items)).toContain('2026-10-20 Dussehra (holiday)');
    expect(shown(items)).toContain('2027-10-29 Diwali/Deepavali (holiday)');
    expect(items.at(0)?.date).toBe('2026-10-02');
    expect(items.at(-1)?.date).toBe('2027-12-12');
  });

  it('leaves out what is before and after it, though the calendar holds eleven years', async () => {
    const { items } = await festivalsFor(chennai);
    const titlesOn = (date: string) => on(items, date).map((item) => item.title);

    expect(titlesOn('2026-09-04')).toEqual([]);
    expect(titlesOn('2027-12-25')).toEqual([]);
    expect(items.length).toBeLessThan(120);
  });

  it('asks the library for the same span, and for the place region', async () => {
    await festivalsFor(chennai);

    expect(libraryMock).toHaveBeenCalledTimes(1);
    expect(libraryMock).toHaveBeenCalledWith({
      countryCode: 'IN',
      regionCode: 'IN-TN',
      from: '2026-09-26',
      to: '2027-12-15',
    });
  });

  it('moves with the clock', async () => {
    const { items } = await festivalsFor(chennai, new Date('2027-06-01T00:00:00Z'));

    expect((items.at(0)?.date ?? '') >= '2027-04-17').toBe(true);
    expect(shown(items)).toContain('2027-10-29 Diwali/Deepavali (holiday)');
    expect(shown(items)).not.toContain('2026-11-08 Diwali/Deepavali (holiday)');
  });

  it.each([
    ['Chennai', chennai],
    ['San Francisco', sanFrancisco],
    ['Paris', paris],
  ])('still covers the window for %s when the copy is a month old', async (_name, locality) => {
    const kept = (await festivalsFor(locality)).items;

    for (const age of [0, 1, 7, 15, 30]) {
      const later = new Date(NOW.getTime() + age * 86_400_000);
      const today = todayIn(locality.timeZone, later);
      const fresh = (await festivalsFor(locality, later)).items;

      expect(festivalsInWindow(kept, today)).toEqual(festivalsInWindow(fresh, today));
    }
  });
});

describe('a library row made by hand', () => {
  it('merges Deepavali into the calendar Diwali/Deepavali', async () => {
    libraryMock.mockReturnValueOnce([row('date-holidays', '2026-11-08', 'Deepavali')]);
    const { items } = await festivalsFor(chennai);

    expect(on(items, '2026-11-08')).toEqual([
      row('Google Calendar', '2026-11-08', 'Diwali/Deepavali', 'holiday'),
      row('Google Calendar', '2026-11-08', 'Naraka Chaturdasi', 'observance'),
    ]);
  });

  it('makes Pongal a day off when the library says the state has it off', async () => {
    libraryMock.mockReturnValueOnce([row('date-holidays', '2027-01-15', 'Pongal', 'holiday')]);
    const { items } = await festivalsFor(chennai);

    expect(on(items, '2027-01-15')).toEqual([
      row('Google Calendar', '2027-01-15', 'Guru Govind Singh Jayanti', 'observance'),
      row('Google Calendar', '2027-01-15', 'Pongal', 'holiday'),
    ]);
  });

  it('keeps a library festival the calendar does not have that day', async () => {
    libraryMock.mockReturnValueOnce([
      row('date-holidays', '2027-01-16', 'Thiruvalluvar Day', 'holiday'),
    ]);
    const { items } = await festivalsFor(chennai);

    expect(on(items, '2027-01-16')).toEqual([
      row('date-holidays', '2027-01-16', 'Thiruvalluvar Day', 'holiday'),
    ]);
  });
});

describe('when a place has no country', () => {
  it.each([
    ['Worldwide', { ...WORLDWIDE }],
    ['a country code that is not one', { ...WORLDWIDE, countryCode: 'india' }],
    ['a lower-case code', { ...WORLDWIDE, countryCode: 'in' }],
  ])('answers not found for %s, and asks nobody', async (_name, locality) => {
    const { fetchMock, source } = sourceAnswering();
    const result = await source.fetch({ locality, language: 'en' });

    expect(result).toEqual({
      items: [],
      attribution: { name: 'Public holiday calendars and date-holidays' },
      warnings: ['Festivals need a country.'],
      failed: 'not_found',
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(libraryMock).not.toHaveBeenCalled();
  });
});

describe('when a country has no calendar in the table', () => {
  it('answers the library rows as a complete result, with no call', async () => {
    const { fetchMock, source } = sourceAnswering();
    const result = await source.fetch({ locality: netherlands, language: 'nl' });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.items.length).toBeGreaterThan(20);
    expect(result.items.every((item) => item.source.name === 'date-holidays')).toBe(true);
    expect(shown(result.items)).toContain('2026-12-25 Christmas Day (holiday)');
    expect(result.failed).toBeUndefined();
    expect(result.partial).toBeUndefined();
    expect(result.warnings).toEqual([]);
    expect(result.attribution).toEqual({ name: 'Public holiday calendars and date-holidays' });
  });

  it('answers not found when the library has nothing either', async () => {
    libraryMock.mockReturnValueOnce([]);
    const { fetchMock, source } = sourceAnswering();
    const result = await source.fetch({ locality: netherlands, language: 'nl' });

    expect(result).toMatchObject({ items: [], failed: 'not_found' });
    expect(result.partial).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('answers not found for a country neither reader knows', async () => {
    const nowhere = { ...WORLDWIDE, countryCode: 'ZZ' };
    const { fetchMock, source } = sourceAnswering();

    expect(await source.fetch({ locality: nowhere, language: 'en' })).toMatchObject({
      items: [],
      failed: 'not_found',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('when the calendar is down', () => {
  it.each<[string, Answer]>([
    ['a 503', { status: 503 }],
    ['a 500', { status: 500 }],
    ['a 429', { status: 429 }],
    ['a dropped connection', new Error('socket hang up')],
    ['a sign-in page instead of a calendar', { body: SIGN_IN_PAGE }],
    ['an empty body', { body: '' }],
  ])('answers the library rows as partial after %s', async (_what, answer) => {
    const { source } = sourceAnswering({ FR: answer });
    const result = await source.fetch({ locality: paris, language: 'fr' });

    expect(result.partial).toBe(true);
    expect(result.failed).toBeUndefined();
    expect(result.items.length).toBeGreaterThan(10);
    expect(result.items.every((item) => item.source.name === 'date-holidays')).toBe(true);
    expect(on(result.items, '2026-11-11')).toEqual([
      row('date-holidays', '2026-11-11', 'Armistice Day'),
    ]);
    expect(result.warnings).toEqual([
      'The holiday calendar for FR did not answer, so these are the days date-holidays knows.',
    ]);
  });

  it('answers trouble when the library has nothing to fall back on', async () => {
    libraryMock.mockReturnValueOnce([]);
    const { source } = sourceAnswering({ FR: { status: 503 } });
    const result = await source.fetch({ locality: paris, language: 'fr' });

    expect(result).toMatchObject({ items: [], failed: 'upstream' });
    expect(result.partial).toBeUndefined();
  });

  it('does not throw when the fetch throws before it returns a promise', async () => {
    const source = createHolidaysSource({
      fetch: () => {
        throw new Error('refused');
      },
      now: () => NOW,
    });
    const result = await source.fetch({ locality: paris, language: 'fr' });

    expect(result.partial).toBe(true);
    expect(result.failed).toBeUndefined();
  });
});

describe('when the calendar is not there', () => {
  it('answers not found when the library has nothing', async () => {
    libraryMock.mockReturnValueOnce([]);
    const { source } = sourceAnswering({ FR: { status: 404 } });
    const result = await source.fetch({ locality: paris, language: 'fr' });

    expect(result).toMatchObject({ items: [], failed: 'not_found' });
    expect(result.partial).toBeUndefined();
  });

  it('answers the library rows as the whole answer: asking again would not bring more', async () => {
    const { source } = sourceAnswering({ FR: { status: 404 } });
    const result = await source.fetch({ locality: paris, language: 'fr' });

    expect(result.items.length).toBeGreaterThan(10);
    expect(result.items.every((item) => item.source.name === 'date-holidays')).toBe(true);
    expect(result.partial).toBeUndefined();
    expect(result.failed).toBeUndefined();
    expect(result.warnings).toEqual([
      'There is no holiday calendar for FR at its address, so these are the days date-holidays knows.',
    ]);
  });

  it('is what a table country with no recording reads as', async () => {
    const germany = buildLocality({ countryCode: 'DE', regionCode: 'DE-BY' });
    const { fetchMock, source } = sourceAnswering();
    const result = await source.fetch({ locality: germany, language: 'de' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(holidayCalendarUrl('en.german'));
    expect(result.failed).toBeUndefined();
    expect(shown(result.items)).toContain('2026-12-25 Christmas Day (holiday)');
  });
});

describe('when the library has nothing', () => {
  it('answers the calendar alone, as a complete result', async () => {
    libraryMock.mockReturnValueOnce([]);
    const result = await festivalsFor(chennai);

    expect(result.items.length).toBeGreaterThan(70);
    expect(result.items.every((item) => item.source.name === 'Google Calendar')).toBe(true);
    expect(result.failed).toBeUndefined();
    expect(result.partial).toBeUndefined();
    expect(result.warnings).toEqual([]);
  });

  it('is simply empty, with no failure, when the calendar has no events either', async () => {
    libraryMock.mockReturnValueOnce([]);
    const { source } = sourceAnswering({ FR: { body: EMPTY_CALENDAR } });
    const result = await source.fetch({ locality: paris, language: 'fr' });

    expect(result.items).toEqual([]);
    expect(result.failed).toBeUndefined();
    expect(result.partial).toBeUndefined();
  });

  it('answers the library rows as complete when the calendar is there but empty', async () => {
    const { source } = sourceAnswering({ FR: { body: EMPTY_CALENDAR } });
    const result = await source.fetch({ locality: paris, language: 'fr' });

    expect(result.items.length).toBeGreaterThan(10);
    expect(result.partial).toBeUndefined();
    expect(result.failed).toBeUndefined();
  });
});

describe('festivalsInWindow', () => {
  const festival = (date: string | undefined, title = `On ${date}`) => ({ date, title });
  const datesIn = (
    dates: string[],
    today: string,
    window?: Parameters<typeof festivalsInWindow>[2],
  ) =>
    festivalsInWindow(
      dates.map((date) => festival(date)),
      today,
      window,
    ).map((item) => item.date);

  it('takes today minus 7 and leaves today minus 8', () => {
    expect(datesIn(['2026-11-02', '2026-11-03'], TODAY)).toEqual(['2026-11-03']);
  });

  it('takes today plus 30 and leaves today plus 31', () => {
    expect(datesIn(['2026-12-10', '2026-12-11'], TODAY)).toEqual(['2026-12-10']);
  });

  it('takes today, yesterday and tomorrow', () => {
    expect(datesIn(['2026-11-11', '2026-11-10', '2026-11-09'], TODAY)).toEqual([
      '2026-11-09',
      '2026-11-10',
      '2026-11-11',
    ]);
  });

  it('looks ahead across a year end', () => {
    const dates = [
      '2026-12-12',
      '2026-12-13',
      '2026-12-31',
      '2027-01-01',
      '2027-01-19',
      '2027-01-20',
    ];
    expect(datesIn(dates, '2026-12-20')).toEqual([
      '2026-12-13',
      '2026-12-31',
      '2027-01-01',
      '2027-01-19',
    ]);
  });

  it('looks back across a year end', () => {
    const dates = [
      '2026-12-26',
      '2026-12-27',
      '2026-12-31',
      '2027-01-03',
      '2027-02-02',
      '2027-02-03',
    ];
    expect(datesIn(dates, '2027-01-03')).toEqual([
      '2026-12-27',
      '2026-12-31',
      '2027-01-03',
      '2027-02-02',
    ]);
  });

  it('counts a leap day', () => {
    expect(datesIn(['2028-03-09', '2028-03-10'], '2028-02-08')).toEqual(['2028-03-09']);
    expect(datesIn(['2027-03-10', '2027-03-11'], '2027-02-08')).toEqual(['2027-03-10']);
  });

  it('takes another window when asked', () => {
    const dates = ['2026-11-09', '2026-11-10', '2026-11-12', '2026-11-13'];

    expect(datesIn(dates, TODAY, { daysBack: 0, daysAhead: 2 })).toEqual([
      '2026-11-10',
      '2026-11-12',
    ]);
    expect(datesIn(dates, TODAY, { daysAhead: 0 })).toEqual(['2026-11-09', '2026-11-10']);
    expect(datesIn(dates, TODAY, { daysBack: 0 })).toEqual([
      '2026-11-10',
      '2026-11-12',
      '2026-11-13',
    ]);
  });

  it('answers by date, then by name', () => {
    const items = [
      festival('2026-11-24', "Guru Tegh Bahadur's Martyrdom Day"),
      festival('2026-11-08', 'Naraka Chaturdasi'),
      festival('2026-11-24', 'Guru Nanak Jayanti'),
      festival('2026-11-08', 'Diwali/Deepavali'),
    ];

    expect(festivalsInWindow(items, TODAY).map((item) => item.title)).toEqual([
      'Diwali/Deepavali',
      'Naraka Chaturdasi',
      'Guru Nanak Jayanti',
      "Guru Tegh Bahadur's Martyrdom Day",
    ]);
  });

  it('keeps the same festival in two years apart: only this year is in the window', () => {
    const items = [
      festival('2026-11-08', 'Diwali/Deepavali'),
      festival('2027-10-29', 'Diwali/Deepavali'),
    ];
    expect(festivalsInWindow(items, TODAY)).toEqual([festival('2026-11-08', 'Diwali/Deepavali')]);
  });

  it('leaves out what has no date, or a date that is not one', () => {
    const items = [
      festival(undefined, 'Undated'),
      festival('', 'Empty'),
      festival('soon', 'Words'),
      festival('2026-11-31', 'No Such Day'),
      festival('2026-11-10T08:00:00Z', 'An Instant'),
      festival('2026-11-10', 'Today'),
    ];
    expect(festivalsInWindow(items, TODAY).map((item) => item.title)).toEqual(['Today']);
  });

  it.each(['', 'today', '2026-02-31', '10/11/2026'])(
    'gives nothing, and does not throw, when today is %j',
    (today) => {
      expect(festivalsInWindow([festival('2026-11-10')], today)).toEqual([]);
    },
  );

  it('hands back the same items, and leaves the list it was given alone', () => {
    const later = { date: '2026-11-24', title: 'Guru Nanak Jayanti', id: 'b', extra: [1, 2] };
    const sooner = { date: '2026-11-08', title: 'Diwali/Deepavali', id: 'a', extra: [3] };
    const items = [later, sooner];

    const window = festivalsInWindow(items, TODAY);

    expect(window).toEqual([sooner, later]);
    expect(window[0]).toBe(sooner);
    expect(window[0].id).toBe('a');
    expect(items).toEqual([later, sooner]);
  });
});

describe('the window, cut from what the source hands over', () => {
  it('is what research found around the recording for Chennai', async () => {
    const { items } = await festivalsFor(chennai);
    const today = todayIn(chennai.timeZone, NOW);

    expect(today).toBe(TODAY);
    expect(shown(festivalsInWindow(items, today))).toEqual([
      '2026-11-08 Diwali/Deepavali (holiday)',
      '2026-11-08 Naraka Chaturdasi (observance)',
      '2026-11-09 Govardhan Puja (observance)',
      '2026-11-11 Bhai Duj (observance)',
      '2026-11-15 Chhat Puja (Pratihar Sashthi/Surya Sashthi) (observance)',
      '2026-11-24 Guru Nanak Jayanti (holiday)',
      "2026-11-24 Guru Tegh Bahadur's Martyrdom Day (observance)",
    ]);
  });

  it('is what research found for San Francisco', async () => {
    const { items } = await festivalsFor(sanFrancisco);

    expect(shown(festivalsInWindow(items, todayIn(sanFrancisco.timeZone, NOW)))).toEqual([
      '2026-11-03 Election Day (observance)',
      '2026-11-11 Veterans Day (holiday)',
      '2026-11-26 Thanksgiving Day (holiday)',
      '2026-11-27 Black Friday (observance)',
      '2026-11-27 Day after Thanksgiving Day (holiday)',
    ]);
  });

  it('is one Armistice Day for Paris', async () => {
    const { items } = await festivalsFor(paris);

    expect(shown(festivalsInWindow(items, todayIn(paris.timeZone, NOW)))).toEqual([
      '2026-11-11 Armistice Day (holiday)',
    ]);
  });

  it('follows the day it is in the place, not on the server', () => {
    // 18:35 UTC on the 10th is five past midnight on the 11th in Chennai.
    const justAfterMidnight = new Date('2026-11-10T18:35:00Z');
    const edges = [
      { date: '2026-11-03', title: 'A Week Before The 10th' },
      { date: '2026-12-11', title: 'A Month After The 11th' },
    ];

    const inChennai = todayIn('Asia/Kolkata', justAfterMidnight);
    const onTheServer = todayIn(null, justAfterMidnight);

    expect(festivalsInWindow(edges, inChennai).map((item) => item.date)).toEqual(['2026-12-11']);
    expect(festivalsInWindow(edges, onTheServer).map((item) => item.date)).toEqual(['2026-11-03']);
  });

  it('counts the days to each row from the same today', async () => {
    const { items } = await festivalsFor(chennai);
    const window = festivalsInWindow(items, TODAY);

    expect(window.map((item) => daysUntil(item.date ?? '', TODAY))).toEqual([
      -2, -2, -1, 1, 5, 14, 14,
    ]);
    expect(daysUntil(addDays(TODAY, FESTIVAL_DAYS_AHEAD), TODAY)).toBe(30);
    expect(daysUntil(addDays(TODAY, -FESTIVAL_DAYS_BACK), TODAY)).toBe(-7);
  });
});
