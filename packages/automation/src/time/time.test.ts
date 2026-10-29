import {
  civilFromDays,
  daysFromCivil,
  daysInMonth,
  epochToCivil,
  isLeapYear,
  parseIsoDate,
  toIsoString,
  weekdayOfDays,
} from './calendar';
import { formatDate } from './format';
import { isValidTimeZone, offsetMinutes, zonedTime, zonedToEpoch } from './zone';

describe('calendar maths', () => {
  it('counts days the way Date.UTC does, both ways', () => {
    for (const [year, month, day] of [
      [1970, 1, 1],
      [2000, 2, 29],
      [2026, 11, 3],
      [2100, 3, 1],
      [1969, 12, 31],
    ]) {
      const days = daysFromCivil({ year, month, day });
      expect(days * 86_400_000).toBe(Date.UTC(year, month - 1, day));
      expect(civilFromDays(days)).toEqual({ year, month, day });
    }
  });

  it('knows weekdays, leap years and month lengths', () => {
    expect(weekdayOfDays(daysFromCivil({ year: 2026, month: 11, day: 3 }))).toBe(2);
    expect([isLeapYear(2028), isLeapYear(2100), isLeapYear(2000)]).toEqual([true, false, true]);
    expect([daysInMonth(2026, 2), daysInMonth(2028, 2), daysInMonth(2026, 4)]).toEqual([
      28, 29, 30,
    ]);
  });

  it('reads ISO dates with offsets and refuses impossible ones', () => {
    expect(parseIsoDate('2026-11-03')).toBe(Date.UTC(2026, 10, 3));
    expect(parseIsoDate('2026-11-03T09:30:00Z')).toBe(Date.UTC(2026, 10, 3, 9, 30));
    expect(parseIsoDate('2026-11-03T15:00:00+05:30')).toBe(Date.UTC(2026, 10, 3, 9, 30));
    expect(parseIsoDate('2026-11-03T09:30:00.123456Z')).toBe(Date.UTC(2026, 10, 3, 9, 30, 0, 123));
    expect(parseIsoDate('2026-02-30')).toBeUndefined();
    expect(parseIsoDate('2026-11-03T24:00')).toBeUndefined();
    expect(parseIsoDate('3 Nov 2026')).toBeUndefined();
  });

  it('writes ISO text exactly like toISOString', () => {
    const ms = Date.UTC(2026, 10, 3, 9, 5, 7, 42);
    expect(toIsoString(ms)).toBe(new Date(ms).toISOString());
    expect(epochToCivil(ms)).toMatchObject({ hour: 9, minute: 5, second: 7, ms: 42 });
  });
});

describe('time zones', () => {
  it('knows real zones only', () => {
    expect(isValidTimeZone('Asia/Kolkata')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
  });

  it('gives the wall clock and offset at an instant', () => {
    const ms = Date.UTC(2026, 10, 3, 9, 0);
    expect(zonedTime(ms, 'Asia/Kolkata')).toMatchObject({ hour: 14, minute: 30, weekday: 2 });
    expect(offsetMinutes(ms, 'Asia/Kolkata')).toBe(330);
    expect(offsetMinutes(ms, 'America/New_York')).toBe(-300);
    expect(offsetMinutes(Date.UTC(2026, 6, 1), 'Europe/London')).toBe(60);
  });

  it('finds the instant of a wall clock time, across daylight saving', () => {
    const wall = (month: number, day: number, hour: number, minute = 0) => ({
      year: 2026,
      month,
      day,
      hour,
      minute,
      second: 0,
    });
    expect(zonedToEpoch(wall(7, 1, 9), 'Europe/London')).toBe(Date.UTC(2026, 6, 1, 8));
    expect(zonedToEpoch(wall(3, 29, 1, 30), 'Europe/London')).toBe(Date.UTC(2026, 2, 29, 1, 30));
    expect(zonedToEpoch(wall(10, 25, 1, 30), 'Europe/London')).toBe(Date.UTC(2026, 9, 25, 0, 30));
  });
});

describe('the date format', () => {
  const ms = Date.UTC(2026, 10, 3, 21, 5, 9);

  it('writes the pattern letters people know from spreadsheets', () => {
    expect(formatDate(ms, 'yyyy-MM-dd HH:mm:ss')).toBe('2026-11-03 21:05:09');
    expect(formatDate(ms, 'EEEE, d MMMM yy')).toBe('Tuesday, 3 November 26');
    expect(formatDate(ms, 'EEE d MMM, h:mm a')).toBe('Tue 3 Nov, 9:05 PM');
    expect(formatDate(ms, 'M/d hh')).toBe('11/3 09');
  });

  it('keeps quoted words and an escaped quote as written', () => {
    expect(formatDate(ms, "d MMM 'at' H:mm ''")).toBe("3 Nov at 21:05 '");
  });

  it('writes the date in the zone it is given', () => {
    expect(formatDate(ms, 'yyyy-MM-dd HH:mm', 'Asia/Kolkata')).toBe('2026-11-04 02:35');
  });
});
