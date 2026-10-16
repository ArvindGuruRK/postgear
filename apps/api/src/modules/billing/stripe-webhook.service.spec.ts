/**
 * The webhook handler against the in-memory store: a bad signature is a
 * 400, a replayed id is a duplicate, an event older than the last one is
 * ignored, each handled type has its effect, and a handler failure is
 * recorded and answered rather than thrown.
 */
import { BadRequestException } from '@nestjs/common';
import { securityLogger } from '../../common/logging/security-logger';
import type { BillingRepository } from './billing.repository';
import type { BillingWebhookEvent } from './billing.types';
import { StripeWebhookService } from './stripe-webhook.service';
import { WebhookVerificationError } from './stripe.client';
import { FakeBillingStore, NOW, orgBilling, subscriptionRow } from './testing/fake-billing-store';

const NOW_SECONDS = Math.floor(NOW.getTime() / 1_000);

function event(type: string, object: Record<string, unknown>, overrides: Partial<BillingWebhookEvent> = {}): BillingWebhookEvent {
  return { id: `evt_${type}_${Math.random().toString(36).slice(2)}`, type, created: NOW_SECONDS, data: { object }, ...overrides };
}

function stripeSubscription(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub_123',
    object: 'subscription',
    customer: 'cus_123',
    status: 'active',
    cancel_at: null,
    cancel_at_period_end: false,
    trial_end: null,
    metadata: { organizationId: 'org_1', tier: 'PRO', period: 'MONTHLY' },
    items: { data: [{ current_period_end: NOW_SECONDS + 30 * 86_400 }] },
    ...overrides,
  };
}

describe('StripeWebhookService', () => {
  let store: FakeBillingStore;
  let verify: jest.Mock;
  let service: StripeWebhookService;
  let warn: jest.SpyInstance;
  let log: jest.SpyInstance;

  beforeEach(() => {
    store = new FakeBillingStore([orgBilling()]);
    verify = jest.fn();
    service = new StripeWebhookService(store as unknown as BillingRepository, verify);
    warn = jest.spyOn(securityLogger, 'warn').mockImplementation(() => undefined);
    log = jest.spyOn(securityLogger, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
    log.mockRestore();
  });

  describe('receive', () => {
    it('answers 400 and logs billing.webhook_rejected when the signature fails', async () => {
      verify.mockImplementation(() => {
        throw new WebhookVerificationError('No signatures found matching the expected signature');
      });

      await expect(service.receive(Buffer.from('{}'), 't=1,v1=bad')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(warn).toHaveBeenCalledWith(
        'billing.webhook_rejected',
        expect.objectContaining({ hasSignature: true, hasBody: true }),
      );
      expect(store.events.size).toBe(0);
    });

    it('applies what the verifier returns', async () => {
      const incoming = event('invoice.created', {});
      verify.mockReturnValue(incoming);

      await expect(service.receive(Buffer.from('{}'), 'sig')).resolves.toEqual({
        received: true,
        outcome: 'ignored:unhandled',
      });
      expect(verify).toHaveBeenCalledWith(expect.any(Buffer), 'sig');
    });
  });

  describe('apply', () => {
    it('records an unhandled type and answers received', async () => {
      const incoming = event('charge.succeeded', {});

      await expect(service.apply(incoming)).resolves.toEqual({ received: true, outcome: 'ignored:unhandled' });
      expect(store.events.get(incoming.id)).toMatchObject({ type: 'charge.succeeded', outcome: 'ignored:unhandled' });
    });

    it('treats a replayed event id as a duplicate and applies nothing twice', async () => {
      const incoming = event('customer.subscription.updated', stripeSubscription({ status: 'past_due' }));

      await service.apply(incoming);
      expect(store.subscription().status).toBe('PAST_DUE');

      store.subscription().status = 'ACTIVE';
      await expect(service.apply(incoming)).resolves.toEqual({ received: true, duplicate: true });
      expect(store.subscription().status).toBe('ACTIVE');
      expect(log).toHaveBeenCalledWith('billing.webhook_duplicate', expect.objectContaining({ eventId: incoming.id }));
    });

    it('is a duplicate when the insert itself collides (two deliveries racing)', async () => {
      const incoming = event('customer.subscription.updated', stripeSubscription());
      const hasEvent = jest.spyOn(store, 'hasEvent').mockResolvedValue(false);
      store.events.set(incoming.id, { id: incoming.id, type: incoming.type, organizationId: null, outcome: 'applied' });

      await expect(service.apply(incoming)).resolves.toEqual({ received: true, duplicate: true });
      hasEvent.mockRestore();
    });

    it('ignores an event older than the row has already seen', async () => {
      store.subscription().lastStripeEventAt = NOW;
      const stale = event('customer.subscription.updated', stripeSubscription({ status: 'canceled' }), {
        created: NOW_SECONDS - 60,
      });

      await expect(service.apply(stale)).resolves.toEqual({ received: true, outcome: 'ignored:stale' });
      expect(store.subscription().status).toBe('ACTIVE');
      expect(store.events.get(stale.id)).toMatchObject({ organizationId: 'org_1', outcome: 'ignored:stale' });
    });

    it('records a handler failure, logs it, and still answers received', async () => {
      jest.spyOn(store, 'upsertSubscription').mockRejectedValueOnce(new Error('connection lost'));
      const incoming = event('customer.subscription.updated', stripeSubscription());

      const receipt = await service.apply(incoming);

      expect(receipt).toEqual({ received: true, outcome: 'failed:Error: connection lost' });
      expect(warn).toHaveBeenCalledWith('billing.webhook_failed', expect.objectContaining({ eventId: incoming.id }));
      // The transaction rolled back; the failure row was written afterwards.
      expect(store.org()).toMatchObject({ isTrailing: false });
      expect(store.events.get(incoming.id)).toMatchObject({ outcome: 'failed:Error: connection lost' });
      // And the replay is a duplicate, so Stripe stops.
      await expect(service.apply(incoming)).resolves.toEqual({ received: true, duplicate: true });
    });

    it('ignores an event that names no workspace it knows', async () => {
      const incoming = event('customer.subscription.updated', stripeSubscription({
        id: 'sub_other',
        customer: 'cus_other',
        metadata: { organizationId: 'org_ghost', tier: 'PRO', period: 'MONTHLY' },
      }));

      await expect(service.apply(incoming)).resolves.toEqual({ received: true, outcome: 'ignored:unknown_org' });
    });
  });

  describe('checkout.session.completed', () => {
    it('links the customer, activates the row and notifies a workspace that was on a trial', async () => {
      store = new FakeBillingStore([
        orgBilling({
          paymentId: null,
          isTrailing: true,
          subscription: subscriptionRow({ identifier: null, status: 'TRIALING', subscriptionTier: 'PRO', trialEndsAt: new Date('2026-10-30'), totalChannels: 15 }),
        }),
      ]);
      service = new StripeWebhookService(store as unknown as BillingRepository, verify);

      const incoming = event('checkout.session.completed', {
        id: 'cs_1',
        mode: 'subscription',
        customer: 'cus_new',
        subscription: 'sub_new',
        client_reference_id: 'org_1',
        metadata: { organizationId: 'org_1', tier: 'TEAM', period: 'YEARLY' },
      });

      await expect(service.apply(incoming)).resolves.toEqual({ received: true, outcome: 'applied' });
      expect(store.org()).toMatchObject({ paymentId: 'cus_new', isTrailing: false, allowTrial: false });
      expect(store.subscription()).toMatchObject({
        subscriptionTier: 'TEAM',
        period: 'YEARLY',
        status: 'ACTIVE',
        identifier: 'sub_new',
        trialEndsAt: null,
        totalChannels: 40,
        lastStripeEventAt: NOW,
      });
      expect(store.notifications).toEqual([
        expect.objectContaining({ type: 'billing.activated', title: 'Team plan is active', meta: { tier: 'TEAM', period: 'YEARLY' } }),
      ]);
    });

    it('creates the row for a workspace that never had one', async () => {
      store = new FakeBillingStore([orgBilling({ paymentId: null, subscription: null })]);
      service = new StripeWebhookService(store as unknown as BillingRepository, verify);

      await service.apply(
        event('checkout.session.completed', {
          id: 'cs_1',
          customer: 'cus_new',
          subscription: 'sub_new',
          metadata: { organizationId: 'org_1', tier: 'STANDARD', period: 'MONTHLY' },
        }),
      );

      expect(store.subscription()).toMatchObject({ subscriptionTier: 'STANDARD', status: 'ACTIVE', identifier: 'sub_new', totalChannels: 5 });
    });

    it('resolves the workspace from the customer when the metadata is missing', async () => {
      const incoming = event('checkout.session.completed', { id: 'cs_1', customer: 'cus_123', subscription: 'sub_123', metadata: {} });

      await expect(service.apply(incoming)).resolves.toEqual({ received: true, outcome: 'applied' });
      expect(store.events.get(incoming.id)?.organizationId).toBe('org_1');
      // Already active for this very subscription: no second "activated" notice.
      expect(store.notifications).toHaveLength(0);
    });
  });

  describe('customer.subscription.created / updated', () => {
    it('applies the tier from the metadata, the period end and a scheduled cancellation', async () => {
      const periodEnd = NOW_SECONDS + 20 * 86_400;
      await service.apply(
        event('customer.subscription.updated', stripeSubscription({
          cancel_at_period_end: true,
          cancel_at: null,
          items: { data: [{ current_period_end: periodEnd }] },
        })),
      );

      expect(store.subscription()).toMatchObject({
        subscriptionTier: 'PRO',
        status: 'ACTIVE',
        totalChannels: 15,
        currentPeriodEnd: new Date(periodEnd * 1_000),
        cancelAt: new Date(periodEnd * 1_000),
      });
      // A tier change on an already-active row is not an activation.
      expect(store.notifications).toHaveLength(0);
    });

    it('clears a scheduled downgrade once the event carries that tier', async () => {
      store.subscription().subscriptionTier = 'PRO';
      store.subscription().scheduledTier = 'STANDARD';
      store.subscription().scheduledPeriod = 'MONTHLY';

      await service.apply(
        event('customer.subscription.updated', stripeSubscription({ metadata: { organizationId: 'org_1', tier: 'STANDARD', period: 'MONTHLY' } })),
      );

      expect(store.subscription()).toMatchObject({ subscriptionTier: 'STANDARD', scheduledTier: null, scheduledPeriod: null, totalChannels: 5 });
    });

    it('keeps a pending downgrade through an unrelated update', async () => {
      store.subscription().scheduledTier = 'STANDARD';
      store.subscription().subscriptionTier = 'PRO';

      await service.apply(event('customer.subscription.updated', stripeSubscription()));

      expect(store.subscription().scheduledTier).toBe('STANDARD');
    });

    it('moves a past-due plan back to active and notifies the reactivation', async () => {
      store.subscription().status = 'PAST_DUE';

      await service.apply(event('customer.subscription.updated', stripeSubscription()));

      expect(store.subscription().status).toBe('ACTIVE');
      expect(store.notifications.map((n) => n.type)).toEqual(['billing.activated']);
    });

    it('maps a trialing Stripe subscription with its trial end', async () => {
      const trialEnd = NOW_SECONDS + 7 * 86_400;
      await service.apply(event('customer.subscription.created', stripeSubscription({ status: 'trialing', trial_end: trialEnd })));

      expect(store.subscription()).toMatchObject({ status: 'TRIALING', trialEndsAt: new Date(trialEnd * 1_000) });
      expect(store.org().isTrailing).toBe(true);
    });

    it('leaves the row alone when an older subscription of the same customer is cancelled', async () => {
      await expect(
        service.apply(event('customer.subscription.updated', stripeSubscription({ id: 'sub_old', status: 'canceled' }))),
      ).resolves.toEqual({ received: true, outcome: 'ignored:other_subscription' });
      expect(store.subscription().status).toBe('ACTIVE');
    });
  });

  describe('customer.subscription.deleted', () => {
    it('cancels and soft-deletes the row, and notifies once', async () => {
      await service.apply(event('customer.subscription.deleted', stripeSubscription({ status: 'canceled' })));

      expect(store.subscription()).toMatchObject({ status: 'CANCELED', deletedAt: NOW, scheduledTier: null });
      expect(store.org().isTrailing).toBe(false);
      expect(store.notifications).toEqual([expect.objectContaining({ type: 'billing.canceled', title: 'Standard plan ended' })]);

      await service.apply(event('customer.subscription.deleted', stripeSubscription({ status: 'canceled' })));
      expect(store.notifications).toHaveLength(1);
    });

    it('ignores the deletion of a subscription the row no longer tracks', async () => {
      await expect(
        service.apply(event('customer.subscription.deleted', stripeSubscription({ id: 'sub_old' }))),
      ).resolves.toEqual({ received: true, outcome: 'ignored:other_subscription' });
      expect(store.subscription().status).toBe('ACTIVE');
    });
  });

  describe('invoices', () => {
    const invoice = (overrides: Record<string, unknown> = {}) => ({
      id: 'in_1',
      object: 'invoice',
      customer: 'cus_123',
      parent: { subscription_details: { subscription: 'sub_123', metadata: { organizationId: 'org_1' } } },
      lines: { data: [{ period: { end: NOW_SECONDS + 31 * 86_400 } }] },
      ...overrides,
    });

    it('moves a live plan into PAST_DUE grace and notifies on a failed payment', async () => {
      await expect(service.apply(event('invoice.payment_failed', invoice()))).resolves.toEqual({ received: true, outcome: 'applied' });

      expect(store.subscription()).toMatchObject({ status: 'PAST_DUE', lastStripeEventAt: NOW });
      expect(store.notifications).toEqual([expect.objectContaining({ type: 'billing.payment_failed', title: 'Payment failed' })]);
    });

    it('returns a past-due plan to ACTIVE with the invoice line’s period end when it is paid', async () => {
      store.subscription().status = 'PAST_DUE';

      await service.apply(event('invoice.paid', invoice()));

      expect(store.subscription()).toMatchObject({
        status: 'ACTIVE',
        currentPeriodEnd: new Date((NOW_SECONDS + 31 * 86_400) * 1_000),
      });
      expect(store.notifications).toHaveLength(0);
    });

    it('ignores an invoice for a workspace with no live row, or for another subscription', async () => {
      await expect(
        service.apply(event('invoice.paid', invoice({ parent: { subscription_details: { subscription: 'sub_other', metadata: { organizationId: 'org_1' } } } }))),
      ).resolves.toEqual({ received: true, outcome: 'ignored:other_subscription' });

      store.subscription().deletedAt = NOW;
      await expect(service.apply(event('invoice.payment_failed', invoice()))).resolves.toEqual({
        received: true,
        outcome: 'ignored:no_subscription',
      });
    });
  });
});
