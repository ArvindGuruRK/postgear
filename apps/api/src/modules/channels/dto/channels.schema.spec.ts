/**
 * The two request shapes the UI revamp added to the channels API
 * (2026-10-19): `disabled` on `PATCH /channels/:id`, and the body of
 * `PUT /channels/order`.
 */
import { reorderChannelsSchema, updateChannelSchema } from './channels.schema';

describe('updateChannelSchema: disabled', () => {
  it('accepts disabled on its own, either way', () => {
    expect(updateChannelSchema.safeParse({ disabled: true }).success).toBe(true);
    expect(updateChannelSchema.safeParse({ disabled: false }).success).toBe(true);
  });

  it('refuses a disabled that is not a boolean', () => {
    expect(updateChannelSchema.safeParse({ disabled: 'yes' }).success).toBe(false);
  });

  it('still refuses an empty update', () => {
    expect(updateChannelSchema.safeParse({}).success).toBe(false);
  });

  it('takes a rename and a colour in one request, as Preferences sends them', () => {
    const parsed = updateChannelSchema.safeParse({ name: '  Acme   Studio ', color: 3 });

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).toEqual({ name: 'Acme Studio', color: 3 });
  });
});

describe('reorderChannelsSchema', () => {
  it('accepts a list of ids', () => {
    expect(reorderChannelsSchema.safeParse({ ids: ['b', 'a', 'c'] }).success).toBe(true);
  });

  it('refuses an empty list, a repeated id and an unknown key', () => {
    expect(reorderChannelsSchema.safeParse({ ids: [] }).success).toBe(false);
    expect(reorderChannelsSchema.safeParse({ ids: ['a', 'b', 'a'] }).success).toBe(false);
    expect(reorderChannelsSchema.safeParse({ ids: ['a'], orgId: 'other' }).success).toBe(false);
  });

  it('refuses ids that are not strings', () => {
    expect(reorderChannelsSchema.safeParse({ ids: [1, 2] }).success).toBe(false);
    expect(reorderChannelsSchema.safeParse({ ids: [''] }).success).toBe(false);
  });
});

describe('updateChannelSchema: posting slots (Sprint 13 Module 13)', () => {
  const slot = (extra: Record<string, unknown>) => ({ postingTimes: [{ time: 540, ...extra }] });

  it('defaults a bare time to every day with no window, and sorts the days', () => {
    const parsed = updateChannelSchema.parse(slot({}));
    expect(parsed.postingTimes).toEqual([
      { time: 540, windowMinutes: 0, days: [1, 2, 3, 4, 5, 6, 7] },
    ]);
    expect(updateChannelSchema.parse(slot({ days: [4, 2] })).postingTimes?.[0]?.days).toEqual([
      2, 4,
    ]);
  });

  it('takes only windows of 0, 5, 15 or 30 minutes', () => {
    for (const windowMinutes of [0, 5, 15, 30]) {
      expect(updateChannelSchema.safeParse(slot({ windowMinutes })).success).toBe(true);
    }
    for (const windowMinutes of [1, 10, 60, -5]) {
      expect(updateChannelSchema.safeParse(slot({ windowMinutes })).success).toBe(false);
    }
  });

  it('takes 1 to 7 distinct weekdays, at least one, and nothing else', () => {
    expect(updateChannelSchema.safeParse(slot({ days: [] })).success).toBe(false);
    expect(updateChannelSchema.safeParse(slot({ days: [0] })).success).toBe(false);
    expect(updateChannelSchema.safeParse(slot({ days: [8] })).success).toBe(false);
    expect(updateChannelSchema.safeParse(slot({ days: [2, 2] })).success).toBe(false);
    expect(updateChannelSchema.safeParse(slot({ label: 'x' })).success).toBe(false);
  });
});
