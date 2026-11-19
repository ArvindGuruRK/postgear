/**
 * A plan change reaches the limits within seconds (Sprint 12, Module 20
 * section 3). A simulated Stripe upgrade goes through the real webhook
 * handler (the same path `BILLING_SIMULATION` uses), and the resolver's
 * snapshot moves to the new tier: its export quality is what the Export
 * dialog's quality tiles read from `GET /entitlements/me`.
 *
 * Between them is the resolver's cache, 15 seconds per workspace. The
 * webhook rewrites the workspace's Redis stamp after it commits, and the
 * resolver reads that stamp at most once a second, so the change shows on the
 * next read after a second. Without the stamp it would wait out the whole
 * cache, which the second test shows, so a refactor that drops the stamp
 * fails here.
 */
import type { ConfigService } from '@nestjs/config';
import { KEYS, seedValue, TIERS } from '@postgear/entitlements';
import { securityLogger } from '../../common/logging/security-logger';
import type { Env } from '../../config/env';
import type { BillingRepository } from '../billing/billing.repository';
import type { BillingWebhookEvent } from '../billing/billing.types';
import { StripeWebhookService } from '../billing/stripe-webhook.service';
import { FakeBillingStore, NOW, orgBilling } from '../billing/testing/fake-billing-store';
import type { RedisService } from '../redis/redis.service';
import { EntitlementResolver } from './entitlement-resolver';
import type { EntitlementsRepository } from './entitlements.repository';

const ORG = 'org_1';
const NOW_SECONDS = Math.floor(NOW.getTime() / 1_000);
const QUALITY = 'clips.export_max_quality' as const;

/** Redis as the stamps use it: a plain key-value store shared by the webhook and the resolver. */
class FakeRedis {
  readonly values = new Map<string, string>();
  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }
  async set(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }
}

function upgradeToPro(): BillingWebhookEvent {
  return {
    id: `evt_upgrade_${Math.random().toString(36).slice(2)}`,
    type: 'customer.subscription.updated',
    created: NOW_SECONDS,
    data: {
      object: {
        id: 'sub_123',
        object: 'subscription',
        customer: 'cus_123',
        status: 'active',
        cancel_at: null,
        cancel_at_period_end: false,
        trial_end: null,
        metadata: { organizationId: ORG, tier: 'PRO', period: 'MONTHLY' },
        items: { data: [{ current_period_end: NOW_SECONDS + 30 * 86_400 }] },
      },
    },
  };
}

describe('a simulated Stripe upgrade moves the Clips limits', () => {
  let clock: number;
  let store: FakeBillingStore;
  let redis: FakeRedis;
  let resolver: EntitlementResolver;
  const logs: jest.SpyInstance[] = [];

  beforeEach(() => {
    clock = NOW.getTime();
    jest.spyOn(Date, 'now').mockImplementation(() => clock);
    logs.push(jest.spyOn(securityLogger, 'log').mockImplementation(() => undefined));
    logs.push(jest.spyOn(securityLogger, 'warn').mockImplementation(() => undefined));

    store = new FakeBillingStore([orgBilling()]);
    redis = new FakeRedis();
    // The resolver reads the same rows the webhook writes.
    const repository = {
      planRows: async () =>
        TIERS.flatMap((tier) => KEYS.map((key) => ({ tier, key, value: seedValue(tier, key) }))),
      planRowsFor: async (tier: string) =>
        KEYS.map((key) => ({ tier, key, value: seedValue(tier as (typeof TIERS)[number], key) })),
      overrides: async () => [],
      // Nothing used yet: the snapshot reads every meter's ledger too.
      sumUnits: async () => 0,
      billing: async (orgId: string) => {
        const org = store.orgs.get(orgId);
        return org
          ? { organizationCreatedAt: org.createdAt, subscription: org.subscription }
          : null;
      },
    } as unknown as EntitlementsRepository;
    const config = { get: () => 'db' } as unknown as ConfigService<Env, true>;
    resolver = new EntitlementResolver(repository, redis as unknown as RedisService, config);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    logs.length = 0;
  });

  it('the plans differ, so the test can see the move', () => {
    expect(seedValue('STANDARD', QUALITY)).not.toEqual(seedValue('PRO', QUALITY));
  });

  it('shows the new tier and export quality a second after the webhook commits', async () => {
    const before = await resolver.snapshot(ORG, NOW);
    expect(before.tier).toBe('STANDARD');
    expect(await resolver.get(ORG, QUALITY, NOW)).toEqual(seedValue('STANDARD', QUALITY));

    const webhook = new StripeWebhookService(
      store as unknown as BillingRepository,
      jest.fn(),
      redis as unknown as RedisService,
    );
    await expect(webhook.apply(upgradeToPro())).resolves.toEqual({
      received: true,
      outcome: 'applied',
    });
    expect(store.subscription().subscriptionTier).toBe('PRO');

    clock += 1_001;
    const after = await resolver.snapshot(ORG, NOW);
    expect(after.tier).toBe('PRO');
    expect(await resolver.get(ORG, QUALITY, NOW)).toEqual(seedValue('PRO', QUALITY));
  });

  it('without the stamp the old plan would hold until the 15 second cache runs out', async () => {
    expect(await resolver.get(ORG, QUALITY, NOW)).toEqual(seedValue('STANDARD', QUALITY));

    // The same upgrade through a webhook service built without Redis: no stamp is written.
    const webhook = new StripeWebhookService(store as unknown as BillingRepository, jest.fn());
    await webhook.apply(upgradeToPro());

    clock += 1_001;
    expect(await resolver.get(ORG, QUALITY, NOW)).toEqual(seedValue('STANDARD', QUALITY));
    clock += 15_000;
    expect(await resolver.get(ORG, QUALITY, NOW)).toEqual(seedValue('PRO', QUALITY));
  });
});
