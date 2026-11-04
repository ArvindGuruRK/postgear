/**
 * The schedule builder's rules as pure functions (Module 06): turning a
 * stored Schedule config into the builder's choices and every choice back
 * into a config that `scheduleConfigSchema` accepts, the time zone list,
 * and the next runs in words. No React, so each rule is unit tested.
 */
import {
  DAY_NAMES,
  HOURLY_STEPS,
  isValidTimeZone,
  nextRuns,
  offsetMinutes,
  SCHEDULE_FREQUENCIES,
  type ScheduleConfig,
  type ScheduleFrequency,
  TIME_OF_DAY_PATTERN,
  WEEKDAYS,
  type Weekday,
  zoneWords,
} from '@postgear/automation';
import type { SummaryBoxRow } from '@postgear/ui';

export const FREQUENCY_CHOICES: readonly { value: ScheduleFrequency; label: string }[] = [
  { value: 'hourly', label: 'Hourly' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekdays', label: 'Weekdays' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
];

export const DEFAULT_TIME = '09:00';

/** Three letter day names for the day chips. */
export const DAY_SHORT: Readonly<Record<Weekday, string>> = {
  mon: 'Mon',
  tue: 'Tue',
  wed: 'Wed',
  thu: 'Thu',
  fri: 'Fri',
  sat: 'Sat',
  sun: 'Sun',
};

export { DAY_NAMES };

function isFrequency(value: unknown): value is ScheduleFrequency {
  return (SCHEDULE_FREQUENCIES as readonly unknown[]).includes(value);
}

/**
 * The config for one frequency, with only the fields that frequency uses:
 * switching from Weekly to Daily drops the days, and anything the
 * new frequency needs gets a default (09:00, Monday, the 1st, every hour).
 */
export function scheduleFor(
  frequency: ScheduleFrequency,
  from: Partial<ScheduleConfig>,
  fallbackZone: string,
): ScheduleConfig {
  const timeZone = from.timeZone && isValidTimeZone(from.timeZone) ? from.timeZone : fallbackZone;
  if (frequency === 'hourly') {
    const everyHours = (HOURLY_STEPS as readonly number[]).includes(from.everyHours ?? -1)
      ? (from.everyHours as number)
      : 1;
    return { frequency, everyHours, timeZone };
  }
  const time = from.time && TIME_OF_DAY_PATTERN.test(from.time) ? from.time : DEFAULT_TIME;
  if (frequency === 'weekly') {
    const days = sortDays((from.days ?? []).filter((day) => WEEKDAYS.includes(day)));
    return { frequency, time, days: days.length ? days : ['mon'], timeZone };
  }
  if (frequency === 'monthly') {
    const day = from.dayOfMonth;
    const dayOfMonth =
      day === 'last' || (typeof day === 'number' && day >= 1 && day <= 31) ? day : 1;
    return { frequency, time, dayOfMonth, timeZone };
  }
  return { frequency, time, timeZone };
}

/**
 * A stored config as the builder shows it. A config that is not a schedule
 * yet (a fresh step, a broken save) reads as every Monday at 09:00 in
 * `fallbackZone`, the browser's zone.
 */
export function asSchedule(value: unknown, fallbackZone: string): ScheduleConfig {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Partial<ScheduleConfig>;
  const frequency = isFrequency(raw.frequency) ? raw.frequency : 'weekly';
  return scheduleFor(frequency, raw, fallbackZone);
}

/** Days in week order, each once. */
export function sortDays(days: readonly Weekday[]): Weekday[] {
  return WEEKDAYS.filter((day) => days.includes(day));
}

/** The weekly config with `day` turned on or off; the last day stays on. */
export function toggleDay(config: ScheduleConfig, day: Weekday): ScheduleConfig {
  const days = config.days ?? [];
  const next = days.includes(day) ? days.filter((d) => d !== day) : [...days, day];
  if (next.length === 0) return config;
  return { ...config, days: sortDays(next) };
}

/** "1st", "2nd", ... "31st" and "Last day" for Monthly. */
export function dayOfMonthChoices(): { value: string; label: string }[] {
  const choices = Array.from({ length: 31 }, (_, i) => ({
    value: String(i + 1),
    label: ordinalDay(i + 1),
  }));
  return [...choices, { value: 'last', label: 'Last day' }];
}

function ordinalDay(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;
}

/** "Every hour", "Every 2 hours" for the hours menu. */
export function hoursLabel(hours: number): string {
  return hours === 1 ? 'Every hour' : `Every ${hours} hours`;
}

function offsetWords(minutes: number): string {
  if (minutes === 0) return 'UTC';
  const sign = minutes > 0 ? '+' : '-';
  const abs = Math.abs(minutes);
  return `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

/** The zones this browser knows, or a short list when it cannot say. */
function knownZones(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
  try {
    const zones = intl.supportedValuesOf?.('timeZone');
    if (zones?.length) return zones;
  } catch {
    // Older engines: fall through to the short list.
  }
  return ['UTC'];
}

/**
 * The time zone menu: every IANA zone with its offset now ("Asia/Kolkata
 * (UTC+05:30)"), with the stored zone and the browser's zone always in it.
 */
export function timeZoneChoices(
  current: string,
  browserZone: string,
  now = Date.now(),
): { value: string; label: string }[] {
  const zones = new Set(knownZones());
  zones.add('UTC');
  for (const zone of [current, browserZone]) {
    if (zone && isValidTimeZone(zone)) zones.add(zone);
  }
  return [...zones]
    .sort((a, b) => a.localeCompare(b))
    .map((zone) => {
      let offset = '';
      try {
        offset = offsetWords(offsetMinutes(now, zone));
      } catch {
        offset = '';
      }
      const words = zoneWords(zone);
      return { value: zone, label: offset && offset !== words ? `${words} (${offset})` : words };
    });
}

export interface UpcomingRun {
  iso: string;
  /** "Monday". */
  weekday: string;
  /** "3 November", or "November 3", as the locale writes it. */
  date: string;
  /** "09:00": always this shape, for `runRows` to write the viewer's way. */
  time: string;
}

/**
 * The next three runs as the schedule's own zone tells them, in parts so a list
 * can line them up. Empty when the config cannot run yet.
 */
export function upcomingRuns(
  config: ScheduleConfig,
  fromIso: string,
  locale?: string,
): UpcomingRun[] {
  const timeZone = config.timeZone;
  try {
    const weekday = new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone });
    const date = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', timeZone });
    const time = new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZone,
    });
    return nextRuns(config, fromIso, 3).map((iso) => {
      const at = Date.parse(iso);
      return {
        iso,
        weekday: weekday.format(at),
        date: date.format(at),
        time: time.format(at),
      };
    });
  } catch {
    return [];
  }
}

/** The runs as the rows of a `SummaryBox`. */
export function runRows(
  runs: readonly UpcomingRun[],
  formatTime: (time: string) => string,
): SummaryBoxRow[] {
  return runs.map((run) => ({
    id: run.iso,
    lead: run.weekday,
    main: run.date,
    end: formatTime(run.time),
  }));
}
