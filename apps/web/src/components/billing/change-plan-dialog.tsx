'use client';

/**
 * Confirms a plan change with the proration preview.
 *
 * ## Why this asks the server before it asks the user
 *
 * An upgrade charges the difference for the rest of the period today; a
 * downgrade changes nothing until the period ends. Neither is obvious from
 * a button that says "Upgrade", so the dialog fetches
 * `GET /billing/change/preview` first and states the amount and the date.
 * The confirm button is disabled until the preview has loaded; a preview
 * that fails is shown with a retry, and the change is still possible: the
 * API computes the real charge regardless.
 */
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Skeleton,
  Stack,
  Text,
} from '@postgear/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import type {
  BillingPeriod,
  ChangePreview,
  ChangePreviewResponse,
  Plan,
  SubscriptionView,
} from '@/types/billing';
import { useMounted } from '../posts/use-mounted';
import { changeKind, formatDate, formatPrice, planPrice } from './billing-view-model';

export interface ChangeTarget {
  plan: Plan;
  period: BillingPeriod;
}

export function ChangePlanDialog({
  target,
  view,
  onOpenChange,
  onConfirmed,
}: {
  target: ChangeTarget | null;
  view: SubscriptionView;
  onOpenChange: (open: boolean) => void;
  onConfirmed: (
    subscription: SubscriptionView,
    preview: ChangePreview,
    target: ChangeTarget,
  ) => void;
}) {
  const mounted = useMounted();
  const [preview, setPreview] = useState<ChangePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  // Which load is current: a response from an earlier target, or from a
  // closed dialog, must not land on the one now open.
  const generation = useRef(0);

  const tier = target?.plan.tier ?? null;
  const period = target?.period ?? null;

  const loadPreview = useCallback(async () => {
    const run = ++generation.current;
    setPreview(null);
    setPreviewError(null);
    setError(null);

    if (!tier || !period || tier === 'FREE') {
      return;
    }

    try {
      const response = await api<ChangePreviewResponse>(
        `/billing/change/preview?tier=${tier}&period=${period}`,
      );
      if (generation.current === run) {
        setPreview(response.preview);
      }
    } catch (cause) {
      if (generation.current === run) {
        setPreviewError(
          cause instanceof ApiError ? cause.message : 'The preview could not be loaded.',
        );
      }
    }
  }, [tier, period]);

  useEffect(() => {
    void loadPreview();

    return () => {
      generation.current += 1;
    };
  }, [loadPreview]);

  async function confirm() {
    if (!target || target.plan.tier === 'FREE' || !preview) {
      return;
    }

    setWorking(true);
    setError(null);

    try {
      const { subscription } = await api<{ subscription: SubscriptionView }>('/billing/change', {
        method: 'POST',
        body: { tier: target.plan.tier, period: target.period },
      });
      onConfirmed(subscription, preview, target);
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : 'The plan could not be changed. Please try again.',
      );
    } finally {
      setWorking(false);
    }
  }

  const kind = target ? changeKind(view, target.plan.tier, target.period) : 'same';
  const price = target ? planPrice(target.plan, target.period) : null;
  const date = (iso: string | null) => (mounted ? formatDate(iso) : null);

  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {kind === 'downgrade' ? 'Switch to' : 'Upgrade to'} {target?.plan.name}
          </DialogTitle>
          <DialogDescription>
            {price ? `${price.amount}${price.per}` : ''}
            {price?.note ? ` (${price.note})` : ''}
            {target
              ? `: ${target.plan.channels} channels, ${target.plan.aiCredits.toLocaleString()} AI credits a month.`
              : ''}
          </DialogDescription>
        </DialogHeader>

        <Stack gap="sm" className="mt-4">
          {preview ? (
            <div
              className="rounded-md border-2 border-outline bg-secondary p-4"
              data-testid="billing-preview"
              data-effective={preview.effective}
              data-amount={preview.amountDueCents}
            >
              {preview.effective === 'now' ? (
                <Text size="sm">
                  {preview.amountDueCents > 0
                    ? `You pay ${formatPrice(preview.amountDueCents, preview.currency)} today for the rest of this period, prorated.`
                    : 'Nothing to pay today: the unused part of your current plan covers it.'}{' '}
                  The new plan applies as soon as the payment is confirmed
                  {preview.periodEnd
                    ? `, and renews on ${date(preview.periodEnd) ?? 'the period end'}`
                    : ''}
                  .
                </Text>
              ) : (
                <Text size="sm">
                  Nothing changes until {date(preview.periodEnd) ?? 'the end of this period'}. From
                  then you pay {formatPrice(preview.amountDueCents, preview.currency)}
                  {price?.per ?? ''} and the new limits apply. Channels already connected keep
                  publishing.
                </Text>
              )}
            </div>
          ) : previewError ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border-2 border-outline bg-secondary p-4">
              <Text size="sm" className="text-dangerInk">
                {previewError}
              </Text>
              <Button variant="secondary" size="sm" onClick={() => void loadPreview()}>
                Try again
              </Button>
            </div>
          ) : (
            <Skeleton className="h-16" aria-label="Loading the preview" />
          )}

          {error ? (
            <Text size="sm" className="text-dangerInk" role="alert">
              {error}
            </Text>
          ) : null}
        </Stack>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary" disabled={working}>
              Keep current plan
            </Button>
          </DialogClose>
          <Button onClick={confirm} disabled={working || !preview}>
            {working ? 'Applying…' : kind === 'downgrade' ? 'Schedule change' : 'Confirm upgrade'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
