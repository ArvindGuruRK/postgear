/**
 * The billing service against a fake gateway and the in-memory store: the
 * checks that run before any gateway call, the up-now / down-later rule,
 * the schedule columns the row owns, the feedback mail, and the simulated
 * ids a hand-made row is given.
 */
import { ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';
import type { MailService } from '../mail/mail.service';
import type { BillingConfig } from './billing.config';
import { BILLING_MESSAGES } from './billing.messages';
import type { BillingRepository } from './billing.repository';
import { BillingService, changeRequestFor } from './billing.service';
import type { SubscriptionSnapshot } from './billing.types';
import { EntitlementsService } from './entitlements.service';
import type { StripeGateway } from './stripe.client';
import { FakeBillingStore, NOW, orgBilling, subscriptionRow } from './testing/fake-billing-store';

function config(overrides: Partial<BillingConfig> = {}): BillingConfig {
  return {
    mode: 'stripe',
    secretKey: 'sk_test_x',
    webhookSecret: 'whsec_x',
    publishableKey: 'pk_test_x',
    trialDays: 14,
    priceIds: {},
    webUrl: 'http://localhost:3000',
    warnings: [],
    ...overrides,
  };
}

/** Every gateway method as a plain `jest.Mock`, so a test can reprogram any of them. */
type GatewayMocks = { [K in keyof StripeGateway]: jest.Mock };

function fakeGateway(): GatewayMocks {
  return {
    ensureCustomer: jest.fn(async ({ customerId }: { customerId: string | null }) => customerId ?? 'cus_new'),
    createCheckoutSession: jest.fn(async () => ({ url: 'https://checkout.stripe.com/c/pay/cs_1' })),
    createPortalSession: jest.fn(async () => ({ url: 'https://billing.stripe.com/p/session/1' })),
    previewChange: jest.fn(async () => ({ effective: 'now' as const, amountDueCents: 1_000, currency: 'usd', periodEnd: null })),
    changePlan: jest.fn(async () => undefined),
    cancelAtPeriodEnd: jest.fn(async () => undefined),
    resume: jest.fn(async () => undefined),
  };
}

function build(store: FakeBillingStore, overrides: Partial<BillingConfig> = {}) {
  const resolved = config(overrides);
  const gateway = fakeGateway();
  const mail = { sendPlain: jest.fn(async () => true) };
  const configService = { get: jest.fn(() => 'PostGear <owner@postgear.local>') };
  const repository = store as unknown as BillingRepository;
  const service = new BillingService(
    repository,
    new EntitlementsService(repository, resolved),
    gateway as unknown as StripeGateway,
    resolved,
    mail as unknown as MailService,
    configService as unknown as ConfigService<Env, true>,
  );

  return { service, gateway, mail };
}

describe('BillingService', () => {
  it('reports the status and the plan table', () => {
    const { service } = build(new FakeBillingStore(), { mode: 'simulation', publishableKey: null });

    expect(service.status()).toEqual({ mode: 'simulation', publishableKey: null, trialDays: 14 });
    expect(service.plans().plans.map((plan) => plan.tier)).toEqual(['FREE', 'STANDARD', 'PRO', 'TEAM', 'ULTIMATE']);
  });

  describe('subscription', () => {
    it('describes the plan and both meters', async () => {
      const store = new FakeBillingStore([orgBilling()]);
      store.liveChannels.set('org_1', 3);
      store.creditsUsed = 23;
      const { service } = build(store);

      const result = await service.subscription('org_1', NOW);

      expect(result.subscription).toMatchObject({
        tier: 'STANDARD',
        status: 'active',
        period: 'MONTHLY',
        currentPeriodEnd: '2026-11-13T15:42:00.000Z',
        canStartTrial: false,
        portalAvailable: true,
      });
      expect(result.usage).toEqual({
        channels: { used: 3, limit: 5 },
        aiCredits: { used: 23, allowance: 100, resetsAt: '2026-11-13T00:00:00.000Z' },
      });
    });

    it('offers the trial to a workspace with no row, and no portal without a customer', async () => {
      const store = new FakeBillingStore([orgBilling({ paymentId: null, subscription: null })]);
      store.liveChannels.set('org_1', 1);
      const { service } = build(store);

      const result = await service.subscription('org_1', NOW);

      expect(result.subscription).toMatchObject({ tier: 'FREE', status: 'none', canStartTrial: true, portalAvailable: false });
      expect(result.usage.channels).toEqual({ used: 1, limit: 1 });
      expect(result.usage.aiCredits.allowance).toBe(25);
    });
  });

  describe('checkout', () => {
    it('answers 503 when billing is unconfigured, before any gateway call', async () => {
      const store = new FakeBillingStore([orgBilling({ subscription: null })]);
      const { service, gateway } = build(store, { mode: 'unconfigured', secretKey: null });

      await expect(service.checkout('org_1', { tier: 'PRO', period: 'MONTHLY' })).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(gateway.ensureCustomer).not.toHaveBeenCalled();
    });

    it('refuses a second subscription for a workspace Stripe is already billing', async () => {
      const { service } = build(new FakeBillingStore([orgBilling()]));

      await expect(service.checkout('org_1', { tier: 'PRO', period: 'MONTHLY' })).rejects.toThrow(BILLING_MESSAGES.ALREADY_SUBSCRIBED);
    });

    it('creates the customer, stores it, and asks for a session back to the billing page', async () => {
      const store = new FakeBillingStore([orgBilling({ paymentId: null, subscription: null })]);
      const { service, gateway } = build(store);

      await expect(service.checkout('org_1', { tier: 'PRO', period: 'YEARLY' })).resolves.toEqual({
        url: 'https://checkout.stripe.com/c/pay/cs_1',
      });
      expect(gateway.ensureCustomer).toHaveBeenCalledWith({ orgId: 'org_1', name: 'PostGear Demo Org', email: 'demo@postgear.local', customerId: null });
      expect(store.org().paymentId).toBe('cus_new');
      expect(gateway.createCheckoutSession).toHaveBeenCalledWith({
        orgId: 'org_1',
        customerId: 'cus_new',
        tier: 'PRO',
        period: 'YEARLY',
        successUrl: 'http://localhost:3000/org_1/settings/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}',
        cancelUrl: 'http://localhost:3000/org_1/settings/billing?checkout=cancel',
      });
    });

    it('lets a trialing workspace subscribe', async () => {
      const store = new FakeBillingStore([
        orgBilling({ paymentId: null, subscription: subscriptionRow({ identifier: null, status: 'TRIALING', trialEndsAt: new Date('2026-10-30') }) }),
      ]);
      const { service } = build(store);

      await expect(service.checkout('org_1', { tier: 'STANDARD', period: 'MONTHLY' })).resolves.toHaveProperty('url');
    });

    it('turns a gateway failure into a 503 with the catalogue message', async () => {
      const { service, gateway } = build(new FakeBillingStore([orgBilling({ subscription: null })]));
      gateway.createCheckoutSession.mockRejectedValue(new Error('StripeConnectionError: sk_test_secret'));

      await expect(service.checkout('org_1', { tier: 'PRO', period: 'MONTHLY' })).rejects.toThrow(BILLING_MESSAGES.PROVIDER_FAILED);
    });
  });

  describe('portal', () => {
    it('needs a customer', async () => {
      const { service } = build(new FakeBillingStore([orgBilling({ paymentId: null })]));
      await expect(service.portal('org_1')).rejects.toThrow(BILLING_MESSAGES.PORTAL_UNAVAILABLE);
    });

    it('opens one for the stored customer, returning to the billing page', async () => {
      const { service, gateway } = build(new FakeBillingStore([orgBilling()]));
      await expect(service.portal('org_1')).resolves.toEqual({ url: 'https://billing.stripe.com/p/session/1' });
      expect(gateway.createPortalSession).toHaveBeenCalledWith({ customerId: 'cus_123', returnUrl: 'http://localhost:3000/org_1/settings/billing' });
    });
  });

  describe('change', () => {
    it('applies an upgrade now and leaves no schedule behind', async () => {
      const store = new FakeBillingStore([orgBilling({ subscription: subscriptionRow({ scheduledTier: 'STANDARD', subscriptionTier: 'PRO' }) })]);
      const { service, gateway } = build(store);

      await service.change('org_1', { tier: 'TEAM', period: 'MONTHLY' });

      expect(gateway.changePlan).toHaveBeenCalledWith(expect.objectContaining({ toTier: 'TEAM', effective: 'now', subscriptionId: 'sub_123', customerId: 'cus_123' }));
      expect(store.subscription().scheduledTier).toBeNull();
    });

    it('records a downgrade on the row and schedules it with the gateway', async () => {
      const store = new FakeBillingStore([orgBilling({ subscription: subscriptionRow({ subscriptionTier: 'PRO' }) })]);
      const { service, gateway } = build(store);

      const result = await service.change('org_1', { tier: 'STANDARD', period: 'YEARLY' });

      expect(gateway.changePlan).toHaveBeenCalledWith(expect.objectContaining({ effective: 'period_end' }));
      expect(store.subscription()).toMatchObject({ subscriptionTier: 'PRO', scheduledTier: 'STANDARD', scheduledPeriod: 'YEARLY' });
      expect(result.subscription).toMatchObject({ tier: 'PRO', scheduledTier: 'STANDARD' });
    });

    it('refuses the same plan, a workspace with no live plan, and a hand-granted row in Stripe mode', async () => {
      const { service } = build(new FakeBillingStore([orgBilling()]));
      await expect(service.change('org_1', { tier: 'STANDARD', period: 'MONTHLY' })).rejects.toThrow(BILLING_MESSAGES.SAME_PLAN);

      const trial = build(new FakeBillingStore([orgBilling({ subscription: subscriptionRow({ status: 'TRIALING', trialEndsAt: new Date('2026-11-01') }) })]));
      await expect(trial.service.change('org_1', { tier: 'PRO', period: 'MONTHLY' })).rejects.toThrow(BILLING_MESSAGES.NO_SUBSCRIPTION);

      const manual = build(new FakeBillingStore([orgBilling({ paymentId: null, subscription: subscriptionRow({ identifier: null }) })]));
      await expect(manual.service.change('org_1', { tier: 'PRO', period: 'MONTHLY' })).rejects.toThrow(BILLING_MESSAGES.MANUAL_PLAN);
    });

    it('in simulation, adopts ids for a row made outside the flow and then changes it', async () => {
      const store = new FakeBillingStore([orgBilling({ paymentId: null, subscription: subscriptionRow({ identifier: null }) })]);
      const { service, gateway } = build(store, { mode: 'simulation', secretKey: null, webhookSecret: null });
      gateway.ensureCustomer.mockResolvedValue('cus_sim_abc');

      await service.change('org_1', { tier: 'PRO', period: 'MONTHLY' });

      expect(store.org().paymentId).toBe('cus_sim_abc');
      expect(store.subscription().identifier).toMatch(/^sub_sim_/);
      expect(gateway.changePlan).toHaveBeenCalledWith(expect.objectContaining({ customerId: 'cus_sim_abc', toTier: 'PRO' }));
    });
  });

  describe('cancel and resume', () => {
    it('cancels at period end, drops a pending downgrade, and mails the feedback to the owner', async () => {
      const store = new FakeBillingStore([orgBilling({ subscription: subscriptionRow({ scheduledTier: 'STANDARD', subscriptionTier: 'PRO' }) })]);
      const { service, gateway, mail } = build(store);

      await service.cancel('org_1', { reason: 'too_expensive', feedback: 'Great product, wrong budget.' });

      expect(gateway.cancelAtPeriodEnd).toHaveBeenCalledWith(expect.objectContaining({ subscriptionId: 'sub_123', tier: 'PRO' }));
      expect(store.subscription().scheduledTier).toBeNull();
      expect(mail.sendPlain).toHaveBeenCalledWith(
        'PostGear <owner@postgear.local>',
        'Cancellation feedback from PostGear Demo Org',
        expect.arrayContaining(['Reason: Too expensive', 'Great product, wrong budget.']),
      );
    });

    it('still cancels when the mail fails', async () => {
      const { service, mail } = build(new FakeBillingStore([orgBilling()]));
      mail.sendPlain.mockRejectedValue(new Error('smtp down'));

      await expect(service.cancel('org_1', { reason: 'other' })).resolves.toHaveProperty('subscription');
    });

    it('resumes only a scheduled cancellation', async () => {
      const { service } = build(new FakeBillingStore([orgBilling()]));
      await expect(service.resume('org_1')).rejects.toThrow(BILLING_MESSAGES.NOT_CANCELING);

      const canceling = build(new FakeBillingStore([orgBilling({ subscription: subscriptionRow({ cancelAt: new Date('2026-11-13') }) })]));
      await expect(canceling.service.resume('org_1')).resolves.toHaveProperty('subscription');
      expect(canceling.gateway.resume).toHaveBeenCalled();
    });
  });

  describe('startTrial', () => {
    it('422s a workspace that is not eligible', async () => {
      const { service } = build(new FakeBillingStore([orgBilling()]));
      await expect(service.startTrial('org_1')).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('starts one and returns the trialing view', async () => {
      const { service } = build(new FakeBillingStore([orgBilling({ paymentId: null, subscription: null })]));
      const result = await service.startTrial('org_1');
      expect(result.subscription).toMatchObject({ tier: 'PRO', status: 'trialing', canStartTrial: false });
    });
  });
});

describe('changeRequestFor', () => {
  const snapshot: SubscriptionSnapshot = {
    orgId: 'org_1',
    customerId: 'cus',
    subscriptionId: 'sub',
    tier: 'PRO',
    period: 'MONTHLY',
    currentPeriodEnd: null,
    cancelAt: null,
    scheduledTier: null,
    scheduledPeriod: null,
  };

  it('is now for a higher tier or monthly to yearly, period end for the rest', () => {
    expect(changeRequestFor(snapshot, { tier: 'TEAM', period: 'MONTHLY' }).effective).toBe('now');
    expect(changeRequestFor(snapshot, { tier: 'PRO', period: 'YEARLY' }).effective).toBe('now');
    expect(changeRequestFor(snapshot, { tier: 'STANDARD', period: 'MONTHLY' }).effective).toBe('period_end');
    expect(changeRequestFor({ ...snapshot, period: 'YEARLY' }, { tier: 'PRO', period: 'MONTHLY' }).effective).toBe('period_end');
    expect(changeRequestFor({ ...snapshot, period: 'YEARLY' }, { tier: 'STANDARD', period: 'YEARLY' }).effective).toBe('period_end');
  });

  it('refuses the current plan unless a downgrade is pending, which it then cancels', () => {
    expect(() => changeRequestFor(snapshot, { tier: 'PRO', period: 'MONTHLY' })).toThrow(BILLING_MESSAGES.SAME_PLAN);
    expect(changeRequestFor({ ...snapshot, scheduledTier: 'STANDARD' }, { tier: 'PRO', period: 'MONTHLY' }).effective).toBe('now');
  });
});
