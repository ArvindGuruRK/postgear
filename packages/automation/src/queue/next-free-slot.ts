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
import { civilFromDays, daysFromCivil, MS_PER_MINUTE, weekdayOfDays } from '../time/calendar';
import { zonedTime, zonedToEpoch } from '../time/zone';
import { jitteredTime } from './jitter';
import {
  DEFAULT_POSTING_SLOTS,
  isoWeekdayOf,
  type PostingSlot,
  readPostingSlots,
} from './posting-slots';

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
  /**
   * The channel's posting slots (Module 13), or bare minutes since local
   * midnight (a slot on every day with no window); anything unreadable is
   * ignored.
   */
  postingTimes: readonly (number | PostingSlot)[];
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

function cleanSlots(times: readonly (number | PostingSlot)[]): PostingSlot[] {
  const slots = readPostingSlots(times);
  return slots.length > 0 ? slots : DEFAULT_POSTING_SLOTS.map((slot) => ({ ...slot }));
}

export interface FreeSlot {
  /** The slot's own time (epoch ms). */
  slot: number;
  windowMinutes: number;
}

/**
 * The first slot later than `from` plus five minutes, on a weekday it runs
 * on, with no queued post inside its window (or within a minute of it when
 * it has none); `null` when none is free within a year. An empty (or
 * unreadable) list uses the default slots.
 *
 * A time the clocks skip (01:30 when they go forward at 01:00) moves forward
 * by the gap; a time that happens twice (when they go back) is the first.
 */
export function findFreeSlot(input: NextFreeSlotInput): FreeSlot | null {
  const earliest = epochOf(input.from) + SLOT_LEAD_MS;
  const taken = input.taken.map(epochOf).filter((time) => Number.isFinite(time));
  const slots = cleanSlots(input.postingTimes);

  // Start a day early: a zone far behind UTC can still be on the day before.
  const startDay = daysFromCivil(zonedTime(earliest, input.timeZone)) - 1;

  for (let offset = 0; offset <= SLOT_SEARCH_DAYS + 1; offset += 1) {
    const days = startDay + offset;
    const date = civilFromDays(days);
    const weekday = isoWeekdayOf(weekdayOfDays(days));
    const candidates = slots
      .filter((slot) => slot.days.includes(weekday))
      .map((slot) => ({
        slot: zonedToEpoch(
          { ...date, hour: Math.floor(slot.time / 60), minute: slot.time % 60, second: 0 },
          input.timeZone,
        ),
        windowMinutes: slot.windowMinutes,
      }))
      .sort((a, b) => a.slot - b.slot);

    for (const candidate of candidates) {
      if (candidate.slot <= earliest) continue;
      const reach = candidate.windowMinutes * MS_PER_MINUTE + SLOT_CLASH_MS;
      if (taken.some((time) => Math.abs(time - candidate.slot) <= reach)) continue;
      return candidate;
    }
  }
  return null;
}

/** The first free slot's own time, as epoch milliseconds (see `findFreeSlot`). */
export function nextFreeSlot(input: NextFreeSlotInput): number | null {
  return findFreeSlot(input)?.slot ?? null;
}

/**
 * Module 13: where a post placed in the next free slot goes out, as epoch
 * ms: the slot's time moved to a natural minute inside its window
 * (`jitteredTime`), never before `from` plus the lead time and never on
 * another queued post's minute. `seed` is the post's id, or a fresh value
 * for a post not saved yet.
 */
export function placeInFreeSlot(input: NextFreeSlotInput & { seed: string }): number | null {
  const found = findFreeSlot(input);
  if (!found) return null;
  return jitteredTime(found.slot, found.windowMinutes, input.seed, {
    taken: input.taken.map(epochOf),
    notBefore: epochOf(input.from) + SLOT_LEAD_MS,
  });
}
