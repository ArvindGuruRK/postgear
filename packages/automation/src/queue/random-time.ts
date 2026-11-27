/**
 * Pick A Random Time (Sprint 13, Module 13): a time on a chosen day inside
 * one part of it, in the person's time zone.
 *
 * Morning 6:00 to 11:59, Noon 12:00 to 13:59, Afternoon 14:00 to 17:59,
 * Evening 18:00 to 21:59. Never on a five-minute mark, never within a minute
 * of a post already placed that day, never earlier than now plus the lead
 * time. The time it gives is a hand-picked exact time: nothing jitters it
 * again.
 *
 * Pure: the caller passes the seed (a fresh one per press) and the clock.
 */
import type { CivilDate } from '../time/calendar';
import { zonedToEpoch } from '../time/zone';
import { hashSeed, MS_PER_MINUTE, onFiveMinuteMark } from './jitter';
import { SLOT_LEAD_MS } from './next-free-slot';

export const DAY_PARTS = ['morning', 'noon', 'afternoon', 'evening'] as const;
export type DayPart = (typeof DAY_PARTS)[number];

/** Each part as minutes since midnight: first minute, last minute. */
export const DAY_PART_RANGES: Readonly<Record<DayPart, readonly [number, number]>> = {
  morning: [6 * 60, 11 * 60 + 59],
  noon: [12 * 60, 13 * 60 + 59],
  afternoon: [14 * 60, 17 * 60 + 59],
  evening: [18 * 60, 21 * 60 + 59],
};

export interface RandomTimeInput {
  part: DayPart;
  /** The chosen day, on the wall clock of `timeZone`. */
  day: CivilDate;
  seed: string;
  /** Posts already placed that day on the chosen channels (epoch ms). */
  taken: readonly number[];
  /** IANA zone the day and the parts are read in. */
  timeZone: string;
  /** Usually now (epoch ms). */
  from: number;
}

/** A time inside the part of the day, as epoch ms; null when none is left (a past evening). */
export function randomTimeOfDay(input: RandomTimeInput): number | null {
  const [first, last] = DAY_PART_RANGES[input.part];
  const earliest = input.from + SLOT_LEAD_MS;
  const candidates: number[] = [];
  for (let minutes = first; minutes <= last; minutes += 1) {
    const at = zonedToEpoch(
      { ...input.day, hour: Math.floor(minutes / 60), minute: minutes % 60, second: 0 },
      input.timeZone,
    );
    if (at <= earliest) continue;
    if (onFiveMinuteMark(at)) continue;
    if (input.taken.some((time) => Math.abs(time - at) <= MS_PER_MINUTE)) continue;
    // A skipped hour (clocks going forward) maps two wall minutes onto one instant.
    if (candidates[candidates.length - 1] === at) continue;
    candidates.push(at);
  }
  if (candidates.length === 0) return null;
  return candidates[hashSeed(input.seed) % candidates.length] as number;
}
