/**
 * Time zones through `Intl` (no zone database shipped, no `Date`): the
 * runtime already knows every IANA zone and its daylight saving rules,
 * in browsers, Node and Temporal's sandbox alike.
 */
import {
  type CivilDateTime,
  civilToEpoch,
  daysFromCivil,
  MS_PER_DAY,
  MS_PER_MINUTE,
  weekdayOfDays,
} from './calendar';

const FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = FORMATTERS.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    FORMATTERS.set(timeZone, formatter);
  }
  return formatter;
}

/** True for a zone the runtime knows (`Asia/Kolkata`, `UTC`). */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
}

export interface ZonedTime extends CivilDateTime {
  /** 0 is Sunday. */
  weekday: number;
}

/** The wall clock in `timeZone` at an instant. */
export function zonedTime(epochMs: number, timeZone: string): ZonedTime {
  const parts: Record<string, number> = {};
  for (const part of formatterFor(timeZone).formatToParts(epochMs)) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  const time = {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    // Some engines still print midnight as 24 under h23.
    hour: parts.hour % 24,
    minute: parts.minute,
    second: parts.second,
  };
  return { ...time, weekday: weekdayOfDays(daysFromCivil(time)) };
}

/** Minutes the zone is ahead of UTC at an instant (+330 for Asia/Kolkata). */
export function offsetMinutes(epochMs: number, timeZone: string): number {
  const wall = civilToEpoch(zonedTime(epochMs, timeZone));
  const whole = epochMs - (((epochMs % 1_000) + 1_000) % 1_000);
  return Math.round((wall - whole) / MS_PER_MINUTE);
}

/**
 * The instant a wall clock time happens in `timeZone`. When the clocks go
 * forward and that time never happens (01:30 in London on the last Sunday
 * of March), it moves forward by the gap (02:30). When they go back and it
 * happens twice, the first one wins.
 */
export function zonedToEpoch(time: CivilDateTime, timeZone: string): number {
  const wall = civilToEpoch(time);
  const before = offsetMinutes(wall - MS_PER_DAY, timeZone);
  const after = offsetMinutes(wall + MS_PER_DAY, timeZone);
  const fits = [before, after]
    .map((offset) => wall - offset * MS_PER_MINUTE)
    .filter((epoch) => civilToEpoch(zonedTime(epoch, timeZone)) === wall)
    .sort((a, b) => a - b);
  return fits[0] ?? wall - before * MS_PER_MINUTE;
}
