import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildLocality } from '../../geo/locality';
import type { DiscoverFetch, Locality, SourceItem } from '../../types';
import { CURATED_DAYS, curatedFestivals, hasCuratedDays } from './curated';
import { holidayRegion } from './date-holidays';
import { isCalendarDate } from './dates';
import { HOLIDAY_CALENDAR_IDS, holidayCalendarUrl } from './google-calendar';
import { createHolidaysSource, festivalsInWindow } from './index';

const INDIA_CALENDAR = readFileSync(
  join(__dirname, '..', '..', '..', 'fixtures', 'chennai', 'holidays-IN.2026-11-10.ics'),
  'utf8',
);

/** India's recorded calendar for India, a 404 for every other country. */
const calendarFetch: DiscoverFetch = async (url) =>
  url === holidayCalendarUrl(HOLIDAY_CALENDAR_IDS.IN)
    ? { status: 200, body: INDIA_CALENDAR, finalUrl: url }
    : { status: 404, body: '', finalUrl: url };

const chennai = buildLocality({ countryCode: 'IN', regionCode: 'IN-TN', city: 'Chennai' });
const mumbai = buildLocality({ countryCode: 'IN', regionCode: 'IN-MH', city: 'Mumbai' });
const delhi = buildLocality({ countryCode: 'IN', regionCode: 'IN-DL', city: 'Delhi' });

async function festivals(locality: Locality, now: string) {
  const source = createHolidaysSource({ fetch: calendarFetch, now: () => new Date(now) });
  return source.fetch({ locality, language: 'en' });
}

const shown = (items: SourceItem[], date: string) =>
  items
    .filter((item) => item.date === date)
    .map((item) => `${item.title} (${item.observance ? 'observance' : 'holiday'})`);

describe('a state list merged into the festivals', () => {
  it("gives Chennai Tamil Nadu's January 2027 days off, each once, and credits the state lists", async () => {
    const result = await festivals(chennai, '2026-11-10T08:00:00Z');
    const january = festivalsInWindow(result.items, '2027-01-10', { daysBack: 0, daysAhead: 10 });

    expect(shown(january, '2027-01-15')).toContain('Pongal (holiday)');
    expect(shown(january, '2027-01-15').filter((title) => title.startsWith('Pongal'))).toHaveLength(
      1,
    );
    expect(shown(january, '2027-01-16')).toEqual(['Thiruvalluvar Day (holiday)']);
    expect(shown(january, '2027-01-17')).toEqual(['Uzhavar Thirunal (holiday)']);
    expect(result.attribution.name).toBe('Public holiday calendars, date-holidays and state lists');
  });

  it("moves Pongal 2026 to the state's date, and folds a day the calendar has into its row", async () => {
    const { items } = await festivals(chennai, '2026-01-05T08:00:00Z');

    // The calendar has Pongal on the 14th as an observance; Tamil Nadu keeps the 15th off.
    expect(shown(items, '2026-01-14')).toEqual(['Makar Sankranti (observance)']);
    expect(shown(items, '2026-01-15')).toEqual(['Pongal (holiday)']);
    // The calendar's Ugadi and the state's Telugu New Year are one row, a day off.
    expect(shown(items, '2026-03-19').filter((title) => /ugadi|telugu/i.test(title))).toEqual([
      'Ugadi (holiday)',
    ]);
    expect(shown(items, '2026-11-08').filter((title) => /deepavali/i.test(title))).toEqual([
      'Diwali/Deepavali (holiday)',
    ]);
  });

  it('leaves a region with no list of its own as it was', async () => {
    const result = await festivals(delhi, '2026-11-10T08:00:00Z');

    expect(hasCuratedDays('IN-DL')).toBe(false);
    expect(result.items.some((item) => item.source.name === 'State list')).toBe(false);
    expect(result.attribution.name).toBe('Public holiday calendars and date-holidays');
    // A region of another country never borrows the list.
    const mismatched = buildLocality({ countryCode: 'US', regionCode: 'IN-TN' });
    const american = await festivals(mismatched, '2026-11-10T08:00:00Z');
    expect(american.items.some((item) => item.source.name === 'State list')).toBe(false);
  });

  it('puts a yearly day in every year from its first, and one row with the library', async () => {
    const days = curatedFestivals({ regionCode: 'IN-PB', from: '2026-01-01', to: '2028-12-31' });
    expect(days.map((day) => `${day.date} ${day.title}`)).toEqual([
      '2026-11-01 Punjab Day',
      '2027-11-01 Punjab Day',
      '2028-11-01 Punjab Day',
    ]);
    const tamilNaduDays = curatedFestivals({
      regionCode: 'IN-TN',
      from: '2024-01-01',
      to: '2026-12-31',
    })
      .filter((day) => day.title.startsWith('Tamil Nadu Day'))
      .map((day) => day.date);
    expect(tamilNaduDays).toEqual(['2024-07-18', '2025-07-18', '2026-07-18', '2026-11-01']);

    // The library calls 1 May "Maharashtra Day" too: one row, and its day off stands.
    const { items } = await festivals(mumbai, '2026-11-10T08:00:00Z');
    expect(shown(items, '2027-05-01').filter((title) => title.startsWith('Maharashtra'))).toEqual([
      'Maharashtra Day (holiday)',
    ]);
  });

  it('keeps a state with a list apart from its country in the shared copy', () => {
    expect(holidayRegion('IN', 'IN-TS')).toBe('IN-TS');
    expect(holidayRegion('IN', 'IN-TN')).toBe('IN-TN');
    expect(holidayRegion('US', 'IN-TN')).toBeNull();
  });
});

describe('the state lists themselves', () => {
  it('hold only real dates, each dated day with the page it was checked on', () => {
    for (const [region, days] of Object.entries(CURATED_DAYS)) {
      for (const day of days) {
        const label = `${region} ${day.name}`;
        if ('date' in day) {
          expect([label, isCalendarDate(day.date), /^https:\/\//.test(day.source)]).toEqual([
            label,
            true,
            true,
          ]);
        } else {
          // A leap year, so 29 February would pass; nothing here should need it.
          expect([label, isCalendarDate(`2028-${day.monthDay}`)]).toEqual([label, true]);
        }
      }
    }
  });
});
