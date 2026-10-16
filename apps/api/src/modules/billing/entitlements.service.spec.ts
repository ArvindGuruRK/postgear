/**
 * The entitlement every other module gates on: the channel ceiling at and
 * below the limit, a lifetime or hand-granted row winning over the plan's
 * number, and who may start a trial.
 */
import type { BillingConfig } from './billing.config';
import type { BillingRepository } from './billing.repository';
import { ChannelLimitReachedError, channelLimitOf, EntitlementsService } from './entitlements.service';
import { FakeBillingStore, NOW, orgBilling, subscriptionRow } from './testing/fake-billing-store';

function config(overrides: Partial<BillingConfig> = {}): BillingConfig {
  return {
    mode: 'simulation',
    secretKey: null,
    webhookSecret: null,
    publishableKey: null,
    trialDays: 14,
    priceIds: {},
    webUrl: 'http://localhost:3000',
    warnings: [],
    ...overrides,
  };
}

function service(store: FakeBillingStore, overrides: Partial<BillingConfig> = {}) {
  return new EntitlementsService(store as unknown as BillingRepository, config(overrides));
}

describe('EntitlementsService', () => {
  describe('channel usage', () => {
    it('reads the plan limit for a live subscription', async () => {
      const store = new FakeBillingStore([orgBilling()]);
      store.liveChannels.set('org_1', 3);

      await expect(service(store).channelUsage('org_1', NOW)).resolves.toEqual({
        used: 3,
        limit: 5,
        tier: 'STANDARD',
      });
    });

    it('falls to the FREE limit for a workspace with no live plan, or none at all', async () => {
      const store = new FakeBillingStore([
        orgBilling({ id: 'org_1', subscription: subscriptionRow({ status: 'CANCELED', totalChannels: 40 }) }),
      ]);
      store.liveChannels.set('org_1', 2);

      await expect(service(store).channelUsage('org_1', NOW)).resolves.toEqual({
        used: 2,
        limit: 1,
        tier: 'FREE',
      });
      await expect(service(store).channelUsage('org_missing', NOW)).resolves.toEqual({
        used: 0,
        limit: 1,
        tier: 'FREE',
      });
    });

    it('lets a hand-granted totalChannels, and a lifetime row, win over the plan', () => {
      expect(channelLimitOf(subscriptionRow({ totalChannels: 12 }), NOW)).toEqual({
        limit: 12,
        tier: 'STANDARD',
      });
      expect(channelLimitOf(subscriptionRow({ totalChannels: 2 }), NOW).limit).toBe(5);
      expect(
        channelLimitOf(subscriptionRow({ isLifetime: true, status: 'CANCELED', totalChannels: 50 }), NOW),
      ).toEqual({ limit: 50, tier: 'STANDARD' });
    });

    it('allows a connection below the limit and refuses one at it, logging the refusal', async () => {
      const store = new FakeBillingStore([orgBilling()]);
      const entitlements = service(store);

      store.liveChannels.set('org_1', 4);
      await expect(entitlements.assertCanConnect('org_1')).resolves.toMatchObject({ used: 4, limit: 5 });

      store.liveChannels.set('org_1', 5);
      await expect(entitlements.assertCanConnect('org_1')).rejects.toBeInstanceOf(
        ChannelLimitReachedError,
      );
      await expect(entitlements.checkConnect('org_1')).resolves.toMatchObject({ allowed: false });
    });
  });

  describe('startTrial', () => {
    it('creates the TRIALING PRO row, flips the org flags and writes the notification', async () => {
      const store = new FakeBillingStore([orgBilling({ subscription: null, paymentId: null })]);

      const entitlement = await service(store).startTrial('org_1', NOW);

      expect(entitlement).toMatchObject({ tier: 'PRO', status: 'trialing' });
      expect(store.subscription()).toMatchObject({
        subscriptionTier: 'PRO',
        status: 'TRIALING',
        identifier: null,
        totalChannels: 15,
        trialEndsAt: new Date('2026-10-30T12:00:00.000Z'),
      });
      expect(store.org()).toMatchObject({ isTrailing: true, allowTrial: false });
      expect(store.notifications).toEqual([
        expect.objectContaining({
          organizationId: 'org_1',
          type: 'billing.trial_started',
          link: '/org_1/settings/billing',
          meta: expect.objectContaining({ tier: 'PRO' }),
        }),
      ]);
    });

    it('refuses when any row exists, even a cancelled one', async () => {
      const store = new FakeBillingStore([
        orgBilling({ subscription: subscriptionRow({ status: 'CANCELED', deletedAt: NOW }) }),
      ]);

      await expect(service(store).startTrial('org_1', NOW)).resolves.toBeNull();
      await expect(service(store).canStartTrial('org_1')).resolves.toBe(false);
      expect(store.notifications).toHaveLength(0);
    });

    it('refuses when trials are off or the workspace does not exist', async () => {
      const store = new FakeBillingStore([orgBilling({ subscription: null })]);

      await expect(service(store, { trialDays: 0 }).startTrial('org_1', NOW)).resolves.toBeNull();
      await expect(service(store).startTrial('org_nope', NOW)).resolves.toBeNull();
      expect(store.org().subscription).toBeNull();
    });
  });
});
