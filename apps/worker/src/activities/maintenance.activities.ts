/**
 * The activity behind `maintenanceWorkflow`: make sure every queued post and
 * every refreshable channel has a workflow.
 *
 * The API starts workflows as posts are queued and channels connected, but it
 * does so best-effort: if Temporal is unreachable for a moment, the save still
 * succeeds and the row is simply waiting for this. A `start` with the
 * deterministic id is idempotent: one that already runs is left exactly as it
 * is (the "already started" error is the expected answer), and one that does
 * not is created. Deliberately *not* a wake: waking every sleeping workflow
 * every fifteen minutes would add a dozen history events each time, and a post
 * scheduled weeks out would hit Temporal's history limit before its day came.
 */

import { LIMITS } from '@postgear/automation';
import { AutomationRunStatus, prisma, State, WebhookDeliveryStatus } from '@postgear/db';
import {
  ANALYTICS_SYNC_WORKFLOW,
  AUTOMATION_RUN_WORKFLOW,
  analyticsSyncWorkflowId,
  automationRunWorkflowId,
  POST_PUBLISH_WORKFLOW,
  publishWorkflowId,
  SCHEDULING_TASK_QUEUE,
  TOKEN_REFRESH_WORKFLOW,
  tokenRefreshWorkflowId,
  WEBHOOK_DELIVERY_WORKFLOW,
  webhookDeliveryWorkflowId,
} from '@postgear/scheduling';
import {
  type Client,
  WorkflowExecutionAlreadyStartedError,
  WorkflowNotFoundError,
} from '@temporalio/client';
import { finalizeRun, INTERRUPTED_MESSAGE } from '../automation/finish';
import { PrismaRunStore } from '../automation/prisma-run-store';
import type { RunStore } from '../automation/run-store';
import type { ActivityDeps } from './deps';

export interface ReconcileReport {
  queuedPosts: number;
  refreshableChannels: number;
  /** Sprint 7: live, set-up channels whose analytics loop was ensured. */
  analyticsChannels: number;
  /** Sprint 8: pending webhook deliveries whose workflow was ensured. */
  webhookDeliveries: number;
  /** Sprint 10: workflow runs still QUEUED a minute after they were created, started here. */
  queuedAutomationRuns: number;
  /** Sprint 10: RUNNING or WAITING runs whose Temporal workflow was gone, marked FAILED. */
  interruptedAutomationRuns: number;
  failures: number;
}

/** A queued run younger than this is still being started by the API. */
const AUTOMATION_RUN_RECONCILE_MIN_AGE_MS = 60_000;

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

      // Sprint 10: workflow runs. The API writes the run row first and starts
      // its workflow best-effort, so a run still QUEUED a minute later is
      // started here. A run the database calls RUNNING or WAITING whose
      // workflow is gone (or closed without finishing it) never ends on its
      // own: it is marked FAILED.
      const automation = await reconcileAutomationRuns(client, new PrismaRunStore(), now);
      failures += automation.failures;

      return {
        queuedPosts: roots.length,
        refreshableChannels: channels.length,
        analyticsChannels: analyticsChannels.length,
        webhookDeliveries: deliveries.length,
        queuedAutomationRuns: automation.queued,
        interruptedAutomationRuns: automation.interrupted,
        failures,
      };
    },
  };
}

/** True when the run's Temporal workflow exists and is still running. */
async function workflowRunning(client: Client, runId: string): Promise<boolean> {
  try {
    const description = await client.workflow.getHandle(automationRunWorkflowId(runId)).describe();
    return description.status.name === 'RUNNING';
  } catch (error) {
    if (error instanceof WorkflowNotFoundError) {
      return false;
    }
    throw error;
  }
}

export async function reconcileAutomationRuns(
  client: Client,
  store: RunStore,
  now: number,
): Promise<{ queued: number; interrupted: number; failures: number }> {
  let failures = 0;
  let interrupted = 0;

  const interrupt = async (run: { id: string; organizationId: string }) => {
    const ended = await finalizeRun(
      store,
      { runId: run.id, organizationId: run.organizationId },
      { status: AutomationRunStatus.FAILED, error: INTERRUPTED_MESSAGE, finishedAt: new Date() },
    );
    if (ended) interrupted += 1;
  };

  const queued = await prisma.automationRun.findMany({
    where: {
      status: AutomationRunStatus.QUEUED,
      createdAt: { lt: new Date(now - AUTOMATION_RUN_RECONCILE_MIN_AGE_MS) },
    },
    select: { id: true, organizationId: true },
  });

  await inBatches(queued, async (run) => {
    try {
      await client.workflow.start(AUTOMATION_RUN_WORKFLOW, {
        workflowId: automationRunWorkflowId(run.id),
        taskQueue: SCHEDULING_TASK_QUEUE,
        args: [{ runId: run.id, organizationId: run.organizationId }],
        workflowExecutionTimeout: `${LIMITS.runTimeoutDays} days`,
        workflowIdReusePolicy: 'REJECT_DUPLICATE',
      });
    } catch (error) {
      if (!(error instanceof WorkflowExecutionAlreadyStartedError)) {
        failures += 1;
        return;
      }
      // Its workflow already ran and closed without picking the run up: it
      // can never start again under this id.
      try {
        if (!(await workflowRunning(client, run.id))) await interrupt(run);
      } catch {
        failures += 1;
      }
    }
  });

  const open = await prisma.automationRun.findMany({
    where: { status: { in: [AutomationRunStatus.RUNNING, AutomationRunStatus.WAITING] } },
    select: { id: true, organizationId: true },
  });

  await inBatches(open, async (run) => {
    try {
      if (!(await workflowRunning(client, run.id))) await interrupt(run);
    } catch {
      // Temporal did not answer: try again on the next pass.
      failures += 1;
    }
  });

  return { queued: queued.length, interrupted, failures };
}

export type MaintenanceActivities = ReturnType<typeof createMaintenanceActivities>;

async function inBatches<T>(items: T[], run: (item: T) => Promise<void>): Promise<void> {
  for (let index = 0; index < items.length; index += CONCURRENCY) {
    await Promise.all(items.slice(index, index + CONCURRENCY).map(run));
  }
}
