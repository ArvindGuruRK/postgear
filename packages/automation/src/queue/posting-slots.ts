/**
 * Posting slots (Sprint 13, Module 13): a channel's posting times, each with
 * a window and the weekdays it runs on.
 *
 * They live where the times always did, `Integration.postingTimes` (a JSON
 * list in a text column), with two optional fields on each entry, so no new
 * table and no data move. `readPostingSlots` is the one tolerant reader:
 * a bare number or an entry from before the change reads as a slot on every
 * day with no window, which is exactly how it behaved before.
 *
 * Pure: no clock, no randomness, no Node.
 */

/** The windows a slot may have, in minutes either side of its time. */
export const POSTING_WINDOWS = [0, 5, 15, 30] as const;
export type PostingWindow = (typeof POSTING_WINDOWS)[number];

/** ISO weekdays: 1 is Monday, 7 is Sunday. */
export const ISO_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

/** At most this many slots on one channel (the API's cap). */
export const MAX_POSTING_SLOTS = 48;

const MINUTES_PER_DAY = 24 * 60;

export interface PostingSlot {
  /** Minutes since local midnight, 0 to 1439 (the key keeps its stored name). */
  time: number;
  /** 0 means exactly on time. */
  windowMinutes: PostingWindow;
  /** Distinct ISO weekdays, sorted, at least one. */
  days: number[];
}

/** What a newly connected channel gets: 02:00, 06:40 and 11:40, every day, exact. */
export const DEFAULT_POSTING_SLOTS: readonly PostingSlot[] = Object.freeze(
  [120, 400, 700].map((time) => ({
    time,
    windowMinutes: 0 as PostingWindow,
    days: [...ISO_WEEKDAYS],
  })),
);

export function isPostingWindow(value: unknown): value is PostingWindow {
  return (POSTING_WINDOWS as readonly unknown[]).includes(value);
}

/** 0 (Sunday) to 6 as the calendar helpers count, to ISO 1 (Monday) to 7 (Sunday). */
export function isoWeekdayOf(sundayFirst: number): number {
  return sundayFirst === 0 ? 7 : sundayFirst;
}

function cleanDays(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [...ISO_WEEKDAYS];
  const days = [
    ...new Set(raw.filter((day): day is number => Number.isInteger(day) && day >= 1 && day <= 7)),
  ].sort((a, b) => a - b);
  return days.length > 0 ? days : [...ISO_WEEKDAYS];
}

function readEntry(entry: unknown): PostingSlot | null {
  if (typeof entry === 'number') {
    return Number.isInteger(entry) && entry >= 0 && entry < MINUTES_PER_DAY
      ? { time: entry, windowMinutes: 0, days: [...ISO_WEEKDAYS] }
      : null;
  }
  if (typeof entry !== 'object' || entry === null) return null;
  const { time, windowMinutes, days } = entry as Record<string, unknown>;
  if (typeof time !== 'number' || !Number.isInteger(time) || time < 0 || time >= MINUTES_PER_DAY) {
    return null;
  }
  return {
    time,
    windowMinutes: isPostingWindow(windowMinutes) ? windowMinutes : 0,
    days: cleanDays(days),
  };
}

/**
 * Reads whatever is stored (the JSON text, an already parsed list, or a list
 * of bare minutes) into slots, sorted by time. Entries it cannot read are
 * left out; an unreadable whole gives an empty list (the caller decides what
 * an empty channel means). Two entries with the same time are merged: their
 * days joined, the wider window kept.
 */
export function readPostingSlots(raw: unknown): PostingSlot[] {
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  const byTime = new Map<number, PostingSlot>();
  for (const entry of value.slice(0, MAX_POSTING_SLOTS * 2)) {
    const slot = readEntry(entry);
    if (!slot) continue;
    const known = byTime.get(slot.time);
    if (!known) {
      byTime.set(slot.time, slot);
      continue;
    }
    byTime.set(slot.time, {
      time: slot.time,
      windowMinutes: Math.max(known.windowMinutes, slot.windowMinutes) as PostingWindow,
      days: cleanDays([...known.days, ...slot.days]),
    });
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time).slice(0, MAX_POSTING_SLOTS);
}

/** The flat list of times, for the readers that only ever needed the minutes. */
export function postingTimesOf(slots: readonly PostingSlot[]): { time: number }[] {
  return slots.map((slot) => ({ time: slot.time }));
}
