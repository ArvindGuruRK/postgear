/**
 * The cycle maths, pinned (the same cases the credits policy has always had,
 * since `cycleFor` moved here unchanged), and the UTC day window.
 */
import { cycleFor, dayWindow, meterWindow } from './cycle';

const utc = (iso: string): Date => new Date(iso);

describe('cycleFor', () => {
  it('runs from the anchor day of this month when that day has passed', () => {
    const cycle = cycleFor(utc('2026-03-13T15:42:00Z'), utc('2026-10-20T09:00:00Z'));

    expect(cycle.start.toISOString()).toBe('2026-10-13T00:00:00.000Z');
    expect(cycle.end.toISOString()).toBe('2026-11-13T00:00:00.000Z');
  });

  it('runs from last month when the anchor day is still ahead', () => {
    const cycle = cycleFor(utc('2026-03-13T15:42:00Z'), utc('2026-10-05T09:00:00Z'));

    expect(cycle.start.toISOString()).toBe('2026-09-13T00:00:00.000Z');
    expect(cycle.end.toISOString()).toBe('2026-10-13T00:00:00.000Z');
  });

  it('starts a new cycle at midnight on the anchor day itself', () => {
    const cycle = cycleFor(utc('2026-03-13T15:42:00Z'), utc('2026-10-13T00:00:00Z'));

    expect(cycle.start.toISOString()).toBe('2026-10-13T00:00:00.000Z');
  });

  it('clamps a day-31 anchor to shorter months without skipping any', () => {
    const anchor = utc('2026-01-31T10:00:00Z');

    const february = cycleFor(anchor, utc('2026-02-15T00:00:00Z'));
    expect(february.start.toISOString()).toBe('2026-01-31T00:00:00.000Z');
    expect(february.end.toISOString()).toBe('2026-02-28T00:00:00.000Z');

    const march = cycleFor(anchor, utc('2026-03-01T00:00:00Z'));
    expect(march.start.toISOString()).toBe('2026-02-28T00:00:00.000Z');
    expect(march.end.toISOString()).toBe('2026-03-31T00:00:00.000Z');

    const april = cycleFor(anchor, utc('2026-04-30T23:59:59Z'));
    expect(april.start.toISOString()).toBe('2026-04-30T00:00:00.000Z');
    expect(april.end.toISOString()).toBe('2026-05-31T00:00:00.000Z');
  });

  it('crosses the year boundary', () => {
    const cycle = cycleFor(utc('2025-12-20T00:00:00Z'), utc('2026-01-10T00:00:00Z'));

    expect(cycle.start.toISOString()).toBe('2025-12-20T00:00:00.000Z');
    expect(cycle.end.toISOString()).toBe('2026-01-20T00:00:00.000Z');
  });

  it('handles a leap year February', () => {
    const cycle = cycleFor(utc('2027-01-30T00:00:00Z'), utc('2028-02-29T12:00:00Z'));

    expect(cycle.start.toISOString()).toBe('2028-02-29T00:00:00.000Z');
    expect(cycle.end.toISOString()).toBe('2028-03-30T00:00:00.000Z');
  });
});

describe('dayWindow', () => {
  it('runs midnight UTC to the next midnight UTC', () => {
    const day = dayWindow(utc('2026-11-18T23:59:59.999Z'));

    expect(day.start.toISOString()).toBe('2026-11-18T00:00:00.000Z');
    expect(day.end.toISOString()).toBe('2026-11-19T00:00:00.000Z');
  });

  it('starts a new day at midnight exactly, and crosses months and years', () => {
    expect(dayWindow(utc('2026-11-19T00:00:00Z')).start.toISOString()).toBe(
      '2026-11-19T00:00:00.000Z',
    );
    expect(dayWindow(utc('2026-12-31T08:00:00Z')).end.toISOString()).toBe(
      '2027-01-01T00:00:00.000Z',
    );
  });
});

describe('meterWindow', () => {
  it('picks the cycle or the day by the meter kind', () => {
    const anchor = utc('2026-03-13T00:00:00Z');
    const now = utc('2026-11-18T10:00:00Z');

    expect(meterWindow('cycle', anchor, now)).toEqual(cycleFor(anchor, now));
    expect(meterWindow('day', anchor, now)).toEqual(dayWindow(now));
  });
});
