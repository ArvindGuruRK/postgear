import { DEFAULT_POSTING_TIMES, nextFreeSlot } from './next-free-slot';

const at = (iso: string) => Date.parse(iso);
const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());
const hm = (hour: number, minute = 0) => hour * 60 + minute;

describe('nextFreeSlot', () => {
  it('takes the first posting time later than five minutes from now', () => {
    const slot = nextFreeSlot({
      postingTimes: [hm(9), hm(13), hm(18)],
      taken: [],
      from: at('2026-11-03T08:56:00Z'),
      timeZone: 'UTC',
    });
    // 09:00 is only four minutes away, so the 13:00 slot is next.
    expect(iso(slot)).toBe('2026-11-03T13:00:00.000Z');
    expect(
      iso(
        nextFreeSlot({
          postingTimes: [hm(9), hm(13)],
          taken: [],
          from: at('2026-11-03T08:54:00Z'),
          timeZone: 'UTC',
        }),
      ),
    ).toBe('2026-11-03T09:00:00.000Z');
  });

  it('skips a slot with a queued post within a minute of it, either side', () => {
    const base = { postingTimes: [hm(9), hm(13), hm(18)], from: at('2026-11-03T07:00:00Z') };
    expect(
      iso(nextFreeSlot({ ...base, taken: [at('2026-11-03T09:00:00Z')], timeZone: 'UTC' })),
    ).toBe('2026-11-03T13:00:00.000Z');
    expect(
      iso(
        nextFreeSlot({
          ...base,
          taken: [at('2026-11-03T08:59:30Z'), new Date('2026-11-03T13:01:00Z')],
          timeZone: 'UTC',
        }),
      ),
    ).toBe('2026-11-03T18:00:00.000Z');
    // A minute and a half away is not a clash.
    expect(
      iso(nextFreeSlot({ ...base, taken: [at('2026-11-03T09:01:30Z')], timeZone: 'UTC' })),
    ).toBe('2026-11-03T09:00:00.000Z');
  });

  it('crosses midnight in the step’s zone, not in UTC', () => {
    // 23:58 in Kolkata (18:28 UTC): the 23:50 slot has passed, so 09:00 tomorrow.
    const slot = nextFreeSlot({
      postingTimes: [hm(9), hm(23, 50)],
      taken: [],
      from: at('2026-11-03T18:28:00Z'),
      timeZone: 'Asia/Kolkata',
    });
    expect(iso(slot)).toBe('2026-11-04T03:30:00.000Z');
  });

  it('rolls over to the next day when every slot today is taken', () => {
    const slot = nextFreeSlot({
      postingTimes: [hm(9), hm(17)],
      taken: [at('2026-11-03T09:00:00Z'), at('2026-11-03T17:00:00Z')],
      from: at('2026-11-03T06:00:00Z'),
      timeZone: 'Europe/London',
    });
    expect(iso(slot)).toBe('2026-11-04T09:00:00.000Z');
  });

  it('keeps 09:00 at 09:00 local when London goes onto summer time', () => {
    // The clocks go forward at 01:00 UTC on Sunday 29 March 2026.
    const before = nextFreeSlot({
      postingTimes: [hm(9)],
      taken: [],
      from: at('2026-03-28T06:00:00Z'),
      timeZone: 'Europe/London',
    });
    expect(iso(before)).toBe('2026-03-28T09:00:00.000Z');
    const after = nextFreeSlot({
      postingTimes: [hm(9)],
      taken: [at('2026-03-28T09:00:00Z')],
      from: at('2026-03-28T06:00:00Z'),
      timeZone: 'Europe/London',
    });
    expect(iso(after)).toBe('2026-03-29T08:00:00.000Z');
  });

  it('moves a time the clocks skip forward by the gap', () => {
    // 01:30 never happens in London on 29 March 2026; it becomes 02:30 BST.
    const slot = nextFreeSlot({
      postingTimes: [hm(1, 30)],
      taken: [],
      from: at('2026-03-28T23:00:00Z'),
      timeZone: 'Europe/London',
    });
    expect(iso(slot)).toBe('2026-03-29T01:30:00.000Z');
  });

  it('keeps 09:00 at 09:00 local when New York leaves daylight time', () => {
    // EDT ends at 06:00 UTC on Sunday 1 November 2026.
    const slot = nextFreeSlot({
      postingTimes: [hm(9)],
      taken: [],
      from: at('2026-10-31T20:00:00Z'),
      timeZone: 'America/New_York',
    });
    expect(iso(slot)).toBe('2026-11-01T14:00:00.000Z');
    const saturday = nextFreeSlot({
      postingTimes: [hm(9)],
      taken: [],
      from: at('2026-10-31T06:00:00Z'),
      timeZone: 'America/New_York',
    });
    expect(iso(saturday)).toBe('2026-10-31T13:00:00.000Z');
  });

  it('takes the first of a time that happens twice when the clocks go back', () => {
    // 01:30 happens at 05:30 UTC (EDT) and again at 06:30 UTC (EST).
    const slot = nextFreeSlot({
      postingTimes: [hm(1, 30)],
      taken: [],
      from: at('2026-11-01T03:00:00Z'),
      timeZone: 'America/New_York',
    });
    expect(iso(slot)).toBe('2026-11-01T05:30:00.000Z');
  });

  it('falls back to a fresh channel’s posting times when there are none', () => {
    const from = at('2026-11-03T00:00:00Z');
    const empty = nextFreeSlot({ postingTimes: [], taken: [], from, timeZone: 'UTC' });
    const defaults = nextFreeSlot({
      postingTimes: DEFAULT_POSTING_TIMES,
      taken: [],
      from,
      timeZone: 'UTC',
    });
    expect(iso(empty)).toBe('2026-11-03T02:00:00.000Z');
    expect(empty).toBe(defaults);
    // Unreadable entries are ignored the same way.
    expect(nextFreeSlot({ postingTimes: [-5, 1440, 3.5], taken: [], from, timeZone: 'UTC' })).toBe(
      defaults,
    );
  });

  it('gives up after a year of taken slots', () => {
    const from = at('2026-11-03T00:00:00Z');
    const taken = Array.from({ length: 400 }, (_, day) => from + day * 86_400_000 + 9 * 3_600_000);
    expect(nextFreeSlot({ postingTimes: [hm(9)], taken, from, timeZone: 'UTC' })).toBeNull();
  });
});
