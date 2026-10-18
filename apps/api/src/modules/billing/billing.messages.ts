/**
 * User-facing strings for billing.
 *
 * Specific, for the reason `channels.messages.ts` gives: the caller is an
 * authenticated admin of the workspace, so there is nothing to hide behind
 * "something went wrong". What *is* hidden is Stripe. A Stripe error body
 * can quote a request, a customer id or part of a key; none of that reaches
 * a response: every provider failure is mapped to a string below and the
 * original goes to the server log.
 *
 * The webhook is the one exception to "specific": a signature failure is
 * answered with a bare "Invalid signature", because the caller is either
 * Stripe (which does not read it) or someone forging payment events (who
 * should learn nothing).
 */
import type { PlanTier } from './plans';

export const BILLING_MESSAGES = {
  NOT_CONFIGURED:
    'Billing is not set up on this PostGear instance. Set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET, or BILLING_SIMULATION="true" for local development.',
  WORKSPACE_NOT_FOUND: 'Workspace not found',
  TRIAL_NOT_ELIGIBLE:
    'This workspace has already had a plan or a trial, so a new trial cannot be started.',
  TRIALS_DISABLED: 'Free trials are not offered on this PostGear instance.',
  ALREADY_SUBSCRIBED:
    'This workspace already has a plan. Change it from the billing page instead of subscribing again.',
  NO_SUBSCRIPTION: 'This workspace has no active plan to change. Subscribe first.',
  MANUAL_PLAN:
    'This plan was granted by hand rather than through Stripe, so it cannot be changed here. Contact whoever runs PostGear.',
  SAME_PLAN: 'That is the plan this workspace is already on.',
  PORTAL_UNAVAILABLE: 'The billing portal opens once this workspace has subscribed.',
  NOT_CANCELING: 'There is no scheduled cancellation to resume.',
  CHECKOUT_FAILED: 'We could not start the checkout. Please try again.',
  PROVIDER_FAILED: 'The payment provider could not be reached. Please try again in a minute.',
  WEBHOOK_REJECTED: 'Invalid signature',
  CHANNEL_LIMIT:
    'This workspace has reached its plan’s channel limit. Upgrade the plan to connect more channels.',
} as const;

/** The reasons the cancel dialog offers, in the order it shows them. */
export const CANCEL_REASONS = [
  'too_expensive',
  'missing_features',
  'not_using',
  'switching',
  'other',
] as const;

export type CancelReason = (typeof CANCEL_REASONS)[number];

export const CANCEL_REASON_LABELS: Record<CancelReason, string> = {
  too_expensive: 'Too expensive',
  missing_features: 'Missing features I need',
  not_using: 'Not using it enough',
  switching: 'Switching to another tool',
  other: 'Something else',
};

/**
 * The `Notifications` rows billing writes. Each is a title and a line of
 * content; the dispatcher (the notifications module) emails them to the
 * workspace's admins, so the content has to read on its own.
 */
export const BILLING_NOTIFICATIONS = {
  activated: (planName: string) => ({
    title: `${planName} plan is active`,
    content: `Your workspace is now on the ${planName} plan. Thanks for subscribing to PostGear.`,
  }),
  paymentFailed: (planName: string) => ({
    title: 'Payment failed',
    content: `The latest payment for your ${planName} plan did not go through. Update your payment method from the billing page to keep your plan.`,
  }),
  canceled: (planName: string) => ({
    title: `${planName} plan ended`,
    content: `Your ${planName} plan has ended and the workspace is on the Free plan. You can subscribe again at any time.`,
  }),
  trialStarted: (planName: string, days: number) => ({
    title: `Your ${planName} trial has started`,
    content: `You have ${days} days of the ${planName} plan, no card needed. Pick a plan before it ends to keep everything running.`,
  }),
} as const;

/** The plan name as the notifications spell it ("Pro", not "PRO"). */
export function planLabel(tier: PlanTier): string {
  return tier.charAt(0) + tier.slice(1).toLowerCase();
}
