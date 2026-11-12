/**
 * Holidays worked out offline by `date-holidays` (research 01, section 3.5): the
 * fallback for a country with no calendar in the table, and the only place a
 * state's own days off come from (the Google calendars are country level).
 *
 * ## Loaded on first use
 *
 * The library and its data are 12 MB, so it is required inside
 * {@link loadLibrary}, the first time a festival list is really asked for, and
 * never when the API boots or a test imports the engine. The import at the top
 * is of types only and compiles to nothing.
 *
 * ## Asked in English, and never trusted to answer
 *
 * The names are asked for in English so they can be matched with the calendar's.
 * A state is passed only when the library lists it for that country, because an
 * unknown one quietly answers the whole country and would hide a wrong code.
 *
 * Everything is caught. The library throws for some countries: under `require`
 * every country whose rules use the Chinese calendar fails inside its astronomy
 * dependency (CN, HK, TW, SG, MY, KR, VN, ID, PH and a few more, checked with
 * 3.39.1). Those read as "the library has nothing", and the country's calendar,
 * when it has one, carries the list alone.
 */
import type { default as Holidays, HolidaysTypes } from 'date-holidays';
import { countryOf, isCountryCode, isRegionCode } from '../../geo/iso3166';
import type { SourceItem } from '../../types';
import { hasCuratedDays } from './curated';
import { isCalendarDate } from './dates';
import { festivalItem } from './merge';

export type HolidaysLibrary = typeof Holidays;

export interface LibraryQuery {
  countryCode: string;
  /** ISO 3166-2, such as `US-CA`. Used only when the library lists that state. */
  regionCode?: string | null;
  /** The first and the last day wanted, both included, `YYYY-MM-DD`. */
  from: string;
  to: string;
}

/**
 * `public` and `bank` are days off. `observance` and `optional` are not. A type
 * that is not here (`school`) is not a festival for a brand to post about.
 */
const OBSERVANCE_BY_TYPE: Readonly<Record<string, boolean>> = {
  public: false,
  bank: false,
  observance: true,
  optional: true,
};

/** A span is two or three calendar years. This only stops a nonsense one from spinning. */
const MAX_YEARS = 5;

let library: HolidaysLibrary | null = null;

/** The CommonJS build is the class itself; a bundler may wrap it in `default`. */
function loadLibrary(): HolidaysLibrary {
  if (!library) {
    const loaded: HolidaysLibrary | { default: HolidaysLibrary } = require('date-holidays');
    library = typeof loaded === 'function' ? loaded : loaded.default;
  }
  return library;
}

/** `IN-TN` to `TN`, when it is a state of this country and the library knows it. */
function stateFor(
  probe: Holidays,
  countryCode: string,
  regionCode: string | null | undefined,
): string | null {
  if (!regionCode || !isRegionCode(regionCode) || countryOf(regionCode) !== countryCode) {
    return null;
  }
  const state = regionCode.slice(countryCode.length + 1);
  const states: Record<string, string> | undefined = probe.getStates(countryCode);
  return states && Object.hasOwn(states, state) ? state : null;
}

/**
 * The region as the library knows it (`US-CA`), or as the hand-kept state lists
 * do (`IN-TS`, which the library knows only as `IN-TG`), or null for one with no
 * days of its own, which includes one that does not exist. The API keys its
 * shared copy on this, so a made-up region reads the country's copy instead of
 * costing a fetch and a month-long copy of its own, and a region with days of
 * its own never shares a copy with its country. Never throws.
 */
export function holidayRegion(
  countryCode: string,
  regionCode: string | null | undefined,
  load: () => HolidaysLibrary = loadLibrary,
): string | null {
  if (!regionCode || !isCountryCode(countryCode)) return null;
  if (hasCuratedDays(regionCode) && countryOf(regionCode) === countryCode) return regionCode;
  try {
    const Library = load();
    return stateFor(new Library(), countryCode, regionCode) ? regionCode : null;
  } catch {
    return null;
  }
}

function rowsOf(holidays: readonly HolidaysTypes.Holiday[], query: LibraryQuery): SourceItem[] {
  return holidays.flatMap((holiday) => {
    const observance = Object.hasOwn(OBSERVANCE_BY_TYPE, holiday.type)
      ? OBSERVANCE_BY_TYPE[holiday.type]
      : undefined;
    if (observance === undefined) return [];

    // "2026-11-11 00:00:00", and "2026-03-20 00:00:00 -0600" for a day that
    // begins at sunset the evening before. Either way the day is the first ten.
    const date = String(holiday.date).slice(0, 10);
    if (date < query.from || date > query.to) return [];

    const name = typeof holiday.name === 'string' ? holiday.name : '';
    return festivalItem({ name, date, observance, origin: 'date-holidays' }) ?? [];
  });
}

/**
 * The library's festivals for a place between two days, and never a throw. A
 * holiday that runs several days (Eid in many countries) is one row on its first
 * day. An unknown country, a country the library fails on and a library that
 * will not load all give an empty list.
 *
 * `load` is there for tests. Everything else uses the lazy default.
 */
export function libraryFestivals(
  query: LibraryQuery,
  load: () => HolidaysLibrary = loadLibrary,
): SourceItem[] {
  const { countryCode } = query;
  if (!isCountryCode(countryCode)) return [];
  if (!isCalendarDate(query.from) || !isCalendarDate(query.to)) return [];

  const firstYear = Number(query.from.slice(0, 4));
  const lastYear = Number(query.to.slice(0, 4));

  try {
    const Library = load();
    const probe = new Library();
    if (!Object.hasOwn(probe.getCountries() ?? {}, countryCode)) return [];

    const state = stateFor(probe, countryCode, query.regionCode);
    const options: HolidaysTypes.Options = { languages: ['en'] };
    const calendar = state
      ? new Library(countryCode, state, options)
      : new Library(countryCode, options);

    const items: SourceItem[] = [];
    for (let year = firstYear; year <= lastYear && year < firstYear + MAX_YEARS; year += 1) {
      try {
        items.push(...rowsOf(calendar.getHolidays(year) ?? [], query));
      } catch {
        // One year the library cannot work out does not take the others with it.
      }
    }
    return items;
  } catch {
    return [];
  }
}
