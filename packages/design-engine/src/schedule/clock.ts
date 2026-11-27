/**
 * The 12 or 24 hour switch (Sprint 13), applied to rows that are already
 * text.
 *
 * Rows are words a person may have typed over, so the switch does not rebuild
 * them from Twitch: it rewrites the times it can read and leaves every other
 * word alone. A time is read in the time field, and in the title only where
 * a second stream was joined on (", 10 PM Chat"), so a title that happens to
 * hold "Top 10:30 moments" is never touched.
 */
import type { ScheduleRow } from '../types';
import { clockText } from './time';

/** "7 PM", "7:30pm", "07:30 a.m." */
const TWELVE = /\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*([AaPp])\.?\s*[Mm]\.?(?![A-Za-z])/g;
/** "19:00", "7:30": a 24 hour time with no AM or PM after it. */
const TWENTY_FOUR = /\b([01]?\d|2[0-3]):([0-5]\d)\b(?!\s*[AaPp]\.?\s*[Mm]\b)/g;

/** Every time in `text` rewritten on the chosen clock. */
export function convertClockText(text: string, hour12: boolean): string {
  if (hour12) {
    return text.replace(TWENTY_FOUR, (_, hour: string, minute: string) =>
      clockText(Number(hour), Number(minute), true),
    );
  }
  return text.replace(TWELVE, (_, hour: string, minute: string | undefined, mark: string) => {
    const pm = mark.toLowerCase() === 'p';
    const value = (Number(hour) % 12) + (pm ? 12 : 0);
    return clockText(value, Number(minute ?? 0), false);
  });
}

/** The joined stream's time in a title: ", 10 PM Chat" or ", 22:00 Chat". */
const JOINED = /(, )(\d{1,2}(?::[0-5]\d)?\s*[AaPp]\.?\s*[Mm]\.?|\d{1,2}:[0-5]\d)(?= )/g;

function convertJoined(title: string, hour12: boolean): string {
  return title.replace(JOINED, (_, comma: string, time: string) => {
    const converted = convertClockText(time, hour12);
    return `${comma}${converted}`;
  });
}

/** Rows with their times on the chosen clock. The same array when nothing changed. */
export function withClock(rows: readonly ScheduleRow[], hour12: boolean): ScheduleRow[] {
  let changed = false;

  const next = rows.map((row) => {
    const time = convertClockText(row.time, hour12);
    const title = convertJoined(row.title, hour12);
    if (time === row.time && title === row.title) return row;

    changed = true;
    return { ...row, time, title };
  });

  return changed ? next : (rows as ScheduleRow[]);
}
