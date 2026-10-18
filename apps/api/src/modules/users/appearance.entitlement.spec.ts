/**
 * Premium-theme entitlement: any enabled workspace on a live paid tier
 * unlocks it, by the plan table's own rule.
 */
jest.mock('@postgear/db', () => {
  const actual = jest.requireActual('@postgear/db');

  return {
    ...actual,
    prisma: { userOrganization: { findMany: jest.fn() } },
  };
});

import { prisma } from '@postgear/db';
import type { SubscriptionLike } from '../billing/plans';
import {
  ENTITLEMENT_SUBSCRIPTION_SELECT,
  hasPremiumThemes,
  premiumUnlockedFrom,
} from './appearance.entitlement';

const db = prisma as unknown as { userOrganization: { findMany: jest.Mock } };

const NOW = new Date('2026-10-17T12:00:00.000Z');
const LATER = new Date('2026-10-30T12:00:00.000Z');
const EARLIER = new Date('2026-10-01T12:00:00.000Z');

function row(overrides: Partial<SubscriptionLike> = {}): SubscriptionLike {
  return {
    subscriptionTier: 'STANDARD',
    status: 'ACTIVE',
    period: 'MONTHLY',
    trialEndsAt: null,
    currentPeriodEnd: LATER,
    cancelAt: null,
    deletedAt: null,
    isLifetime: false,
    scheduledTier: null,
    scheduledPeriod: null,
    ...overrides,
  };
}

describe('premiumUnlockedFrom', () => {
  it('is locked with no workspaces, or only workspaces without a plan', () => {
    expect(premiumUnlockedFrom([], NOW)).toBe(false);
    expect(premiumUnlockedFrom([null, null], NOW)).toBe(false);
  });

  it('unlocks for an active paid plan', () => {
    expect(premiumUnlockedFrom([row()], NOW)).toBe(true);
  });

  it('unlocks for a trial still running, not for one that has ended', () => {
    expect(premiumUnlockedFrom([row({ status: 'TRIALING', trialEndsAt: LATER })], NOW)).toBe(true);
    expect(premiumUnlockedFrom([row({ status: 'TRIALING', trialEndsAt: EARLIER })], NOW)).toBe(
      false,
    );
  });

  it('keeps a scheduled cancellation and past-due grace, drops a cancelled, incomplete or deleted plan', () => {
    expect(premiumUnlockedFrom([row({ cancelAt: LATER })], NOW)).toBe(true);
    expect(premiumUnlockedFrom([row({ status: 'PAST_DUE' })], NOW)).toBe(true);
    expect(premiumUnlockedFrom([row({ status: 'CANCELED' })], NOW)).toBe(false);
    expect(premiumUnlockedFrom([row({ status: 'INCOMPLETE' })], NOW)).toBe(false);
    expect(premiumUnlockedFrom([row({ deletedAt: EARLIER })], NOW)).toBe(false);
  });

  it('unlocks when any one of several workspaces is paid', () => {
    expect(premiumUnlockedFrom([null, row({ status: 'CANCELED' }), row()], NOW)).toBe(true);
  });

  it('honours a lifetime grant whatever its status', () => {
    expect(premiumUnlockedFrom([row({ isLifetime: true, status: 'CANCELED' })], NOW)).toBe(true);
  });
});

describe('hasPremiumThemes', () => {
  it('reads only enabled memberships, with the columns the rule needs', async () => {
    db.userOrganization.findMany.mockResolvedValue([
      { organization: { subscription: null } },
      { organization: { subscription: row({ subscriptionTier: 'PRO' }) } },
    ]);

    await expect(hasPremiumThemes('u1', NOW)).resolves.toBe(true);
    expect(db.userOrganization.findMany).toHaveBeenCalledWith({
      where: { userId: 'u1', disabled: false },
      select: {
        organization: { select: { subscription: { select: ENTITLEMENT_SUBSCRIPTION_SELECT } } },
      },
    });
  });

  it('is locked for a user whose workspaces are all on Free', async () => {
    db.userOrganization.findMany.mockResolvedValue([{ organization: { subscription: null } }]);

    await expect(hasPremiumThemes('u1', NOW)).resolves.toBe(false);
  });
});
