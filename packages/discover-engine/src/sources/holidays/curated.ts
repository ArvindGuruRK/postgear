/**
 * A third reader for festivals: days kept by hand per state (ISO 3166-2), for
 * what the country's calendar and `date-holidays` miss, name differently, or
 * date differently there. The data is in `curated/`, each day with the list it
 * was checked against.
 *
 * ## Merged like the other two, with one rule of its own
 *
 * A state's day goes through the same merge as the calendar's and the library's
 * rows, so a day either already has on that date shows once, under the name it
 * already had, and a day off in the state's list makes the row a day off.
 *
 * The rule of its own: in that state, the state's date wins. A row from either
 * reader with the same name up to {@link NEAR_DAYS} days away is dropped, because
 * it is the same festival on the date the rest of the country keeps. Google's
 * India calendar has Pongal 2026 on 14 January, an observance; Tamil Nadu's list
 * has it on the 15th, a day off. Without the rule Chennai would see Pongal twice,
 * with the day off on the wrong day.
 */
import { isRegionCode } from '../../geo/iso3166';
import type { SourceItem } from '../../types';
import { STATE_DAYS } from './curated/state-days';
import { TAMIL_NADU_DAYS } from './curated/tamil-nadu';
import type { CuratedDay } from './curated/types';
import { dayNumber, isCalendarDate } from './dates';
import { festivalItem, festivalNameKeys, mergeFestivals } from './merge';

export type { CuratedDate, CuratedDay, CuratedYearlyDay } from './curated/types';

/** How far apart the state's date and another reader's may be and still be one festival. */
export const NEAR_DAYS = 3;

/** A span is two or three calendar years. This only stops a nonsense one from spinning. */
const MAX_YEARS = 5;

function joined(
  ...tables: Readonly<Record<string, readonly CuratedDay[]>>[]
): Readonly<Record<string, readonly CuratedDay[]>> {
  const all: Record<string, CuratedDay[]> = {};
  for (const table of tables) {
    for (const [region, days] of Object.entries(table)) {
      all[region] = [...(all[region] ?? []), ...days];
    }
  }
  return all;
}

/** Every state with days of its own, by ISO 3166-2 code. */
export const CURATED_DAYS: Readonly<Record<string, readonly CuratedDay[]>> = joined(
  { 'IN-TN': TAMIL_NADU_DAYS },
  STATE_DAYS,
);

function daysOf(regionCode: string | null | undefined): readonly CuratedDay[] {
  return regionCode && isRegionCode(regionCode) && Object.hasOwn(CURATED_DAYS, regionCode)
    ? CURATED_DAYS[regionCode]
    : [];
}

/** Whether a region has days of its own here, so the API keeps a copy for it apart from its country's. */
export function hasCuratedDays(regionCode: string | null | undefined): boolean {
  return daysOf(regionCode).length > 0;
}

/**
 * A region's own days between two dates, both included, as festival rows. A
 * yearly day falls in every year of the span from its `since`; one that does not
 * exist in a year (29 February) is skipped that year. Empty for a region with no
 * days, or a span that is not two dates.
 */
export function curatedFestivals(query: {
  regionCode: string | null | undefined;
  from: string;
  to: string;
}): SourceItem[] {
  const days = daysOf(query.regionCode);
  if (days.length === 0 || !isCalendarDate(query.from) || !isCalendarDate(query.to)) return [];

  const firstYear = Number(query.from.slice(0, 4));
  const lastYear = Math.min(Number(query.to.slice(0, 4)), firstYear + MAX_YEARS - 1);
  const inSpan = (date: string) => date >= query.from && date <= query.to;

  const items: SourceItem[] = [];
  const add = (day: CuratedDay, date: string) => {
    if (!isCalendarDate(date) || !inSpan(date)) return;
    const item = festivalItem({
      name: day.name,
      date,
      observance: day.observance,
      origin: 'State list',
    });
    if (item) items.push(item);
  };

  for (const day of days) {
    if ('date' in day) {
      add(day, day.date);
      continue;
    }
    for (let year = Math.max(firstYear, day.since ?? firstYear); year <= lastYear; year += 1) {
      add(day, `${String(year).padStart(4, '0')}-${day.monthDay}`);
    }
  }
  return items;
}

/** The same festival a few days off: one of the names agrees, and the dates are close but not equal. */
function isNearSame(row: SourceItem, day: SourceItem): boolean {
  const apart = Math.abs(dayNumber(row.date ?? '') - dayNumber(day.date ?? ''));
  if (!(apart >= 1 && apart <= NEAR_DAYS)) return false;
  const dayKeys = new Set(festivalNameKeys(day.title));
  return festivalNameKeys(row.title).some((key) => dayKeys.has(key));
}

/**
 * The calendar's and the library's rows with the state's days merged in. The
 * state's date wins over a row of the same name a few days away, and everything
 * else is `mergeFestivals`: one row per date and name, a day off beating an
 * observance, the calendar's name shown when it has the day.
 */
export function mergeWithStateDays(
  calendar: readonly SourceItem[],
  library: readonly SourceItem[],
  stateDays: readonly SourceItem[],
): SourceItem[] {
  if (stateDays.length === 0) return mergeFestivals(calendar, library);
  const keep = (row: SourceItem) => !stateDays.some((day) => isNearSame(row, day));
  return mergeFestivals(calendar.filter(keep), [...library.filter(keep), ...stateDays]);
}
