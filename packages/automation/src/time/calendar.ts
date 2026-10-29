/**
 * Calendar maths without `Date` objects: days since 1970-01-01 to a
 * year, month and day and back, ISO parsing and printing. Pure integer
 * arithmetic, so it gives the same answer in the browser, the API and
 * Temporal's sandbox.
 */

export const MS_PER_MINUTE = 60_000;
export const MS_PER_DAY = 86_400_000;

export interface CivilDate {
  year: number;
  /** 1 to 12. */
  month: number;
  /** 1 to 31. */
  day: number;
}

export interface CivilDateTime extends CivilDate {
  hour: number;
  minute: number;
  second: number;
}

/** Days since 1970-01-01 for a calendar date (proleptic Gregorian). */
export function daysFromCivil({ year, month, day }: CivilDate): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yearOfEra = y - era * 400;
  const dayOfYear = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const dayOfEra =
    yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146_097 + dayOfEra - 719_468;
}

/** The calendar date `days` after 1970-01-01. */
export function civilFromDays(days: number): CivilDate {
  const z = days + 719_468;
  const era = Math.floor(z / 146_097);
  const dayOfEra = z - era * 146_097;
  const yearOfEra = Math.floor(
    (dayOfEra -
      Math.floor(dayOfEra / 1_460) +
      Math.floor(dayOfEra / 36_524) -
      Math.floor(dayOfEra / 146_096)) /
      365,
  );
  const dayOfYear =
    dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const mp = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  return { year: yearOfEra + era * 400 + (month <= 2 ? 1 : 0), month, day };
}

/** 0 is Sunday, 6 is Saturday (1970-01-01 was a Thursday). */
export function weekdayOfDays(days: number): number {
  return (((days + 4) % 7) + 7) % 7;
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** Milliseconds since the epoch for a wall time read as UTC. */
export function civilToEpoch(time: CivilDateTime, ms = 0): number {
  return (
    daysFromCivil(time) * MS_PER_DAY +
    ((time.hour * 60 + time.minute) * 60 + time.second) * 1_000 +
    ms
  );
}

/** The UTC wall time of an instant. */
export function epochToCivil(epochMs: number): CivilDateTime & { ms: number } {
  const days = Math.floor(epochMs / MS_PER_DAY);
  const rest = epochMs - days * MS_PER_DAY;
  const seconds = Math.floor(rest / 1_000);
  return {
    ...civilFromDays(days),
    hour: Math.floor(seconds / 3_600),
    minute: Math.floor((seconds % 3_600) / 60),
    second: seconds % 60,
    ms: rest - seconds * 1_000,
  };
}

const pad = (value: number, width = 2) => String(value).padStart(width, '0');

/** `2026-11-03T09:00:00.000Z`, the same text `Date.prototype.toISOString` gives. */
export function toIsoString(epochMs: number): string {
  const t = epochToCivil(epochMs);
  return `${pad(t.year, 4)}-${pad(t.month)}-${pad(t.day)}T${pad(t.hour)}:${pad(t.minute)}:${pad(t.second)}.${pad(t.ms, 3)}Z`;
}

const ISO =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:?\d{2})?)?$/i;

/**
 * Milliseconds since the epoch for an ISO date (`2026-11-03`) or date and
 * time (`2026-11-03T09:00:00Z`, `+05:30` offsets too). A time without an
 * offset is read as UTC. Anything else, including impossible dates like
 * February 30, gives `undefined`: never a guess.
 */
export function parseIsoDate(text: string): number | undefined {
  const match = ISO.exec(text.trim());
  if (!match) return undefined;
  const [, y, mo, d, h = '0', mi = '0', s = '0', fraction = '', zone] = match;
  const time = {
    year: Number(y),
    month: Number(mo),
    day: Number(d),
    hour: Number(h),
    minute: Number(mi),
    second: Number(s),
  };
  if (time.month < 1 || time.month > 12) return undefined;
  if (time.day < 1 || time.day > daysInMonth(time.year, time.month)) return undefined;
  if (time.hour > 23 || time.minute > 59 || time.second > 59) return undefined;
  const ms = fraction ? Number(fraction.slice(0, 3).padEnd(3, '0')) : 0;
  let offsetMinutes = 0;
  if (zone && zone.toUpperCase() !== 'Z') {
    const digits = zone.replace(':', '');
    const hours = Number(digits.slice(1, 3));
    const minutes = Number(digits.slice(3, 5));
    if (hours > 23 || minutes > 59) return undefined;
    offsetMinutes = (digits[0] === '-' ? -1 : 1) * (hours * 60 + minutes);
  }
  return civilToEpoch(time, ms) - offsetMinutes * MS_PER_MINUTE;
}
