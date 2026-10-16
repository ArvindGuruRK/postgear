/**
 * The plan table's entitlement rule, every branch: no row, a deleted row, a
 * trial before and after its end, each Stripe-driven status, a lifetime
 * row, and the ladder an upgrade climbs.
 */
import {
  allowanceFor,
  channelLimitFor,
  isUpgrade,
  PLANS,
  priceFor,
  resolveEntitlement,
  type SubscriptionLike,
} from './plans';

const NOW = new Date('2026-10-16T12:00:00.000Z');

function row(overrides: Partial<SubscriptionLike> = {}): SubscriptionLike {
  return {
    subscriptionTier: 'PRO',
    status: 'ACTIVE',
    period: 'MONTHLY',
    trialEndsAt: null,
    currentPeriodEnd: new Date('2026-11-16T12:00:00.000Z'),
    cancelAt: null,
    deletedAt: null,
    isLifetime: false,
    scheduledTier: null,
    scheduledPeriod: null,
    ...overrides,
  };
}

describe('resolveEntitlement', () => {
  it('is FREE / none with no row', () => {
    expect(resolveEntitlement(null, NOW)).toMatchObject({ tier: 'FREE', status: 'none', plan: PLANS.FREE });
  });

  it('is FREE / canceled for a deleted row that was cancelled, none otherwise', () => {
    expect(resolveEntitlement(row({ deletedAt: NOW, status: 'CANCELED' }), NOW).status).toBe('canceled');
    expect(resolveEntitlement(row({ deletedAt: NOW, status: 'ACTIVE' }), NOW).status).toBe('none');
  });

  it('grants the trial tier while the trial runs, and FREE / trial_expired after', () => {
    const live = resolveEntitlement(
      row({ status: 'TRIALING', trialEndsAt: new Date('2026-10-30T00:00:00.000Z') }),
      NOW,
    );
    expect(live).toMatchObject({ tier: 'PRO', status: 'trialing' });

    const expired = resolveEntitlement(
      row({ status: 'TRIALING', trialEndsAt: new Date('2026-10-01T00:00:00.000Z') }),
      NOW,
    );
    expect(expired).toMatchObject({ tier: 'FREE', status: 'trial_expired' });
    expect(expired.trialEndsAt).toEqual(new Date('2026-10-01T00:00:00.000Z'));
  });

  it('maps ACTIVE to active, or canceling once a cancellation is scheduled', () => {
    expect(resolveEntitlement(row(), NOW).status).toBe('active');
    const canceling = resolveEntitlement(row({ cancelAt: new Date('2026-11-16') }), NOW);
    expect(canceling).toMatchObject({ tier: 'PRO', status: 'canceling' });
    expect(canceling.cancelAt).toEqual(new Date('2026-11-16'));
  });

  it('keeps the tier through PAST_DUE grace, drops it on CANCELED and INCOMPLETE', () => {
    expect(resolveEntitlement(row({ status: 'PAST_DUE' }), NOW)).toMatchObject({
      tier: 'PRO',
      status: 'past_due',
    });
    expect(resolveEntitlement(row({ status: 'CANCELED' }), NOW)).toMatchObject({
      tier: 'FREE',
      status: 'canceled',
    });
    expect(resolveEntitlement(row({ status: 'INCOMPLETE' }), NOW)).toMatchObject({
      tier: 'FREE',
      status: 'incomplete',
    });
  });

  it('treats a lifetime row as active whatever its status says', () => {
    expect(resolveEntitlement(row({ isLifetime: true, status: 'CANCELED' }), NOW)).toMatchObject({
      tier: 'PRO',
      status: 'active',
      isLifetime: true,
    });
  });

  it('carries the scheduled downgrade through', () => {
    expect(
      resolveEntitlement(row({ scheduledTier: 'STANDARD', scheduledPeriod: 'YEARLY' }), NOW),
    ).toMatchObject({ scheduledTier: 'STANDARD', scheduledPeriod: 'YEARLY' });
  });
});

describe('the ladder and the numbers', () => {
  it('ranks the tiers so an upgrade moves up and nothing else does', () => {
    expect(isUpgrade('FREE', 'STANDARD')).toBe(true);
    expect(isUpgrade('STANDARD', 'PRO')).toBe(true);
    expect(isUpgrade('PRO', 'STANDARD')).toBe(false);
    expect(isUpgrade('TEAM', 'TEAM')).toBe(false);
  });

  it('reads limits and prices from the one table', () => {
    expect(channelLimitFor('FREE')).toBe(1);
    expect(channelLimitFor('ULTIMATE')).toBe(100);
    expect(allowanceFor('PRO')).toBe(500);
    expect(priceFor('STANDARD', 'MONTHLY')).toBe(2_900);
    expect(priceFor('STANDARD', 'YEARLY')).toBe(29_000);
  });
});
