/**
 * A schedule as a Temporal `ScheduleSpec`: calendar entries in the
 * schedule's own zone. The shapes copy `@temporalio/client`'s types
 * without importing them (this package stays pure); Module 09 hands the
 * object straight to `client.schedule.create`.
 *
 * Temporal has no "last day of the month", so days 29 to 31 list each
 * month's last day separately. February gets both the 28th and the 29th,
 * and a skip entry drops the 28th in leap years (through 2096).
 */

import { timesOfDay } from './next-runs';
import type { ScheduleConfig, Weekday } from './schema';

export type SpecMonth =
  | 'JANUARY'
  | 'FEBRUARY'
  | 'MARCH'
  | 'APRIL'
  | 'MAY'
  | 'JUNE'
  | 'JULY'
  | 'AUGUST'
  | 'SEPTEMBER'
  | 'OCTOBER'
  | 'NOVEMBER'
  | 'DECEMBER';

export type SpecDayOfWeek =
  | 'SUNDAY'
  | 'MONDAY'
  | 'TUESDAY'
  | 'WEDNESDAY'
  | 'THURSDAY'
  | 'FRIDAY'
  | 'SATURDAY';

/** Temporal's `LooseRange`: one value, or a range with an optional step. */
export type SpecRange<T> = T | { start: T; end: T; step: number } | { start: T; end?: T };
export type SpecValue<T> = SpecRange<T> | SpecRange<T>[];

/** Temporal's `CalendarSpec`. Unset second, minute and hour mean 0; the rest mean every. */
export interface CalendarSpecShape {
  second?: SpecValue<number>;
  minute?: SpecValue<number>;
  hour?: SpecValue<number>;
  dayOfMonth?: SpecValue<number>;
  month?: SpecValue<SpecMonth>;
  year?: SpecValue<number>;
  dayOfWeek?: SpecValue<SpecDayOfWeek>;
  comment?: string;
}

/** Temporal's `ScheduleSpec`, the calendar part. */
export interface ScheduleSpecShape {
  calendars: CalendarSpecShape[];
  skip?: CalendarSpecShape[];
  timezone: string;
}

const DAY_OF_WEEK: Readonly<Record<Weekday, SpecDayOfWeek>> = {
  mon: 'MONDAY',
  tue: 'TUESDAY',
  wed: 'WEDNESDAY',
  thu: 'THURSDAY',
  fri: 'FRIDAY',
  sat: 'SATURDAY',
  sun: 'SUNDAY',
};

const LONG_MONTHS: SpecMonth[] = [
  'JANUARY',
  'MARCH',
  'MAY',
  'JULY',
  'AUGUST',
  'OCTOBER',
  'DECEMBER',
];
const SHORT_MONTHS: SpecMonth[] = ['APRIL', 'JUNE', 'SEPTEMBER', 'NOVEMBER'];

/** Leap years ahead; a skip entry for each drops February 28 there. */
export const LEAP_YEARS = { start: 2028, end: 2096, step: 4 } as const;

export function toTemporalScheduleSpec(config: ScheduleConfig): ScheduleSpecShape {
  const timezone = config.timeZone;
  if (config.frequency === 'hourly') {
    const step = config.everyHours ?? 1;
    return { calendars: [{ hour: { start: 0, end: 23, step }, minute: 0 }], timezone };
  }

  const [[hour, minute]] = timesOfDay(config);
  const at = { hour, minute };
  switch (config.frequency) {
    case 'daily':
      return { calendars: [at], timezone };
    case 'weekdays':
      return {
        calendars: [{ ...at, dayOfWeek: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'] }],
        timezone,
      };
    case 'weekly':
      return {
        calendars: [{ ...at, dayOfWeek: (config.days ?? []).map((day) => DAY_OF_WEEK[day]) }],
        timezone,
      };
    case 'monthly': {
      const day = config.dayOfMonth === 'last' ? 31 : (config.dayOfMonth ?? 1);
      if (day <= 28) return { calendars: [{ ...at, dayOfMonth: day }], timezone };
      const calendars: CalendarSpecShape[] =
        day === 31
          ? [
              { ...at, dayOfMonth: 31, month: LONG_MONTHS },
              { ...at, dayOfMonth: 30, month: SHORT_MONTHS },
            ]
          : [{ ...at, dayOfMonth: day, month: [...LONG_MONTHS, ...SHORT_MONTHS] }];
      calendars.push(
        { ...at, dayOfMonth: 29, month: 'FEBRUARY' },
        { ...at, dayOfMonth: 28, month: 'FEBRUARY' },
      );
      return {
        calendars,
        skip: [{ ...at, dayOfMonth: 28, month: 'FEBRUARY', year: { ...LEAP_YEARS } }],
        timezone,
      };
    }
  }
}
