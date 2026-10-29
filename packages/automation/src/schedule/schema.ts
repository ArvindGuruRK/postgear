/**
 * The stored shape of the Schedule trigger's config. The UI never says
 * "cron": a schedule is a frequency plus the fields that frequency needs.
 *
 * Fields that the chosen frequency does not use may stay (switching from
 * Weekly to Daily and back keeps the picked days); the refinement only
 * asks for the fields the frequency needs. Next run times, the plain-words
 * sentence and the Temporal spec live next to this file.
 *
 * The time zone is an IANA name stored on the step itself, because
 * PostGear has no workspace time zone and `User.timezone` is a fixed
 * offset that cannot follow daylight saving (README decision log).
 */
import { z } from 'zod';

export const SCHEDULE_FREQUENCIES = ['hourly', 'daily', 'weekdays', 'weekly', 'monthly'] as const;
export type ScheduleFrequency = (typeof SCHEDULE_FREQUENCIES)[number];

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/**
 * Hourly steps. Only ones that divide a day, so "Every 3 hours" is true
 * across midnight too (every 5 hours would run at 20:00 and then 00:00).
 */
export const HOURLY_STEPS = [1, 2, 3, 4, 6, 8, 12] as const;

/** `HH:mm`, 24 hour. */
export const TIME_OF_DAY_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Shape only (`Area/City`, `UTC`); whether the zone exists is checked where `Intl` is trusted. */
const TIME_ZONE_PATTERN = /^(UTC|[A-Za-z]+(\/[A-Za-z0-9_+-]+){1,2})$/;

/** An IANA time zone name, as Schedule and Add To Queue store it. */
export const timeZoneSchema = z.string().regex(TIME_ZONE_PATTERN, 'Pick a time zone.');

export const scheduleConfigSchema = z
  .object({
    frequency: z.enum(SCHEDULE_FREQUENCIES),
    /** Hourly only: every N hours. */
    everyHours: z
      .number()
      .int()
      .refine((hours) => (HOURLY_STEPS as readonly number[]).includes(hours), {
        message: 'Choose how many hours apart.',
      })
      .optional(),
    /** Every frequency but hourly. */
    time: z.string().regex(TIME_OF_DAY_PATTERN, 'Pick a time.').optional(),
    /** Weekly only. */
    days: z.array(z.enum(WEEKDAYS)).max(7).optional(),
    /** Monthly only; 29 to 31 run on the last day of shorter months. */
    dayOfMonth: z.union([z.number().int().min(1).max(31), z.literal('last')]).optional(),
    timeZone: timeZoneSchema,
  })
  .strict()
  .superRefine((config, issue) => {
    const need = (path: keyof typeof config, message: string) =>
      issue.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });

    if (config.frequency === 'hourly') {
      if (config.everyHours === undefined) need('everyHours', 'Choose how many hours apart.');
      return;
    }
    if (config.time === undefined) need('time', 'Pick a time.');
    if (config.frequency === 'weekly' && !config.days?.length) {
      need('days', 'Pick at least one day.');
    }
    if (config.frequency === 'monthly' && config.dayOfMonth === undefined) {
      need('dayOfMonth', 'Pick a day of the month.');
    }
  });

export type ScheduleConfig = z.infer<typeof scheduleConfigSchema>;
