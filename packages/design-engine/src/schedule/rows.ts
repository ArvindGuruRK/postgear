/**
 * Twitch's schedule segments as the seven rows of a picture (Sprint 13).
 *
 * The rules, from research 10 section 9.5 and Module 14 section C2:
 *
 * 1. Each segment's UTC start is read in the picture's zone, which handles
 *    daylight saving date by date: a week that crosses a clock change shows
 *    the true local times on both sides of it.
 * 2. A segment belongs to the local date it starts on. One that runs past
 *    midnight stays on its start day.
 * 3. A cancelled segment (`canceledUntil` set) is dropped; a day left with
 *    nothing, and a day that never had anything, reads Off.
 * 4. Two segments on one day join in one row ("7 PM Minecraft, 10 PM
 *    Chat"); a third or more adds "+1 more" (or "+2 more"), and the day is
 *    named in `crowded` so the editor can warn that it will not fit.
 * 5. A blank title takes the category's name, and with neither the row
 *    reads Live.
 * 6. A break (`vacation`) that overlaps the week is reported as the instant
 *    it ends; the zone line then reads "On a break until Mon 23 Nov" and the
 *    rows are left as Twitch has them.
 * 7. Always seven rows, Monday to Sunday.
 *
 * The rows are plain text from then on: what a person types over them is
 * theirs, and nothing here runs again unless they ask for Twitch's schedule.
 */
import type { ScheduleRow } from '../types';
import { addDays, formatClock, localDate, safeTimeZone, WEEKDAY_LABELS, weekRange } from './time';

/** One segment as `POST /studio/schedules/fetch` answers it (all times UTC, ISO). */
export interface ScheduleSegment {
  start: string;
  end: string | null;
  title: string;
  /** The category's (game's) name, or null for none. */
  category: string | null;
  /** Set when a recurring segment was cancelled; it then shows as no stream. */
  canceledUntil: string | null;
  recurring: boolean;
}

/** A break, as Twitch answers it, or null. */
export interface ScheduleVacation {
  start: string;
  end: string;
}

export interface WeekOptions {
  /** IANA zone the picture is drawn in. */
  timeZone: string;
  /** ISO date of the Monday the week starts on, in `timeZone`. */
  weekStart: string;
  hour12: boolean;
}

export interface ConvertedWeek {
  /** Seven rows, Monday to Sunday. */
  rows: ScheduleRow[];
  /** Row indexes (0 is Monday) that hold three or more streams: "+1 more" will not fit well. */
  crowded: number[];
  /** When the break that overlaps this week ends (ISO), or null for no break. */
  vacationUntil: string | null;
}

/** What a row says for a stream with no title and no category. */
export const UNTITLED_STREAM = 'Live';

/** A day with no stream. The renderer reads it as Off; the words stay for Off's undo. */
export function offRow(day: string): ScheduleRow {
  return { day, time: '', title: '', off: true };
}

/** Seven Off rows, Monday to Sunday: a channel with no Twitch schedule, or a blank week. */
export function emptyWeek(): ScheduleRow[] {
  return WEEKDAY_LABELS.map((day) => offRow(day));
}

function streamName(segment: ScheduleSegment): string {
  const title = segment.title.trim();
  if (title) return title;
  return segment.category?.trim() || UNTITLED_STREAM;
}

function startOf(segment: ScheduleSegment): number {
  return Date.parse(segment.start);
}

/** The week's rows, its crowded days and its break. */
export function convertWeek(
  segments: readonly ScheduleSegment[],
  options: WeekOptions & { vacation?: ScheduleVacation | null },
): ConvertedWeek {
  const zone = safeTimeZone(options.timeZone);
  const days = WEEKDAY_LABELS.map((_, index) => addDays(options.weekStart, index));
  const byDay: ScheduleSegment[][] = days.map(() => []);

  const live = segments
    .filter((segment) => !segment.canceledUntil && Number.isFinite(startOf(segment)))
    .sort((a, b) => startOf(a) - startOf(b));

  for (const segment of live) {
    const date = localDate(new Date(startOf(segment)), zone);
    const index = days.indexOf(date);
    if (index !== -1) byDay[index].push(segment);
  }

  const crowded: number[] = [];
  const rows = byDay.map((streams, index): ScheduleRow => {
    const day = WEEKDAY_LABELS[index];
    if (streams.length === 0) return offRow(day);

    const clock = (segment: ScheduleSegment) =>
      formatClock(new Date(startOf(segment)), zone, options.hour12);
    const [first, second] = streams;
    let title = streamName(first);

    if (second) title = `${title}, ${clock(second)} ${streamName(second)}`;
    if (streams.length > 2) {
      title = `${title} +${streams.length - 2} more`;
      crowded.push(index);
    }

    return { day, time: clock(first), title };
  });

  return { rows, crowded, vacationUntil: vacationInWeek(options.vacation ?? null, options) };
}

/** Seven rows, Monday to Sunday, from Twitch's segments (Module 14, C2). */
export function segmentsToRows(
  segments: readonly ScheduleSegment[],
  options: WeekOptions,
): ScheduleRow[] {
  return convertWeek(segments, options).rows;
}

/** The end of a break that overlaps the week, or null when there is none or it misses. */
export function vacationInWeek(
  vacation: ScheduleVacation | null,
  options: Pick<WeekOptions, 'timeZone' | 'weekStart'>,
): string | null {
  if (!vacation) return null;

  const start = Date.parse(vacation.start);
  const end = Date.parse(vacation.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;

  const week = weekRange(options.weekStart, safeTimeZone(options.timeZone));
  const overlaps = start < week.end.getTime() && end > week.start.getTime();
  return overlaps ? new Date(end).toISOString() : null;
}
