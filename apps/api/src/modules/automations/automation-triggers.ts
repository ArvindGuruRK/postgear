/**
 * Starting and stopping what makes a workflow run on its own (Module 09).
 *
 * - **Event triggers** (Post Published, Post Failed) need nothing here: the
 *   worker finds active workflows by their live version's trigger when a
 *   post publishes or fails.
 * - **Schedule** has one Temporal Schedule per workflow, built from the
 *   live version's Schedule step. Turning a workflow on creates or replaces
 *   it; pausing or deleting deletes it (so nothing is caught up later).
 *   Activating a version whose trigger is not Schedule deletes any schedule
 *   an older version left.
 * - **Runs in progress** are stopped when a workflow is deleted: each open
 *   run's workflow is told to cancel, and a run nobody can tell is closed
 *   here (any open run whose workflow is gone, a QUEUED one when Temporal
 *   is unreachable, the same rule as Cancel).
 *
 * Everything is best-effort, like `SchedulingService`: the worker's
 * reconcile recreates a missing schedule of an active workflow and deletes
 * one whose workflow is not on, so a Temporal blip never fails a request.
 */
import { Injectable, Logger } from '@nestjs/common';
import {
  type AutomationGraph,
  buildIndex,
  scheduleConfigSchema,
  toTemporalScheduleSpec,
} from '@postgear/automation';
import { AutomationRunStatus } from '@postgear/db';
import { SchedulingService } from '../scheduling/scheduling.service';
import { AutomationsRepository } from './automations.repository';

const SCHEDULE_TRIGGER_TYPE = 'trigger.schedule';

/** Open runs cancelled at once when a workflow is deleted. */
const CANCEL_BATCH = 10;

/** The live version a workflow's triggers are built from. */
export interface LiveVersion {
  id: string;
  graph: AutomationGraph;
}

@Injectable()
export class AutomationTriggers {
  private readonly logger = new Logger(AutomationTriggers.name);

  constructor(
    private readonly scheduling: SchedulingService,
    private readonly repository: AutomationsRepository,
  ) {}

  /**
   * Sets up what runs the live version on its own. False only when a
   * schedule was needed and could not be set up (the caller warns; the
   * reconcile finishes it within 15 minutes).
   */
  async start(orgId: string, automationId: string, version: LiveVersion): Promise<boolean> {
    const trigger = buildIndex(version.graph).triggers[0];
    if (trigger?.type !== SCHEDULE_TRIGGER_TYPE) {
      // A schedule an older version left behind; nothing to wait for.
      await this.scheduling.deleteAutomationSchedule(automationId);
      return true;
    }

    const config = scheduleConfigSchema.safeParse(trigger.config);
    if (!config.success) return false;

    return this.scheduling.putAutomationSchedule({
      automationId,
      organizationId: orgId,
      versionId: version.id,
      spec: toTemporalScheduleSpec(config.data),
    });
  }

  /** Stops new runs: deletes the workflow's schedule. False when Temporal could not be reached. */
  async stop(_orgId: string, automationId: string): Promise<boolean> {
    return this.scheduling.deleteAutomationSchedule(automationId);
  }

  /** Cancels every QUEUED, RUNNING or WAITING run of a workflow (it is being deleted). */
  async stopRuns(orgId: string, automationId: string): Promise<void> {
    const runs = await this.repository.openRuns(orgId, automationId);
    for (let start = 0; start < runs.length; start += CANCEL_BATCH) {
      await Promise.all(
        runs.slice(start, start + CANCEL_BATCH).map(async (run) => {
          const outcome = await this.scheduling.cancelAutomationRun(run.id, run.temporalWorkflowId);
          if (outcome === 'signalled') return;
          const statuses =
            outcome === 'notFound'
              ? [
                  AutomationRunStatus.QUEUED,
                  AutomationRunStatus.RUNNING,
                  AutomationRunStatus.WAITING,
                ]
              : [AutomationRunStatus.QUEUED];
          const closed = await this.repository.closeRun(orgId, run.id, statuses);
          if (!closed && outcome === 'unavailable') {
            this.logger.warn(
              JSON.stringify({ event: 'automation.delete.run_left_open', orgId, runId: run.id }),
            );
          }
        }),
      );
    }
  }
}
