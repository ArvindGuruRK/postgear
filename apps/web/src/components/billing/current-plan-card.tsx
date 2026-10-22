'use client';

/**
 * The card at the top of the billing page: which plan, in what state, when
 * it next bills (or ends, or changes), and the two meters.
 *
 * One component for both page states. With a live paid plan it is the
 * **manage** card: Cancel / Resume and Manage billing live in its footer.
 * Without one it is the **subscribe** summary: the Free plan or the trial,
 * the same meters, and Start free trial when the workspace is eligible.
 *
 * Dates are formatted in the viewer's locale after mount (see
 * `use-mounted.ts`); until then the line reads without the date.
 */
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Text,
  UsageMeter,
} from '@postgear/ui';
import type { BillingUsage, SubscriptionView } from '@/types/billing';
import { useMounted } from '../posts/use-mounted';
import { daysLeft, formatDate, statusBadge, viewStateFor } from './billing-view-model';

const TIER_NAMES: Record<SubscriptionView['tier'], string> = {
  FREE: 'Free',
  STANDARD: 'Standard',
  PRO: 'Pro',
  TEAM: 'Team',
  ULTIMATE: 'Ultimate',
};

export function CurrentPlanCard({
  view,
  usage,
  canManage,
  busy,
  onStartTrial,
  onCancel,
  onResume,
  onPortal,
}: {
  view: SubscriptionView;
  usage: BillingUsage;
  canManage: boolean;
  /** Which action is in flight, so its button says so and the rest wait. */
  busy: string | null;
  onStartTrial: () => void;
  onCancel: () => void;
  onResume: () => void;
  onPortal: () => void;
}) {
  const mounted = useMounted();
  const manage = viewStateFor(view) === 'manage';
  const badge = statusBadge(view.status);
  const trialDays = daysLeft(view.trialEndsAt);
  const periodLabel = view.period === 'YEARLY' ? 'yearly' : 'monthly';
  const date = (iso: string | null) => (mounted ? formatDate(iso) : null);

  return (
    <Card data-testid="billing-current-plan" data-tier={view.tier} data-state={manage ? 'manage' : 'subscribe'}>
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>{view.plan.name} Plan</CardTitle>
          <Badge
            variant={badge.variant}
            data-testid="billing-status"
            data-status={view.status}
          >
            {badge.label}
          </Badge>
        </div>

        {view.isLifetime ? (
          <CardDescription>A lifetime plan, never billed.</CardDescription>
        ) : view.status === 'canceling' ? (
          <CardDescription data-testid="billing-cancel-at" data-date={view.cancelAt ?? ''}>
            Your plan ends on {date(view.cancelAt) ?? 'the last day of this period'}. Everything
            keeps working until then, and you can resume at any time before it.
          </CardDescription>
        ) : view.status === 'past_due' ? (
          <CardDescription>
            The last payment did not go through. Update your card from Manage billing to keep the
            plan; nothing has been switched off yet.
          </CardDescription>
        ) : view.status === 'trialing' ? (
          <CardDescription>
            {trialDays === null
              ? 'Your free trial is running.'
              : `${trialDays} ${trialDays === 1 ? 'day' : 'days'} left in your free trial`}
            {view.trialEndsAt ? `. It ends on ${date(view.trialEndsAt) ?? 'its last day'}.` : '.'}{' '}
            Pick a plan below before then to keep everything running.
          </CardDescription>
        ) : view.status === 'trial_expired' ? (
          <CardDescription>
            Your trial has ended and the workspace is on the Free plan. Choose a plan below to get
            its limits back.
          </CardDescription>
        ) : manage ? (
          <CardDescription data-testid="billing-next-billing">
            Billed {periodLabel}.
            {view.currentPeriodEnd
              ? ` Next billing date: ${date(view.currentPeriodEnd) ?? '…'}.`
              : ''}
          </CardDescription>
        ) : (
          <CardDescription>
            One channel and 25 AI credits a month. Choose a plan below when you need more.
          </CardDescription>
        )}

        {view.scheduledTier ? (
          <Text
            size="sm"
            data-testid="billing-scheduled"
            data-tier={view.scheduledTier}
            data-period={view.scheduledPeriod ?? ''}
          >
            Changes to {TIER_NAMES[view.scheduledTier]}
            {view.scheduledPeriod ? ` (${view.scheduledPeriod === 'YEARLY' ? 'yearly' : 'monthly'})` : ''}
            {view.currentPeriodEnd ? ` on ${date(view.currentPeriodEnd) ?? 'the period end'}` : ' at the end of this period'}
            . Choose your current plan again to keep it.
          </Text>
        ) : null}
      </CardHeader>

      <CardContent className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <UsageMeter
          data-testid="billing-usage-channels"
          data-used={usage.channels.used}
          data-max={usage.channels.limit}
          label="Connected channels"
          value={usage.channels.used}
          max={usage.channels.limit}
          caption="Checked when a channel is connected; nothing already connected is switched off."
        />
        <UsageMeter
          data-testid="billing-usage-credits"
          data-used={usage.aiCredits.used}
          data-max={usage.aiCredits.allowance}
          label="AI credits"
          value={usage.aiCredits.used}
          max={usage.aiCredits.allowance}
          unit="credits"
          tone="ai"
          caption={
            mounted
              ? `Resets ${formatDate(usage.aiCredits.resetsAt) ?? 'next cycle'}, ${view.plan.name}`
              : view.plan.name
          }
        />
      </CardContent>

      {canManage ? (
        <CardFooter className="flex-wrap">
          {manage ? (
            <>
              {view.status === 'canceling' ? (
                <Button onClick={onResume} disabled={busy !== null}>
                  {busy === 'resume' ? 'Resuming…' : 'Resume Plan'}
                </Button>
              ) : (
                <Button variant="danger" onClick={onCancel} disabled={busy !== null || view.isLifetime}>
                  Cancel Plan
                </Button>
              )}
              {view.portalAvailable ? (
                <Button variant="secondary" onClick={onPortal} disabled={busy !== null}>
                  {busy === 'portal' ? 'Opening…' : 'Manage Billing'}
                </Button>
              ) : null}
              <Text size="sm" muted as="span" className="basis-full sm:basis-auto">
                To change plan, pick another one below.
              </Text>
            </>
          ) : view.canStartTrial ? (
            <>
              <Button onClick={onStartTrial} disabled={busy !== null} data-testid="billing-start-trial">
                {busy === 'trial' ? 'Starting…' : 'Start Free Trial'}
              </Button>
              <Text size="sm" muted as="span">
                Pro for two weeks, no card needed.
              </Text>
            </>
          ) : null}
        </CardFooter>
      ) : null}
    </Card>
  );
}
