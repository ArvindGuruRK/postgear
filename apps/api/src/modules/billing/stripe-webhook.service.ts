/**
 * `POST /billing/webhook`: verify, then apply once.
 *
 * ## Idempotent by table, ordered by timestamp
 *
 * Stripe delivers at least once and in no promised order. Two guards, both
 * in the same transaction as the state change:
 *
 * - **The `BillingEvent` row is inserted first.** Its primary key is the
 *   Stripe event id, so a redelivery (or two deliveries racing) fails the
 *   insert, the transaction rolls back, and the answer is `duplicate` with
 *   a 200 — nothing was applied twice.
 * - **An event older than the row's `lastStripeEventAt` is ignored.** A
 *   delayed `customer.subscription.updated` from before a cancellation
 *   must not un-cancel it. The outcome is recorded as `ignored:stale`.
 *
 * ## A handler bug answers 200
 *
 * Stripe retries a non-2xx for up to three days. A verified event the
 * handler cannot process is a bug on this side, and replaying it every
 * hour will not fix it — it will only repeat whatever half-effect it had.
 * So the error is logged as `billing.webhook_failed`, the event is recorded
 * `failed:<reason>` (outside the rolled-back transaction, so the replay
 * reads as a duplicate), and the response is 200. The log is the alarm.
 *
 * ## What is trusted
 *
 * Nothing from the client. The organization is resolved from the metadata
 * the gateway put on the Stripe object, falling back to the customer id on
 * the organization and the subscription id on the row. An event that
 * resolves to no workspace is `ignored:unknown_org`.
 */
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { Period, Subscription, SubscriptionStatus, SubscriptionTier } from '@postgear/db';
import { securityLogger } from '../../common/logging/security-logger';
import { BILLING_MESSAGES, BILLING_NOTIFICATIONS, planLabel } from './billing.messages';
import {
  BillingRepository,
  type BillingStore,
  isUniqueViolation,
  type OrgBilling,
} from './billing.repository';
import type { BillingWebhookEvent, WebhookReceipt } from './billing.types';
import { channelLimitFor, isPaidTier } from './plans';
import { STRIPE_EVENT_VERIFIER, type StripeEventVerifier, WebhookVerificationError } from './stripe.client';

/** The handled types. Anything else is recorded `ignored:unhandled` and answered 200. */
export const HANDLED_EVENT_TYPES = [
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.payment_failed',
  'invoice.paid',
] as const;

interface Applied {
  orgId: string | null;
  outcome: string;
}

/** The fields read off a Stripe object. Every one optional: the readers below cope. */
interface StripeObjectLike {
  id?: string;
  mode?: string;
  customer?: string | { id: string } | null;
  subscription?: string | { id: string } | null;
  client_reference_id?: string | null;
  status?: string;
  cancel_at?: number | null;
  cancel_at_period_end?: boolean;
  trial_end?: number | null;
  metadata?: Record<string, string> | null;
  items?: { data?: Array<{ current_period_end?: number }> };
  lines?: { data?: Array<{ period?: { end?: number } }> };
  parent?: {
    subscription_details?: {
      subscription?: string | { id: string } | null;
      metadata?: Record<string, string> | null;
    } | null;
  } | null;
}

@Injectable()
export class StripeWebhookService {
  constructor(
    private readonly repository: BillingRepository,
    @Inject(STRIPE_EVENT_VERIFIER) private readonly verify: StripeEventVerifier,
  ) {}

  /** The route: a bad signature is a 400 and a security event; anything verified is applied. */
  async receive(rawBody: Buffer | undefined, signature: string | undefined): Promise<WebhookReceipt> {
    let event: BillingWebhookEvent;

    try {
      event = this.verify(rawBody, signature);
    } catch (error) {
      securityLogger.warn('billing.webhook_rejected', {
        reason:
          error instanceof WebhookVerificationError
            ? error.message
            : error instanceof Error
              ? error.name
              : 'unknown',
        hasSignature: Boolean(signature),
        hasBody: Boolean(rawBody),
      });
      throw new BadRequestException(BILLING_MESSAGES.WEBHOOK_REJECTED);
    }

    return this.apply(event);
  }

  /**
   * Applies one verified (or simulated) event. Never throws: every outcome
   * is a receipt and a `BillingEvent` row.
   */
  async apply(event: BillingWebhookEvent): Promise<WebhookReceipt> {
    if (await this.repository.hasEvent(event.id)) {
      securityLogger.log('billing.webhook_duplicate', { eventId: event.id, type: event.type });
      return { received: true, duplicate: true };
    }

    try {
      const outcome = await this.repository.transaction(async (store) => {
        await store.recordEvent({
          id: event.id,
          type: event.type,
          organizationId: null,
          outcome: 'processing',
        });
        const applied = await this.handle(event, store);
        await store.finishEvent(event.id, {
          organizationId: applied.orgId,
          outcome: applied.outcome,
        });
        return applied.outcome;
      });

      return { received: true, outcome };
    } catch (error) {
      if (isUniqueViolation(error)) {
        securityLogger.log('billing.webhook_duplicate', { eventId: event.id, type: event.type });
        return { received: true, duplicate: true };
      }

      const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      securityLogger.warn('billing.webhook_failed', { eventId: event.id, type: event.type, reason });

      const outcome = `failed:${reason.slice(0, 180)}`;
      await this.repository
        .recordEvent({ id: event.id, type: event.type, organizationId: null, outcome })
        .catch(() => undefined);

      return { received: true, outcome };
    }
  }

  private async handle(event: BillingWebhookEvent, store: BillingStore): Promise<Applied> {
    switch (event.type) {
      case 'checkout.session.completed':
        return this.onCheckoutCompleted(event, store);
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        return this.onSubscriptionChanged(event, store);
      case 'customer.subscription.deleted':
        return this.onSubscriptionDeleted(event, store);
      case 'invoice.payment_failed':
        return this.onPaymentFailed(event, store);
      case 'invoice.paid':
        return this.onInvoicePaid(event, store);
      default:
        return { orgId: null, outcome: 'ignored:unhandled' };
    }
  }

  private async onCheckoutCompleted(event: BillingWebhookEvent, store: BillingStore): Promise<Applied> {
    const session = objectOf(event);

    if (session.mode && session.mode !== 'subscription') {
      return { orgId: null, outcome: 'ignored:not_subscription' };
    }

    const customerId = idOf(session.customer);
    const subscriptionId = idOf(session.subscription);
    const org = await this.resolveOrg(store, {
      metadata: session.metadata,
      fallbackOrgId: session.client_reference_id ?? null,
      customerId,
      subscriptionId,
    });

    if (!org) {
      return { orgId: null, outcome: 'ignored:unknown_org' };
    }

    const stale = staleOutcome(event, org);
    if (stale) {
      return { orgId: org.id, outcome: stale };
    }

    const existing = org.subscription;
    const tier = parseTier(session.metadata?.tier) ?? existing?.subscriptionTier ?? null;

    if (!tier) {
      return { orgId: org.id, outcome: 'ignored:no_tier' };
    }

    const period = parsePeriod(session.metadata?.period) ?? existing?.period ?? 'MONTHLY';
    const eventTime = timeOf(event);
    const sameSubscription = Boolean(existing && subscriptionId && existing.identifier === subscriptionId);

    await store.updateOrganization(org.id, {
      paymentId: customerId ?? org.paymentId,
      isTrailing: false,
      allowTrial: false,
    });
    await store.upsertSubscription(org.id, {
      subscriptionTier: tier,
      period,
      status: 'ACTIVE',
      identifier: subscriptionId ?? existing?.identifier ?? null,
      cancelAt: null,
      trialEndsAt: null,
      currentPeriodEnd: sameSubscription ? (existing?.currentPeriodEnd ?? null) : null,
      scheduledTier: null,
      scheduledPeriod: null,
      totalChannels: channelsFor(tier, existing),
      isLifetime: false,
      deletedAt: null,
      lastStripeEventAt: eventTime,
    });

    if (!isLive(existing, subscriptionId)) {
      await notify(store, org.id, 'billing.activated', BILLING_NOTIFICATIONS.activated(planLabel(tier)), {
        tier,
        period,
      });
    }

    return { orgId: org.id, outcome: 'applied' };
  }

  private async onSubscriptionChanged(event: BillingWebhookEvent, store: BillingStore): Promise<Applied> {
    const subscription = objectOf(event);
    const subscriptionId = subscription.id ?? null;
    const customerId = idOf(subscription.customer);
    const org = await this.resolveOrg(store, {
      metadata: subscription.metadata,
      fallbackOrgId: null,
      customerId,
      subscriptionId,
    });

    if (!org) {
      return { orgId: null, outcome: 'ignored:unknown_org' };
    }

    const stale = staleOutcome(event, org);
    if (stale) {
      return { orgId: org.id, outcome: stale };
    }

    const existing = org.subscription;
    const { status, ended } = mapStatus(subscription.status);

    // An older subscription's tail (its cancellation after a new one was
    // bought) must not overwrite the row that now tracks the new one.
    if (existing?.identifier && subscriptionId && existing.identifier !== subscriptionId && ended) {
      return { orgId: org.id, outcome: 'ignored:other_subscription' };
    }

    const tier = parseTier(subscription.metadata?.tier) ?? existing?.subscriptionTier ?? null;

    if (!tier) {
      return { orgId: org.id, outcome: 'ignored:no_tier' };
    }

    const period = parsePeriod(subscription.metadata?.period) ?? existing?.period ?? 'MONTHLY';
    const eventTime = timeOf(event);
    const currentPeriodEnd = periodEndOf(subscription) ?? existing?.currentPeriodEnd ?? null;
    const cancelAt =
      toDate(subscription.cancel_at) ??
      (subscription.cancel_at_period_end ? currentPeriodEnd : null);
    const trialEndsAt = status === 'TRIALING' ? toDate(subscription.trial_end) : null;
    const scheduleLanded =
      existing?.scheduledTier === tier && (existing.scheduledPeriod ?? period) === period;
    const tierChanged = existing ? existing.subscriptionTier !== tier : true;

    await store.updateOrganization(org.id, {
      paymentId: customerId ?? org.paymentId,
      isTrailing: status === 'TRIALING',
      allowTrial: false,
    });
    await store.upsertSubscription(org.id, {
      subscriptionTier: tier,
      period,
      status,
      identifier: subscriptionId ?? existing?.identifier ?? null,
      cancelAt: ended ? (existing?.cancelAt ?? null) : cancelAt,
      currentPeriodEnd,
      trialEndsAt,
      scheduledTier: scheduleLanded || ended ? null : (existing?.scheduledTier ?? null),
      scheduledPeriod: scheduleLanded || ended ? null : (existing?.scheduledPeriod ?? null),
      totalChannels: channelsFor(tier, existing, tierChanged),
      isLifetime: existing?.isLifetime ?? false,
      deletedAt: ended ? eventTime : null,
      lastStripeEventAt: eventTime,
    });

    if (status === 'ACTIVE' && !isLive(existing, subscriptionId)) {
      await notify(store, org.id, 'billing.activated', BILLING_NOTIFICATIONS.activated(planLabel(tier)), {
        tier,
        period,
      });
    }

    if (ended && existing && !existing.deletedAt) {
      await notify(store, org.id, 'billing.canceled', BILLING_NOTIFICATIONS.canceled(planLabel(tier)), {
        tier,
        period,
      });
    }

    return { orgId: org.id, outcome: 'applied' };
  }

  private async onSubscriptionDeleted(event: BillingWebhookEvent, store: BillingStore): Promise<Applied> {
    const subscription = objectOf(event);
    const subscriptionId = subscription.id ?? null;
    const org = await this.resolveOrg(store, {
      metadata: subscription.metadata,
      fallbackOrgId: null,
      customerId: idOf(subscription.customer),
      subscriptionId,
    });

    if (!org) {
      return { orgId: null, outcome: 'ignored:unknown_org' };
    }

    const stale = staleOutcome(event, org);
    if (stale) {
      return { orgId: org.id, outcome: stale };
    }

    const existing = org.subscription;

    if (!existing) {
      return { orgId: org.id, outcome: 'ignored:no_subscription' };
    }

    if (existing.identifier && subscriptionId && existing.identifier !== subscriptionId) {
      return { orgId: org.id, outcome: 'ignored:other_subscription' };
    }

    const eventTime = timeOf(event);
    const tier = existing.subscriptionTier;

    await store.updateOrganization(org.id, { isTrailing: false, allowTrial: false });
    await store.updateSubscription(org.id, {
      status: 'CANCELED',
      deletedAt: eventTime,
      scheduledTier: null,
      scheduledPeriod: null,
      lastStripeEventAt: eventTime,
    });

    if (!existing.deletedAt) {
      await notify(store, org.id, 'billing.canceled', BILLING_NOTIFICATIONS.canceled(planLabel(tier)), {
        tier,
        period: existing.period,
      });
    }

    return { orgId: org.id, outcome: 'applied' };
  }

  private async onPaymentFailed(event: BillingWebhookEvent, store: BillingStore): Promise<Applied> {
    const invoice = objectOf(event);
    const resolved = await this.resolveInvoiceOrg(store, invoice);

    if (!resolved.org) {
      return { orgId: null, outcome: 'ignored:unknown_org' };
    }

    if (resolved.outcome !== null) {
      return { orgId: resolved.org.id, outcome: resolved.outcome };
    }

    const { org, existing } = resolved;
    const stale = staleOutcome(event, org);
    if (stale) {
      return { orgId: org.id, outcome: stale };
    }

    const eventTime = timeOf(event);

    // A cancelled or incomplete row is not "past due": Stripe's own dunning
    // already decided what it is. Only a live plan is moved into grace.
    if (existing.status === 'ACTIVE' || existing.status === 'TRIALING' || existing.status === 'PAST_DUE') {
      await store.updateSubscription(org.id, { status: 'PAST_DUE', lastStripeEventAt: eventTime });
    } else {
      await store.updateSubscription(org.id, { lastStripeEventAt: eventTime });
    }

    await notify(
      store,
      org.id,
      'billing.payment_failed',
      BILLING_NOTIFICATIONS.paymentFailed(planLabel(existing.subscriptionTier)),
      { tier: existing.subscriptionTier, period: existing.period },
    );

    return { orgId: org.id, outcome: 'applied' };
  }

  private async onInvoicePaid(event: BillingWebhookEvent, store: BillingStore): Promise<Applied> {
    const invoice = objectOf(event);
    const resolved = await this.resolveInvoiceOrg(store, invoice);

    if (!resolved.org) {
      return { orgId: null, outcome: 'ignored:unknown_org' };
    }

    if (resolved.outcome !== null) {
      return { orgId: resolved.org.id, outcome: resolved.outcome };
    }

    const { org, existing } = resolved;
    const stale = staleOutcome(event, org);
    if (stale) {
      return { orgId: org.id, outcome: stale };
    }

    const eventTime = timeOf(event);
    const linePeriodEnd = toDate(invoice.lines?.data?.[0]?.period?.end);
    const recovers = existing.status === 'PAST_DUE' || existing.status === 'INCOMPLETE';

    await store.updateSubscription(org.id, {
      ...(recovers ? { status: 'ACTIVE' as const } : {}),
      ...(linePeriodEnd ? { currentPeriodEnd: linePeriodEnd } : {}),
      lastStripeEventAt: eventTime,
    });

    return { orgId: org.id, outcome: 'applied' };
  }

  /** The workspace an event is about: metadata first, then the customer, then the subscription id. */
  private async resolveOrg(
    store: BillingStore,
    source: {
      metadata: Record<string, string> | null | undefined;
      fallbackOrgId: string | null;
      customerId: string | null;
      subscriptionId: string | null;
    },
  ): Promise<OrgBilling | null> {
    const candidates: string[] = [];
    const fromMetadata = source.metadata?.organizationId;

    if (fromMetadata) {
      candidates.push(fromMetadata);
    }
    if (source.fallbackOrgId) {
      candidates.push(source.fallbackOrgId);
    }
    if (source.customerId) {
      const byCustomer = await store.findOrgIdByCustomer(source.customerId);
      if (byCustomer) {
        candidates.push(byCustomer);
      }
    }
    if (source.subscriptionId) {
      const bySubscription = await store.findOrgIdBySubscription(source.subscriptionId);
      if (bySubscription) {
        candidates.push(bySubscription);
      }
    }

    for (const orgId of candidates) {
      const org = await store.findOrgBilling(orgId);
      if (org) {
        return org;
      }
    }

    return null;
  }

  /** An invoice names its subscription under `parent`; the org follows from that. */
  private async resolveInvoiceOrg(
    store: BillingStore,
    invoice: StripeObjectLike,
  ): Promise<
    | { org: null }
    | { org: OrgBilling; existing: Subscription; outcome: null }
    | { org: OrgBilling; existing: Subscription | null; outcome: string }
  > {
    const details = invoice.parent?.subscription_details ?? null;
    const subscriptionId = idOf(details?.subscription) ?? idOf(invoice.subscription);
    const org = await this.resolveOrg(store, {
      metadata: details?.metadata ?? invoice.metadata,
      fallbackOrgId: null,
      customerId: idOf(invoice.customer),
      subscriptionId,
    });

    if (!org) {
      return { org: null };
    }

    const existing = org.subscription;

    if (!existing || existing.deletedAt) {
      return { org, existing, outcome: 'ignored:no_subscription' };
    }

    if (existing.identifier && subscriptionId && existing.identifier !== subscriptionId) {
      return { org, existing, outcome: 'ignored:other_subscription' };
    }

    return { org, existing, outcome: null };
  }
}

// ---------------------------------------------------------------------------
// Readers — every field optional, nothing trusted to be well-formed
// ---------------------------------------------------------------------------

function objectOf(event: BillingWebhookEvent): StripeObjectLike {
  const object = event.data?.object;
  return typeof object === 'object' && object !== null ? (object as StripeObjectLike) : {};
}

function idOf(value: string | { id: string } | null | undefined): string | null {
  if (!value) {
    return null;
  }
  return typeof value === 'string' ? value : (value.id ?? null);
}

function toDate(seconds: number | null | undefined): Date | null {
  return typeof seconds === 'number' && Number.isFinite(seconds) ? new Date(seconds * 1_000) : null;
}

function timeOf(event: BillingWebhookEvent): Date {
  return toDate(event.created) ?? new Date();
}

function periodEndOf(subscription: StripeObjectLike): Date | null {
  return toDate(subscription.items?.data?.[0]?.current_period_end);
}

function parseTier(value: string | undefined): SubscriptionTier | null {
  return isPaidTier(value) ? value : null;
}

function parsePeriod(value: string | undefined): Period | null {
  return value === 'MONTHLY' || value === 'YEARLY' ? value : null;
}

/** Stripe's subscription statuses onto the five the row knows. `ended` = the row is soft-deleted. */
function mapStatus(status: string | undefined): { status: SubscriptionStatus; ended: boolean } {
  switch (status) {
    case 'trialing':
      return { status: 'TRIALING', ended: false };
    case 'past_due':
    case 'unpaid':
    case 'paused':
      return { status: 'PAST_DUE', ended: false };
    case 'canceled':
    case 'incomplete_expired':
      return { status: 'CANCELED', ended: true };
    case 'incomplete':
      return { status: 'INCOMPLETE', ended: false };
    default:
      return { status: 'ACTIVE', ended: false };
  }
}

/** `ignored:stale` when the row has already seen a newer event; otherwise null. */
function staleOutcome(event: BillingWebhookEvent, org: OrgBilling): string | null {
  const last = org.subscription?.lastStripeEventAt;

  if (last && timeOf(event).getTime() < last.getTime()) {
    return 'ignored:stale';
  }

  return null;
}

/** A row that is live for this very subscription — so activating it again is not news. */
function isLive(existing: Subscription | null, subscriptionId: string | null): boolean {
  return Boolean(
    existing &&
      !existing.deletedAt &&
      existing.status === 'ACTIVE' &&
      (!subscriptionId || !existing.identifier || existing.identifier === subscriptionId),
  );
}

/**
 * The channel entitlement to write: the plan's number on a new or changed
 * tier; otherwise the larger of the plan and the row, so a hand-granted
 * number survives an event that did not change the plan.
 */
function channelsFor(
  tier: SubscriptionTier,
  existing: Subscription | null,
  tierChanged: boolean = !existing || existing.subscriptionTier !== tier,
): number {
  const plan = channelLimitFor(tier);

  if (!existing || tierChanged) {
    return plan;
  }

  return Math.max(plan, existing.totalChannels);
}

async function notify(
  store: BillingStore,
  orgId: string,
  type: string,
  text: { title: string; content: string },
  meta: Record<string, unknown>,
): Promise<void> {
  await store.createNotification({
    organizationId: orgId,
    type,
    title: text.title,
    content: text.content,
    link: `/${orgId}/settings/billing`,
    meta,
  });
}
