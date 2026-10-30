/**
 * Temporal Schedules for workflows whose trigger is Schedule (Module 09).
 *
 * One schedule per workflow, `automationScheduleId(id)`, built from the
 * **active version's** Schedule step. The API builds the same options when a
 * workflow is turned on (and deletes the schedule when it is paused); the
 * worker builds them here for the maintenance reconcile, and deletes the
 * schedule when it auto-pauses a workflow. Pausing deletes rather than
 * pauses, so a workflow turned back on never catches up on missed runs.
 *
 * Temporal client calls (SDK 1.24.0):
 * - create: `client.schedule.create(options)`, which throws
 *   `ScheduleAlreadyRunning` when the id is taken;
 * - read: `client.schedule.getHandle(id).describe()`, which throws
 *   `ScheduleNotFoundError` when there is none;
 * - delete: `client.schedule.getHandle(id).delete()` (same error);
 * - list: `for await (const summary of client.schedule.list())`.
 * Replacing is delete, then create.
 */
import {
  type AutomationGraph,
  type ScheduleConfig,
  scheduleConfigSchema,
  toTemporalScheduleSpec,
  upgradeGraph,
} from '@postgear/automation';
import {
  AUTOMATION_RUN_WORKFLOW,
  AUTOMATION_SCHEDULE_POLICIES,
  type AutomationScheduledRunInput,
  automationScheduledWorkflowIdPrefix,
  automationScheduleId,
  SCHEDULING_TASK_QUEUE,
} from '@postgear/scheduling';
import {
  type Client,
  ScheduleAlreadyRunning,
  type ScheduleDescription,
  ScheduleNotFoundError,
  type ScheduleOptions,
  ScheduleOverlapPolicy,
} from '@temporalio/client';

/** Every workflow schedule's id starts with this. */
export const AUTOMATION_SCHEDULE_PREFIX = automationScheduleId('');

/** The workflow a schedule id belongs to, or null for any other schedule. */
export function automationIdOfSchedule(scheduleId: string): string | null {
  if (!scheduleId.startsWith(AUTOMATION_SCHEDULE_PREFIX)) return null;
  const id = scheduleId.slice(AUTOMATION_SCHEDULE_PREFIX.length);
  return id.length > 0 ? id : null;
}

/** The Schedule step's settings in a version's graph; null when it has none that parse. */
export function scheduleConfigOf(graph: unknown): ScheduleConfig | null {
  let parsed: AutomationGraph;
  try {
    parsed = upgradeGraph(graph);
  } catch {
    return null;
  }
  const trigger = parsed.nodes.find((node) => node.type === 'trigger.schedule');
  if (!trigger) return null;
  const config = scheduleConfigSchema.safeParse(trigger.config);
  return config.success ? config.data : null;
}

export interface AutomationScheduleTarget {
  automationId: string;
  organizationId: string;
  versionId: string;
  config: ScheduleConfig;
}

/**
 * The schedule exactly as the API builds it: the spec in the step's own time
 * zone, a start of `automationRunWorkflow` with the scheduled input (Temporal
 * appends the scheduled time to the workflow id), overlap SKIP and a one
 * minute catch-up window.
 */
export function automationScheduleOptions(target: AutomationScheduleTarget): ScheduleOptions {
  const input: AutomationScheduledRunInput = {
    scheduled: { automationId: target.automationId, versionId: target.versionId },
    organizationId: target.organizationId,
  };
  return {
    scheduleId: automationScheduleId(target.automationId),
    spec: toTemporalScheduleSpec(target.config),
    action: {
      type: 'startWorkflow',
      workflowType: AUTOMATION_RUN_WORKFLOW,
      taskQueue: SCHEDULING_TASK_QUEUE,
      workflowId: automationScheduledWorkflowIdPrefix(target.automationId),
      args: [input],
    },
    policies: {
      overlap: ScheduleOverlapPolicy[AUTOMATION_SCHEDULE_POLICIES.overlap],
      catchupWindow: AUTOMATION_SCHEDULE_POLICIES.catchupWindowMs,
    },
  };
}

/** Creates the schedule; `exists` when one with this id is already there. */
export async function createAutomationSchedule(
  client: Client,
  target: AutomationScheduleTarget,
): Promise<'created' | 'exists'> {
  try {
    await client.schedule.create(automationScheduleOptions(target));
    return 'created';
  } catch (error) {
    if (error instanceof ScheduleAlreadyRunning) return 'exists';
    throw error;
  }
}

/** Deletes the workflow's schedule; false when there was none. */
export async function deleteAutomationSchedule(
  client: Client,
  automationId: string,
): Promise<boolean> {
  try {
    await client.schedule.getHandle(automationScheduleId(automationId)).delete();
    return true;
  } catch (error) {
    if (error instanceof ScheduleNotFoundError) return false;
    throw error;
  }
}

/** The version a schedule starts runs of, from its action's input. */
export function scheduledVersionOf(
  description: Pick<ScheduleDescription, 'action'>,
): string | null {
  const [input] = (description.action.args ?? []) as unknown[];
  if (typeof input !== 'object' || input === null) return null;
  const scheduled = (input as { scheduled?: { versionId?: unknown } }).scheduled;
  return typeof scheduled?.versionId === 'string' ? scheduled.versionId : null;
}

/** An ACTIVE, not deleted workflow whose active version starts on a Schedule. */
export interface ActiveScheduledAutomation {
  automationId: string;
  organizationId: string;
  versionId: string;
  /** The active version's graph, as stored. */
  graph: unknown;
}

export interface ScheduleReconcileReport {
  /** Missing schedules created, and schedules of an older version replaced. */
  recreated: number;
  /** Schedules whose workflow is gone, paused, a draft or no longer on a Schedule. */
  deleted: number;
  failures: number;
}

/**
 * Every ACTIVE workflow on a Schedule has its schedule, for its active
 * version; every other `automation-schedule:*` schedule is deleted.
 *
 * The schedules are listed **before** the workflows are read: a schedule in
 * the list was created after its workflow was turned on, so a workflow
 * turned on meanwhile is already ACTIVE when it is read and keeps its
 * schedule.
 */
export async function reconcileAutomationSchedules(
  client: Client,
  activeAutomations: () => Promise<ActiveScheduledAutomation[]>,
): Promise<ScheduleReconcileReport> {
  const report: ScheduleReconcileReport = { recreated: 0, deleted: 0, failures: 0 };

  const listed: string[] = [];
  for await (const summary of client.schedule.list()) {
    const automationId = automationIdOfSchedule(summary.scheduleId);
    if (automationId) listed.push(automationId);
  }

  const active = await activeAutomations();
  const activeIds = new Set(active.map((automation) => automation.automationId));

  for (const automationId of listed) {
    if (activeIds.has(automationId)) continue;
    try {
      if (await deleteAutomationSchedule(client, automationId)) report.deleted += 1;
    } catch {
      report.failures += 1;
    }
  }

  for (const automation of active) {
    const config = scheduleConfigOf(automation.graph);
    if (!config) {
      report.failures += 1;
      continue;
    }
    const target: AutomationScheduleTarget = { ...automation, config };
    try {
      let description: ScheduleDescription | null = null;
      try {
        description = await client.schedule
          .getHandle(automationScheduleId(automation.automationId))
          .describe();
      } catch (error) {
        if (!(error instanceof ScheduleNotFoundError)) throw error;
      }

      if (description && scheduledVersionOf(description) === automation.versionId) continue;
      // Missing, or still starting runs of an older version (an activation
      // whose replace did not finish): those runs would all be skipped.
      if (description) await deleteAutomationSchedule(client, automation.automationId);
      if ((await createAutomationSchedule(client, target)) === 'created') report.recreated += 1;
    } catch {
      report.failures += 1;
    }
  }

  return report;
}
