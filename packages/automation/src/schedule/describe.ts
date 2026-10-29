/**
 * A schedule in plain words, never "cron": "Every Monday at 08:00
 * (Asia/Kolkata)", "Every 2 hours", "On the last day of every month at
 * 18:00".
 */
import type { ScheduleConfig, Weekday } from './schema';

export const DAY_NAMES: Readonly<Record<Weekday, string>> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
};

const WEEK_ORDER: readonly Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

/** 1st, 2nd, 3rd, 4th, 11th, 12th, 13th, 21st, 22nd, 23rd, 31st. */
export function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teen ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10];
  return `${n}${suffix ?? 'th'}`;
}

/** "Monday", "Monday and Friday", "Monday, Wednesday and Friday". */
export function listWords(words: readonly string[]): string {
  if (words.length <= 1) return words[0] ?? '';
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

function weeklyWords(days: readonly Weekday[]): string {
  const unique = WEEK_ORDER.filter((day) => days.includes(day));
  if (unique.length === 7) return 'Every day';
  if (unique.length === 5 && !unique.includes('sat') && !unique.includes('sun')) {
    return 'Every weekday';
  }
  if (unique.length === 0) return 'Every week';
  return `Every ${listWords(unique.map((day) => DAY_NAMES[day]))}`;
}

/** "Asia/Kolkata", "America/New York". */
export function zoneWords(timeZone: string): string {
  return timeZone.replace(/_/g, ' ');
}

export interface DescribeScheduleOptions {
  /** Add the zone after the time. Default true; card summaries leave it out. */
  timeZone?: boolean;
}

export function describeSchedule(
  config: ScheduleConfig,
  options: DescribeScheduleOptions = {},
): string {
  if (config.frequency === 'hourly') {
    const step = config.everyHours ?? 1;
    return step === 1 ? 'Every hour' : `Every ${step} hours`;
  }
  const time = config.time ?? '09:00';
  const zone = options.timeZone === false ? '' : ` (${zoneWords(config.timeZone)})`;
  let when: string;
  switch (config.frequency) {
    case 'daily':
      when = 'Every day';
      break;
    case 'weekdays':
      when = 'Every weekday';
      break;
    case 'weekly':
      when = weeklyWords(config.days ?? []);
      break;
    case 'monthly': {
      const day = config.dayOfMonth ?? 1;
      when =
        day === 'last' ? 'On the last day of every month' : `On the ${ordinal(day)} of every month`;
      break;
    }
  }
  return `${when} at ${time}${zone}`;
}

/** Extra lines the Schedule panel shows under the sentence. */
export function scheduleNotes(config: ScheduleConfig): string[] {
  const day = config.dayOfMonth;
  if (config.frequency === 'monthly' && typeof day === 'number' && day >= 29) {
    return [`Months without a ${ordinal(day)} run on their last day.`];
  }
  return [];
}
