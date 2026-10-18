'use client';

/**
 * The billing page (Sprint 8, contract §6): the plan a workspace is on,
 * the two meters, and the plan grid, in one of two states.
 *
 * **Subscribe** (no live paid plan): the Free plan or the trial in the
 * summary card (with *Start free trial* when eligible), the grid's buttons
 * say *Subscribe* and open Stripe Checkout (or, in simulation, come straight
 * back with `?checkout=success`).
 *
 * **Manage** (a live paid plan): the summary card carries the status badge,
 * the next billing date, Cancel / Resume and Manage billing; the grid's
 * buttons say *Upgrade* / *Downgrade* and open the change dialog with its
 * proration preview.
 *
 * ## Nothing here is optimistic
 *
 * Every write goes to Stripe (or the simulation) first and reaches the row
 * through a webhook. So after checkout, a change, a cancellation or a
 * resume the page shows *Activating…* and polls `GET /billing/subscription`
 * every two seconds for at most a minute (`billing-view-model.ts`), and the
 * plan on screen only changes when the row has. A timeout is not an error:
 * it says so and offers to check again.
 *
 * The `?checkout=` / `?portal=` query the API sends the browser back with
 * is read once on mount and then cleared with `history.replaceState`, so a
 * reload does not replay it and the island is not remounted.
 */
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  ErrorState,
  Spinner,
  Stack,
  Text,
  useToast,
} from '@postgear/ui';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import type {
  BillingPeriod,
  BillingStatus,
  ChangePreview,
  Plan,
  SubscriptionResponse,
  SubscriptionView,
} from '@/types/billing';
import { useWorkspace } from '../navigation/workspace-provider';
import { BillingUnconfigured } from './billing-unconfigured';
import {
  daysLeft,
  formatDate,
  idlePending,
  type PlanAction,
  pendingReducer,
  POLL_INTERVAL_MS,
  returnSignalFrom,
  viewStateFor,
} from './billing-view-model';
import { CancelDialog } from './cancel-dialog';
import { type ChangeTarget, ChangePlanDialog } from './change-plan-dialog';
import { CurrentPlanCard } from './current-plan-card';
import { PlanGrid } from './plan-grid';

export function BillingView({
  orgId,
  status,
  plans,
  initial,
}: {
  orgId: string;
  /** Null when `/billing/status` did not answer. */
  status: BillingStatus | null;
  plans: Plan[];
  /** Null when the server could not load it; the island then tries once more. */
  initial: SubscriptionResponse | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const { role } = useWorkspace();
  const canManage = role !== 'USER';

  const [data, setData] = useState<SubscriptionResponse | null>(initial);
  const [loadFailed, setLoadFailed] = useState(false);
  const [period, setPeriod] = useState<BillingPeriod>(initial?.subscription.period ?? 'MONTHLY');
  const [pending, dispatch] = useReducer(pendingReducer, idlePending);
  const [signal] = useState(() => returnSignalFrom(searchParams));
  const [checkoutCanceled, setCheckoutCanceled] = useState(signal === 'checkout_cancel');
  const [changeTarget, setChangeTarget] = useState<ChangeTarget | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const latest = useRef(data);
  latest.current = data;

  const reload = useCallback(async (): Promise<SubscriptionResponse | null> => {
    try {
      const next = await api<SubscriptionResponse>('/billing/subscription');
      setData(next);
      setLoadFailed(false);
      return next;
    } catch {
      setLoadFailed(true);
      return null;
    }
  }, []);

  // The server could not load the subscription: one more try from here.
  useEffect(() => {
    if (initial === null) {
      void reload();
    }
  }, [initial, reload]);

  // The query the API sent the browser back with, handled once and cleared.
  useEffect(() => {
    if (!signal) {
      return;
    }

    if (signal === 'checkout_success') {
      dispatch({
        type: 'start',
        expectation: { kind: 'activated' },
        label: 'Activating your plan…',
        now: Date.now(),
      });
    } else if (signal === 'portal_simulated') {
      toast({
        title: 'The billing portal is simulated',
        description:
          'With BILLING_SIMULATION=true there is no Stripe portal to open. Manage the plan from this page instead.',
      });
    }

    window.history.replaceState(null, '', window.location.pathname);
  }, [signal, toast]);

  // The poll: every two seconds while something is pending.
  useEffect(() => {
    if (pending.phase !== 'pending') {
      return;
    }

    let cancelled = false;

    const tick = async () => {
      const next = await reload();
      const view = (next ?? latest.current)?.subscription;

      if (!cancelled && view) {
        dispatch({ type: 'poll', view, now: Date.now() });
      }
    };

    void tick();
    const timer = setInterval(() => void tick(), POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [pending.phase, reload]);

  useEffect(() => {
    if (pending.phase === 'done') {
      toast({ title: 'All set', description: 'Your plan is up to date.' });
      dispatch({ type: 'reset' });
    }
  }, [pending.phase, toast]);

  function fail(title: string, cause: unknown) {
    toast({
      variant: 'danger',
      title,
      description: cause instanceof ApiError ? cause.message : 'Please try again.',
    });
  }

  async function subscribe(plan: Plan) {
    setBusy(plan.tier);
    try {
      const { url } = await api<{ url: string }>('/billing/checkout', {
        method: 'POST',
        body: { tier: plan.tier, period },
      });
      window.location.assign(url);
    } catch (cause) {
      fail('Could not start the checkout', cause);
      setBusy(null);
    }
  }

  async function startTrial() {
    setBusy('trial');
    try {
      const { subscription } = await api<{ subscription: SubscriptionView }>('/billing/trial', {
        method: 'POST',
      });
      setData((current) => (current ? { ...current, subscription } : current));
      await reload();
      toast({
        title: 'Your Pro trial has started',
        description: `${daysLeft(subscription.trialEndsAt) ?? 14} days of Pro, no card needed.`,
      });
      router.refresh();
    } catch (cause) {
      fail('Could not start the trial', cause);
    } finally {
      setBusy(null);
    }
  }

  async function openPortal() {
    setBusy('portal');
    try {
      const { url } = await api<{ url: string }>('/billing/portal', { method: 'POST' });
      window.location.assign(url);
    } catch (cause) {
      fail('Could not open the billing portal', cause);
      setBusy(null);
    }
  }

  async function resume() {
    setBusy('resume');
    try {
      const { subscription } = await api<{ subscription: SubscriptionView }>('/billing/resume', {
        method: 'POST',
      });
      setData((current) => (current ? { ...current, subscription } : current));
      dispatch({
        type: 'start',
        expectation: { kind: 'status', status: 'active' },
        label: 'Resuming your plan…',
        now: Date.now(),
      });
    } catch (cause) {
      fail('Could not resume the plan', cause);
    } finally {
      setBusy(null);
    }
  }

  function onPlanSelect(plan: Plan, action: PlanAction) {
    if (action.kind === 'subscribe') {
      void subscribe(plan);
    } else if (action.kind === 'upgrade' || action.kind === 'downgrade') {
      setChangeTarget({ plan, period });
    }
  }

  function onChanged(subscription: SubscriptionView, preview: ChangePreview, target: ChangeTarget) {
    setData((current) => (current ? { ...current, subscription } : current));
    setChangeTarget(null);

    if (preview.effective === 'now') {
      dispatch({
        type: 'start',
        expectation: { kind: 'plan', tier: target.plan.tier, period: target.period },
        label: `Activating your ${target.plan.name} plan…`,
        now: Date.now(),
      });
    } else {
      toast({
        title: `Switch to ${target.plan.name} scheduled`,
        description: preview.periodEnd
          ? `It takes effect on ${formatDate(preview.periodEnd) ?? 'the period end'}.`
          : 'It takes effect at the end of this billing period.',
      });
    }
  }

  function onCanceled(subscription: SubscriptionView) {
    setData((current) => (current ? { ...current, subscription } : current));
    setCancelOpen(false);
    dispatch({
      type: 'start',
      expectation: { kind: 'status', status: 'canceling' },
      label: 'Scheduling the cancellation…',
      now: Date.now(),
    });
  }

  const view = data?.subscription ?? null;
  const usage = data?.usage ?? null;
  const manage = view ? viewStateFor(view) === 'manage' : false;
  const unconfigured = status?.mode === 'unconfigured';

  return (
    <Stack gap="lg">
      {status === null ? (
        <ErrorState
          title="Billing didn't answer"
          description="The API could not say whether payments are set up. Check that it is running, then try again."
          action={{ label: 'Try again', onClick: () => router.refresh() }}
        />
      ) : null}

      {unconfigured ? <BillingUnconfigured /> : null}

      {status?.mode === 'simulation' ? (
        <Alert data-testid="billing-simulated">
          <AlertDescription>
            Billing is simulated (<code className="font-bold">BILLING_SIMULATION=true</code>): no card
            is charged and no Stripe account is used. Checkout, plan changes and cancellations
            still run through the real webhook handler, a second or two later.
          </AlertDescription>
        </Alert>
      ) : null}

      {checkoutCanceled ? (
        <Alert className="items-center justify-between">
          <AlertDescription>Checkout was cancelled. Nothing has changed.</AlertDescription>
          <Button variant="secondary" size="sm" onClick={() => setCheckoutCanceled(false)}>
            Dismiss
          </Button>
        </Alert>
      ) : null}

      {pending.phase === 'pending' ? (
        <Alert
          data-testid="billing-activating"
          data-attempts={pending.attempts}
          aria-live="polite"
          className="items-center"
        >
          <Spinner size="sm" aria-label={pending.label} />
          <div className="flex flex-col gap-1">
            <AlertTitle>{pending.label}</AlertTitle>
            <AlertDescription>
              Waiting for the payment provider to confirm. This usually takes a few seconds; the
              plan on this page changes as soon as it has.
            </AlertDescription>
          </div>
        </Alert>
      ) : null}

      {pending.phase === 'timed_out' ? (
        <Alert variant="warning" className="flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <AlertTitle>Still waiting on the payment provider</AlertTitle>
            <AlertDescription>
              The confirmation has not arrived in the last minute. It can take a little longer;
              nothing is lost, and this page updates once it lands.
            </AlertDescription>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              dispatch({ type: 'reset' });
              void reload();
            }}
          >
            Check again
          </Button>
        </Alert>
      ) : null}

      {loadFailed && !view ? (
        <ErrorState
          title="Couldn't load your plan"
          description="The API did not answer. Check that it is running, then try again."
          action={{ label: 'Try again', onClick: () => void reload() }}
        />
      ) : null}

      {view && usage ? (
        <>
          {view.status === 'past_due' ? (
            <Alert variant="danger">
              <AlertDescription>
                The last payment for your {view.plan.name} plan failed. Update your card from Manage
                billing; the plan keeps working while Stripe retries.
              </AlertDescription>
            </Alert>
          ) : null}

          <CurrentPlanCard
            view={view}
            usage={usage}
            canManage={canManage}
            busy={busy}
            onStartTrial={() => void startTrial()}
            onCancel={() => setCancelOpen(true)}
            onResume={() => void resume()}
            onPortal={() => void openPortal()}
          />

          <PlanGrid
            plans={plans}
            period={period}
            onPeriodChange={setPeriod}
            view={view}
            canManage={canManage}
            disabled={unconfigured}
            busyTier={busy && plans.some((plan) => plan.tier === busy) ? busy : null}
            onSelect={onPlanSelect}
          />

          {!canManage ? (
            <Text size="sm" muted>
              Only workspace admins can subscribe, change or cancel the plan.
            </Text>
          ) : null}

          {manage ? (
            <ChangePlanDialog
              target={changeTarget}
              view={view}
              onOpenChange={(open) => {
                if (!open) {
                  setChangeTarget(null);
                }
              }}
              onConfirmed={onChanged}
            />
          ) : null}

          {manage ? (
            <CancelDialog
              open={cancelOpen}
              view={view}
              onOpenChange={setCancelOpen}
              onCanceled={onCanceled}
            />
          ) : null}
        </>
      ) : null}

      <Text size="xs" muted>
        Workspace {orgId}. Prices in US dollars.
      </Text>
    </Stack>
  );
}
