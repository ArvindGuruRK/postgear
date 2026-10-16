/**
 * The billing page's judgements, pinned: the badge per status, price
 * formatting, days left in a trial, each plan card's button, and the
 * polling state machine that waits for a webhook.
 */
import type { Plan, SubscriptionView } from '@/types/billing';
import {
  changeKind,
  daysLeft,
  formatPrice,
  idlePending,
  isSatisfied,
  pendingReducer,
  planAction,
  planPrice,
  POLL_TIMEOUT_MS,
  returnSignalFrom,
  statusBadge,
  viewStateFor,
} from './billing-view-model';

const NOW = new Date('2026-10-16T12:00:00.000Z');

const PRO: Plan = {
  tier: 'PRO',
  name: 'Pro',
  description: 'For creators.',
  monthlyPriceCents: 4_900,
  yearlyPriceCents: 49_000,
  channels: 15,
  aiCredits: 500,
  members: 3,
  features: [],
  highlighted: true,
};

const STANDARD: Plan = { ...PRO, tier: 'STANDARD', name: 'Standard', monthlyPriceCents: 2_900, yearlyPriceCents: 29_000, highlighted: false };
const FREE: Plan = { ...PRO, tier: 'FREE', name: 'Free', monthlyPriceCents: 0, yearlyPriceCents: 0, highlighted: false };

function view(overrides: Partial<SubscriptionView> = {}): SubscriptionView {
  return {
    tier: 'STANDARD',
    status: 'active',
    plan: STANDARD,
    period: 'MONTHLY',
    currentPeriodEnd: '2026-11-13T00:00:00.000Z',
    trialEndsAt: null,
    cancelAt: null,
    scheduledTier: null,
    scheduledPeriod: null,
    isLifetime: false,
    canStartTrial: false,
    portalAvailable: true,
    ...overrides,
  };
}

describe('statusBadge', () => {
  it('gives every status a label and the Sprint 5 tone', () => {
    expect(statusBadge('active')).toEqual({ label: 'Active', variant: 'success' });
    expect(statusBadge('trialing')).toEqual({ label: 'Trial', variant: 'primary' });
    expect(statusBadge('past_due')).toEqual({ label: 'Payment failed', variant: 'danger' });
    expect(statusBadge('canceling')).toEqual({ label: 'Ending', variant: 'accent' });
    expect(statusBadge('none').variant).toBe('outline');
  });
});

describe('prices', () => {
  it('drops the cents when there are none', () => {
    expect(formatPrice(2_900)).toBe('$29');
    expect(formatPrice(2_417)).toBe('$24.17');
    expect(formatPrice(0)).toBe('$0');
  });

  it('reads a plan per period, with the yearly plan’s monthly equivalent', () => {
    expect(planPrice(PRO, 'MONTHLY')).toEqual({ amount: '$49', per: '/mo', note: null });
    expect(planPrice(PRO, 'YEARLY')).toEqual({ amount: '$490', per: '/yr', note: '$40.83/mo, billed yearly' });
    expect(planPrice(FREE, 'YEARLY')).toEqual({ amount: '$0', per: '/yr', note: null });
  });
});

describe('daysLeft', () => {
  it('rounds up to whole days and never goes negative', () => {
    expect(daysLeft('2026-10-30T12:00:00.000Z', NOW)).toBe(14);
    expect(daysLeft('2026-10-17T00:00:00.000Z', NOW)).toBe(1);
    expect(daysLeft('2026-10-01T00:00:00.000Z', NOW)).toBe(0);
    expect(daysLeft(null, NOW)).toBeNull();
    expect(daysLeft('not a date', NOW)).toBeNull();
  });
});

describe('the two states and the plan buttons', () => {
  it('manages a live paid plan and offers plans otherwise', () => {
    expect(viewStateFor(view())).toBe('manage');
    expect(viewStateFor(view({ status: 'canceling' }))).toBe('manage');
    expect(viewStateFor(view({ status: 'past_due' }))).toBe('manage');
    expect(viewStateFor(view({ tier: 'PRO', status: 'trialing' }))).toBe('subscribe');
    expect(viewStateFor(view({ tier: 'FREE', status: 'none' }))).toBe('subscribe');
  });

  it('classifies a change like the API does', () => {
    const current = view();
    expect(changeKind(current, 'STANDARD', 'MONTHLY')).toBe('same');
    expect(changeKind(current, 'PRO', 'MONTHLY')).toBe('upgrade');
    expect(changeKind(current, 'STANDARD', 'YEARLY')).toBe('upgrade');
    expect(changeKind(view({ period: 'YEARLY' }), 'STANDARD', 'MONTHLY')).toBe('downgrade');
    expect(changeKind(view({ tier: 'PRO' }), 'STANDARD', 'MONTHLY')).toBe('downgrade');
    expect(changeKind(view({ tier: 'PRO', scheduledTier: 'STANDARD', scheduledPeriod: 'MONTHLY' }), 'STANDARD', 'MONTHLY')).toBe('scheduled');
  });

  it('labels the cards for a workspace on Standard monthly', () => {
    const current = view();
    expect(planAction(STANDARD, 'MONTHLY', current, true)).toMatchObject({ kind: 'current', label: 'Current plan', disabled: true });
    expect(planAction(PRO, 'MONTHLY', current, true)).toMatchObject({ kind: 'upgrade', label: 'Upgrade', variant: 'primary', disabled: false });
    expect(planAction(STANDARD, 'YEARLY', current, true)).toMatchObject({ kind: 'upgrade' });
    expect(planAction(FREE, 'MONTHLY', current, true)).toMatchObject({ kind: 'free', disabled: true });
    expect(planAction(STANDARD, 'MONTHLY', view({ tier: 'PRO', plan: PRO }), true)).toMatchObject({ kind: 'downgrade', label: 'Downgrade' });
  });

  it('offers Subscribe to a workspace without a plan, and only to admins', () => {
    const trial = view({ tier: 'PRO', status: 'trialing', plan: PRO, period: 'MONTHLY' });
    expect(planAction(PRO, 'MONTHLY', trial, true)).toMatchObject({ kind: 'subscribe', label: 'Subscribe', variant: 'primary', disabled: false });
    expect(planAction(STANDARD, 'MONTHLY', trial, true)).toMatchObject({ kind: 'subscribe', variant: 'secondary' });
    expect(planAction(PRO, 'MONTHLY', trial, false).disabled).toBe(true);
    expect(planAction(FREE, 'MONTHLY', view({ tier: 'FREE', status: 'none' }), true)).toMatchObject({ label: 'Current plan' });
  });
});

describe('the pending state', () => {
  it('waits, counts polls, and finishes when the expectation holds', () => {
    let state = pendingReducer(idlePending, { type: 'start', expectation: { kind: 'plan', tier: 'PRO', period: 'MONTHLY' }, label: 'Activating…', now: 0 });
    expect(state).toMatchObject({ phase: 'pending', attempts: 0 });

    state = pendingReducer(state, { type: 'poll', view: view(), now: 2_000 });
    expect(state).toMatchObject({ phase: 'pending', attempts: 1 });

    state = pendingReducer(state, { type: 'poll', view: view({ tier: 'PRO', plan: PRO }), now: 4_000 });
    expect(state).toEqual({ phase: 'done', label: 'Activating…' });

    expect(pendingReducer(state, { type: 'reset' })).toEqual(idlePending);
  });

  it('gives up after the timeout', () => {
    const started = pendingReducer(idlePending, { type: 'start', expectation: { kind: 'activated' }, label: 'Activating…', now: 1_000 });
    const late = pendingReducer(started, { type: 'poll', view: view({ tier: 'FREE', status: 'none' }), now: 1_000 + POLL_TIMEOUT_MS });
    expect(late).toEqual({ phase: 'timed_out', label: 'Activating…' });
  });

  it('ignores polls when nothing is pending', () => {
    expect(pendingReducer(idlePending, { type: 'poll', view: view(), now: 5 })).toBe(idlePending);
  });

  it('knows what each expectation means', () => {
    expect(isSatisfied({ kind: 'activated' }, view({ tier: 'FREE', status: 'none' }))).toBe(false);
    expect(isSatisfied({ kind: 'activated' }, view())).toBe(true);
    expect(isSatisfied({ kind: 'status', status: 'canceling' }, view({ status: 'canceling', cancelAt: '2026-11-13' }))).toBe(true);
    expect(isSatisfied({ kind: 'plan', tier: 'PRO', period: 'YEARLY' }, view({ tier: 'PRO', period: 'MONTHLY' }))).toBe(false);
  });
});

describe('returnSignalFrom', () => {
  it('reads the query the API sends the browser back with', () => {
    expect(returnSignalFrom(new URLSearchParams('checkout=success&session_id=cs_sim_1'))).toBe('checkout_success');
    expect(returnSignalFrom(new URLSearchParams('checkout=cancel'))).toBe('checkout_cancel');
    expect(returnSignalFrom(new URLSearchParams('portal=simulated'))).toBe('portal_simulated');
    expect(returnSignalFrom(new URLSearchParams(''))).toBeNull();
  });
});
