/**
 * Shuffle Times (Sprint 13, Module 13): a week of posting slots from how
 * many posts a week the person wants.
 *
 * - The posts are shared across the week as evenly as possible:
 *   `floor(perWeek / 7)` slots on every day, and the remainder as one more
 *   slot on that many days, Tuesday, Wednesday and Thursday first.
 * - Times are spread across the waking day (7:00 to 22:00), each nudged off
 *   the hour and the half hour (7:50, not 8:00), at least two hours apart.
 * - The same time on several days is one slot with those weekdays: 21 a
 *   week is three slots on all seven days; 10 a week is one slot on all
 *   seven and one on Tuesday, Wednesday and Thursday.
 * - Every suggested slot starts with a window of 15 minutes.
 *
 * Pure: the seed (a fresh value per press of Shuffle) picks the nudges.
 */
import { hashSeed } from './jitter';
import { ISO_WEEKDAYS, type PostingSlot } from './posting-slots';

export const MIN_POSTS_PER_WEEK = 1;
export const MAX_POSTS_PER_WEEK = 35;

/** The waking day the suggestions are spread across, minutes since midnight. */
export const SUGGEST_DAY_START = 7 * 60;
export const SUGGEST_DAY_END = 22 * 60;

/** The order the remainder's extra slots go to days (ISO weekdays). */
export const EXTRA_DAY_ORDER = [2, 3, 4, 1, 5, 6, 7] as const;

/** The window, in minutes, every suggested slot starts with. */
export const SUGGESTED_WINDOW = 15;

/** At most this far either way a time is nudged from its even spot. */
const MAX_NUDGE = 10;

/** `count` times spread evenly across the waking day, each nudged by the seed. */
function spreadTimes(count: number, seed: string): number[] {
  const span = SUGGEST_DAY_END - SUGGEST_DAY_START;
  const step = span / count;
  const times: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const even = Math.round(SUGGEST_DAY_START + step * (index + 0.5));
    // A nudge of 1 to MAX_NUDGE minutes, either way, chosen by the seed.
    const roll = hashSeed(`${seed}:${index}`);
    const size = 1 + (roll % MAX_NUDGE);
    let time = even + (roll & 0x8000 ? size : -size);
    // Never on the hour or the half hour.
    if (time % 30 === 0) time += 7;
    times.push(Math.min(SUGGEST_DAY_END - 1, Math.max(SUGGEST_DAY_START, time)));
  }
  return times;
}

/** The suggested slots for `perWeek` posts (clamped to 1 to 35), sorted by time. */
export function suggestSlots(perWeek: number, seed: string): PostingSlot[] {
  const total = Math.min(
    MAX_POSTS_PER_WEEK,
    Math.max(MIN_POSTS_PER_WEEK, Math.round(Number.isFinite(perWeek) ? perWeek : 1)),
  );
  const everyDay = Math.floor(total / 7);
  const extraDays = total % 7;
  const times = spreadTimes(everyDay + (extraDays > 0 ? 1 : 0), seed);

  // Which of the times is the extra one (on fewer days): chosen by the seed.
  const extraIndex = extraDays > 0 ? hashSeed(`${seed}:extra`) % times.length : -1;
  const slots: PostingSlot[] = times.map((time, index) => ({
    time,
    windowMinutes: SUGGESTED_WINDOW,
    days:
      index === extraIndex
        ? [...EXTRA_DAY_ORDER.slice(0, extraDays)].sort((a, b) => a - b)
        : [...ISO_WEEKDAYS],
  }));
  return slots.sort((a, b) => a.time - b.time);
}

/** How many posts a week a set of slots makes (each slot once per weekday it lists). */
export function postsPerWeek(slots: readonly PostingSlot[]): number {
  return slots.reduce((sum, slot) => sum + slot.days.length, 0);
}
