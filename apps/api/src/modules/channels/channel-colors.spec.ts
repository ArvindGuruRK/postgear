/**
 * The channel colour rule: creation order (then id) across every row the
 * workspace has ever had, soft-deleted ones included, wrapping after seven.
 */
jest.mock('@postgear/db', () => ({
  prisma: { integration: { findMany: jest.fn() } },
}));

import { prisma } from '@postgear/db';
import {
  assignChannelColors,
  CHANNEL_COLOR_COUNT,
  colorOf,
  loadChannelColors,
} from './channel-colors';

const findMany = prisma.integration.findMany as unknown as jest.Mock;

const at = (minute: number) => new Date(Date.UTC(2026, 9, 1, 9, minute));

describe('channel colours', () => {
  beforeEach(() => findMany.mockReset());

  it('hands out slots in creation order, whatever order the rows arrive in', () => {
    const colors = assignChannelColors([
      { id: 'c', createdAt: at(30) },
      { id: 'a', createdAt: at(10) },
      { id: 'b', createdAt: at(20) },
    ]);

    expect([colors.get('a'), colors.get('b'), colors.get('c')]).toEqual([0, 1, 2]);
  });

  it('breaks a createdAt tie by id', () => {
    const colors = assignChannelColors([
      { id: 'ch_b', createdAt: at(10) },
      { id: 'ch_a', createdAt: at(10) },
    ]);

    expect(colors.get('ch_a')).toBe(0);
    expect(colors.get('ch_b')).toBe(1);
  });

  it('wraps after the palette runs out', () => {
    const rows = Array.from({ length: CHANNEL_COLOR_COUNT + 2 }, (_, index) => ({
      id: `ch_${String(index).padStart(2, '0')}`,
      createdAt: at(index),
    }));
    const colors = assignChannelColors(rows);

    expect(CHANNEL_COLOR_COUNT).toBe(7);
    expect(colors.get('ch_06')).toBe(6);
    expect(colors.get('ch_07')).toBe(0);
    expect(colors.get('ch_08')).toBe(1);
  });

  it('counts soft-deleted channels, so deleting one never repaints the rest', async () => {
    // The second channel was disconnected: its row stays, and so does its slot.
    findMany.mockResolvedValue([
      { id: 'first', createdAt: at(1) },
      { id: 'deleted', createdAt: at(2) },
      { id: 'third', createdAt: at(3) },
    ]);

    const colors = await loadChannelColors('org_1');

    expect(colors.get('first')).toBe(0);
    expect(colors.get('deleted')).toBe(1);
    expect(colors.get('third')).toBe(2);

    const [args] = findMany.mock.calls[0];
    expect(args.where).toEqual({ organizationId: 'org_1' });
    expect(args.where).not.toHaveProperty('deletedAt');
    expect(args.orderBy).toEqual([{ createdAt: 'asc' }, { id: 'asc' }]);
    expect(args.select).toEqual({ id: true, createdAt: true });
  });

  it('gives a channel newer than the map the next slot', () => {
    const colors = assignChannelColors([
      { id: 'a', createdAt: at(1) },
      { id: 'b', createdAt: at(2) },
    ]);

    expect(colorOf(colors, 'b')).toBe(1);
    expect(colorOf(colors, 'just-connected')).toBe(2);
  });
});
