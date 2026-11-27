/**
 * Module 13: posting slots (time, window, weekdays), the jitter, the slot
 * finder with weekdays and windows, Shuffle's suggestion and the random time
 * of day. All pure: every clock and seed is passed in.
 */
import { MS_PER_MINUTE } from '../time/calendar';
import { zonedTime, zonedToEpoch } from '../time/zone';
import { hashSeed, jitteredTime, onFiveMinuteMark } from './jitter';
import { findFreeSlot, placeInFreeSlot, SLOT_LEAD_MS } from './next-free-slot';
import { DEFAULT_POSTING_SLOTS, type PostingSlot, readPostingSlots } from './posting-slots';
import { DAY_PART_RANGES, DAY_PARTS, randomTimeOfDay } from './random-time';
import { postsPerWeek, SUGGEST_DAY_END, SUGGEST_DAY_START, suggestSlots } from './suggest-slots';

const ZONE = 'Europe/London';
const ALL = [1, 2, 3, 4, 5, 6, 7];

/** Monday 16 November 2026, 06:00 in London (no daylight saving in November). */
const MONDAY_6AM = zonedToEpoch(
  { year: 2026, month: 11, day: 16, hour: 6, minute: 0, second: 0 },
  ZONE,
);

function at(day: number, hour: number, minute: number): number {
  return zonedToEpoch({ year: 2026, month: 11, day, hour, minute, second: 0 }, ZONE);
}

describe('readPostingSlots', () => {
  it('reads a legacy entry, or a bare minute, as every day with no window', () => {
    expect(readPostingSlots('[{"time":120}, {"time":400}]')).toEqual([
      { time: 120, windowMinutes: 0, days: ALL },
      { time: 400, windowMinutes: 0, days: ALL },
    ]);
    expect(readPostingSlots([700])).toEqual([{ time: 700, windowMinutes: 0, days: ALL }]);
  });

  it('keeps a window and weekdays, cleaning what it cannot use', () => {
    expect(
      readPostingSlots([
        { time: 540, windowMinutes: 15, days: [4, 2, 2, 9] },
        { time: 600, windowMinutes: 7, days: [] },
        { time: 2000 },
        'nonsense',
      ]),
    ).toEqual([
      { time: 540, windowMinutes: 15, days: [2, 4] },
      { time: 600, windowMinutes: 0, days: ALL },
    ]);
  });

  it('merges two entries at one time, and reads broken text as empty', () => {
    expect(
      readPostingSlots([
        { time: 540, windowMinutes: 5, days: [1] },
        { time: 540, windowMinutes: 15, days: [3] },
      ]),
    ).toEqual([{ time: 540, windowMinutes: 15, days: [1, 3] }]);
    expect(readPostingSlots('{not json')).toEqual([]);
    expect(readPostingSlots({ time: 1 })).toEqual([]);
  });

  it('defaults to the three times a new channel gets, every day, exact', () => {
    expect(DEFAULT_POSTING_SLOTS.map((slot) => slot.time)).toEqual([120, 400, 700]);
    expect(DEFAULT_POSTING_SLOTS.every((slot) => slot.windowMinutes === 0)).toBe(true);
  });
});

describe('jitteredTime', () => {
  const slot = at(17, 9, 0);

  it('stays inside the window, never on a five-minute mark, and is stable for a seed', () => {
    for (let index = 0; index < 200; index += 1) {
      const time = jitteredTime(slot, 15, `post-${index}`);
      expect(Math.abs(time - slot)).toBeLessThanOrEqual(15 * MS_PER_MINUTE);
      expect(onFiveMinuteMark(time)).toBe(false);
      expect(jitteredTime(slot, 15, `post-${index}`)).toBe(time);
    }
  });

  it('is the slot itself with a window of 0', () => {
    expect(jitteredTime(slot, 0, 'post-1')).toBe(slot);
  });

  it('never lands on the minute of a post already placed', () => {
    const taken: number[] = [];
    for (let index = 0; index < 20; index += 1) {
      const time = jitteredTime(slot, 15, `post-${index}`, { taken });
      expect(taken.some((other) => Math.abs(other - time) < MS_PER_MINUTE)).toBe(false);
      taken.push(time);
    }
  });

  it('never goes before notBefore', () => {
    const time = jitteredTime(slot, 30, 'x', { notBefore: slot + 10 * MS_PER_MINUTE });
    expect(time).toBeGreaterThan(slot + 10 * MS_PER_MINUTE);
  });

  it('hashes seeds stably', () => {
    expect(hashSeed('abc')).toBe(hashSeed('abc'));
    expect(hashSeed('abc')).not.toBe(hashSeed('abd'));
  });
});

describe('findFreeSlot and placeInFreeSlot with slots', () => {
  const tuesThurs: PostingSlot = { time: 540, windowMinutes: 15, days: [2, 4] };

  it('skips a weekday the slot does not run on', () => {
    // From Monday morning, a Tuesday and Thursday slot is Tuesday's.
    const first = findFreeSlot({
      postingTimes: [tuesThurs],
      taken: [],
      from: MONDAY_6AM,
      timeZone: ZONE,
    });
    expect(first?.slot).toBe(at(17, 9, 0));
    expect(zonedTime(first?.slot as number, ZONE).weekday).toBe(2);
    // Tuesday's is taken by a post inside its window: next is Thursday.
    const second = findFreeSlot({
      postingTimes: [tuesThurs],
      taken: [at(17, 9, 7)],
      from: MONDAY_6AM,
      timeZone: ZONE,
    });
    expect(second?.slot).toBe(at(19, 9, 0));
  });

  it('places two posts at different natural minutes near their slots', () => {
    const slots: PostingSlot[] = [{ time: 540, windowMinutes: 15, days: ALL }];
    const first = placeInFreeSlot({
      postingTimes: slots,
      taken: [],
      from: MONDAY_6AM,
      timeZone: ZONE,
      seed: 'post-a',
    }) as number;
    const second = placeInFreeSlot({
      postingTimes: slots,
      taken: [first],
      from: MONDAY_6AM,
      timeZone: ZONE,
      seed: 'post-b',
    }) as number;
    expect(Math.abs(first - at(16, 9, 0))).toBeLessThanOrEqual(15 * MS_PER_MINUTE);
    expect(Math.abs(second - at(17, 9, 0))).toBeLessThanOrEqual(15 * MS_PER_MINUTE);
    expect(onFiveMinuteMark(first)).toBe(false);
    expect(onFiveMinuteMark(second)).toBe(false);
  });

  it('keeps bare minutes exact, as before', () => {
    expect(
      placeInFreeSlot({
        postingTimes: [540],
        taken: [],
        from: MONDAY_6AM,
        timeZone: ZONE,
        seed: 'x',
      }),
    ).toBe(at(16, 9, 0));
  });
});

describe('suggestSlots', () => {
  it('21 a week is three slots on all seven days', () => {
    const slots = suggestSlots(21, 'seed-1');
    expect(slots).toHaveLength(3);
    expect(slots.every((slot) => slot.days.length === 7)).toBe(true);
    expect(postsPerWeek(slots)).toBe(21);
  });

  it('10 a week is one slot on all seven days and one on Tuesday, Wednesday and Thursday', () => {
    const slots = suggestSlots(10, 'seed-2');
    expect(slots.map((slot) => slot.days).sort((a, b) => a.length - b.length)).toEqual([
      [2, 3, 4],
      ALL,
    ]);
    expect(postsPerWeek(slots)).toBe(10);
  });

  it('spreads, nudges and bounds the times, with a window of 15, for every count', () => {
    for (let perWeek = 1; perWeek <= 35; perWeek += 1) {
      for (const seed of ['a', 'b', 'c']) {
        const slots = suggestSlots(perWeek, seed);
        expect(postsPerWeek(slots)).toBe(perWeek);
        const times = slots.map((slot) => slot.time);
        for (const [index, time] of times.entries()) {
          expect(time).toBeGreaterThanOrEqual(SUGGEST_DAY_START);
          expect(time).toBeLessThan(SUGGEST_DAY_END);
          expect(time % 30).not.toBe(0);
          if (index > 0) expect(time - (times[index - 1] as number)).toBeGreaterThanOrEqual(120);
        }
        expect(slots.every((slot) => slot.windowMinutes === 15)).toBe(true);
      }
    }
  });

  it('gives another set for another seed, and clamps the count', () => {
    expect(suggestSlots(21, 'one')).not.toEqual(suggestSlots(21, 'two'));
    expect(postsPerWeek(suggestSlots(0, 'x'))).toBe(1);
    expect(postsPerWeek(suggestSlots(99, 'x'))).toBe(35);
  });
});

describe('randomTimeOfDay', () => {
  const day = { year: 2026, month: 11, day: 18 };

  it('picks a time inside each part of the day, never on a five-minute mark', () => {
    for (const part of DAY_PARTS) {
      for (let index = 0; index < 30; index += 1) {
        const time = randomTimeOfDay({
          part,
          day,
          seed: `${part}-${index}`,
          taken: [],
          timeZone: ZONE,
          from: MONDAY_6AM,
        }) as number;
        const wall = zonedTime(time, ZONE);
        const minutes = wall.hour * 60 + wall.minute;
        const [first, last] = DAY_PART_RANGES[part];
        expect(minutes).toBeGreaterThanOrEqual(first);
        expect(minutes).toBeLessThanOrEqual(last);
        expect(onFiveMinuteMark(time)).toBe(false);
      }
    }
  });

  it('gives another time for another seed', () => {
    const one = randomTimeOfDay({
      part: 'evening',
      day,
      seed: 'a',
      taken: [],
      timeZone: ZONE,
      from: MONDAY_6AM,
    });
    const two = randomTimeOfDay({
      part: 'evening',
      day,
      seed: 'b',
      taken: [],
      timeZone: ZONE,
      from: MONDAY_6AM,
    });
    expect(one).not.toBe(two);
  });

  it('stays a minute clear of posts already placed, and after now plus the lead time', () => {
    const taken = Array.from({ length: 60 }, (_, index) => at(18, 18, index));
    const time = randomTimeOfDay({
      part: 'evening',
      day,
      seed: 'x',
      taken,
      timeZone: ZONE,
      from: MONDAY_6AM,
    }) as number;
    expect(taken.some((other) => Math.abs(other - time) <= MS_PER_MINUTE)).toBe(false);

    const lateToday = at(16, 21, 0);
    const today = { year: 2026, month: 11, day: 16 };
    const evening = randomTimeOfDay({
      part: 'evening',
      day: today,
      seed: 'y',
      taken: [],
      timeZone: ZONE,
      from: lateToday,
    }) as number;
    expect(evening).toBeGreaterThan(lateToday + SLOT_LEAD_MS);
    expect(
      randomTimeOfDay({
        part: 'morning',
        day: today,
        seed: 'z',
        taken: [],
        timeZone: ZONE,
        from: lateToday,
      }),
    ).toBeNull();
  });
});
