/**
 * Festivals and public holidays for a place, merged from two readers: the
 * country's Google calendar (rich, English, country level; `google-calendar.ts`)
 * and `date-holidays` (offline rules, and the only one that knows a state's own
 * days off; `date-holidays.ts`). `merge.ts` decides when two rows are one. A
 * state with a hand-kept list of its own (`curated.ts`) adds those days, and the
 * attribution then credits the state lists too.
 *
 * ## The source answers far more than the tab shows
 *
 * The Festivals tab shows a week back and a month ahead. This source hands over
 * 45 days back and 400 ahead instead, because the API keeps one copy per country
 * and region for up to 30 days and cuts the window on every request, with the
 * place's own "today". A copy that only held the window of the day it was
 * fetched would have run dry by the time it was a month old.
 *
 * So the window is not this source's job: {@link todayIn} and
 * {@link festivalsInWindow} are, for the caller to cut with.
 *
 * ## One reader down is not a failure
 *
 * When the calendar does not answer but the library has rows, those rows are
 * real, just not everything, and the result says `partial` instead of `failed`.
 * A calendar that is simply not there (a 404) is different: nothing is missing
 * that asking again would bring back, so the library's rows are the answer.
 */
import { countryOf, isCountryCode } from '../../geo/iso3166';
import type {
  DiscoverFetch,
  DiscoverSource,
  SourceAttribution,
  SourceFailure,
  SourceInput,
  SourceItem,
  SourceResult,
} from '../../types';
import { curatedFestivals, mergeWithStateDays } from './curated';
import { libraryFestivals } from './date-holidays';
import { addDays, dayNumber, todayIn } from './dates';
import { holidayCalendarId, holidayCalendarPageUrl, readHolidayCalendar } from './google-calendar';
import { byDateThenName } from './merge';

export { daysUntil, todayIn } from './dates';

/** What the Festivals tab shows: a week back, for "just happened", and a month ahead. */
export const FESTIVAL_DAYS_BACK = 7;
export const FESTIVAL_DAYS_AHEAD = 30;

/** What the source hands over, around the day it is asked. See the header for why. */
export const FESTIVAL_SPAN_DAYS_BACK = 45;
export const FESTIVAL_SPAN_DAYS_AHEAD = 400;

const SOURCE_NAME = 'Public holiday calendars and date-holidays';
/** What the group credits when a state's own days (`curated.ts`) are among the rows. */
const WITH_STATE_LISTS = 'Public holiday calendars, date-holidays and state lists';

/** The country's calendar as a page a person can open, when it has one. */
function attributionFor(calendarId: string | null, withStateDays = false): SourceAttribution {
  const name = withStateDays ? WITH_STATE_LISTS : SOURCE_NAME;
  return calendarId ? { name, url: holidayCalendarPageUrl(calendarId) } : { name };
}

/**
 * The items dated from `daysBack` before `today` to `daysAhead` after it, both
 * ends included, by date then name. `today` is a plain date (`YYYY-MM-DD`, from
 * {@link todayIn}); an item with no date, or a `today` that is not a date, gives
 * nothing rather than a throw.
 */
export function festivalsInWindow<T extends { date?: string; title: string }>(
  items: readonly T[],
  today: string,
  window: { daysBack?: number; daysAhead?: number } = {},
): T[] {
  const anchor = dayNumber(today);
  const first = anchor - (window.daysBack ?? FESTIVAL_DAYS_BACK);
  const last = anchor + (window.daysAhead ?? FESTIVAL_DAYS_AHEAD);

  return items
    .filter((item) => {
      const day = dayNumber(item.date ?? '');
      return day >= first && day <= last;
    })
    .sort(byDateThenName);
}

export function createHolidaysSource(options: {
  fetch: DiscoverFetch;
  now?: () => Date;
}): DiscoverSource {
  const { fetch: calendarFetch, now = () => new Date() } = options;

  return {
    id: 'holidays',
    name: SOURCE_NAME,

    fetch: async ({ locality, signal }: SourceInput): Promise<SourceResult> => {
      const country = locality.countryCode;
      if (!country || !isCountryCode(country)) {
        return {
          items: [],
          attribution: attributionFor(null),
          warnings: ['Festivals need a country.'],
          failed: 'not_found',
        };
      }

      const today = todayIn(null, now());
      const from = addDays(today, -FESTIVAL_SPAN_DAYS_BACK);
      const to = addDays(today, FESTIVAL_SPAN_DAYS_AHEAD);
      const inSpan = (item: SourceItem) =>
        item.date !== undefined && item.date >= from && item.date <= to;

      const calendarId = holidayCalendarId(country);
      const calendar = calendarId
        ? await readHolidayCalendar(calendarFetch, calendarId, signal)
        : null;
      const fromLibrary = libraryFestivals({
        countryCode: country,
        regionCode: locality.regionCode,
        from,
        to,
      });
      // Only a region of this country: a mismatched pair must not borrow another country's days.
      const region = locality.regionCode;
      const fromState =
        region && countryOf(region) === country
          ? curatedFestivals({ regionCode: region, from, to })
          : [];
      const attribution = attributionFor(calendarId, fromState.length > 0);

      if (calendar?.ok) {
        return {
          items: mergeWithStateDays(calendar.items.filter(inSpan), fromLibrary, fromState),
          attribution,
          warnings: [],
        };
      }

      const failure: SourceFailure = calendar?.failure ?? 'not_found';
      if (fromLibrary.length === 0 && fromState.length === 0) {
        return { items: [], attribution, warnings: [], failed: failure };
      }

      const items = mergeWithStateDays([], fromLibrary, fromState);
      if (calendar === null) return { items, attribution, warnings: [] };

      const known =
        fromState.length > 0 ? 'date-holidays and the state list know' : 'date-holidays knows';
      if (failure === 'upstream') {
        return {
          items,
          attribution,
          warnings: [
            `The holiday calendar for ${country} did not answer, so these are the days ${known}.`,
          ],
          partial: true,
        };
      }
      return {
        items,
        attribution,
        warnings: [
          `There is no holiday calendar for ${country} at its address, so these are the days ${known}.`,
        ],
      };
    },
  };
}
