/**
 * Delivers one outbound webhook event to one receiver (Sprint 8).
 *
 * ## Why a workflow per delivery
 *
 * A receiver that is down for an hour must still get the event, and the
 * worker that was sending it may be restarted in between. Temporal owns the
 * retry timers — 30 s, 2 min, 8 min, 32 min, 2 h — so a deploy in the middle
 * of a backoff resumes the backoff rather than losing the delivery. The row
 * (`WebhookDelivery`) is written by the activity after every attempt, so the
 * deliveries screen sees the same thing Temporal does.
 *
 * ## The one decision this file makes
 *
 * The activity's retry policy decides *whether* to try again (a 4xx is
 * final, everything else is not); this workflow only decides what happens
 * after the last attempt: mark the row failed and tell the workspace. That
 * is a separate activity, retried generously, because a flaky database must
 * not leave a delivery PENDING forever with no workflow behind it.
 */
import {
  NON_RETRYABLE_WEBHOOK_FAILURES,
  WEBHOOK_DELIVERY_RETRY_POLICY,
  WEBHOOK_DELIVERY_TIMEOUT_MS,
  WEBHOOK_FAILURE_TYPES,
  type WebhookDeliveryInput,
} from '@postgear/scheduling';
import { ActivityFailure, ApplicationFailure, proxyActivities } from '@temporalio/workflow';
import type { Activities } from '../activities';

const { deliverWebhook } = proxyActivities<Activities>({
  // The request itself is capped at ten seconds; the rest covers the reads
  // and writes around it.
  startToCloseTimeout: `${Math.ceil(WEBHOOK_DELIVERY_TIMEOUT_MS / 1000) + 20} seconds`,
  retry: {
    initialInterval: `${WEBHOOK_DELIVERY_RETRY_POLICY.initialIntervalMs / 1000} seconds`,
    backoffCoefficient: WEBHOOK_DELIVERY_RETRY_POLICY.backoffCoefficient,
    maximumInterval: `${WEBHOOK_DELIVERY_RETRY_POLICY.maximumIntervalMs / 1000} seconds`,
    maximumAttempts: WEBHOOK_DELIVERY_RETRY_POLICY.maximumAttempts,
    nonRetryableErrorTypes: NON_RETRYABLE_WEBHOOK_FAILURES,
  },
});

const { markWebhookDeliveryFailed } = proxyActivities<Activities>({
  startToCloseTimeout: '1 minute',
  retry: {
    initialInterval: '5 seconds',
    backoffCoefficient: 2,
    maximumInterval: '5 minutes',
    maximumAttempts: 10,
  },
});

export type WebhookDeliveryOutcome =
  | { outcome: 'delivered'; statusCode: number; attempts: number }
  | { outcome: 'failed'; reason: 'rejected' | 'retries_exhausted' | 'unexpected'; message: string }
  | { outcome: 'skipped'; message: string };

export async function webhookDeliveryWorkflow(
  input: WebhookDeliveryInput,
): Promise<WebhookDeliveryOutcome> {
  try {
    const result = await deliverWebhook(input);
    return { outcome: 'delivered', statusCode: result.statusCode, attempts: result.attempt };
  } catch (error) {
    const cause = error instanceof ActivityFailure ? error.cause : error;
    const failure = cause instanceof ApplicationFailure ? cause : null;
    const message = failure?.message ?? (error instanceof Error ? error.message : String(error));

    if (failure?.type === WEBHOOK_FAILURE_TYPES.skipped) {
      return { outcome: 'skipped', message };
    }

    const reason: 'rejected' | 'retries_exhausted' | 'unexpected' =
      failure?.type === WEBHOOK_FAILURE_TYPES.rejected
        ? 'rejected'
        : failure?.type === WEBHOOK_FAILURE_TYPES.retryable
          ? 'retries_exhausted'
          : 'unexpected';

    await markWebhookDeliveryFailed({ ...input, message });

    return { outcome: 'failed', reason, message };
  }
}
