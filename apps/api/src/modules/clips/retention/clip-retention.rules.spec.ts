/**
 * The retention clock's rules (Module 19 section 1): dates move forward on
 * use, never closer than three days, the notice once, and a plan that now
 * keeps videos longer moves the date instead of removing.
 */
import {
  DAY_MS,
  decideDue,
  expiryFrom,
  needsTouch,
  nextExpiry,
  noticeDue,
  retentionDaysOf,
} from './clip-retention.rules';

const NOW = new Date('2026-11-19T12:00:00.000Z');
const days = (n: number) => new Date(NOW.getTime() + n * DAY_MS);

describe('retentionDaysOf', () => {
  it('reads whole days, at least one', () => {
    expect(retentionDaysOf(14)).toBe(14);
    expect(retentionDaysOf(7.9)).toBe(7);
    expect(retentionDaysOf(0)).toBe(1);
    expect(retentionDaysOf('x')).toBe(1);
    expect(retentionDaysOf(null)).toBe(1);
  });
});

describe('expiryFrom', () => {
  it('adds the plan days to the last use', () => {
    expect(expiryFrom(NOW, 7)).toEqual(days(7));
  });
});

describe('nextExpiry', () => {
  it('takes a later date as it is', () => {
    expect(nextExpiry(days(5), days(14), NOW)).toEqual(days(14));
    expect(nextExpiry(null, days(7), NOW)).toEqual(days(7));
  });

  it('never moves an existing date closer than three days from now', () => {
    // A downgrade from 30 days to 1: the video keeps at least three days.
    expect(nextExpiry(days(25), days(1), NOW)).toEqual(days(3));
    // A plan of five days: five is more than three, so five it is.
    expect(nextExpiry(days(25), days(5), NOW)).toEqual(days(5));
  });

  it('keeps a date that was already sooner than three days', () => {
    expect(nextExpiry(days(2), days(1), NOW)).toEqual(days(2));
  });
});

describe('needsTouch', () => {
  it('writes at most once a day', () => {
    expect(
      needsTouch({ lastUsedAt: new Date(NOW.getTime() - 3_600_000), expiresAt: days(6) }, NOW),
    ).toBe(false);
    expect(
      needsTouch({ lastUsedAt: new Date(NOW.getTime() - DAY_MS), expiresAt: days(6) }, NOW),
    ).toBe(true);
  });

  it('always writes a video that has no date yet', () => {
    expect(needsTouch({ lastUsedAt: NOW, expiresAt: null }, NOW)).toBe(true);
  });
});

describe('noticeDue', () => {
  it('is due within three days, once', () => {
    expect(noticeDue({ expiresAt: days(3), expiryNoticeAt: null }, NOW)).toBe(true);
    expect(noticeDue({ expiresAt: days(3.5), expiryNoticeAt: null }, NOW)).toBe(false);
    expect(noticeDue({ expiresAt: days(2), expiryNoticeAt: NOW }, NOW)).toBe(false);
    expect(noticeDue({ expiresAt: null, expiryNoticeAt: null }, NOW)).toBe(false);
  });
});

describe('decideDue', () => {
  const lastUsed = days(-5);

  it('sends the notice when the date is within three days', () => {
    expect(
      decideDue({ lastUsedAt: lastUsed, expiresAt: days(2), expiryNoticeAt: null }, 7, NOW),
    ).toEqual({
      kind: 'notice',
    });
  });

  it('removes once the date has passed and the notice went out', () => {
    expect(
      decideDue({ lastUsedAt: lastUsed, expiresAt: days(-0.1), expiryNoticeAt: days(-3) }, 5, NOW),
    ).toEqual({ kind: 'remove' });
  });

  it('sends the notice first when the date passed without one (the sweep was away)', () => {
    expect(
      decideDue({ lastUsedAt: lastUsed, expiresAt: days(-1), expiryNoticeAt: null }, 4, NOW),
    ).toEqual({
      kind: 'notice',
    });
  });

  it('moves the date forward when the plan now keeps videos longer', () => {
    expect(
      decideDue({ lastUsedAt: lastUsed, expiresAt: days(2), expiryNoticeAt: null }, 30, NOW),
    ).toEqual({
      kind: 'extend',
      expiresAt: days(25),
    });
    // Even a date that passed: an upgrade keeps the video.
    expect(
      decideDue({ lastUsedAt: lastUsed, expiresAt: days(-1), expiryNoticeAt: days(-4) }, 14, NOW),
    ).toEqual({ kind: 'extend', expiresAt: days(9) });
  });

  it('waits when the notice went out and the date is still ahead', () => {
    expect(
      decideDue({ lastUsedAt: lastUsed, expiresAt: days(1), expiryNoticeAt: days(-2) }, 6, NOW),
    ).toEqual({
      kind: 'wait',
    });
    expect(
      decideDue({ lastUsedAt: lastUsed, expiresAt: null, expiryNoticeAt: null }, 7, NOW),
    ).toEqual({
      kind: 'wait',
    });
  });
});
