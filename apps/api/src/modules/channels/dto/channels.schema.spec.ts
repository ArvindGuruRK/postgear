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
