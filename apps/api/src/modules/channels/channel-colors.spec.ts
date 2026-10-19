/**
 * The channel colour rule: a stored slot, the least-used one on connect,
 * never recomputed on read.
 */
jest.mock('@postgear/db', () => ({
  prisma: {
    integration: { findMany: jest.fn(), updateMany: jest.fn() },
    $transaction: jest.fn(),
    $executeRaw: jest.fn(),
  },
}));

import { prisma } from '@postgear/db';
import {
  CHANNEL_COLOR_COUNT,
  colorOf,
  loadChannelColors,
  nextChannelColor,
  pickChannelColor,
} from './channel-colors';

const db = prisma as unknown as {
  integration: { findMany: jest.Mock; updateMany: jest.Mock };
  $transaction: jest.Mock;
  $executeRaw: jest.Mock;
};

describe('channel colours', () => {
  beforeEach(() => {
    db.integration.findMany.mockReset();
    db.integration.updateMany.mockReset();
    db.$executeRaw.mockReset().mockResolvedValue(1);
    db.$transaction
      .mockReset()
      .mockImplementation(async (callback: (tx: unknown) => unknown) => callback(db));
  });

  describe('pickChannelColor', () => {
    it('takes the first slot nobody uses', () => {
      expect(pickChannelColor([])).toBe(0);
      expect(pickChannelColor([0, 1, 2])).toBe(3);
      // A gap left by a disconnected channel is filled first.
      expect(pickChannelColor([0, 2, 3])).toBe(1);
    });

    it('takes the least-used slot, lowest first, once all are in use', () => {
      const allOnce = Array.from({ length: CHANNEL_COLOR_COUNT }, (_, slot) => slot);

      expect(CHANNEL_COLOR_COUNT).toBe(7);
      expect(pickChannelColor(allOnce)).toBe(0);
      expect(pickChannelColor([...allOnce, 0, 1])).toBe(2);
      expect(pickChannelColor([...allOnce, ...allOnce, 3])).toBe(0);
    });

    it('ignores slots outside the palette', () => {
      expect(pickChannelColor([0, 9, -1, 1.5])).toBe(1);
    });
  });

  it('picks a new colour under the workspace lock, from connected channels only', async () => {
    db.integration.findMany.mockResolvedValue([{ color: 0 }, { color: 1 }]);

    await expect(nextChannelColor(db as never, 'org_1')).resolves.toBe(2);

    expect(db.$executeRaw).toHaveBeenCalledTimes(1);
    expect(db.$executeRaw.mock.calls[0]).toContain('channel-colors:org_1');
    expect(db.integration.findMany).toHaveBeenCalledWith({
      where: { organizationId: 'org_1', deletedAt: null, color: { not: null } },
      select: { color: true },
    });
  });

  it('reads stored colours, disconnected channels included, without writing', async () => {
    db.integration.findMany.mockResolvedValue([
      { id: 'first', color: 4 },
      { id: 'deleted', color: 1 },
    ]);

    const colors = await loadChannelColors('org_1');

    expect(colors.get('first')).toBe(4);
    expect(colors.get('deleted')).toBe(1);
    expect(db.integration.findMany.mock.calls[0][0].where).toEqual({ organizationId: 'org_1' });
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.integration.updateMany).not.toHaveBeenCalled();
  });

  it('assigns and stores a colour for a row that has none, once', async () => {
    db.integration.findMany
      // The plain read finds a row without a colour...
      .mockResolvedValueOnce([
        { id: 'a', color: 0 },
        { id: 'b', color: null },
      ])
      // ...and the read under the lock still does.
      .mockResolvedValueOnce([
        { id: 'a', color: 0, deletedAt: null },
        { id: 'gone', color: null, deletedAt: new Date('2026-10-01') },
        { id: 'b', color: null, deletedAt: null },
      ]);

    const colors = await loadChannelColors('org_1');

    expect(db.$executeRaw).toHaveBeenCalledTimes(1);
    // Only live rows hold a slot, so the disconnected row and `b` both get 1.
    expect(colors.get('a')).toBe(0);
    expect(colors.get('gone')).toBe(1);
    expect(colors.get('b')).toBe(1);
    // Guarded on `color: null`, so a concurrent assignment is never overwritten.
    expect(db.integration.updateMany).toHaveBeenCalledWith({
      where: { id: 'b', organizationId: 'org_1', color: null },
      data: { color: 1 },
    });
    expect(db.integration.updateMany).toHaveBeenCalledTimes(2);
  });

  it('draws a channel the map does not know in a stable colour', () => {
    const colors = new Map([['known', 3]]);

    expect(colorOf(colors, 'known')).toBe(3);
    const first = colorOf(colors, 'just-connected');
    expect(first).toBe(colorOf(colors, 'just-connected'));
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThan(CHANNEL_COLOR_COUNT);
  });
});
