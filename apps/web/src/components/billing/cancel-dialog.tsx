'use client';

/**
 * Cancels the plan at the end of the period, asking why.
 *
 * The reason is required and the feedback optional; both go to the owner
 * by mail, which is the one thing the product learns from a cancellation.
 * The copy says what actually happens (access until the period end, then
 * the Free plan, nothing deleted), because "cancel" on its own reads as
 * "lose everything now".
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
  FormField,
  FormHelperText,
  FormLabel,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stack,
  Text,
  Textarea,
} from '@postgear/ui';
import { useId, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import type { CancelReason, SubscriptionView } from '@/types/billing';
import { useMounted } from '../posts/use-mounted';
import { CANCEL_REASON_OPTIONS, formatDate, MAX_FEEDBACK_LENGTH } from './billing-view-model';

function isReason(value: string): value is CancelReason {
  return CANCEL_REASON_OPTIONS.some((option) => option.value === value);
}

export function CancelDialog({
  open,
  view,
  onOpenChange,
  onCanceled,
}: {
  open: boolean;
  view: SubscriptionView;
  onOpenChange: (open: boolean) => void;
  onCanceled: (subscription: SubscriptionView) => void;
}) {
  const id = useId();
  const mounted = useMounted();
  const [reason, setReason] = useState<CancelReason | ''>('');
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const periodEnd = mounted ? formatDate(view.currentPeriodEnd) : null;

  async function confirm() {
    if (!reason) {
      return;
    }

    setWorking(true);
    setError(null);

    try {
      const trimmed = feedback.trim();
      const { subscription } = await api<{ subscription: SubscriptionView }>('/billing/cancel', {
        method: 'POST',
        body: { reason, ...(trimmed ? { feedback: trimmed } : {}) },
      });
      setReason('');
      setFeedback('');
      onCanceled(subscription);
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : 'The plan could not be cancelled. Please try again.',
      );
    } finally {
      setWorking(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel the {view.plan.name} plan?</DialogTitle>
          <DialogDescription>
            It stays active until {periodEnd ?? 'the end of this billing period'}; after that the
            workspace moves to the Free plan. Nothing is deleted, and you can resume before then.
          </DialogDescription>
        </DialogHeader>

        <Stack gap="md" className="mt-4">
          <FormField>
            <FormLabel htmlFor={`${id}-reason`} required>
              Reason
            </FormLabel>
            <Select
              value={reason}
              onValueChange={(value) => {
                if (isReason(value)) {
                  setReason(value);
                }
              }}
            >
              <SelectTrigger id={`${id}-reason`} aria-label="Reason">
                <SelectValue placeholder="Choose a reason" />
              </SelectTrigger>
              <SelectContent>
                {CANCEL_REASON_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>

          <FormField>
            <FormLabel htmlFor={`${id}-feedback`}>Anything else? (optional)</FormLabel>
            <Textarea
              id={`${id}-feedback`}
              value={feedback}
              maxLength={MAX_FEEDBACK_LENGTH}
              onChange={(event) => setFeedback(event.target.value)}
              placeholder="What would have made you stay?"
            />
            <FormHelperText>
              {feedback.length} / {MAX_FEEDBACK_LENGTH}. This goes to whoever runs PostGear.
            </FormHelperText>
          </FormField>

          {error ? (
            <Text size="sm" className="text-dangerInk" role="alert">
              {error}
            </Text>
          ) : null}
        </Stack>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary" disabled={working}>
              Keep My Plan
            </Button>
          </DialogClose>
          <Button variant="danger" onClick={confirm} disabled={working || !reason}>
            {working ? 'Cancelling…' : 'Cancel Plan'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
