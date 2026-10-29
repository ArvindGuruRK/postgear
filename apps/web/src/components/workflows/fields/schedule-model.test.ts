import {
  describeSchedule,
  HOURLY_STEPS,
  nextRuns,
  SCHEDULE_FREQUENCIES,
  type ScheduleConfig,
  scheduleConfigSchema,
} from '@postgear/automation';
import {
  asSchedule,
  dayOfMonthChoices,
  FREQUENCY_CHOICES,
  joinTime,
  minuteChoices,
  scheduleFor,
  splitTime,
  timeZoneChoices,
  toggleDay,
  upcomingRuns,
} from './schedule-model';

const parses = (config: ScheduleConfig) => {
  const parsed = scheduleConfigSchema.safeParse(config);
  expect(parsed.success).toBe(true);
  // What the builder writes is exactly what the package reads back.
  if (parsed.success) expect(parsed.data).toEqual(config);
};

describe('schedule builder output', () => {
  it('names every frequency the package has, never the word cron', () => {
    expect(FREQUENCY_CHOICES.map((choice) => choice.value)).toEqual([...SCHEDULE_FREQUENCIES]);
    for (const choice of FREQUENCY_CHOICES) expect(choice.label).not.toMatch(/cron/i);
  });

  it.each(SCHEDULE_FREQUENCIES)('writes a valid %s schedule from anything', (frequency) => {
    for (const from of [{}, { time: '25:99', days: [], everyHours: 5, timeZone: 'Nowhere/Land' }]) {
      const config = scheduleFor(frequency, from as Partial<ScheduleConfig>, 'Asia/Kolkata');
      parses(config);
      expect(config.timeZone).toBe('Asia/Kolkata');
      expect(nextRuns(config, '2026-10-29T00:00:00Z', 3)).toHaveLength(3);
    }
  });

  it('keeps only the fields of the chosen frequency', () => {
    const weekly: ScheduleConfig = {
      frequency: 'weekly',
      days: ['fri', 'mon'],
      time: '18:30',
      timeZone: 'UTC',
    };
    expect(scheduleFor('weekly', weekly, 'UTC')).toEqual({ ...weekly, days: ['mon', 'fri'] });
    expect(scheduleFor('daily', weekly, 'UTC')).toEqual({
      frequency: 'daily',
      time: '18:30',
      timeZone: 'UTC',
    });
    expect(scheduleFor('hourly', weekly, 'UTC')).toEqual({
      frequency: 'hourly',
      everyHours: 1,
      timeZone: 'UTC',
    });
    expect(scheduleFor('monthly', weekly, 'UTC')).toEqual({
      frequency: 'monthly',
      time: '18:30',
      dayOfMonth: 1,
      timeZone: 'UTC',
    });
    for (const step of HOURLY_STEPS) parses(scheduleFor('hourly', { everyHours: step }, 'UTC'));
    parses(scheduleFor('monthly', { dayOfMonth: 'last', time: '07:05' }, 'UTC'));
  });

  it('reads a fresh or broken config as every Monday at 09:00 in the browser zone', () => {
    expect(asSchedule(undefined, 'Europe/London')).toEqual({
      frequency: 'weekly',
      days: ['mon'],
      time: '09:00',
      timeZone: 'Europe/London',
    });
    expect(
      describeSchedule(
        asSchedule({ frequency: 'weekdays', time: '08:15', timeZone: 'UTC' }, 'UTC'),
      ),
    ).toBe('Every weekday at 08:15 (UTC)');
  });

  it('toggles days in week order and never leaves none', () => {
    const config = scheduleFor('weekly', { days: ['wed'] }, 'UTC');
    const more = toggleDay(config, 'mon');
    expect(more.days).toEqual(['mon', 'wed']);
    parses(more);
    expect(toggleDay(scheduleFor('weekly', { days: ['wed'] }, 'UTC'), 'wed').days).toEqual(['wed']);
  });

  it('writes 24 hour times', () => {
    expect(joinTime(7, 5)).toBe('07:05');
    expect(splitTime('23:59')).toEqual([23, 59]);
    expect(splitTime('9am')).toEqual([9, 0]);
    expect(minuteChoices(7)).toContain(7);
    expect(minuteChoices(10)).toHaveLength(12);
    expect(dayOfMonthChoices().at(-1)).toEqual({ value: 'last', label: 'Last day' });
    expect(dayOfMonthChoices()[1].label).toBe('2nd');
    expect(dayOfMonthChoices()[10].label).toBe('11th');
    expect(dayOfMonthChoices()[22].label).toBe('23rd');
  });

  it('lists time zones with their offset, including the stored one', () => {
    const zones = timeZoneChoices(
      'Asia/Kolkata',
      'Europe/London',
      Date.parse('2026-01-15T00:00:00Z'),
    );
    const kolkata = zones.find((zone) => zone.value === 'Asia/Kolkata');
    expect(kolkata?.label).toBe('Asia/Kolkata (UTC+05:30)');
    expect(zones.find((zone) => zone.value === 'UTC')?.label).toBe('UTC');
    expect(zones.some((zone) => zone.value === 'Europe/London')).toBe(true);
  });

  it('tells the next three runs in the schedule zone', () => {
    const config: ScheduleConfig = { frequency: 'daily', time: '09:00', timeZone: 'Asia/Kolkata' };
    const runs = upcomingRuns(config, '2026-11-02T00:00:00Z', 'en-GB');
    expect(runs).toHaveLength(3);
    expect(runs[0]).toContain('09:00');
    expect(runs[0]).toContain('2 November');
  });
});
