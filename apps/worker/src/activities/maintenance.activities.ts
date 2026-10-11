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
import { WorkflowExecutionAlreadyStartedError } from '@temporalio/client';
import { prisma, State } from '@postgear/db';
import {
  POST_PUBLISH_WORKFLOW,
  publishWorkflowId,
  SCHEDULING_TASK_QUEUE,
  TOKEN_REFRESH_WORKFLOW,
  tokenRefreshWorkflowId,
} from '@postgear/scheduling';
import type { ActivityDeps } from './deps';

export interface ReconcileReport {
  queuedPosts: number;
  refreshableChannels: number;
  failures: number;
}

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

      return { queuedPosts: roots.length, refreshableChannels: channels.length, failures };
    },
  };
}

export type MaintenanceActivities = ReturnType<typeof createMaintenanceActivities>;

async function inBatches<T>(items: T[], run: (item: T) => Promise<void>): Promise<void> {
  for (let index = 0; index < items.length; index += CONCURRENCY) {
    await Promise.all(items.slice(index, index + CONCURRENCY).map(run));
  }
}
