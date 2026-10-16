/**
 * The shapes the billing module passes between its parts and returns from
 * its routes. The route shapes mirror `apps/web/src/types/billing.ts` and
 * docs/sprint-documents/sprint-08-contract.md §5.1.
 *
 * ## Stripe objects are read structurally
 *
 * The webhook handler does not type its payloads as `Stripe.Event`. Two
 * reasons: the simulation synthesises events with only the fields the
 * handler reads, and Stripe's own union over every event type gives no
 * guarantee the SDK's idea of a field matches the API version the account
 * sends. So the handler reads a few named fields through tolerant readers
 * (`stripe-webhook.service.ts`), and a real `Stripe.Event` satisfies the
 * same interface by structure.
 */
import type { Period, SubscriptionTier } from '@postgear/db';
import type { BillingMode } from './billing.config';
import type { EntitlementStatus, Plan, PlanTier } from './plans';

/** What every handled event is read as — a real `Stripe.Event` fits. */
export interface BillingWebhookEvent {
  id: string;
  type: string;
  /** Unix seconds, as Stripe sends it. */
  created: number;
  data: { object: unknown };
}

export interface BillingStatus {
  mode: BillingMode;
  publishableKey: string | null;
  trialDays: number;
}

export interface SubscriptionView {
  tier: PlanTier;
  status: EntitlementStatus;
  plan: Plan;
  period: Period | null;
  currentPeriodEnd: string | null;
  trialEndsAt: string | null;
  cancelAt: string | null;
  scheduledTier: PlanTier | null;
  scheduledPeriod: Period | null;
  isLifetime: boolean;
  canStartTrial: boolean;
  portalAvailable: boolean;
}

export interface BillingUsage {
  channels: { used: number; limit: number };
  aiCredits: { used: number; allowance: number; resetsAt: string };
}

export interface SubscriptionResponse {
  subscription: SubscriptionView;
  usage: BillingUsage;
}

export interface ChangePreview {
  effective: 'now' | 'period_end';
  amountDueCents: number;
  currency: string;
  periodEnd: string | null;
}

/** `GET /channels` carries this, and the channels service gates on it. */
export interface ChannelUsage {
  used: number;
  limit: number;
  tier: PlanTier;
}

/**
 * What the Stripe gateway needs to know about the subscription it is acting
 * on. Read from the row, never from the client.
 */
export interface SubscriptionSnapshot {
  orgId: string;
  customerId: string;
  subscriptionId: string;
  tier: SubscriptionTier;
  period: Period;
  currentPeriodEnd: Date | null;
  cancelAt: Date | null;
  scheduledTier: SubscriptionTier | null;
  scheduledPeriod: Period | null;
}

export interface PlanChangeRequest extends SubscriptionSnapshot {
  toTier: SubscriptionTier;
  toPeriod: Period;
  /** Decided by the service from the plan ladder: up is now, down is period end. */
  effective: 'now' | 'period_end';
}

export interface CheckoutRequest {
  orgId: string;
  customerId: string;
  tier: SubscriptionTier;
  period: Period;
  /** Carries `{CHECKOUT_SESSION_ID}`, which Stripe (and the simulation) fills in. */
  successUrl: string;
  cancelUrl: string;
}

export interface WebhookReceipt {
  received: true;
  duplicate?: true;
  /** `applied`, `ignored:<reason>` or `failed:<reason>` — what the `BillingEvent` row says. */
  outcome?: string;
}
