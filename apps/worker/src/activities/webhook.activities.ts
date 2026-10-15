/**
 * The activities behind `webhookDeliveryWorkflow` (Sprint 8).
 *
 * `deliverWebhook` is one attempt: it reads the row and its hook, signs and
 * sends, records the attempt on the row, and either returns (delivered) or
 * throws a typed failure the workflow's retry policy understands. The row is
 * written **before** the failure is thrown, so the deliveries screen can say
 * "attempt 2 of 6, connection refused" while Temporal waits.
 *
 * `markWebhookDeliveryFailed` runs once, after the last attempt, and tells
 * the workspace: a `webhook.failed` notification to its admins. It is kept
 * out of `deliverWebhook` so a retried attempt can never send that
 * notification early.
 */
import { decrypt, EncryptionError, prisma, WebhookDeliveryStatus } from '@postgear/db';
import {
  WEBHOOK_DELIVERY_RETRY_POLICY,
  WEBHOOK_FAILURE_TYPES,
  type WebhookDeliveryInput,
} from '@postgear/scheduling';
import { ApplicationFailure, Context } from '@temporalio/activity';
import { sendWebhook, type SendWebhookOutcome } from '../lib/webhook-sender';
import type { ActivityDeps } from './deps';

export interface DeliverWebhookResult {
  statusCode: number;
  attempt: number;
}

export interface MarkWebhookDeliveryFailedInput extends WebhookDeliveryInput {
  /** What the last attempt said; stored if the row has nothing newer. */
  message: string;
}

export function createWebhookActivities(deps: ActivityDeps) {
  return {
    async deliverWebhook(input: WebhookDeliveryInput): Promise<DeliverWebhookResult> {
      const attempt = Context.current().info.attempt;
      const delivery = await prisma.webhookDelivery.findFirst({
        where: { id: input.deliveryId, organizationId: input.organizationId },
        select: {
          id: true,
          event: true,
          status: true,
          payload: true,
          webhook: {
            select: { id: true, url: true, secret: true, deletedAt: true, disabled: true },
          },
        },
      });

      if (!delivery) {
        throw skipped('The delivery no longer exists.');
      }
      if (delivery.status === WebhookDeliveryStatus.DELIVERED) {
        // An earlier attempt got through and its write won the race.
        return { statusCode: 200, attempt };
      }
      if (delivery.status === WebhookDeliveryStatus.FAILED) {
        throw skipped('The delivery was already marked failed.');
      }
      if (delivery.webhook.deletedAt || delivery.webhook.disabled) {
        await prisma.webhookDelivery.updateMany({
          where: { id: delivery.id, organizationId: input.organizationId },
          data: {
            status: WebhookDeliveryStatus.FAILED,
            lastError: 'The webhook was removed or disabled before this was delivered.',
            lastAttemptAt: new Date(),
          },
        });
        throw skipped('The webhook was removed or disabled.');
      }

      let secret: string;
      try {
        secret = delivery.webhook.secret ? decrypt(delivery.webhook.secret) : '';
      } catch (error) {
        if (!(error instanceof EncryptionError)) throw error;
        secret = '';
      }
      if (!secret) {
        await recordAttempt(delivery.id, input.organizationId, attempt, {
          outcome: 'rejected',
          statusCode: 0,
          error: 'The webhook has no signing secret. Rotate its secret and try again.',
          durationMs: 0,
        });
        throw ApplicationFailure.create({
          type: WEBHOOK_FAILURE_TYPES.rejected,
          nonRetryable: true,
          message: 'The webhook has no signing secret.',
        });
      }

      const body = JSON.stringify(delivery.payload);
      const outcome = await sendWebhook({
        url: delivery.webhook.url,
        secret,
        deliveryId: delivery.id,
        event: delivery.event,
        body,
        allowPrivate: deps.env.WEBHOOK_ALLOW_PRIVATE_URLS === 'true',
      });

      await recordAttempt(delivery.id, input.organizationId, attempt, outcome);

      switch (outcome.outcome) {
        case 'delivered':
          return { statusCode: outcome.statusCode, attempt };
        case 'retry':
          throw ApplicationFailure.create({
            type: WEBHOOK_FAILURE_TYPES.retryable,
            nonRetryable: false,
            message: outcome.error,
          });
        case 'rejected':
          throw ApplicationFailure.create({
            type: WEBHOOK_FAILURE_TYPES.rejected,
            nonRetryable: true,
            message: outcome.error,
          });
        case 'unsafe':
          Context.current().log.warn('webhook.unsafe_url', {
            deliveryId: delivery.id,
            webhookId: delivery.webhook.id,
            organizationId: input.organizationId,
            reason: outcome.error,
          });
          throw ApplicationFailure.create({
            type: WEBHOOK_FAILURE_TYPES.rejected,
            nonRetryable: true,
            message: outcome.error,
          });
      }
    },

    /** The delivery failed for good: the row says so, and the admins are told once. */
    async markWebhookDeliveryFailed(input: MarkWebhookDeliveryFailedInput): Promise<void> {
      const delivery = await prisma.webhookDelivery.findFirst({
        where: { id: input.deliveryId, organizationId: input.organizationId },
        select: {
          id: true,
          status: true,
          event: true,
          attempts: true,
          lastError: true,
          webhook: { select: { id: true, name: true, url: true } },
        },
      });

      if (!delivery || delivery.status !== WebhookDeliveryStatus.PENDING) {
        return;
      }

      const message = delivery.lastError ?? input.message;

      await prisma.$transaction([
        prisma.webhookDelivery.updateMany({
          where: { id: delivery.id, organizationId: input.organizationId },
          data: { status: WebhookDeliveryStatus.FAILED, lastError: message },
        }),
        prisma.notifications.create({
          data: {
            organizationId: input.organizationId,
            type: 'webhook.failed',
            title: 'Webhook delivery failed',
            content: `Could not deliver ${delivery.event} to "${delivery.webhook.name}" after ${
              delivery.attempts || WEBHOOK_DELIVERY_RETRY_POLICY.maximumAttempts
            } attempts: ${message}`,
            link: `/${input.organizationId}/settings/webhooks`,
            emailStatus: 'PENDING',
            meta: {
              webhookId: delivery.webhook.id,
              webhookName: delivery.webhook.name,
              deliveryId: delivery.id,
              event: delivery.event,
              attempts: delivery.attempts,
              message,
            },
          },
        }),
      ]);
    },
  };
}

export type WebhookActivities = ReturnType<typeof createWebhookActivities>;

async function recordAttempt(
  deliveryId: string,
  organizationId: string,
  attempt: number,
  outcome: SendWebhookOutcome,
): Promise<void> {
  const delivered = outcome.outcome === 'delivered';
  const now = new Date();

  await prisma.webhookDelivery.updateMany({
    where: { id: deliveryId, organizationId },
    data: {
      attempts: attempt,
      lastAttemptAt: now,
      lastStatusCode: 'statusCode' in outcome ? outcome.statusCode : null,
      lastError: delivered ? null : outcome.error,
      ...(delivered ? { status: WebhookDeliveryStatus.DELIVERED, deliveredAt: now } : {}),
    },
  });
}

function skipped(message: string): ApplicationFailure {
  return ApplicationFailure.create({
    type: WEBHOOK_FAILURE_TYPES.skipped,
    nonRetryable: true,
    message,
  });
}
