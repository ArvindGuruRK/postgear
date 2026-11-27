/**
 * A natural minute inside a slot's window (Sprint 13, Module 13).
 *
 * A post placed in a slot (Next Available, Add To Queue) goes out at a
 * minute inside `[slot - window, slot + window]` that is never on a
 * five-minute mark and never the same minute as another post already placed
 * on the channel. The seed (usually the post's id, or a fresh value per
 * press) picks among the allowed minutes, so the same seed always gives the
 * same minute. A window of 0 is the slot's own time.
 *
 * Pure: the caller passes the seed; nothing here reads a clock or rolls dice.
 */

export const MS_PER_MINUTE = 60_000;

/** A small, stable 32-bit hash (FNV-1a) of a seed string. */
export function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** True when the minute holding `epochMs` is on a five-minute mark (:00, :05, ...). */
export function onFiveMinuteMark(epochMs: number): boolean {
  // Every real zone's offset is a whole number of quarter hours, so the
  // minute's remainder by five is the same in UTC and on the wall clock.
  return Math.floor(epochMs / MS_PER_MINUTE) % 5 === 0;
}

export interface JitterOptions {
  /** Posts already placed on the channel (epoch ms). */
  taken?: readonly number[];
  /** No earlier than this (epoch ms), such as now plus the lead time. */
  notBefore?: number;
}

/**
 * The minute a post placed in this slot goes out at, as epoch ms. With no
 * allowed minute left in the window, the slot's own time.
 */
export function jitteredTime(
  slotTime: number,
  windowMinutes: number,
  seed: string,
  options: JitterOptions = {},
): number {
  const slot = Math.floor(slotTime / MS_PER_MINUTE) * MS_PER_MINUTE;
  if (!(windowMinutes > 0)) return slot;
  const taken = options.taken ?? [];
  const notBefore = options.notBefore ?? Number.NEGATIVE_INFINITY;
  const candidates: number[] = [];
  for (let offset = -windowMinutes; offset <= windowMinutes; offset += 1) {
    const minute = slot + offset * MS_PER_MINUTE;
    if (minute <= notBefore) continue;
    if (onFiveMinuteMark(minute)) continue;
    if (taken.some((time) => Math.abs(time - minute) < MS_PER_MINUTE)) continue;
    candidates.push(minute);
  }
  if (candidates.length === 0) return slot;
  return candidates[hashSeed(seed) % candidates.length] as number;
}
