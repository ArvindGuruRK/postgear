'use client';

/**
 * The plan grid: a Monthly / Yearly toggle and one `PlanCard` per plan,
 * with the current plan marked and each button saying what pressing it
 * does for this workspace: Subscribe, Upgrade, Downgrade, Scheduled,
 * Current plan (`billing-view-model.ts` decides).
 *
 * The cards carry `data-testid="billing-plan-<tier>"`, `data-current` and
 * `data-action` so a test reads the state rather than the colour.
 */
import { Grid, PlanCard, Stack, Tabs, TabsList, TabsTrigger, Text } from '@postgear/ui';
import type { BillingPeriod, Plan, SubscriptionView } from '@/types/billing';
import { type PlanAction, planAction, planPrice } from './billing-view-model';

function isPeriod(value: string): value is BillingPeriod {
  return value === 'MONTHLY' || value === 'YEARLY';
}

export function PlanGrid({
  plans,
  period,
  onPeriodChange,
  view,
  canManage,
  disabled,
  busyTier,
  onSelect,
}: {
  plans: Plan[];
  period: BillingPeriod;
  onPeriodChange: (period: BillingPeriod) => void;
  view: SubscriptionView;
  canManage: boolean;
  /** Billing is unconfigured: the buttons that would call Stripe are off. */
  disabled: boolean;
  /** The tier whose checkout is being opened, so its button says so. */
  busyTier: string | null;
  onSelect: (plan: Plan, action: PlanAction) => void;
}) {
  return (
    <Stack gap="md">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <Text weight="bold" as="span">
            Plans
          </Text>
          <Text size="sm" muted as="span">
            Yearly is ten months for the price of twelve. Upgrades apply now; downgrades at the end
            of the period.
          </Text>
        </div>
        <Tabs
          value={period}
          onValueChange={(value) => {
            if (isPeriod(value)) {
              onPeriodChange(value);
            }
          }}
        >
          <TabsList aria-label="Billing period">
            <TabsTrigger value="MONTHLY">Monthly</TabsTrigger>
            <TabsTrigger value="YEARLY">Yearly</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <Grid cols={3} gap="md">
        {plans.map((plan) => {
          const action = planAction(plan, period, view, canManage);
          const price = planPrice(plan, period);
          const current = action.kind === 'current' || (plan.tier === 'FREE' && view.tier === 'FREE');
          const callsStripe = action.kind !== 'current' && action.kind !== 'free';
          const busy = busyTier === plan.tier;

          return (
            <PlanCard
              key={plan.tier}
              data-testid={`billing-plan-${plan.tier}`}
              data-current={current ? 'true' : 'false'}
              data-action={action.kind}
              name={plan.name}
              price={price.amount}
              period={price.per}
              description={price.note ?? plan.description}
              features={plan.features}
              highlighted={plan.highlighted}
              badge={current ? 'Current' : plan.highlighted ? 'Popular' : undefined}
              actionLabel={busy ? 'Opening…' : action.label}
              actionVariant={action.variant}
              actionDisabled={action.disabled || busyTier !== null || (disabled && callsStripe)}
              onAction={() => onSelect(plan, action)}
            />
          );
        })}
      </Grid>
    </Stack>
  );
}
