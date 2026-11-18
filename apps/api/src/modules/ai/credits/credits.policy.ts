/**
 * The credit rules, as plain functions: what things cost, what a tier gets,
 * and when a cycle starts and ends.
 *
 * Kept free of Prisma and Nest so every rule is a one-line test. The service
 * applies them; the repository stores the outcome.
 *
 * ## The ledger is additive
 *
 * A charge is a `Credits` row with a positive `credits`; a refund is a row
 * with a negative one, typed `refund:<what>`. Nothing is ever updated or
 * deleted, so "used this cycle" is a sum over rows since the cycle started
 * and the history of every generation survives, including the ones that were
 * refunded, which is exactly what a billing dispute needs to see.
 *
 * ## Why the cycle follows the subscription's day of the month
 *
 * (The rule now lives in `@postgear/entitlements` `cycle.ts`; see below.)
 *
 * A calendar month would give a workspace that subscribes on the 28th three
 * days of allowance before a reset. Anchoring on the day the subscription
 * started (or, with no subscription, the day the workspace was created) gives
 * every workspace a full month, and matches how the subscription itself bills.
 * Day 31 clamps to the month's last day, so a January 31 anchor resets on
 * February 28 and then March 31, never skipping a month.
 */
import type { SubscriptionTier } from '@postgear/db';
import { cycleFor, type UsageWindow } from '@postgear/entitlements';
import {
  PLAN_ORDER,
  type SubscriptionLike as PlanSubscriptionLike,
  allowanceFor as planAllowanceFor,
  resolveEntitlement,
} from '../../billing/plans';

export const AI_CREDIT_COSTS = {
  generate_post: 5,
  generate_image: 10,
  copilot_message: 1,
  /** Sprint 7: the SEO analyzer's AI advice; one structured call over the audit. */
  seo_advice: 3,
  /**
   * Sprint 10: the small workflow AI steps (Generate Hashtags, Rewrite In
   * Brand Voice); one short structured call each.
   */
  generate_snippet: 2,
  /** Sprint 11 Module 10: Research This Competitor; one structured call over posts already read. */
  competitor_research: 3,
} as const;

export type AiCreditType = keyof typeof AI_CREDIT_COSTS;

export const AI_CREDIT_TYPES = Object.keys(AI_CREDIT_COSTS) as AiCreditType[];

export type AiRefundType = `refund:${AiCreditType}`;

export function refundTypeFor(type: AiCreditType): AiRefundType {
  return `refund:${type}`;
}

/**
 * Every `Credits.type` this module writes. The sum over these rows is what a
 * cycle has used; rows of any other type (the inherited `ai_images` default,
 * anything a later sprint adds) are not this module's to count.
 */
export const AI_LEDGER_TYPES: readonly string[] = [
  ...AI_CREDIT_TYPES,
  ...AI_CREDIT_TYPES.map(refundTypeFor),
];

/**
 * `NONE` is a workspace with no live entitlement (no subscription, an expired
 * trial, a cancelled plan) and gets the FREE plan's allowance. The name
 * predates Sprint 8's plan table and is kept because the web app and every
 * stream event carry it; it maps to `PlanTier` `FREE`.
 */
export type AiTier = 'NONE' | SubscriptionTier;

/**
 * Derived from the plan table (Sprint 8): `billing/plans.ts` is the single
 * source of truth, and this module holds no numbers of its own.
 */
export const AI_CREDIT_ALLOWANCE: Record<AiTier, number> = Object.fromEntries(
  PLAN_ORDER.map((tier) => [tier === 'FREE' ? 'NONE' : tier, planAllowanceFor(tier)]),
) as Record<AiTier, number>;

/** Below this share of the allowance the UI warns (user story 5.5). */
export const LOW_CREDITS_FRACTION = 0.2;

/** `GET /ai/credits`, and what rides on every terminal stream event. */
export interface AiCredits {
  allowance: number;
  used: number;
  remaining: number;
  /** ISO time the cycle restarts and `used` returns to zero. */
  resetsAt: string;
  tier: AiTier;
  low: boolean;
  costs: typeof AI_CREDIT_COSTS;
}

/**
 * What the tier is read from: the subscription row, or its absence. The
 * columns the plan table's entitlement rule needs, plus `createdAt` for the
 * cycle anchor.
 */
export interface SubscriptionLike extends PlanSubscriptionLike {
  createdAt: Date;
}

/**
 * The tier a workspace is entitled to now. Delegates to the plan table's
 * `resolveEntitlement` (Sprint 8), so a trial that has run out or a plan
 * that was cancelled drops to the FREE allowance without a job flipping it.
 */
export function tierOf(subscription: SubscriptionLike | null, now: Date = new Date()): AiTier {
  const entitlement = resolveEntitlement(subscription, now);
  return entitlement.tier === 'FREE' ? 'NONE' : entitlement.tier;
}

export function allowanceFor(tier: AiTier): number {
  return planAllowanceFor(tier === 'NONE' ? 'FREE' : tier);
}

/** What `POST /ai/generate` charges up front. */
export function generateCost(withImage: boolean): number {
  return AI_CREDIT_COSTS.generate_post + (withImage ? AI_CREDIT_COSTS.generate_image : 0);
}

export function isLow(remaining: number, allowance: number): boolean {
  return remaining < allowance * LOW_CREDITS_FRACTION;
}

/**
 * A credit cycle: start inclusive, end exclusive (the next reset).
 *
 * `cycleFor` moved to `@postgear/entitlements` in Sprint 12, unchanged, so AI
 * credits and the Clips meters (AI minutes, import minutes) reset on the same
 * date. It is re-exported here so every credits caller and test keeps its import.
 */
export type CreditCycle = UsageWindow;

export { cycleFor };

export function buildCredits(params: { tier: AiTier; used: number; resetsAt: Date }): AiCredits {
  const allowance = allowanceFor(params.tier);
  const remaining = Math.max(0, allowance - params.used);

  return {
    allowance,
    used: params.used,
    remaining,
    resetsAt: params.resetsAt.toISOString(),
    tier: params.tier,
    low: isLow(remaining, allowance),
    costs: AI_CREDIT_COSTS,
  };
}
