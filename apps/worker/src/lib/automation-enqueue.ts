/**
 * Live runs started by a post event (Module 09): Post Published and Post
 * Failed. The publish activities call `enqueueAutomationRuns` inside the
 * same transaction that records the outcome (next to the webhook
 * deliveries), then `startAutomationRuns` after commit, best effort.
 *
 * ## Exactly once per event
 *
 * Each run row carries `triggerEventId` (`post.published:<rootId>`, or
 * `post.failed:<rootId>:<publish run id>`), unique per workflow. The insert
 * is `createMany({ skipDuplicates: true })`, so a retried or replayed publish
 * activity inserts nothing new. A run whose start is lost stays QUEUED and
 * the maintenance reconcile starts it a minute later.
 *
 * ## Which workflows
 *
 * ACTIVE, not deleted workflows of the workspace whose **active version**
 * starts on this trigger, and whose trigger filters (channels, tags, failure
 * reasons) let the event through: `matchesTriggerFilters` reads the version,
 * never the draft. Each run runs its own version, so a run started on v1
 * finishes on v1 after v2 is turned on.
 */
import {
  type AutomationGraph,
  LIMITS,
  matchesTriggerFilters,
  redact,
  type TriggerEvent,
  upgradeGraph,
} from '@postgear/automation';
import type { Prisma } from '@postgear/db';
import {
  AUTOMATION_RUN_WORKFLOW,
  automationRunWorkflowId,
  SCHEDULING_TASK_QUEUE,
} from '@postgear/scheduling';
import { type Client, WorkflowExecutionAlreadyStartedError } from '@temporalio/client';
import type { WebhookErrorPayload, WebhookPostPayload } from './webhook-payload';

/** The trigger types a post event starts. */
export type AutomationPostEvent = 'trigger.postPublished' | 'trigger.postFailed';

/**
 * The trigger's output (the catalog's `outputShape` for Post Published and
 * Post Failed): the same `post` an outbound webhook carries, the post's tag
 * names, a PostGear link, and `publishedAt` or the `error` with its plain
 * words (`reasonText`, "Gave up after several tries").
 */
export interface PostTriggerPayload {
  post: WebhookPostPayload;
  tags: string[];
  link: string;
  publishedAt?: string;
  error?: WebhookErrorPayload & { reasonText: string };
}

/** The post in PostGear: the composer opened on its group. */
export function postLink(webUrl: string, organizationId: string, group: string): string {
  return `${webUrl.replace(/\/+$/, '')}/${organizationId}/composer?group=${encodeURIComponent(group)}`;
}

/** The subset of a Prisma client the enqueue needs: the real client or a transaction. */
export type AutomationEnqueueClient = {
  automation: { findMany: Prisma.AutomationDelegate['findMany'] };
  automationRun: {
    createMany: Prisma.AutomationRunDelegate['createMany'];
    findMany: Prisma.AutomationRunDelegate['findMany'];
  };
};

export interface EnqueueAutomationRunsInput {
  /** The trigger type the event fires. */
  event: AutomationPostEvent;
  organizationId: string;
  /** The dedupe key: `postPublishedTriggerEventId` or `postFailedTriggerEventId`. */
  triggerEventId: string;
  /** The trigger's output (`{{ trigger.* }}`), redacted and capped before it is stored. */
  payload: unknown;
  /** What the trigger filters read: the channel, the post's tag ids, a failure reason. */
  filter: Omit<TriggerEvent, 'type'>;
}

/**
 * Inserts one QUEUED live run per matching workflow and returns the ids of
 * this event's runs that are still QUEUED (the new ones, and any an earlier
 * try created but never got started), so a retry starts what it may have
 * missed.
 */
export async function enqueueAutomationRuns(
  client: AutomationEnqueueClient,
  input: EnqueueAutomationRunsInput,
): Promise<string[]> {
  const automations = await client.automation.findMany({
    where: {
      organizationId: input.organizationId,
      status: 'ACTIVE',
      deletedAt: null,
      activeVersion: { is: { triggerType: input.event } },
    },
    select: {
      id: true,
      activeVersion: { select: { id: true, graph: true, triggerType: true } },
    },
  });

  const event: TriggerEvent = { ...input.filter, type: input.event };
  const matching = automations.flatMap((automation) => {
    const version = automation.activeVersion;
    if (!version || version.triggerType !== input.event) return [];
    let graph: AutomationGraph;
    try {
      graph = upgradeGraph(version.graph);
    } catch {
      return [];
    }
    const trigger = graph.nodes.find((node) => node.type === input.event);
    if (!trigger || !matchesTriggerFilters(trigger, event)) return [];
    return [{ automationId: automation.id, versionId: version.id }];
  });

  if (matching.length === 0) {
    return [];
  }

  const triggerPayload = redact(input.payload ?? {}, { capBytes: LIMITS.stepIoCapBytes })
    .value as Prisma.InputJsonValue;

  await client.automationRun.createMany({
    data: matching.map((match) => ({
      id: crypto.randomUUID(),
      automationId: match.automationId,
      versionId: match.versionId,
      organizationId: input.organizationId,
      mode: 'LIVE' as const,
      status: 'QUEUED' as const,
      triggerType: input.event,
      triggerEventId: input.triggerEventId,
      triggerPayload,
    })),
    skipDuplicates: true,
  });

  const rows = await client.automationRun.findMany({
    where: {
      organizationId: input.organizationId,
      automationId: { in: matching.map((match) => match.automationId) },
      triggerEventId: input.triggerEventId,
      status: 'QUEUED',
    },
    select: { id: true },
  });
  return rows.map((row) => row.id);
}

/**
 * Starts the run workflows after commit. Best effort, like
 * `startWebhookDeliveries`: the rows are written, and the maintenance
 * reconcile starts any run still QUEUED a minute from now.
 */
export async function startAutomationRuns(
  temporalClient: () => Promise<Client>,
  organizationId: string,
  runIds: string[],
  log: (message: string, meta: Record<string, unknown>) => void,
): Promise<void> {
  if (runIds.length === 0) {
    return;
  }

  let client: Client;
  try {
    client = await temporalClient();
  } catch (error) {
    log('workflow runs queued but the scheduler was unreachable; the reconcile will start them', {
      organizationId,
      runs: runIds.length,
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  await Promise.all(
    runIds.map(async (runId) => {
      try {
        await client.workflow.start(AUTOMATION_RUN_WORKFLOW, {
          workflowId: automationRunWorkflowId(runId),
          taskQueue: SCHEDULING_TASK_QUEUE,
          args: [{ runId, organizationId }],
          workflowExecutionTimeout: `${LIMITS.runTimeoutDays} days`,
          workflowIdReusePolicy: 'REJECT_DUPLICATE',
        });
      } catch (error) {
        if (error instanceof WorkflowExecutionAlreadyStartedError) {
          return;
        }
        log('could not start a workflow run; the reconcile will retry it', {
          organizationId,
          runId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }),
  );
}
