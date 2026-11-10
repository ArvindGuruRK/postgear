/**
 * Plain calendar dates: `YYYY-MM-DD`, with no clock and no time zone.
 *
 * A festival is on a day, not at an instant. Diwali is 8 November in Chennai
 * whatever the server's clock says, so nothing here builds a `Date` that a time
 * zone could move: a date is counted as whole days, and the one place a zone
 * matters is {@link todayIn}, which asks "what day is it there right now".
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

/**
 * A date as a count of whole days, so two of them can be compared and
 * subtracted. `NaN` for anything that is not a real date (`2026-02-31`, a time,
 * nonsense), and a `NaN` compares false with everything, which is what lets a
 * caller filter with it and never check first.
 */
export function dayNumber(date: string): number {
  const match = ISO_DATE.exec(date);
  if (!match) return Number.NaN;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const time = Date.UTC(year, month - 1, day);
  const back = new Date(time);
  // 31 February rolls over into March. A real date comes back as itself.
  const isReal =
    back.getUTCFullYear() === year && back.getUTCMonth() === month - 1 && back.getUTCDate() === day;
  return isReal ? time / DAY_MS : Number.NaN;
}

/** The other way round. An empty string when the count is not a day a date can hold. */
function dateOfDayNumber(day: number): string {
  const time = day * DAY_MS;
  if (!Number.isFinite(time) || Math.abs(time) > 8.64e15) return '';
  const text = new Date(time).toISOString();
  return ISO_DATE.test(text.slice(0, 10)) ? text.slice(0, 10) : '';
}

export function isCalendarDate(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(dayNumber(value));
}

/** An empty string when `date` is not a real date. */
export function addDays(date: string, days: number): string {
  return dateOfDayNumber(dayNumber(date) + Math.trunc(days));
}

/**
 * Whole days from `today` to `date` (negative for the past). Plain calendar
 * arithmetic, no time zone. `NaN` when either is not a real date.
 */
export function daysUntil(date: string, today: string): number {
  return dayNumber(date) - dayNumber(today);
}

/**
 * The day it is in a place right now. Never throws. An unknown or missing zone
 * reads UTC: the zone can arrive from a query string that was checked for shape
 * only, and `Intl` refuses a zone it does not know by throwing.
 */
export function todayIn(timeZone: string | null | undefined, now: Date = new Date()): string {
  const instant = Number.isNaN(now.getTime()) ? new Date() : now;

  if (typeof timeZone === 'string' && timeZone !== '') {
    try {
      // The calendar and the digits are named so no locale default can change them.
      const parts = new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(instant);
      const part = (type: Intl.DateTimeFormatPartTypes) =>
        parts.find((entry) => entry.type === type)?.value ?? '';
      const date = `${part('year').padStart(4, '0')}-${part('month')}-${part('day')}`;
      if (isCalendarDate(date)) return date;
    } catch {
      // A zone Intl does not know: UTC below.
    }
  }

  return instant.toISOString().slice(0, 10);
}
