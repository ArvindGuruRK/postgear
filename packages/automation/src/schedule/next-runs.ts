/**
 * When a Schedule runs next, in its own time zone, daylight saving
 * included. Wall clock times are found day by day in the zone and turned
 * into instants with `zonedToEpoch`, so "every day at 09:00" stays 09:00
 * when London changes its clocks. A time the clocks skip moves forward by
 * the gap; a time that happens twice runs once, the first time.
 */
import {
  civilFromDays,
  daysFromCivil,
  daysInMonth,
  parseIsoDate,
  toIsoString,
  weekdayOfDays,
} from '../time/calendar';
import { isValidTimeZone, zonedTime, zonedToEpoch } from '../time/zone';
import { type ScheduleConfig, scheduleConfigSchema, type Weekday } from './schema';

export const WEEKDAY_INDEX: Readonly<Record<Weekday, number>> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

/** Search at most this far ahead (a monthly schedule needs about 4 years for 50 runs). */
const MAX_DAYS = 366 * 5;
const MAX_COUNT = 50;

/** The day of the month a monthly schedule runs on in a given month. */
export function monthlyDay(dayOfMonth: number | 'last', year: number, month: number): number {
  const last = daysInMonth(year, month);
  return dayOfMonth === 'last' ? last : Math.min(dayOfMonth, last);
}

/** The wall clock times (hour, minute) a schedule runs at on a day it runs. */
export function timesOfDay(config: ScheduleConfig): [number, number][] {
  if (config.frequency === 'hourly') {
    const step = config.everyHours ?? 1;
    const times: [number, number][] = [];
    for (let hour = 0; hour < 24; hour += step) times.push([hour, 0]);
    return times;
  }
  const [hour, minute] = (config.time ?? '09:00').split(':').map(Number);
  return [[hour, minute]];
}

function runsOn(config: ScheduleConfig, days: number): boolean {
  const weekday = weekdayOfDays(days);
  switch (config.frequency) {
    case 'hourly':
    case 'daily':
      return true;
    case 'weekdays':
      return weekday >= 1 && weekday <= 5;
    case 'weekly':
      return (config.days ?? []).some((day) => WEEKDAY_INDEX[day] === weekday);
    case 'monthly': {
      const date = civilFromDays(days);
      return date.day === monthlyDay(config.dayOfMonth ?? 1, date.year, date.month);
    }
  }
}

/**
 * The next `count` run times strictly after `fromIso`, as ISO instants
 * (`2026-11-03T03:30:00.000Z`). An unfinished config, an unknown zone or
 * an unreadable start gives an empty list.
 */
export function nextRuns(config: ScheduleConfig, fromIso: string, count = 3): string[] {
  if (!scheduleConfigSchema.safeParse(config).success) return [];
  if (!isValidTimeZone(config.timeZone)) return [];
  const from = parseIsoDate(fromIso);
  if (from === undefined) return [];
  const wanted = Math.max(1, Math.min(MAX_COUNT, Math.floor(count)));

  const runs: number[] = [];
  const firstDay = daysFromCivil(zonedTime(from, config.timeZone));
  const times = timesOfDay(config);
  for (let days = firstDay; days < firstDay + MAX_DAYS && runs.length < wanted; days++) {
    if (!runsOn(config, days)) continue;
    const date = civilFromDays(days);
    for (const [hour, minute] of times) {
      const at = zonedToEpoch({ ...date, hour, minute, second: 0 }, config.timeZone);
      // Skipped hours move onto the next one; never list the same instant twice.
      if (at <= from || (runs.length > 0 && at <= runs[runs.length - 1])) continue;
      runs.push(at);
      if (runs.length === wanted) break;
    }
  }
  return runs.map(toIsoString);
}

/**
 * The shortest time between two runs, in minutes: what the AI frequency
 * rule checks. Every frequency but hourly runs at most once a day.
 */
export function scheduleIntervalMinutes(config: ScheduleConfig): number {
  return config.frequency === 'hourly' ? (config.everyHours ?? 1) * 60 : 24 * 60;
}
