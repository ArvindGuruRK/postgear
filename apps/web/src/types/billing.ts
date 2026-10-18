/**
 * Billing shapes shared between server components and client islands
 * (Sprint 8). Declared here rather than imported from the API or from
 * `@postgear/db`, for the reason `workspace.ts` gives: nothing Prisma-backed
 * may reach a browser bundle. These mirror `GET /billing/*` exactly: see
 * docs/sprint-documents/sprint-08-contract.md §5.1.
 */

export type PlanTier = 'FREE' | 'STANDARD' | 'PRO' | 'TEAM' | 'ULTIMATE';
export type PaidTier = Exclude<PlanTier, 'FREE'>;
export type BillingPeriod = 'MONTHLY' | 'YEARLY';
export type BillingMode = 'simulation' | 'stripe' | 'unconfigured';

export type EntitlementStatus =
  | 'none'
  | 'trialing'
  | 'trial_expired'
  | 'active'
  | 'past_due'
  | 'canceling'
  | 'canceled'
  | 'incomplete';

export interface Plan {
  tier: PlanTier;
  name: string;
  description: string;
  monthlyPriceCents: number;
  yearlyPriceCents: number;
  channels: number;
  aiCredits: number;
  /** `null` = unlimited. */
  members: number | null;
  features: string[];
  highlighted: boolean;
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
  period: BillingPeriod | null;
  currentPeriodEnd: string | null;
  trialEndsAt: string | null;
  /** When a scheduled cancellation ends access. */
  cancelAt: string | null;
  scheduledTier: PlanTier | null;
  scheduledPeriod: BillingPeriod | null;
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

/** `GET /billing/plans`. */
export interface PlansResponse {
  plans: Plan[];
  trialDays: number;
}

/** `GET /billing/change/preview`. */
export interface ChangePreviewResponse {
  preview: ChangePreview;
}

/** `{ tier, period }`: the body of checkout and change, the query of the preview. */
export interface PlanSelection {
  tier: PaidTier;
  period: BillingPeriod;
}

export type CancelReason =
  | 'too_expensive'
  | 'missing_features'
  | 'not_using'
  | 'switching'
  | 'other';
