import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildLocality, WORLDWIDE } from '../../geo/locality';
import type { DiscoverFetch } from '../../types';
import { HOLIDAY_CALENDAR_IDS, holidayCalendarUrl } from './google-calendar';
import {
  createHolidaysSource,
  daysUntil,
  FESTIVAL_DAYS_AHEAD,
  festivalsInWindow,
  todayIn,
} from './index';

/**
 * This file is on its own so nothing else can have loaded the library first.
 * The mock is the real library with a counter in front of it: Jest runs the
 * factory the first time anything requires the module, and not before.
 *
 * The count lives on the global object, which every test file gets its own copy
 * of, because the factory must be able to run before any line of this file has:
 * that is exactly what happens when somebody makes the import eager, and the
 * test should then say "expected 0, received 1", not trip over a variable.
 */
type Counted = typeof globalThis & { dateHolidaysLoads?: number };

jest.mock('date-holidays', () => {
  const counted = globalThis as Counted;
  counted.dateHolidaysLoads = (counted.dateHolidaysLoads ?? 0) + 1;
  return jest.requireActual('date-holidays');
});

const loads = () => (globalThis as Counted).dateHolidaysLoads ?? 0;

const FRANCE = readFileSync(
  join(__dirname, '..', '..', '..', 'fixtures', 'paris', 'holidays-FR.2026-11-10.ics'),
  'utf8',
);

const calendarFetch: DiscoverFetch = async (url) => {
  const known = url === holidayCalendarUrl(HOLIDAY_CALENDAR_IDS.FR);
  return { status: known ? 200 : 404, body: known ? FRANCE : '', finalUrl: url };
};

const now = () => new Date('2026-11-10T08:00:00Z');
const paris = buildLocality({ countryCode: 'FR', regionCode: 'FR-IDF', city: 'Paris' });

describe('date-holidays is loaded on first use', () => {
  it('is not loaded by importing the source, building it, or the window helpers', () => {
    expect(loads()).toBe(0);

    createHolidaysSource({ fetch: calendarFetch, now });
    expect(todayIn('Europe/Paris', now())).toBe('2026-11-10');
    expect(daysUntil('2026-11-11', '2026-11-10')).toBe(1);
    expect(festivalsInWindow([], '2026-11-10')).toEqual([]);
    expect(FESTIVAL_DAYS_AHEAD).toBe(30);

    expect(loads()).toBe(0);
  });

  it('is not loaded for a place with no country, which is answered without it', async () => {
    const source = createHolidaysSource({ fetch: calendarFetch, now });
    const result = await source.fetch({ locality: { ...WORLDWIDE }, language: 'en' });

    expect(result.failed).toBe('not_found');
    expect(loads()).toBe(0);
  });

  it('is loaded by the first fetch that needs it, once', async () => {
    const source = createHolidaysSource({ fetch: calendarFetch, now });
    expect(loads()).toBe(0);

    const first = await source.fetch({ locality: paris, language: 'fr' });
    expect(loads()).toBe(1);
    expect(first.items.length).toBeGreaterThan(10);

    await source.fetch({ locality: paris, language: 'fr' });
    await createHolidaysSource({ fetch: calendarFetch, now }).fetch({
      locality: buildLocality({ countryCode: 'NL' }),
      language: 'nl',
    });
    expect(loads()).toBe(1);
  });
});
