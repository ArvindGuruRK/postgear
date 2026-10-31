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
import {
  AutomationRunStatus,
  AutomationStatus,
  type Prisma,
  prisma,
  State,
  WebhookDeliveryStatus,
} from '@postgear/db';
import {
  ANALYTICS_SYNC_WORKFLOW,
  AUTOMATION_RUN_RETENTION_DAYS,
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
import {
  type ActiveScheduledAutomation,
  deleteAutomationSchedule,
  reconcileAutomationSchedules,
} from '../lib/automation-schedules';
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
  /** Sprint 10, Module 09: missing (or outdated) workflow schedules created again. */
  recreatedAutomationSchedules: number;
  /** Sprint 10, Module 09: schedules of workflows no longer on, or no longer on a Schedule, deleted. */
  deletedAutomationSchedules: number;
  failures: number;
}

/** What `pruneAutomationRuns` deleted. */
export interface PruneReport {
  runs: number;
  /** Sprint 10, Module 10: step gateway effect rows past the retention. */
  effects: number;
}

/** Finished runs are deleted this many at a time (their steps cascade). */
export const AUTOMATION_PRUNE_BATCH = 500;

/** Run statuses that never change again: only these are ever pruned. */
const TERMINAL_RUN_STATUSES: AutomationRunStatus[] = [
  AutomationRunStatus.SUCCEEDED,
  AutomationRunStatus.FAILED,
  AutomationRunStatus.CANCELLED,
  AutomationRunStatus.REJECTED,
  AutomationRunStatus.EXPIRED,
];

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

      // Sprint 10, Module 09: every workflow that is on and starts on a
      // Schedule has its Temporal Schedule; no other workflow does. The API
      // registers it on activate, best effort; this finishes what it missed.
      let schedules = { recreated: 0, deleted: 0, failures: 0 };
      try {
        schedules = await reconcileAutomationSchedules(client, activeScheduledAutomations);
      } catch {
        // Listing schedules failed: try again next pass.
        schedules.failures += 1;
      }
      failures += schedules.failures;

      return {
        queuedPosts: roots.length,
        refreshableChannels: channels.length,
        analyticsChannels: analyticsChannels.length,
        webhookDeliveries: deliveries.length,
        queuedAutomationRuns: automation.queued,
        interruptedAutomationRuns: automation.interrupted,
        recreatedAutomationSchedules: schedules.recreated,
        deletedAutomationSchedules: schedules.deleted,
        failures,
      };
    },

    /** Sprint 10, Module 09: finished workflow runs older than the retention go. */
    async pruneAutomationRuns(): Promise<PruneReport> {
      return pruneAutomationRuns(prisma, new Date());
    },
  };
}

/** ACTIVE, not deleted workflows whose active version starts on a Schedule. */
async function activeScheduledAutomations(): Promise<ActiveScheduledAutomation[]> {
  const rows = await prisma.automation.findMany({
    where: {
      status: AutomationStatus.ACTIVE,
      deletedAt: null,
      activeVersion: { is: { triggerType: 'trigger.schedule' } },
    },
    select: {
      id: true,
      organizationId: true,
      activeVersion: { select: { id: true, graph: true } },
    },
  });
  return rows.flatMap((row) =>
    row.activeVersion
      ? [
          {
            automationId: row.id,
            organizationId: row.organizationId,
            versionId: row.activeVersion.id,
            graph: row.activeVersion.graph,
          },
        ]
      : [],
  );
}

/** The subset of a Prisma client the prune needs. */
export type PruneClient = {
  automationRun: {
    findMany: Prisma.AutomationRunDelegate['findMany'];
    deleteMany: Prisma.AutomationRunDelegate['deleteMany'];
  };
  automationEffect: {
    deleteMany: Prisma.AutomationEffectDelegate['deleteMany'];
  };
};

/**
 * Deletes finished runs (and, by cascade, their steps) whose `finishedAt`
 * is older than `AUTOMATION_RUN_RETENTION_DAYS`, 500 at a time. QUEUED,
 * RUNNING and WAITING runs are never touched, whatever their age; runs of
 * deleted workflows go the same way.
 *
 * Sprint 10, Module 10: the step gateway's `AutomationEffect` rows older
 * than the same 30 days go too. An effect only guards the retries of one
 * step, which end within minutes; after a month it protects nothing.
 */
export async function pruneAutomationRuns(client: PruneClient, now: Date): Promise<PruneReport> {
  const cutoff = new Date(now.getTime() - AUTOMATION_RUN_RETENTION_DAYS * 24 * 60 * 60_000);
  let runs = 0;
  for (;;) {
    const batch = await client.automationRun.findMany({
      where: { status: { in: TERMINAL_RUN_STATUSES }, finishedAt: { lt: cutoff } },
      select: { id: true },
      orderBy: { finishedAt: 'asc' },
      take: AUTOMATION_PRUNE_BATCH,
    });
    if (batch.length === 0) break;
    const { count } = await client.automationRun.deleteMany({
      where: { id: { in: batch.map((run) => run.id) }, status: { in: TERMINAL_RUN_STATUSES } },
    });
    runs += count;
    if (batch.length < AUTOMATION_PRUNE_BATCH || count === 0) break;
  }
  const { count: effects } = await client.automationEffect.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  return { runs, effects };
}

/**
 * The run's Temporal workflow: `automationRunWorkflowId(id)`, or the id a
 * Schedule gave it (stored on the row, Module 09).
 */
function runWorkflowId(run: { id: string; temporalWorkflowId?: string | null }): string {
  return run.temporalWorkflowId ?? automationRunWorkflowId(run.id);
}

/** True when the run's Temporal workflow exists and is still running. */
async function workflowRunning(client: Client, workflowId: string): Promise<boolean> {
  try {
    const description = await client.workflow.getHandle(workflowId).describe();
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
    if (!ended.finished) return;
    interrupted += 1;
    // An interrupted live run counts as failed and may auto-pause its workflow.
    if (ended.paused) await deleteAutomationSchedule(client, ended.automationId);
  };

  const queued = await prisma.automationRun.findMany({
    where: {
      status: AutomationRunStatus.QUEUED,
      createdAt: { lt: new Date(now - AUTOMATION_RUN_RECONCILE_MIN_AGE_MS) },
    },
    select: { id: true, organizationId: true, temporalWorkflowId: true },
  });

  await inBatches(queued, async (run) => {
    // A scheduled run's own workflow made the row: never start a second one
    // for it. Still running, it picks the row up; gone, the run ends.
    if (run.temporalWorkflowId) {
      try {
        if (!(await workflowRunning(client, run.temporalWorkflowId))) await interrupt(run);
      } catch {
        failures += 1;
      }
      return;
    }
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
        if (!(await workflowRunning(client, runWorkflowId(run)))) await interrupt(run);
      } catch {
        failures += 1;
      }
    }
  });

  const open = await prisma.automationRun.findMany({
    where: { status: { in: [AutomationRunStatus.RUNNING, AutomationRunStatus.WAITING] } },
    select: { id: true, organizationId: true, temporalWorkflowId: true },
  });

  await inBatches(open, async (run) => {
    try {
      if (!(await workflowRunning(client, runWorkflowId(run)))) await interrupt(run);
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
