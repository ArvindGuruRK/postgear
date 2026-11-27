/**
 * Calendar arithmetic for the Schedule Maker (Sprint 13), with `Intl` only.
 *
 * Twitch answers every time in UTC and never says the broadcaster's zone, so
 * the zone is ours: the one the person picked (their browser's by default).
 * Everything here turns a UTC instant into a wall clock in that zone, or a
 * wall-clock midnight back into an instant, through `Intl.DateTimeFormat`,
 * which knows each zone's daylight saving rules date by date. No offset is
 * ever assumed to hold for a whole week: a week that crosses a clock change
 * is 167 or 169 hours long, and both of its ends are worked out on their own.
 *
 * Pure and browser-safe like the rest of the package: no Node built-ins, no
 * clock read here (a caller that needs "now" passes it in).
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Monday first, as the picture lists the week. */
export const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

const MONTH_LABELS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** One formatter per zone: building them is the slow part of `Intl`. */
const FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let found = FORMATTERS.get(timeZone);
  if (!found) {
    found = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    FORMATTERS.set(timeZone, found);
  }
  return found;
}

/** True for a zone this runtime's `Intl` can draw times in. */
export function isTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 64) return false;
  try {
    formatter(value);
    return true;
  } catch {
    return false;
  }
}

/** A zone `Intl` knows, or UTC: a stored zone a later runtime dropped still draws. */
export function safeTimeZone(value: string): string {
  return isTimeZone(value) ? value : 'UTC';
}

export interface WallClock {
  year: number;
  /** 1 to 12. */
  month: number;
  day: number;
  /** 0 to 23. */
  hour: number;
  minute: number;
  second: number;
}

/** The wall clock in `timeZone` at a UTC instant. */
export function wallClock(instant: Date, timeZone: string): WallClock {
  const parts = formatter(safeTimeZone(timeZone)).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');

  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    // Some runtimes still write midnight as 24 under h23; it is the same hour.
    hour: read('hour') % 24,
    minute: read('minute'),
    second: read('second'),
  };
}

/** How far `timeZone` is ahead of UTC at an instant, in milliseconds. */
export function zoneOffsetMs(instant: Date, timeZone: string): number {
  const wall = wallClock(instant, timeZone);
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  // The instant's own milliseconds are not in the wall clock; drop them both sides.
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** "2026-11-23" as its parts, or null when it is not a real day. */
export function parseIsoDate(value: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1) return null;
  if (check.getUTCDate() !== day) return null;

  return { year, month, day };
}

function isoDateOf(year: number, month: number, day: number): string {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.toISOString().slice(0, 10);
}

/** A calendar date moved by whole days. No zone is involved: a date has none. */
export function addDays(isoDate: string, days: number): string {
  const parts = parseIsoDate(isoDate);
  if (!parts) throw new RangeError(`Not a date: ${isoDate}`);
  return isoDateOf(parts.year, parts.month, parts.day + days);
}

/** 0 for Monday to 6 for Sunday. */
export function weekdayIndex(isoDate: string): number {
  const parts = parseIsoDate(isoDate);
  if (!parts) throw new RangeError(`Not a date: ${isoDate}`);
  const sunday0 = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
  return (sunday0 + 6) % 7;
}

/** The Monday on or before a date. */
export function mondayOf(isoDate: string): string {
  return addDays(isoDate, -weekdayIndex(isoDate));
}

/** The local calendar date in `timeZone` at a UTC instant. */
export function localDate(instant: Date, timeZone: string): string {
  const wall = wallClock(instant, timeZone);
  return isoDateOf(wall.year, wall.month, wall.day);
}

/** This week's Monday in `timeZone`, as of `now`. */
export function currentWeekStart(now: Date, timeZone: string): string {
  return mondayOf(localDate(now, timeZone));
}

/**
 * The UTC instant of midnight at the start of `isoDate` in `timeZone`.
 *
 * The zone's offset is read at a first guess and then at the answer it gives;
 * when a clock change falls between the two, the second reading wins. Where
 * midnight itself does not exist (a zone that springs forward at 00:00), the
 * answer is the first minute that does, which is when that day really began.
 */
export function localMidnightToUtc(isoDate: string, timeZone: string): Date {
  const parts = parseIsoDate(isoDate);
  if (!parts) throw new RangeError(`Not a date: ${isoDate}`);

  const zone = safeTimeZone(timeZone);
  const naive = Date.UTC(parts.year, parts.month - 1, parts.day);
  const first = naive - zoneOffsetMs(new Date(naive), zone);
  const second = naive - zoneOffsetMs(new Date(first), zone);
  if (second === first) return new Date(first);

  // The two readings straddle a change. Prefer the one that really is
  // midnight on that date; if neither is (midnight was skipped), take the
  // earlier instant that still falls on the date.
  for (const candidate of [second, first].sort((a, b) => a - b)) {
    const wall = wallClock(new Date(candidate), zone);
    if (wall.hour === 0 && wall.minute === 0 && localDate(new Date(candidate), zone) === isoDate) {
      return new Date(candidate);
    }
  }
  const later = Math.max(first, second);
  return new Date(localDate(new Date(later), zone) === isoDate ? later : Math.min(first, second));
}

/**
 * The week that starts on `weekStart` in `timeZone`, as the two UTC instants
 * a fetch needs: midnight on that Monday and midnight seven days later. Each
 * end is converted on its own, so a week crossing a clock change is the
 * right number of hours long.
 */
export function weekRange(weekStart: string, timeZone: string): { start: Date; end: Date } {
  return {
    start: localMidnightToUtc(weekStart, timeZone),
    end: localMidnightToUtc(addDays(weekStart, 7), timeZone),
  };
}

/**
 * A time on the picture: "7 PM", "7:30 PM" on a 12 hour clock, "19:00" on a
 * 24 hour one. Built from the wall clock rather than a locale's own format,
 * so the spacing and the marks are the same in every browser and in the
 * exporter.
 */
export function formatClock(instant: Date, timeZone: string, hour12: boolean): string {
  const { hour, minute } = wallClock(instant, timeZone);
  return clockText(hour, minute, hour12);
}

export function clockText(hour: number, minute: number, hour12: boolean): string {
  const mm = String(minute).padStart(2, '0');
  if (!hour12) return `${String(hour).padStart(2, '0')}:${mm}`;

  const mark = hour < 12 ? 'AM' : 'PM';
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return minute === 0 ? `${twelve} ${mark}` : `${twelve}:${mm} ${mark}`;
}

/** "Mon 23 Nov": a day as the break line names it, in `timeZone`. */
export function formatShortDate(instant: Date, timeZone: string): string {
  const date = localDate(instant, timeZone);
  const parts = parseIsoDate(date);
  if (!parts) return date;
  return `${WEEKDAY_LABELS[weekdayIndex(date)]} ${parts.day} ${MONTH_LABELS[parts.month - 1]}`;
}

/** "23 Nov": a date on its own, for the week picker. */
export function formatDayMonth(isoDate: string): string {
  const parts = parseIsoDate(isoDate);
  if (!parts) return isoDate;
  return `${parts.day} ${MONTH_LABELS[parts.month - 1]}`;
}

/** Whole days from `from` to `to`, both ISO dates. */
export function daysBetween(from: string, to: string): number {
  const a = parseIsoDate(from);
  const b = parseIsoDate(to);
  if (!a || !b) return Number.NaN;
  return Math.round(
    (Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / DAY_MS,
  );
}
