import {
  civilFromDays,
  daysFromCivil,
  parseIsoDate,
  toIsoString,
  weekdayOfDays,
} from '../time/calendar';
import { zonedTime, zonedToEpoch } from '../time/zone';
import { describeSchedule, ordinal, scheduleNotes } from './describe';
import { nextRuns, scheduleIntervalMinutes } from './next-runs';
import type { ScheduleConfig } from './schema';
import { type CalendarSpecShape, type SpecValue, toTemporalScheduleSpec } from './temporal-spec';

const daily = (time: string, timeZone: string): ScheduleConfig => ({
  frequency: 'daily',
  time,
  timeZone,
});

describe('next run times', () => {
  it('a daily 09:00 in London stays 09:00 when the clocks go forward in March', () => {
    expect(nextRuns(daily('09:00', 'Europe/London'), '2026-03-27T12:00:00Z', 3)).toEqual([
      '2026-03-28T09:00:00.000Z',
      '2026-03-29T08:00:00.000Z',
      '2026-03-30T08:00:00.000Z',
    ]);
  });

  it('a daily 09:00 in London stays 09:00 when the clocks go back in October', () => {
    expect(nextRuns(daily('09:00', 'Europe/London'), '2026-10-24T12:00:00Z', 2)).toEqual([
      '2026-10-25T09:00:00.000Z',
      '2026-10-26T09:00:00.000Z',
    ]);
  });

  it('a time the clocks skip moves forward by the gap', () => {
    // 01:30 does not happen in London on 29 March 2026; it runs at 02:30 summer time.
    expect(nextRuns(daily('01:30', 'Europe/London'), '2026-03-28T12:00:00Z', 2)).toEqual([
      '2026-03-29T01:30:00.000Z',
      '2026-03-30T00:30:00.000Z',
    ]);
  });

  it('a time that happens twice when the clocks go back runs once, the first time', () => {
    expect(nextRuns(daily('01:30', 'Europe/London'), '2026-10-24T12:00:00Z', 2)).toEqual([
      '2026-10-25T00:30:00.000Z',
      '2026-10-26T01:30:00.000Z',
    ]);
  });

  it('every Monday at 09:00 in New York follows its own daylight saving dates', () => {
    const config: ScheduleConfig = {
      frequency: 'weekly',
      days: ['mon'],
      time: '09:00',
      timeZone: 'America/New_York',
    };
    expect(nextRuns(config, '2026-03-01T00:00:00Z', 2)).toEqual([
      '2026-03-02T14:00:00.000Z',
      '2026-03-09T13:00:00.000Z',
    ]);
    expect(nextRuns(config, '2026-10-26T00:00:00Z', 2)).toEqual([
      '2026-10-26T13:00:00.000Z',
      '2026-11-02T14:00:00.000Z',
    ]);
  });

  it('every Monday at 08:00 in Kolkata runs at 02:30 UTC (a half-hour zone)', () => {
    const config: ScheduleConfig = {
      frequency: 'weekly',
      days: ['mon'],
      time: '08:00',
      timeZone: 'Asia/Kolkata',
    };
    expect(nextRuns(config, '2026-11-01T00:00:00Z', 3)).toEqual([
      '2026-11-02T02:30:00.000Z',
      '2026-11-09T02:30:00.000Z',
      '2026-11-16T02:30:00.000Z',
    ]);
  });

  it('a monthly 31st runs on the last day of shorter months, February included', () => {
    const config: ScheduleConfig = {
      frequency: 'monthly',
      dayOfMonth: 31,
      time: '18:00',
      timeZone: 'UTC',
    };
    expect(nextRuns(config, '2026-01-01T00:00:00Z', 4)).toEqual([
      '2026-01-31T18:00:00.000Z',
      '2026-02-28T18:00:00.000Z',
      '2026-03-31T18:00:00.000Z',
      '2026-04-30T18:00:00.000Z',
    ]);
    expect(nextRuns(config, '2028-02-01T00:00:00Z', 1)).toEqual(['2028-02-29T18:00:00.000Z']);
  });

  it('"last day of the month" is the 28th, 29th, 30th or 31st as the month needs', () => {
    const config: ScheduleConfig = {
      frequency: 'monthly',
      dayOfMonth: 'last',
      time: '18:00',
      timeZone: 'UTC',
    };
    expect(nextRuns(config, '2027-12-15T00:00:00Z', 3)).toEqual([
      '2027-12-31T18:00:00.000Z',
      '2028-01-31T18:00:00.000Z',
      '2028-02-29T18:00:00.000Z',
    ]);
  });

  it('every weekday skips Saturday and Sunday', () => {
    const config: ScheduleConfig = { frequency: 'weekdays', time: '09:00', timeZone: 'UTC' };
    // 6 November 2026 is a Friday.
    expect(nextRuns(config, '2026-11-06T10:00:00Z', 2)).toEqual([
      '2026-11-09T09:00:00.000Z',
      '2026-11-10T09:00:00.000Z',
    ]);
  });

  it('every 6 hours runs at 00:00, 06:00, 12:00 and 18:00', () => {
    const config: ScheduleConfig = { frequency: 'hourly', everyHours: 6, timeZone: 'UTC' };
    expect(nextRuns(config, '2026-11-03T05:00:00Z', 4)).toEqual([
      '2026-11-03T06:00:00.000Z',
      '2026-11-03T12:00:00.000Z',
      '2026-11-03T18:00:00.000Z',
      '2026-11-04T00:00:00.000Z',
    ]);
  });

  it('every hour never runs twice in the hour the clocks skip', () => {
    const config: ScheduleConfig = {
      frequency: 'hourly',
      everyHours: 1,
      timeZone: 'Europe/London',
    };
    expect(nextRuns(config, '2026-03-29T00:00:00Z', 3)).toEqual([
      '2026-03-29T01:00:00.000Z',
      '2026-03-29T02:00:00.000Z',
      '2026-03-29T03:00:00.000Z',
    ]);
  });

  it('lists only times after the start, never the start itself', () => {
    expect(nextRuns(daily('09:00', 'UTC'), '2026-11-03T09:00:00Z', 1)).toEqual([
      '2026-11-04T09:00:00.000Z',
    ]);
  });

  it('gives no times for an unfinished schedule, an unknown zone or a bad start', () => {
    expect(nextRuns({ frequency: 'daily', timeZone: 'UTC' }, '2026-11-03T00:00:00Z')).toEqual([]);
    expect(nextRuns(daily('09:00', 'Mars/Olympus'), '2026-11-03T00:00:00Z')).toEqual([]);
    expect(nextRuns(daily('09:00', 'UTC'), 'tomorrow')).toEqual([]);
  });

  it('runs every hour at most as often as every hour', () => {
    expect(scheduleIntervalMinutes({ frequency: 'hourly', everyHours: 2, timeZone: 'UTC' })).toBe(
      120,
    );
    expect(scheduleIntervalMinutes(daily('09:00', 'UTC'))).toBe(1440);
  });
});

describe('the schedule sentence', () => {
  it('reads like a person would say it', () => {
    expect(
      describeSchedule({
        frequency: 'weekly',
        days: ['mon'],
        time: '08:00',
        timeZone: 'Asia/Kolkata',
      }),
    ).toBe('Every Monday at 08:00 (Asia/Kolkata)');
    expect(describeSchedule({ frequency: 'hourly', everyHours: 2, timeZone: 'UTC' })).toBe(
      'Every 2 hours',
    );
    expect(describeSchedule({ frequency: 'hourly', everyHours: 1, timeZone: 'UTC' })).toBe(
      'Every hour',
    );
    expect(
      describeSchedule(
        { frequency: 'monthly', dayOfMonth: 'last', time: '18:00', timeZone: 'UTC' },
        { timeZone: false },
      ),
    ).toBe('On the last day of every month at 18:00');
    expect(
      describeSchedule({ frequency: 'monthly', dayOfMonth: 22, time: '07:15', timeZone: 'UTC' }),
    ).toBe('On the 22nd of every month at 07:15 (UTC)');
  });

  it('names picked days, and calls Monday to Friday "every weekday"', () => {
    const weekly = (days: ScheduleConfig['days']) =>
      describeSchedule(
        { frequency: 'weekly', days, time: '09:00', timeZone: 'America/New_York' },
        { timeZone: false },
      );
    expect(weekly(['fri', 'mon', 'wed'])).toBe('Every Monday, Wednesday and Friday at 09:00');
    expect(weekly(['mon', 'tue', 'wed', 'thu', 'fri'])).toBe('Every weekday at 09:00');
    expect(weekly(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])).toBe('Every day at 09:00');
    expect(
      describeSchedule({ frequency: 'daily', time: '09:00', timeZone: 'America/New_York' }),
    ).toBe('Every day at 09:00 (America/New York)');
  });

  it('warns that the 29th to the 31st move to the last day in shorter months', () => {
    expect(
      scheduleNotes({ frequency: 'monthly', dayOfMonth: 31, time: '09:00', timeZone: 'UTC' }),
    ).toEqual(['Months without a 31st run on their last day.']);
    expect(
      scheduleNotes({ frequency: 'monthly', dayOfMonth: 28, time: '09:00', timeZone: 'UTC' }),
    ).toEqual([]);
  });

  it('writes ordinals the English way', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 31].map(ordinal)).toEqual([
      '1st',
      '2nd',
      '3rd',
      '4th',
      '11th',
      '12th',
      '13th',
      '21st',
      '22nd',
      '23rd',
      '31st',
    ]);
  });
});

const MONTHS = [
  'JANUARY',
  'FEBRUARY',
  'MARCH',
  'APRIL',
  'MAY',
  'JUNE',
  'JULY',
  'AUGUST',
  'SEPTEMBER',
  'OCTOBER',
  'NOVEMBER',
  'DECEMBER',
];
const DAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];

/** Whether a value matches a Temporal calendar field (unset means "every"). */
function matches<T extends string | number>(
  spec: SpecValue<T> | undefined,
  value: T,
  unset: T | '*',
): boolean {
  if (spec === undefined) return unset === '*' || unset === value;
  const ranges = Array.isArray(spec) ? spec : [spec];
  return ranges.some((range) => {
    if (typeof range !== 'object') return range === value;
    const order = (v: T) =>
      typeof v === 'number' ? v : Math.max(MONTHS.indexOf(v), DAYS.indexOf(v));
    const start = order(range.start);
    const end = order(range.end ?? range.start);
    const step = 'step' in range ? range.step : 1;
    const at = order(value);
    return at >= start && at <= end && (at - start) % step === 0;
  });
}

/** A tiny stand-in for Temporal: the spec's times, found day by day in its zone. */
function specTimes(config: ScheduleConfig, from: string, count: number): string[] {
  const spec = toTemporalScheduleSpec(config);
  const start = parseIsoDate(from) as number;
  const found: number[] = [];
  const first = daysFromCivil(zonedTime(start, spec.timezone));
  const fits = (
    calendar: CalendarSpecShape,
    day: ReturnType<typeof civilFromDays>,
    weekday: number,
    hour: number,
    minute: number,
  ) =>
    matches(calendar.year, day.year, '*') &&
    matches(calendar.month, MONTHS[day.month - 1], '*') &&
    matches(calendar.dayOfMonth, day.day, '*') &&
    matches(calendar.dayOfWeek, DAYS[weekday], '*') &&
    matches(calendar.hour, hour, 0) &&
    matches(calendar.minute, minute, 0);
  for (let days = first; days < first + 366 * 5 && found.length < count; days++) {
    const day = civilFromDays(days);
    const weekday = weekdayOfDays(days);
    for (let hour = 0; hour < 24; hour++) {
      for (const minute of [0, 15, 30, 45]) {
        const wanted = spec.calendars.some((c) => fits(c, day, weekday, hour, minute));
        const skipped = (spec.skip ?? []).some((c) => fits(c, day, weekday, hour, minute));
        if (!wanted || skipped) continue;
        const at = zonedToEpoch({ ...day, hour, minute, second: 0 }, spec.timezone);
        if (at > start && (found.length === 0 || at > found[found.length - 1])) found.push(at);
      }
    }
  }
  return found.slice(0, count).map(toIsoString);
}

describe('the Temporal schedule spec', () => {
  it.each<[string, ScheduleConfig]>([
    ['every 3 hours', { frequency: 'hourly', everyHours: 3, timeZone: 'Asia/Kolkata' }],
    ['every day', daily('07:45', 'Europe/London')],
    ['every weekday', { frequency: 'weekdays', time: '09:00', timeZone: 'America/New_York' }],
    [
      'Monday and Thursday',
      { frequency: 'weekly', days: ['mon', 'thu'], time: '18:30', timeZone: 'UTC' },
    ],
    ['the 15th', { frequency: 'monthly', dayOfMonth: 15, time: '09:00', timeZone: 'UTC' }],
    ['the 29th', { frequency: 'monthly', dayOfMonth: 29, time: '09:00', timeZone: 'UTC' }],
    ['the 30th', { frequency: 'monthly', dayOfMonth: 30, time: '09:00', timeZone: 'UTC' }],
    [
      'the 31st',
      { frequency: 'monthly', dayOfMonth: 31, time: '09:00', timeZone: 'Europe/London' },
    ],
    [
      'the last day',
      { frequency: 'monthly', dayOfMonth: 'last', time: '23:45', timeZone: 'Asia/Kolkata' },
    ],
  ])('runs at the same times as the preview for %s', (_name, config) => {
    const from = '2026-11-03T10:00:00Z';
    const count = config.frequency === 'monthly' ? 50 : 20;
    expect(specTimes(config, from, count)).toEqual(nextRuns(config, from, count));
  });

  it('is a plain object in the schedule zone', () => {
    expect(toTemporalScheduleSpec(daily('09:30', 'Asia/Kolkata'))).toEqual({
      calendars: [{ hour: 9, minute: 30 }],
      timezone: 'Asia/Kolkata',
    });
    expect(toTemporalScheduleSpec({ frequency: 'hourly', everyHours: 4, timeZone: 'UTC' })).toEqual(
      {
        calendars: [{ hour: { start: 0, end: 23, step: 4 }, minute: 0 }],
        timezone: 'UTC',
      },
    );
  });
});
