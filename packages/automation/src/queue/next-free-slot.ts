/**
 * Add To Queue's "next free posting time" (Sprint 10, Module 10).
 *
 * A channel's posting times (`Integration.postingTimes`) are minutes since
 * local midnight with no zone of their own: the composer reads them in the
 * browser's zone. A workflow has no browser, so the step carries an IANA
 * zone (`config.timeZone`, defaulted from the browser that built it) and
 * the times are read in that zone, daylight saving included.
 *
 * Pure (no clock, no `Date` built from nothing): the caller passes `from`
 * and the queued times, so the API and the tests get the same answer.
 */
import { civilFromDays, daysFromCivil, MS_PER_MINUTE } from '../time/calendar';
import { zonedTime, zonedToEpoch } from '../time/zone';

/**
 * What a channel with no posting times falls back to: the same three times
 * a newly connected channel gets (`Integration.postingTimes`' default,
 * 02:00, 06:40 and 11:40), so an empty list behaves like a fresh channel.
 */
export const DEFAULT_POSTING_TIMES: readonly number[] = [120, 400, 700];

/** A slot must be at least this far after `from`, so the post is not due before it is written. */
export const SLOT_LEAD_MS = 5 * MS_PER_MINUTE;

/** A queued post this close to a slot (either side) takes it. */
export const SLOT_CLASH_MS = MS_PER_MINUTE;

/** Days looked ahead before giving up. */
export const SLOT_SEARCH_DAYS = 366;

const MINUTES_PER_DAY = 24 * 60;

export interface NextFreeSlotInput {
  /** Minutes since local midnight, 0 to 1439; anything else is ignored. */
  postingTimes: readonly number[];
  /** When posts are already queued on the channel (or channels). */
  taken: readonly (Date | number)[];
  /** Usually now. */
  from: Date | number;
  /** IANA zone the posting times are read in (the step's `timeZone`). */
  timeZone: string;
}

function epochOf(value: Date | number): number {
  return typeof value === 'number' ? value : value.getTime();
}

function cleanTimes(times: readonly number[]): number[] {
  const valid = times.filter(
    (time) => Number.isInteger(time) && time >= 0 && time < MINUTES_PER_DAY,
  );
  const list = valid.length > 0 ? valid : [...DEFAULT_POSTING_TIMES];
  return [...new Set(list)].sort((a, b) => a - b);
}

/**
 * The first posting time later than `from` plus five minutes with no queued
 * post within a minute of it, as epoch milliseconds; `null` when none is free
 * within a year. An empty (or unreadable) list uses `DEFAULT_POSTING_TIMES`.
 *
 * A time the clocks skip (01:30 when they go forward at 01:00) moves forward
 * by the gap; a time that happens twice (when they go back) is the first.
 */
export function nextFreeSlot(input: NextFreeSlotInput): number | null {
  const earliest = epochOf(input.from) + SLOT_LEAD_MS;
  const taken = input.taken.map(epochOf).filter((time) => Number.isFinite(time));
  const times = cleanTimes(input.postingTimes);

  // Start a day early: a zone far behind UTC can still be on the day before.
  const startDay = daysFromCivil(zonedTime(earliest, input.timeZone)) - 1;

  for (let offset = 0; offset <= SLOT_SEARCH_DAYS + 1; offset += 1) {
    const date = civilFromDays(startDay + offset);
    const candidates = times
      .map((minutes) =>
        zonedToEpoch(
          { ...date, hour: Math.floor(minutes / 60), minute: minutes % 60, second: 0 },
          input.timeZone,
        ),
      )
      .sort((a, b) => a - b);

    for (const slot of candidates) {
      if (slot <= earliest) continue;
      if (taken.some((time) => Math.abs(time - slot) <= SLOT_CLASH_MS)) continue;
      return slot;
    }
  }
  return null;
}
