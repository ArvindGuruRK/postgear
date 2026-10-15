import { hashString, minuteOffset, nextSyncSlot, SYNC_INTERVAL_MS } from './analytics-slot';

describe('hashString', () => {
  it('is stable, unsigned, and spreads similar ids apart', () => {
    expect(hashString('seed-channel-linkedin')).toBe(hashString('seed-channel-linkedin'));
    expect(hashString('a')).not.toBe(hashString('b'));
    expect(hashString('')).toBeGreaterThanOrEqual(0);
  });
});

describe('nextSyncSlot', () => {
  const id = 'ch-1';
  const offset = minuteOffset(id);

  it('is a day later, at the channel’s own minute of that hour', () => {
    const last = Date.UTC(2026, 9, 14, 10, 23, 45);
    const slot = nextSyncSlot(last, id);
    const date = new Date(slot);

    expect(slot - last).toBeGreaterThan(SYNC_INTERVAL_MS - 60 * 60_000);
    expect(slot - last).toBeLessThan(SYNC_INTERVAL_MS + 60 * 60_000);
    expect(date.getUTCHours()).toBe(10);
    expect(date.getUTCMinutes()).toBe(offset);
    expect(date.getUTCSeconds()).toBe(0);
  });

  it('is the same minute for the same channel every day, and differs between channels', () => {
    const first = nextSyncSlot(Date.UTC(2026, 9, 14, 10, 0), id);
    const second = nextSyncSlot(first, id);

    expect(new Date(second).getUTCMinutes()).toBe(new Date(first).getUTCMinutes());
    expect(second - first).toBe(SYNC_INTERVAL_MS);

    const minutes = new Set(
      ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((other) => minuteOffset(other)),
    );
    expect(minutes.size).toBeGreaterThan(1);
    for (const minute of minutes) {
      expect(minute).toBeGreaterThanOrEqual(0);
      expect(minute).toBeLessThan(60);
    }
  });

  it('never lands in the past: a loop that was down a week syncs once, not seven times', () => {
    const last = Date.UTC(2026, 9, 1, 10, 0);
    const now = Date.UTC(2026, 9, 8, 15, 0);
    const slot = nextSyncSlot(last, id, now);

    expect(slot).toBeGreaterThan(now);
    expect(slot - now).toBeLessThanOrEqual(SYNC_INTERVAL_MS);
    expect(new Date(slot).getUTCMinutes()).toBe(offset);
  });
});
