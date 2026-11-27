/**
 * The pure half of a schedule's editing (Sprint 13, Module 14 section C4),
 * shared by the Studio editor's Schedule element and the Schedule Maker's
 * by-hand tab: the week's rows as a person changes them, the source the
 * design keeps, the zones on offer, the fetch, and the sentences.
 *
 * No React and no network here, so every rule is tested on its own.
 */
import {
  addDays,
  convertWeek,
  currentWeekStart,
  type DesignDocument,
  emptyWeek,
  isTimeZone,
  MAX_SCHEDULE_ROWS,
  type ScheduleRow,
  type ScheduleSource,
  scheduleRowsOf,
  setScheduleRows,
  setScheduleSource,
  WEEKDAY_LABELS,
  withClock,
  zoneLabel,
} from '@postgear/design-engine';
import { ApiError } from '@/lib/api';
import type { ScheduleAnswer } from '@/types/studio-schedules';

/** What the page shows for Twitch's 404 (and what the editor repeats). */
export const NO_SCHEDULE_NOTE = 'This channel has no Twitch schedule. Fill it in by hand.';

/** The question Refresh From Twitch (and a zone change over edits) asks first. */
export const REPLACE_EDITS_QUESTION = "Replace your edits with Twitch's schedule?";

export const CLOCK_OPTIONS = [
  { value: '12', label: '12 Hour' },
  { value: '24', label: '24 Hour' },
] as const;

export type ClockChoice = (typeof CLOCK_OPTIONS)[number]['value'];

export function clockChoiceOf(hour12: boolean): ClockChoice {
  return hour12 ? '12' : '24';
}

// ---------------------------------------------------------------------------
// Zones
// ---------------------------------------------------------------------------

/** The browser's own zone, or UTC when it cannot say. */
export function browserZone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return isTimeZone(zone) ? zone : 'UTC';
  } catch {
    return 'UTC';
  }
}

export interface ZoneOption {
  value: string;
  label: string;
}

/**
 * Every zone the browser knows, as the searchable list offers them, with the
 * ones it must always hold (the current choice and UTC) added when the
 * browser's own list leaves them out: Chrome reports `Asia/Kolkata` and may
 * list only `Asia/Calcutta`.
 */
export function zoneOptions(
  current: string,
  supported: () => readonly string[] = supportedZones,
): ZoneOption[] {
  const zones = new Set<string>(supported());
  zones.add('UTC');
  if (isTimeZone(current)) zones.add(current);
  return [...zones]
    .sort((a, b) => a.localeCompare(b))
    .map((zone) => ({ value: zone, label: zoneLabel(zone) }));
}

function supportedZones(): readonly string[] {
  try {
    const list = (Intl as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
    return list ? list('timeZone') : [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export type RowField = 'day' | 'time' | 'title';

/** Seven rows, whatever was stored: missing days are added as Off, extra ones dropped. */
export function fullWeek(rows: readonly ScheduleRow[] | null | undefined): ScheduleRow[] {
  const week = (rows ?? []).slice(0, MAX_SCHEDULE_ROWS).map((row) => ({ ...row }));
  const blanks = emptyWeek();
  while (week.length < MAX_SCHEDULE_ROWS) week.push(blanks[week.length]);
  return week;
}

/** One field of one row, typed. */
export function withRowField(
  rows: readonly ScheduleRow[],
  index: number,
  field: RowField,
  value: string,
): ScheduleRow[] {
  return rows.map((row, at) => (at === index ? { ...row, [field]: value } : row));
}

/**
 * A day on or off. Off keeps the day's words, so turning it back on brings
 * them back; a day turned on with nothing in it gets a title to start from.
 */
export function withRowOff(
  rows: readonly ScheduleRow[],
  index: number,
  off: boolean,
): ScheduleRow[] {
  return rows.map((row, at) => {
    if (at !== index) return row;
    if (off) return { ...row, off: true };
    const { off: _off, ...on } = row;
    return on.title.trim() === '' && on.time.trim() === '' ? { ...on, title: 'Live' } : on;
  });
}

/** True when two weeks say the same thing. */
export function sameRows(a: readonly ScheduleRow[], b: readonly ScheduleRow[]): boolean {
  if (a.length !== b.length) return false;
  return a.every(
    (row, at) =>
      row.day === b[at].day &&
      (row.off === true) === (b[at].off === true) &&
      (row.off === true || (row.time === b[at].time && row.title === b[at].title)),
  );
}

/** Days whose row names more streams than fit ("+1 more"), by their row's day. */
export function crowdedDays(rows: readonly ScheduleRow[]): string[] {
  return rows.filter((row) => !row.off && /\+\d+ more$/.test(row.title)).map((row) => row.day);
}

/** The warning for crowded days, or null. */
export function crowdedWarning(rows: readonly ScheduleRow[]): string | null {
  const days = crowdedDays(rows);
  if (days.length === 0) return null;
  const list = days.length === 1 ? days[0] : `${days.slice(0, -1).join(', ')} and ${days.at(-1)}`;
  return `${list} ${days.length === 1 ? 'has' : 'have'} more streams than fit in a row, so only the first two are named. Shorten the titles or split the day.`;
}

// ---------------------------------------------------------------------------
// The design
// ---------------------------------------------------------------------------

/** A by-hand source for a design that has none yet (one made from the gallery). */
export function manualSource(now: Date, timeZone: string, hour12 = true): ScheduleSource {
  return {
    source: 'manual',
    login: null,
    timeZone,
    weekStart: currentWeekStart(now, timeZone),
    fetchedAt: null,
    hour12,
  };
}

/** The design's schedule source, or a by-hand one in the browser's zone. */
export function sourceOf(document: DesignDocument, now = new Date()): ScheduleSource {
  return document.schedule ?? manualSource(now, browserZone());
}

/** The rows and the source written together: one undo step. */
export function withSchedule(
  document: DesignDocument,
  rows: readonly ScheduleRow[],
  source: ScheduleSource,
): DesignDocument {
  return setScheduleSource(setScheduleRows(document, rows), source);
}

/** Switches the clock: the source's flag, and every time already written, converted. */
export function withHour12(document: DesignDocument, hour12: boolean): DesignDocument {
  const source = sourceOf(document);
  const rows = scheduleRowsOf(document) ?? [];
  return withSchedule(document, withClock(rows, hour12), { ...source, hour12 });
}

/** A new zone for a design whose rows were typed by hand: only the zone line changes. */
export function withZone(document: DesignDocument, timeZone: string): DesignDocument {
  return setScheduleSource(document, { ...sourceOf(document), timeZone });
}

/** The week a refresh asks for: the design's own, unless it is already past. */
export function refreshWeek(source: ScheduleSource, now: Date): string {
  const current = currentWeekStart(now, source.timeZone);
  return source.weekStart < current ? current : source.weekStart;
}

/** A fetched week as rows in a zone, with its crowded days and its break. */
export function rowsFromAnswer(
  answer: ScheduleAnswer,
  options: { timeZone: string; hour12: boolean },
) {
  if (answer.noSchedule) return { rows: emptyWeek(), crowded: [], vacationUntil: null };
  return convertWeek(answer.segments, {
    timeZone: options.timeZone,
    weekStart: answer.weekStart,
    hour12: options.hour12,
    vacation: answer.vacation,
  });
}

/** The source a fetched week is kept under. */
export function twitchSource(
  answer: ScheduleAnswer,
  options: { timeZone: string; hour12: boolean; vacationUntil: string | null },
): ScheduleSource {
  const source: ScheduleSource = {
    source: 'twitch',
    login: answer.broadcaster.login,
    timeZone: options.timeZone,
    weekStart: answer.weekStart,
    fetchedAt: answer.fetchedAt,
    hour12: options.hour12,
  };
  if (options.vacationUntil) source.vacationUntil = options.vacationUntil;
  return source;
}

// ---------------------------------------------------------------------------
// Weeks and words
// ---------------------------------------------------------------------------

export interface WeekOption {
  value: string;
  label: string;
}

const SHORT_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** This week and the eight after it, as the fetch accepts them. */
export function weekOptions(now: Date, timeZone: string): WeekOption[] {
  const current = currentWeekStart(now, timeZone);
  return Array.from({ length: 9 }, (_, index) => {
    const value = addDays(current, index * 7);
    const [, month, day] = value.split('-').map(Number);
    const label =
      index === 0
        ? 'This Week'
        : index === 1
          ? 'Next Week'
          : `Week Of ${day} ${SHORT_MONTHS[month - 1]}`;
    return { value, label };
  });
}

/** A day's full name, for a field's spoken label ("Monday time"). */
export function dayName(index: number): string {
  return (
    ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][index] ??
    WEEKDAY_LABELS[index] ??
    `Day ${index + 1}`
  );
}

/** The sentence a failed fetch shows: the API's own when it sent one. */
export function fetchFailureMessage(cause: unknown): string {
  if (cause instanceof ApiError && cause.message && cause.status !== 0) return cause.message;
  if (cause instanceof ApiError && cause.status === 0) {
    return 'PostGear could not be reached. Check your connection and try again.';
  }
  return 'We could not read that Twitch schedule right now. Try again in a minute, or fill it in by hand.';
}
