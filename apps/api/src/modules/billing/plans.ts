/**
 * The plan table: the single source of truth for what each tier costs and
 * allows (Sprint 8).
 *
 * Pure data and pure functions: no Nest, no Prisma, no Stripe. Everything
 * that gates on a plan reads from here: the AI credit allowance
 * (`ai/credits/credits.policy.ts`), the channel limit (`channels`), the
 * billing page (`GET /billing/plans`) and the Stripe checkout (inline
 * `price_data` built from these numbers). There is deliberately no second
 * copy of any figure anywhere else.
 *
 * ## Prices are placeholders
 *
 * The amounts below are a starting point for the owner to confirm, not a
 * pricing decision made by the code. They live in one place so changing them
 * is one edit. Yearly is ten months (two free).
 *
 * ## Entitlement is computed on read
 *
 * `resolveEntitlement` turns a `Subscription` row (or its absence) into the
 * tier a workspace is entitled to *right now*. A trial that has run past
 * `trialEndsAt` is FREE without any job having to flip it; a cancellation
 * keeps its tier until `cancelAt`; a past-due subscription keeps its tier
 * (Stripe's own dunning decides when it ends). No cron, no race.
 */
import type { Period, SubscriptionStatus, SubscriptionTier } from '@postgear/db';

/** `FREE` is a workspace with no live entitlement: no row, an expired trial, a cancelled plan. */
export type PlanTier = 'FREE' | SubscriptionTier;

export interface Plan {
  tier: PlanTier;
  name: string;
  description: string;
  monthlyPriceCents: number;
  yearlyPriceCents: number;
  /** Connected channels allowed. Enforced where a channel is connected. */
  channels: number;
  /** AI credits per billing cycle. Enforced by the credit ledger. */
  aiCredits: number;
  /** Workspace members. `null` = unlimited. Not enforced yet: see the checklist. */
  members: number | null;
  features: string[];
  /** The plan the billing page draws attention to. */
  highlighted: boolean;
}

export const PLAN_ORDER: readonly PlanTier[] = ['FREE', 'STANDARD', 'PRO', 'TEAM', 'ULTIMATE'];

export const PAID_TIERS: readonly SubscriptionTier[] = ['STANDARD', 'PRO', 'TEAM', 'ULTIMATE'];

/** What a trial grants, and for how long by default (`BILLING_TRIAL_DAYS`). */
export const TRIAL_TIER: SubscriptionTier = 'PRO';
export const DEFAULT_TRIAL_DAYS = 14;

export const PLANS: Record<PlanTier, Plan> = {
  FREE: {
    tier: 'FREE',
    name: 'Free',
    description: 'Try PostGear with one channel.',
    monthlyPriceCents: 0,
    yearlyPriceCents: 0,
    channels: 1,
    aiCredits: 25,
    members: 1,
    features: ['1 connected channel', '25 AI credits a month', 'Calendar and queue', 'SEO analyzer'],
    highlighted: false,
  },
  STANDARD: {
    tier: 'STANDARD',
    name: 'Standard',
    description: 'For one person posting to a few channels.',
    monthlyPriceCents: 2_900,
    yearlyPriceCents: 29_000,
    channels: 5,
    aiCredits: 100,
    members: 1,
    features: [
      '5 connected channels',
      '100 AI credits a month',
      'Analytics for every channel',
      'Public API and webhooks',
      'Premium light themes',
    ],
    highlighted: false,
  },
  PRO: {
    tier: 'PRO',
    name: 'Pro',
    description: 'For creators and small teams who post every day.',
    monthlyPriceCents: 4_900,
    yearlyPriceCents: 49_000,
    channels: 15,
    aiCredits: 500,
    members: 3,
    features: [
      '15 connected channels',
      '500 AI credits a month',
      '3 team members',
      'Analytics, API and webhooks',
      'Premium light themes',
    ],
    highlighted: true,
  },
  TEAM: {
    tier: 'TEAM',
    name: 'Team',
    description: 'For agencies managing many clients.',
    monthlyPriceCents: 9_900,
    yearlyPriceCents: 99_000,
    channels: 40,
    aiCredits: 2_000,
    members: 10,
    features: [
      '40 connected channels',
      '2,000 AI credits a month',
      '10 team members',
      'Analytics, API and webhooks',
      'Premium light themes',
    ],
    highlighted: false,
  },
  ULTIMATE: {
    tier: 'ULTIMATE',
    name: 'Ultimate',
    description: 'For large teams with no limits that matter.',
    monthlyPriceCents: 19_900,
    yearlyPriceCents: 199_000,
    channels: 100,
    aiCredits: 10_000,
    members: null,
    features: [
      '100 connected channels',
      '10,000 AI credits a month',
      'Unlimited team members',
      'Analytics, API and webhooks',
      'Premium light themes',
    ],
    highlighted: false,
  },
};

export function planFor(tier: PlanTier): Plan {
  return PLANS[tier];
}

export function isPlanTier(value: unknown): value is PlanTier {
  return typeof value === 'string' && (PLAN_ORDER as readonly string[]).includes(value);
}

export function isPaidTier(value: unknown): value is SubscriptionTier {
  return typeof value === 'string' && (PAID_TIERS as readonly string[]).includes(value);
}

/** AI credits per cycle. The one function `credits.policy.ts` reads. */
export function allowanceFor(tier: PlanTier): number {
  return PLANS[tier].aiCredits;
}

/** Connected channels allowed. The one function the channels module reads. */
export function channelLimitFor(tier: PlanTier): number {
  return PLANS[tier].channels;
}

export function priceFor(tier: PlanTier, period: Period): number {
  return period === 'YEARLY' ? PLANS[tier].yearlyPriceCents : PLANS[tier].monthlyPriceCents;
}

/** Position in the ladder; an upgrade moves up it. */
export function rankOf(tier: PlanTier): number {
  return PLAN_ORDER.indexOf(tier);
}

export function isUpgrade(from: PlanTier, to: PlanTier): boolean {
  return rankOf(to) > rankOf(from);
}

export type EntitlementStatus =
  | 'none'
  | 'trialing'
  | 'trial_expired'
  | 'active'
  | 'past_due'
  | 'canceling'
  | 'canceled'
  | 'incomplete';

/** The columns `resolveEntitlement` reads: what a repository selects. */
export interface SubscriptionLike {
  subscriptionTier: SubscriptionTier;
  status: SubscriptionStatus;
  period: Period;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  cancelAt: Date | null;
  deletedAt: Date | null;
  isLifetime: boolean;
  scheduledTier: SubscriptionTier | null;
  scheduledPeriod: Period | null;
}

export interface Entitlement {
  tier: PlanTier;
  status: EntitlementStatus;
  plan: Plan;
  period: Period | null;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  cancelAt: Date | null;
  scheduledTier: PlanTier | null;
  scheduledPeriod: Period | null;
  isLifetime: boolean;
}

/**
 * What a workspace is entitled to at `now`.
 *
 * The rules, in order:
 * - no row, or a soft-deleted one → FREE (`none`, or `canceled` when the row
 *   was cancelled, so the page can say "your plan ended" rather than "no plan");
 * - a lifetime row → its tier, `active`, for ever;
 * - TRIALING → its tier while `trialEndsAt` is ahead, else FREE / `trial_expired`;
 * - ACTIVE → its tier; `canceling` when a cancellation is scheduled;
 * - PAST_DUE → its tier (a grace period; Stripe's dunning decides the end);
 * - CANCELED → FREE / `canceled`; INCOMPLETE → FREE / `incomplete`.
 */
export function resolveEntitlement(
  subscription: SubscriptionLike | null,
  now: Date = new Date(),
): Entitlement {
  const free = (status: EntitlementStatus): Entitlement => ({
    tier: 'FREE',
    status,
    plan: PLANS.FREE,
    period: null,
    trialEndsAt: subscription?.trialEndsAt ?? null,
    currentPeriodEnd: null,
    cancelAt: null,
    scheduledTier: null,
    scheduledPeriod: null,
    isLifetime: false,
  });

  if (!subscription) {
    return free('none');
  }

  if (subscription.deletedAt) {
    return free(subscription.status === 'CANCELED' ? 'canceled' : 'none');
  }

  const entitled = (status: EntitlementStatus): Entitlement => ({
    tier: subscription.subscriptionTier,
    status,
    plan: PLANS[subscription.subscriptionTier],
    period: subscription.period,
    trialEndsAt: subscription.trialEndsAt,
    currentPeriodEnd: subscription.currentPeriodEnd,
    cancelAt: subscription.cancelAt,
    scheduledTier: subscription.scheduledTier,
    scheduledPeriod: subscription.scheduledPeriod,
    isLifetime: subscription.isLifetime,
  });

  if (subscription.isLifetime) {
    return entitled('active');
  }

  switch (subscription.status) {
    case 'TRIALING':
      return subscription.trialEndsAt && subscription.trialEndsAt.getTime() > now.getTime()
        ? entitled('trialing')
        : free('trial_expired');
    case 'ACTIVE':
      return entitled(subscription.cancelAt ? 'canceling' : 'active');
    case 'PAST_DUE':
      return entitled('past_due');
    case 'CANCELED':
      return free('canceled');
    case 'INCOMPLETE':
      return free('incomplete');
  }
}
