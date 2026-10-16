/**
 * The billing page's judgements, as plain functions with a test: which
 * badge a status gets, how a price reads, how many trial days are left,
 * what each plan card's button says, and the "Activating…" state machine
 * that polls the subscription until a webhook has landed.
 *
 * ## The pending state is a reducer
 *
 * After checkout, a plan change, a cancellation or a resume, the row does
 * not change until Stripe's webhook (or the simulation's) is processed —
 * the contract's "pending state rather than optimistic update". So the
 * page declares what it is waiting for (`Expectation`), polls every two
 * seconds for at most a minute, and the reducer decides between still
 * waiting, done, and timed out. Nothing here touches the network; the
 * view feeds it what `GET /billing/subscription` returned.
 */
import type {
  BillingPeriod,
  CancelReason,
  EntitlementStatus,
  Plan,
  PlanTier,
  SubscriptionView,
} from '@/types/billing';

export type BadgeTone = 'primary' | 'secondary' | 'danger' | 'ai' | 'accent' | 'success' | 'outline';

export const POLL_INTERVAL_MS = 2_000;
export const POLL_TIMEOUT_MS = 60_000;

const DAY_MS = 24 * 60 * 60 * 1_000;

/**
 * One badge per entitlement status. The tones are the Sprint 5 vocabulary:
 * success for the one good outcome, primary for a trial (something in
 * progress), danger for a payment that failed, accent for a cancellation
 * waiting to happen.
 */
export const STATUS_PRESENTATION: Record<EntitlementStatus, { label: string; variant: BadgeTone }> = {
  none: { label: 'No plan', variant: 'outline' },
  trialing: { label: 'Trial', variant: 'primary' },
  trial_expired: { label: 'Trial ended', variant: 'outline' },
  active: { label: 'Active', variant: 'success' },
  past_due: { label: 'Payment failed', variant: 'danger' },
  canceling: { label: 'Ending', variant: 'accent' },
  canceled: { label: 'Canceled', variant: 'outline' },
  incomplete: { label: 'Incomplete', variant: 'danger' },
};

export function statusBadge(status: EntitlementStatus): { label: string; variant: BadgeTone } {
  return STATUS_PRESENTATION[status];
}

/** "$29" or "$24.17" — prices are USD, so the locale is fixed and safe to render on the server. */
export function formatPrice(cents: number, currency = 'USD'): string {
  const whole = cents % 100 === 0;

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

export interface PlanPrice {
  amount: string;
  per: '/mo' | '/yr';
  /** The yearly plan's monthly equivalent, so the two periods compare. */
  note: string | null;
}

export function planPrice(plan: Plan, period: BillingPeriod): PlanPrice {
  if (plan.tier === 'FREE') {
    return { amount: formatPrice(0), per: period === 'YEARLY' ? '/yr' : '/mo', note: null };
  }

  if (period === 'YEARLY') {
    return {
      amount: formatPrice(plan.yearlyPriceCents),
      per: '/yr',
      note: `${formatPrice(Math.round(plan.yearlyPriceCents / 12))}/mo, billed yearly`,
    };
  }

  return { amount: formatPrice(plan.monthlyPriceCents), per: '/mo', note: null };
}

/** Whole days until `until`, never negative; null when there is no date. */
export function daysLeft(until: string | null, now: Date = new Date()): number | null {
  if (!until) {
    return null;
  }

  const end = new Date(until).getTime();

  if (Number.isNaN(end)) {
    return null;
  }

  return Math.max(0, Math.ceil((end - now.getTime()) / DAY_MS));
}

/** "13 Nov 2026" in the viewer's locale. Render after mount (see `use-mounted.ts`). */
export function formatDate(iso: string | null): string | null {
  if (!iso) {
    return null;
  }

  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** The page's two states: a paid plan to manage, or plans to choose from. */
export type ViewState = 'subscribe' | 'manage';

export function viewStateFor(view: SubscriptionView): ViewState {
  return view.status === 'active' || view.status === 'past_due' || view.status === 'canceling'
    ? 'manage'
    : 'subscribe';
}

const TIER_RANK: Record<PlanTier, number> = { FREE: 0, STANDARD: 1, PRO: 2, TEAM: 3, ULTIMATE: 4 };

export function tierRank(tier: PlanTier): number {
  return TIER_RANK[tier];
}

export type ChangeKind = 'same' | 'scheduled' | 'upgrade' | 'downgrade';

/**
 * Mirrors the API's rule: up the ladder, or monthly to yearly on the same
 * tier, is an upgrade applied now; anything else waits for the period end.
 */
export function changeKind(view: SubscriptionView, tier: PlanTier, period: BillingPeriod): ChangeKind {
  if (tier === view.tier && period === view.period) {
    return 'same';
  }

  if (tier === view.scheduledTier && period === (view.scheduledPeriod ?? period)) {
    return 'scheduled';
  }

  if (tierRank(tier) > tierRank(view.tier)) {
    return 'upgrade';
  }

  if (tier === view.tier && view.period === 'MONTHLY' && period === 'YEARLY') {
    return 'upgrade';
  }

  return 'downgrade';
}

export interface PlanAction {
  kind: 'free' | 'current' | 'scheduled' | 'subscribe' | 'upgrade' | 'downgrade';
  label: string;
  variant: 'primary' | 'secondary';
  disabled: boolean;
}

/** What a plan card's button says and does for this workspace. */
export function planAction(
  plan: Plan,
  period: BillingPeriod,
  view: SubscriptionView,
  canManage: boolean,
): PlanAction {
  const state = viewStateFor(view);
  const current = state === 'manage' && plan.tier === view.tier && period === view.period;

  if (current) {
    return { kind: 'current', label: 'Current plan', variant: 'secondary', disabled: true };
  }

  if (plan.tier === 'FREE') {
    return {
      kind: 'free',
      label: view.tier === 'FREE' ? 'Current plan' : 'Included',
      variant: 'secondary',
      disabled: true,
    };
  }

  if (state === 'subscribe') {
    return {
      kind: 'subscribe',
      label: 'Subscribe',
      variant: plan.highlighted ? 'primary' : 'secondary',
      disabled: !canManage,
    };
  }

  const kind = changeKind(view, plan.tier, period);

  if (kind === 'scheduled') {
    return { kind: 'scheduled', label: 'Scheduled', variant: 'secondary', disabled: true };
  }

  if (kind === 'upgrade') {
    return { kind: 'upgrade', label: 'Upgrade', variant: 'primary', disabled: !canManage };
  }

  return { kind: 'downgrade', label: 'Downgrade', variant: 'secondary', disabled: !canManage };
}

// ---------------------------------------------------------------------------
// The pending ("Activating…") state
// ---------------------------------------------------------------------------

/** What the page is waiting for the webhook to make true. */
export type Expectation =
  | { kind: 'activated' }
  | { kind: 'plan'; tier: PlanTier; period: BillingPeriod }
  | { kind: 'status'; status: EntitlementStatus };

export function isSatisfied(expectation: Expectation, view: SubscriptionView): boolean {
  switch (expectation.kind) {
    case 'activated':
      return viewStateFor(view) === 'manage';
    case 'plan':
      return (
        view.tier === expectation.tier &&
        view.period === expectation.period &&
        viewStateFor(view) === 'manage'
      );
    case 'status':
      return view.status === expectation.status;
  }
}

export type PendingState =
  | { phase: 'idle' }
  | { phase: 'pending'; expectation: Expectation; label: string; startedAt: number; attempts: number }
  | { phase: 'done'; label: string }
  | { phase: 'timed_out'; label: string };

export type PendingAction =
  | { type: 'start'; expectation: Expectation; label: string; now: number }
  | { type: 'poll'; view: SubscriptionView; now: number }
  | { type: 'reset' };

export const idlePending: PendingState = { phase: 'idle' };

export function pendingReducer(state: PendingState, action: PendingAction): PendingState {
  switch (action.type) {
    case 'start':
      return {
        phase: 'pending',
        expectation: action.expectation,
        label: action.label,
        startedAt: action.now,
        attempts: 0,
      };
    case 'poll': {
      if (state.phase !== 'pending') {
        return state;
      }

      if (isSatisfied(state.expectation, action.view)) {
        return { phase: 'done', label: state.label };
      }

      if (action.now - state.startedAt >= POLL_TIMEOUT_MS) {
        return { phase: 'timed_out', label: state.label };
      }

      return { ...state, attempts: state.attempts + 1 };
    }
    case 'reset':
      return idlePending;
  }
}

export const CANCEL_REASON_OPTIONS: ReadonlyArray<{ value: CancelReason; label: string }> = [
  { value: 'too_expensive', label: 'Too expensive' },
  { value: 'missing_features', label: 'Missing features I need' },
  { value: 'not_using', label: 'Not using it enough' },
  { value: 'switching', label: 'Switching to another tool' },
  { value: 'other', label: 'Something else' },
];

export const MAX_FEEDBACK_LENGTH = 1_000;

/** The `?checkout=` and `?portal=` values the API sends the browser back with. */
export type ReturnSignal = 'checkout_success' | 'checkout_cancel' | 'portal_simulated' | null;

export function returnSignalFrom(params: { get(name: string): string | null }): ReturnSignal {
  switch (params.get('checkout')) {
    case 'success':
      return 'checkout_success';
    case 'cancel':
      return 'checkout_cancel';
    default:
      return params.get('portal') === 'simulated' ? 'portal_simulated' : null;
  }
}
