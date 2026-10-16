/**
 * The billing request schemas: what they accept, what they clean, what
 * they refuse.
 */
import { cancelSchema, planSelectionSchema } from './billing.schema';

describe('planSelectionSchema', () => {
  it('accepts a paid tier and a period', () => {
    expect(planSelectionSchema.parse({ tier: 'PRO', period: 'YEARLY' })).toEqual({ tier: 'PRO', period: 'YEARLY' });
  });

  it('refuses FREE, unknown tiers, unknown periods and extra keys', () => {
    expect(planSelectionSchema.safeParse({ tier: 'FREE', period: 'MONTHLY' }).success).toBe(false);
    expect(planSelectionSchema.safeParse({ tier: 'GOLD', period: 'MONTHLY' }).success).toBe(false);
    expect(planSelectionSchema.safeParse({ tier: 'PRO', period: 'WEEKLY' }).success).toBe(false);
    expect(planSelectionSchema.safeParse({ tier: 'PRO', period: 'MONTHLY', orgId: 'x' }).success).toBe(false);
    expect(planSelectionSchema.safeParse({ tier: 'PRO' }).success).toBe(false);
  });
});

describe('cancelSchema', () => {
  it('accepts a reason alone, or with feedback it cleans', () => {
    expect(cancelSchema.parse({ reason: 'not_using' })).toEqual({ reason: 'not_using', feedback: undefined });
    expect(
      cancelSchema.parse({ reason: 'other', feedback: '  Too <b>many</b> emails\u0000 ' }),
    ).toEqual({ reason: 'other', feedback: 'Too many emails' });
  });

  it('turns blank feedback into none, and bounds it', () => {
    expect(cancelSchema.parse({ reason: 'switching', feedback: '   ' }).feedback).toBeUndefined();
    expect(cancelSchema.safeParse({ reason: 'switching', feedback: 'a'.repeat(1_001) }).success).toBe(false);
    expect(cancelSchema.safeParse({ reason: 'switching', feedback: 'a'.repeat(1_000) }).success).toBe(true);
  });

  it('refuses an unknown reason or an extra key', () => {
    expect(cancelSchema.safeParse({ reason: 'bored' }).success).toBe(false);
    expect(cancelSchema.safeParse({ reason: 'other', refund: true }).success).toBe(false);
  });
});
