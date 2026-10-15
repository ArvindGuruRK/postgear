/**
 * The activity behind `maintenanceWorkflow`: make sure every queued post and
 * every refreshable channel has a workflow.
 *
 * The API starts workflows as posts are queued and channels connected, but it
 * does so best-effort — if Temporal is unreachable for a moment, the save still
 * succeeds and the row is simply waiting for this. A `start` with the
 * deterministic id is idempotent: one that already runs is left exactly as it
 * is (the "already started" error is the expected answer), and one that does
 * not is created. Deliberately *not* a wake: waking every sleeping workflow
 * every fifteen minutes would add a dozen history events each time, and a post
 * scheduled weeks out would hit Temporal's history limit before its day came.
 */

import { prisma, State, WebhookDeliveryStatus } from '@postgear/db';
import {
  ANALYTICS_SYNC_WORKFLOW,
  analyticsSyncWorkflowId,
  POST_PUBLISH_WORKFLOW,
  publishWorkflowId,
  SCHEDULING_TASK_QUEUE,
  TOKEN_REFRESH_WORKFLOW,
  tokenRefreshWorkflowId,
  WEBHOOK_DELIVERY_WORKFLOW,
  webhookDeliveryWorkflowId,
} from '@postgear/scheduling';
import { WorkflowExecutionAlreadyStartedError } from '@temporalio/client';
import type { ActivityDeps } from './deps';

export interface ReconcileReport {
  queuedPosts: number;
  refreshableChannels: number;
  /** Sprint 7: live, set-up channels whose analytics loop was ensured. */
  analyticsChannels: number;
  /** Sprint 8: pending webhook deliveries whose workflow was ensured. */
  webhookDeliveries: number;
  failures: number;
}

/**
 * A pending delivery younger than this is still being started by whoever
 * created it; older than a day it is abandoned rather than resurrected (the
 * event it reports is stale, and its retry policy would have ended by now).
 */
const DELIVERY_RECONCILE_MIN_AGE_MS = 60_000;
const DELIVERY_RECONCILE_MAX_AGE_MS = 24 * 60 * 60_000;

/** How many `signalWithStart` calls are in flight at once. */
const CONCURRENCY = 10;

export function createMaintenanceActivities(deps: ActivityDeps) {
  return {
    async reconcileSchedules(): Promise<ReconcileReport> {
      const client = await deps.temporalClient();
      let failures = 0;

      const roots = await prisma.post.findMany({
        where: {
          state: State.QUEUE,
          deletedAt: null,
          parentPostId: null,
          integration: { deletedAt: null },
        },
        select: { id: true, organizationId: true },
      });

      await inBatches(roots, async (root) => {
        try {
          await client.workflow.start(POST_PUBLISH_WORKFLOW, {
            workflowId: publishWorkflowId(root.id),
            taskQueue: SCHEDULING_TASK_QUEUE,
            args: [{ postId: root.id, organizationId: root.organizationId }],
          });
        } catch (error) {
          if (!(error instanceof WorkflowExecutionAlreadyStartedError)) {
            failures += 1;
          }
        }
      });

      const channels = await prisma.integration.findMany({
        where: {
          deletedAt: null,
          refreshNeeded: false,
          inBetweenSteps: false,
          refreshToken: { not: null },
          tokenExpiration: { not: null },
        },
        select: { id: true, organizationId: true },
      });

      await inBatches(channels, async (channel) => {
        try {
          await client.workflow.start(TOKEN_REFRESH_WORKFLOW, {
            workflowId: tokenRefreshWorkflowId(channel.id),
            taskQueue: SCHEDULING_TASK_QUEUE,
            args: [{ integrationId: channel.id, organizationId: channel.organizationId }],
          });
        } catch (error) {
          if (!(error instanceof WorkflowExecutionAlreadyStartedError)) {
            failures += 1;
          }
        }
      });

      // Sprint 7: every channel that could sync metrics gets its loop. The
      // loop itself writes "unsupported" for a platform without metrics and
      // exits, so the filter here is only what makes a channel unusable;
      // which platforms have metrics is the activity's call, not this one's.
      const analyticsChannels = await prisma.integration.findMany({
        where: {
          deletedAt: null,
          refreshNeeded: false,
          inBetweenSteps: false,
          disabled: false,
        },
        select: { id: true, organizationId: true },
      });

      await inBatches(analyticsChannels, async (channel) => {
        try {
          await client.workflow.start(ANALYTICS_SYNC_WORKFLOW, {
            workflowId: analyticsSyncWorkflowId(channel.id),
            taskQueue: SCHEDULING_TASK_QUEUE,
            args: [{ integrationId: channel.id, organizationId: channel.organizationId }],
          });
        } catch (error) {
          if (!(error instanceof WorkflowExecutionAlreadyStartedError)) {
            failures += 1;
          }
        }
      });

      // Sprint 8: a delivery row is created in the same transaction as the
      // outcome it reports, and its workflow is started best-effort after.
      // Any row still PENDING a minute later with no workflow is started here.
      const now = Date.now();
      const deliveries = await prisma.webhookDelivery.findMany({
        where: {
          status: WebhookDeliveryStatus.PENDING,
          createdAt: {
            lt: new Date(now - DELIVERY_RECONCILE_MIN_AGE_MS),
            gt: new Date(now - DELIVERY_RECONCILE_MAX_AGE_MS),
          },
          webhook: { deletedAt: null, disabled: false },
        },
        select: { id: true, organizationId: true },
      });

      await inBatches(deliveries, async (delivery) => {
        try {
          await client.workflow.start(WEBHOOK_DELIVERY_WORKFLOW, {
            workflowId: webhookDeliveryWorkflowId(delivery.id),
            taskQueue: SCHEDULING_TASK_QUEUE,
            args: [{ deliveryId: delivery.id, organizationId: delivery.organizationId }],
          });
        } catch (error) {
          if (!(error instanceof WorkflowExecutionAlreadyStartedError)) {
            failures += 1;
          }
        }
      });

      return {
        queuedPosts: roots.length,
        refreshableChannels: channels.length,
        analyticsChannels: analyticsChannels.length,
        webhookDeliveries: deliveries.length,
        failures,
      };
    },
  };
}

export type MaintenanceActivities = ReturnType<typeof createMaintenanceActivities>;

async function inBatches<T>(items: T[], run: (item: T) => Promise<void>): Promise<void> {
  for (let index = 0; index < items.length; index += CONCURRENCY) {
    await Promise.all(items.slice(index, index + CONCURRENCY).map(run));
  }
}
