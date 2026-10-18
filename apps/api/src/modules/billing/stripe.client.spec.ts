/**
 * The simulation produces events the real handler accepts, in the order
 * Stripe would send them; the proration stand-in; and the verifier that
 * refuses everything outside Stripe mode.
 */
import type { BillingConfig } from './billing.config';
import type { BillingRepository } from './billing.repository';
import type { BillingWebhookEvent, PlanChangeRequest } from './billing.types';
import { StripeWebhookService } from './stripe-webhook.service';
import {
  createEventVerifier,
  periodEndFor,
  SimulatedStripeGateway,
  simulatedPreview,
  WebhookVerificationError,
} from './stripe.client';
import { FakeBillingStore, NOW, orgBilling } from './testing/fake-billing-store';

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

describe('SimulatedStripeGateway', () => {
  let store: FakeBillingStore;
  let applied: BillingWebhookEvent[];
  let gateway: SimulatedStripeGateway;

  beforeEach(() => {
    store = new FakeBillingStore([orgBilling({ paymentId: null, subscription: null })]);
    applied = [];
    const handler = new StripeWebhookService(store as unknown as BillingRepository, jest.fn());
    gateway = new SimulatedStripeGateway(
      {
        apply: async (event) => {
          applied.push(event);
          return handler.apply(event);
        },
      },
      { delayMs: () => 0, now: () => NOW },
    );
  });

  it('mints a simulated customer only when the org has none', async () => {
    const customer = { orgId: 'org_1', name: 'Demo', email: null };
    await expect(gateway.ensureCustomer({ ...customer, customerId: 'cus_keep' })).resolves.toBe('cus_keep');
    await expect(gateway.ensureCustomer({ ...customer, customerId: null })).resolves.toMatch(
      /^cus_sim_[0-9a-f]{16}$/,
    );
  });

  it('checkout returns the success URL with a session id and activates the row through the handler', async () => {
    const { url } = await gateway.createCheckoutSession({
      orgId: 'org_1',
      customerId: 'cus_sim_1',
      tier: 'PRO',
      period: 'YEARLY',
      successUrl: 'http://localhost:3000/org_1/settings/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}',
      cancelUrl: 'http://localhost:3000/org_1/settings/billing?checkout=cancel',
    });

    expect(url).toMatch(/\?checkout=success&session_id=cs_sim_[0-9a-f]{16}$/);
    // Nothing has landed yet: the page's "Activating…" window.
    expect(store.org().subscription).toBeNull();

    await gateway.flush();

    expect(applied.map((event) => event.type)).toEqual([
      'checkout.session.completed',
      'customer.subscription.created',
    ]);
    expect(applied.every((event) => event.id.startsWith('sim_'))).toBe(true);
    expect([...store.events.values()].map((event) => event.outcome)).toEqual(['applied', 'applied']);
    expect(store.org().paymentId).toBe('cus_sim_1');
    expect(store.subscription()).toMatchObject({
      subscriptionTier: 'PRO',
      period: 'YEARLY',
      status: 'ACTIVE',
      currentPeriodEnd: new Date('2027-10-16T12:00:00.000Z'),
      totalChannels: 15,
    });
    expect(store.subscription().identifier).toMatch(/^sub_sim_/);
    expect(store.notifications.map((n) => n.type)).toEqual(['billing.activated']);
  });

  it('cancel and resume go through customer.subscription.updated', async () => {
    await gateway.createCheckoutSession({
      orgId: 'org_1',
      customerId: 'cus_sim_1',
      tier: 'STANDARD',
      period: 'MONTHLY',
      successUrl: 'http://x/?session_id={CHECKOUT_SESSION_ID}',
      cancelUrl: 'http://x/?checkout=cancel',
    });
    await gateway.flush();
    const row = store.subscription();
    const snapshot = {
      orgId: 'org_1',
      customerId: 'cus_sim_1',
      subscriptionId: row.identifier ?? '',
      tier: 'STANDARD' as const,
      period: 'MONTHLY' as const,
      currentPeriodEnd: row.currentPeriodEnd,
      cancelAt: null,
      scheduledTier: null,
      scheduledPeriod: null,
    };

    await gateway.cancelAtPeriodEnd(snapshot);
    await gateway.flush();
    expect(store.subscription().cancelAt).toEqual(row.currentPeriodEnd);

    await gateway.resume({ ...snapshot, cancelAt: row.currentPeriodEnd });
    await gateway.flush();
    expect(store.subscription().cancelAt).toBeNull();
    expect(store.subscription().status).toBe('ACTIVE');
  });

  it('an upgrade lands with the new tier; a downgrade leaves the tier for the schedule', async () => {
    await gateway.createCheckoutSession({
      orgId: 'org_1',
      customerId: 'cus_sim_1',
      tier: 'STANDARD',
      period: 'MONTHLY',
      successUrl: 'http://x/?session_id={CHECKOUT_SESSION_ID}',
      cancelUrl: 'http://x/',
    });
    await gateway.flush();
    const base: PlanChangeRequest = {
      orgId: 'org_1',
      customerId: 'cus_sim_1',
      subscriptionId: store.subscription().identifier ?? '',
      tier: 'STANDARD',
      period: 'MONTHLY',
      currentPeriodEnd: store.subscription().currentPeriodEnd,
      cancelAt: null,
      scheduledTier: null,
      scheduledPeriod: null,
      toTier: 'PRO',
      toPeriod: 'MONTHLY',
      effective: 'now',
    };

    await gateway.changePlan(base);
    await gateway.flush();
    expect(store.subscription()).toMatchObject({ subscriptionTier: 'PRO', totalChannels: 15 });

    await gateway.changePlan({ ...base, tier: 'PRO', toTier: 'STANDARD', effective: 'period_end' });
    await gateway.flush();
    expect(store.subscription().subscriptionTier).toBe('PRO');
  });

  it('the portal is the return URL flagged as simulated', async () => {
    await expect(
      gateway.createPortalSession({ customerId: 'cus_sim_1', returnUrl: 'http://localhost:3000/org_1/settings/billing' }),
    ).resolves.toEqual({ url: 'http://localhost:3000/org_1/settings/billing?portal=simulated' });
  });

  it('logs rather than throws when the handler rejects', async () => {
    const warn = jest.fn();
    const failing = new SimulatedStripeGateway(
      { apply: async () => { throw new Error('boom'); } },
      { delayMs: () => 0, now: () => NOW, logger: { warn } },
    );

    await failing.resume({
      orgId: 'org_1', customerId: 'c', subscriptionId: 's', tier: 'PRO', period: 'MONTHLY',
      currentPeriodEnd: null, cancelAt: null, scheduledTier: null, scheduledPeriod: null,
    });
    await failing.flush();

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('boom'));
  });
});

describe('simulatedPreview', () => {
  const request: PlanChangeRequest = {
    orgId: 'org_1',
    customerId: 'cus',
    subscriptionId: 'sub',
    tier: 'STANDARD',
    period: 'MONTHLY',
    currentPeriodEnd: new Date('2026-10-31T12:00:00.000Z'),
    cancelAt: null,
    scheduledTier: null,
    scheduledPeriod: null,
    toTier: 'PRO',
    toPeriod: 'MONTHLY',
    effective: 'now',
  };

  it('charges the prorated difference for an upgrade', () => {
    // Half the period left: (4900 - 2900) / 2.
    const preview = simulatedPreview(request, new Date('2026-10-16T00:00:00.000Z'));

    expect(preview).toMatchObject({ effective: 'now', currency: 'usd', periodEnd: '2026-10-31T12:00:00.000Z' });
    expect(preview.amountDueCents).toBeGreaterThan(900);
    expect(preview.amountDueCents).toBeLessThan(1_100);
  });

  it('charges the new price minus the unused credit when the period changes', () => {
    const preview = simulatedPreview({ ...request, toPeriod: 'YEARLY' }, new Date('2026-10-16T00:00:00.000Z'));
    expect(preview.amountDueCents).toBeGreaterThan(47_000);
    expect(preview.amountDueCents).toBeLessThan(48_000);
  });

  it('a downgrade costs nothing now and the new price from the period end', () => {
    expect(simulatedPreview({ ...request, tier: 'PRO', toTier: 'STANDARD', effective: 'period_end' }, NOW)).toEqual({
      effective: 'period_end',
      amountDueCents: 2_900,
      currency: 'usd',
      periodEnd: '2026-10-31T12:00:00.000Z',
    });
  });

  it('invents a period end when the row has none', () => {
    expect(periodEndFor('MONTHLY', NOW).toISOString()).toBe('2026-11-16T12:00:00.000Z');
    expect(periodEndFor('YEARLY', NOW).toISOString()).toBe('2027-10-16T12:00:00.000Z');
    expect(simulatedPreview({ ...request, currentPeriodEnd: null }, NOW).periodEnd).toBe('2026-11-16T12:00:00.000Z');
  });
});

describe('createEventVerifier', () => {
  it('refuses every delivery outside Stripe mode', () => {
    const verify = createEventVerifier(config({ mode: 'simulation' }));
    expect(() => verify(Buffer.from('{}'), 'sig')).toThrow(WebhookVerificationError);
  });

  it('refuses a delivery with no body or no signature before touching Stripe', () => {
    const verify = createEventVerifier(config({ mode: 'stripe', secretKey: 'sk_test_x', webhookSecret: 'whsec_x' }));
    expect(() => verify(undefined, 'sig')).toThrow(/Missing raw body/);
    expect(() => verify(Buffer.from('{}'), undefined)).toThrow(/Missing raw body/);
  });

  it('wraps a Stripe signature failure as a verification error', () => {
    const verify = createEventVerifier(config({ mode: 'stripe', secretKey: 'sk_test_x', webhookSecret: 'whsec_x' }));
    expect(() => verify(Buffer.from('{"id":"evt_1"}'), 't=1,v1=deadbeef')).toThrow(WebhookVerificationError);
  });
});
