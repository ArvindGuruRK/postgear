/**
 * A country's public holidays and observances, from the calendar Google publishes
 * for subscription (research 01, section 3.4): plain ICS, no key, English names,
 * country level only.
 *
 * ## The id table is short on purpose
 *
 * Only the ids the research names are here. The three demo countries (India, the
 * United States, France) were checked against the calendar's own `X-WR-CALNAME`
 * when their fixtures were recorded; the other eight are reported, not fetched. A
 * community list maps 232 countries, but nobody has checked it for this project,
 * and an id nobody checked is a guess. A country with no id here reads
 * `date-holidays` alone, which is the fallback the stories ask for.
 *
 * ## Public holiday, or observance
 *
 * The calendar says which in the first line of each event's description, and the
 * recordings hold exactly four forms: `Observance`, `Public holiday`, that with
 * a second line saying the date is tentative, and (United States only)
 * `Public holiday in District of Columbia, Maryland, Virginia`. Only the bare
 * `Public holiday` is shown as one. The calendar is country level and one copy
 * of it serves everybody in the country, so a day off in three states must not
 * read as a day off for all of them; a state's own days off come from
 * `date-holidays`, which is asked per state.
 */
import type { DiscoverFetch, SourceFailure, SourceItem } from '../../types';
import { type IcsEvent, parseIcs } from './ics';
import { festivalItem } from './merge';

export const HOLIDAY_CALENDAR_IDS: Readonly<Record<string, string>> = {
  IN: 'en.indian',
  US: 'en.usa',
  FR: 'en.french',
  GB: 'en.uk',
  AU: 'en.australian',
  SG: 'en.singapore',
  AE: 'en.ae',
  DE: 'en.german',
  BR: 'en.brazilian',
  JP: 'en.japanese',
  CA: 'en.canadian',
};

/** The `#` and the `@` of the calendar's address must be encoded, or Google answers 404. */
export function holidayCalendarUrl(calendarId: string): string {
  const address = encodeURIComponent(`${calendarId}#holiday@group.v.calendar.google.com`);
  return `https://calendar.google.com/calendar/ical/${address}/public/basic.ics`;
}

const CALENDAR_TIMEOUT_MS = 8_000;
const CALENDAR_MAX_BYTES = 1024 * 1024;
const CALENDAR_ACCEPT = 'text/calendar, text/plain;q=0.9';

/** A country's calendar id, or null when the table has none for it. */
export function holidayCalendarId(countryCode: string): string | null {
  return Object.hasOwn(HOLIDAY_CALENDAR_IDS, countryCode)
    ? HOLIDAY_CALENDAR_IDS[countryCode]
    : null;
}

/** The same calendar as a page a person can open, for the attribution. */
export function holidayCalendarPageUrl(calendarId: string): string {
  const address = encodeURIComponent(`${calendarId}#holiday@group.v.calendar.google.com`);
  return `https://calendar.google.com/calendar/embed?src=${address}`;
}

/** True unless the description's first line is exactly `Public holiday`. */
export function isObservance(description: string): boolean {
  return description.split('\n', 1)[0].trim() !== 'Public holiday';
}

/**
 * Calendar events as festival rows. The summary is kept as the calendar wrote it
 * ("Ramzan Id (tentative)" stays tentative). An event that runs several days is
 * one row on its first day, which is the day to post for; the recordings hold
 * none, so this is a rule for the day one appears.
 */
export function festivalsFromCalendar(events: readonly IcsEvent[]): SourceItem[] {
  return events.flatMap(
    (event) =>
      festivalItem({
        name: event.summary,
        date: event.start,
        observance: isObservance(event.description),
        origin: 'Google Calendar',
      }) ?? [],
  );
}

export type CalendarRead =
  | { ok: true; items: SourceItem[] }
  | { ok: false; failure: SourceFailure };

/** Google's sign-in and consent pages answer 200 too, and they are not calendars. */
function looksLikeCalendar(body: string): boolean {
  return /^\u{FEFF}?\s*BEGIN:VCALENDAR\b/iu.test(body);
}

/**
 * Fetches and reads one calendar, and never throws. A 429, a 5xx, a dropped
 * connection and a page that is not a calendar mean Google is in trouble; any
 * other answer means it is fine and has no calendar at that address.
 */
export async function readHolidayCalendar(
  calendarFetch: DiscoverFetch,
  calendarId: string,
  signal?: AbortSignal,
): Promise<CalendarRead> {
  try {
    const response = await calendarFetch(holidayCalendarUrl(calendarId), {
      accept: CALENDAR_ACCEPT,
      signal: signal ?? AbortSignal.timeout(CALENDAR_TIMEOUT_MS),
      maxBytes: CALENDAR_MAX_BYTES,
    });

    if (response.status !== 200) {
      const isTrouble = response.status === 429 || response.status >= 500;
      return { ok: false, failure: isTrouble ? 'upstream' : 'not_found' };
    }
    if (!looksLikeCalendar(response.body)) return { ok: false, failure: 'upstream' };

    return { ok: true, items: festivalsFromCalendar(parseIcs(response.body)) };
  } catch {
    return { ok: false, failure: 'upstream' };
  }
}
