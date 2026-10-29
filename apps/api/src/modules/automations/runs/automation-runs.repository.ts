/**
 * Persistence for workflow runs on the API side (Module 07). The worker
 * writes almost every run and step row; the API creates test runs, reads
 * them back, and makes the three writes a person can cause: a review
 * decision, its undo when the signal fails, and cancelling a run whose
 * workflow cannot be told.
 *
 * - **Every read carries the workspace.** Runs filter on `organizationId`
 *   and step rows on `run.organizationId` (the step table has no column of
 *   its own), so another workspace's run reads as not there. Runs of a
 *   deleted workflow read as not there too, like the workflow itself.
 * - **Readers take the highest attempt per step** (one row per attempt is
 *   the worker's rule, see `activity-contract.ts`). That is two queries: a
 *   light one over every attempt, then the full rows of the latest ones, so
 *   a run with many retries never loads every attempt's 64 KB of data.
 * - **Writes are conditional**, so a decision or a cancel can never
 *   overwrite a step or run the worker moved on meanwhile.
 * - **Connection credentials** are read here only to hide them in run data
 *   on the way out. The service decrypts them; nothing returns or logs them.
 */
import { Injectable } from '@nestjs/common';
import {
  AutomationRunMode,
  AutomationRunStatus,
  AutomationStepStatus,
  Prisma,
  prisma,
} from '@postgear/db';

const RUN_SUMMARY_SELECT = {
  id: true,
  automationId: true,
  mode: true,
  status: true,
  triggerType: true,
  options: true,
  startedById: true,
  stepCount: true,
  creditsUsed: true,
  error: true,
  startedAt: true,
  finishedAt: true,
  createdAt: true,
} as const;

const RUN_DETAIL_SELECT = {
  ...RUN_SUMMARY_SELECT,
  triggerPayload: true,
  graphSnapshot: true,
  version: { select: { version: true, graph: true } },
} as const;

const STEP_SELECT = {
  id: true,
  nodeKey: true,
  nodeType: true,
  nodeName: true,
  status: true,
  attempt: true,
  input: true,
  output: true,
  truncated: true,
  error: true,
  startedAt: true,
  finishedAt: true,
  durationMs: true,
  createdAt: true,
  updatedAt: true,
} as const;

export type RunSummaryRow = Prisma.AutomationRunGetPayload<{ select: typeof RUN_SUMMARY_SELECT }>;
export type RunDetailRow = Prisma.AutomationRunGetPayload<{ select: typeof RUN_DETAIL_SELECT }>;
export type StepRow = Prisma.AutomationRunStepGetPayload<{ select: typeof STEP_SELECT }>;

/** A step's latest attempt, and how many attempts it took. */
export interface LatestStep {
  step: StepRow;
  attempts: number;
}

/** What a test needs from its workflow. */
export interface TestableAutomation {
  id: string;
  name: string;
  draftGraph: Prisma.JsonValue;
  pinnedData: Prisma.JsonValue;
  organization: { name: string };
}

export interface ReviewStepRow {
  id: string;
  nodeType: string;
  status: AutomationStepStatus;
  output: Prisma.JsonValue;
}

export interface RunCreate {
  automationId: string;
  triggerType: string;
  triggerPayload: Prisma.InputJsonValue | typeof Prisma.JsonNull;
  graphSnapshot: Prisma.InputJsonValue;
  seedOutputs?: Prisma.InputJsonValue;
  options: Prisma.InputJsonValue;
  startedById: string | null;
}

/** Statuses whose step rows still carry an output a later step can read. */
const OUTPUT_STATUSES = [
  AutomationStepStatus.SUCCEEDED,
  AutomationStepStatus.DRY_RUN,
  AutomationStepStatus.HANDLED_ERROR,
];

/** Step statuses a cancel closes. */
const OPEN_STEP_STATUSES = [
  AutomationStepStatus.QUEUED,
  AutomationStepStatus.RUNNING,
  AutomationStepStatus.WAITING,
];

/** A step test looks this far back for upstream outputs before using samples. */
const RECENT_TEST_RUNS = 20;

/** One poll reads at most this many changed rows; the next poll reads the rest. */
const CHANGED_STEPS_BATCH = 500;

@Injectable()
export class AutomationRunsRepository {
  async findAutomation(orgId: string, id: string): Promise<TestableAutomation | null> {
    return prisma.automation.findFirst({
      where: { id, organizationId: orgId, deletedAt: null },
      select: {
        id: true,
        name: true,
        draftGraph: true,
        pinnedData: true,
        organization: { select: { name: true } },
      },
    });
  }

  async automationExists(orgId: string, id: string): Promise<boolean> {
    const row = await prisma.automation.findFirst({
      where: { id, organizationId: orgId, deletedAt: null },
      select: { id: true },
    });
    return row !== null;
  }

  /** The newest run's trigger data for this trigger type, any mode. Null when it never ran. */
  async latestTriggerPayload(
    orgId: string,
    automationId: string,
    triggerType: string,
  ): Promise<{ payload: Prisma.JsonValue } | null> {
    const row = await prisma.automationRun.findFirst({
      where: { organizationId: orgId, automationId, triggerType },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { triggerPayload: true },
    });
    return row ? { payload: row.triggerPayload } : null;
  }

  /**
   * For each step key, its output in the newest of the last 20 test runs
   * that has one (latest attempt, a status that leaves an output). Steps
   * with none are absent.
   */
  async latestTestOutputs(
    orgId: string,
    automationId: string,
    nodeKeys: readonly string[],
  ): Promise<Map<string, Prisma.JsonValue>> {
    if (nodeKeys.length === 0) return new Map();

    const runs = await prisma.automationRun.findMany({
      where: { organizationId: orgId, automationId, mode: AutomationRunMode.TEST },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: RECENT_TEST_RUNS,
      select: { id: true },
    });
    if (runs.length === 0) return new Map();

    const rank = new Map(runs.map((run, position) => [run.id, position]));
    const candidates = await prisma.automationRunStep.findMany({
      where: {
        runId: { in: [...rank.keys()] },
        nodeKey: { in: [...nodeKeys] },
        status: { in: OUTPUT_STATUSES },
      },
      select: { id: true, runId: true, nodeKey: true, attempt: true },
    });

    const best = new Map<string, { id: string; rank: number; attempt: number }>();
    for (const row of candidates) {
      const position = rank.get(row.runId) ?? Number.POSITIVE_INFINITY;
      const current = best.get(row.nodeKey);
      if (
        !current ||
        position < current.rank ||
        (position === current.rank && row.attempt > current.attempt)
      ) {
        best.set(row.nodeKey, { id: row.id, rank: position, attempt: row.attempt });
      }
    }
    if (best.size === 0) return new Map();

    const rows = await prisma.automationRunStep.findMany({
      where: { id: { in: [...best.values()].map((entry) => entry.id) } },
      select: { nodeKey: true, output: true },
    });
    return new Map(
      rows
        .filter((row) => row.output !== null)
        .map((row) => [row.nodeKey, row.output as Prisma.JsonValue]),
    );
  }

  async createRun(orgId: string, data: RunCreate): Promise<RunSummaryRow> {
    return prisma.automationRun.create({
      data: {
        organizationId: orgId,
        mode: AutomationRunMode.TEST,
        status: AutomationRunStatus.QUEUED,
        ...data,
      },
      select: RUN_SUMMARY_SELECT,
    });
  }

  /** One page of a workflow's runs, newest first. Asks for one extra row to know whether there is a next page. */
  async listRuns(
    orgId: string,
    automationId: string,
    filter: {
      mode?: AutomationRunMode;
      status?: AutomationRunStatus;
      cursor?: string;
      take: number;
    },
  ): Promise<RunSummaryRow[]> {
    return prisma.automationRun.findMany({
      where: {
        organizationId: orgId,
        automationId,
        ...(filter.mode ? { mode: filter.mode } : {}),
        ...(filter.status ? { status: filter.status } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...(filter.cursor ? { cursor: { id: filter.cursor }, skip: 1 } : {}),
      take: filter.take + 1,
      select: RUN_SUMMARY_SELECT,
    });
  }

  async findRun(orgId: string, runId: string): Promise<RunDetailRow | null> {
    return prisma.automationRun.findFirst({
      where: { id: runId, organizationId: orgId, automation: { deletedAt: null } },
      select: RUN_DETAIL_SELECT,
    });
  }

  async findRunSummary(orgId: string, runId: string): Promise<RunSummaryRow | null> {
    return prisma.automationRun.findFirst({
      where: { id: runId, organizationId: orgId, automation: { deletedAt: null } },
      select: RUN_SUMMARY_SELECT,
    });
  }

  /**
   * The latest attempt of each step (of `nodeKeys` only, when given), in
   * the order the steps first ran.
   */
  async latestSteps(
    orgId: string,
    runId: string,
    nodeKeys?: readonly string[],
  ): Promise<LatestStep[]> {
    const attempts = await prisma.automationRunStep.findMany({
      where: {
        runId,
        run: { organizationId: orgId },
        ...(nodeKeys ? { nodeKey: { in: [...nodeKeys] } } : {}),
      },
      select: { id: true, nodeKey: true, attempt: true, createdAt: true },
    });

    const latest = new Map<string, { id: string; attempt: number; firstAt: number }>();
    for (const row of attempts) {
      const seen = latest.get(row.nodeKey);
      const at = row.createdAt.getTime();
      if (!seen) {
        latest.set(row.nodeKey, { id: row.id, attempt: row.attempt, firstAt: at });
        continue;
      }
      if (row.attempt > seen.attempt) {
        seen.id = row.id;
        seen.attempt = row.attempt;
      }
      seen.firstAt = Math.min(seen.firstAt, at);
    }
    if (latest.size === 0) return [];

    const rows = await prisma.automationRunStep.findMany({
      where: {
        runId,
        run: { organizationId: orgId },
        id: { in: [...latest.values()].map((e) => e.id) },
      },
      select: STEP_SELECT,
    });
    const byId = new Map(rows.map((row) => [row.id, row]));

    return [...latest.entries()]
      .sort(([keyA, a], [keyB, b]) => a.firstAt - b.firstAt || (keyA < keyB ? -1 : 1))
      .flatMap(([, entry]) => {
        const step = byId.get(entry.id);
        return step ? [{ step, attempts: entry.attempt }] : [];
      });
  }

  /** Step rows written after `since`, oldest change first: what the live progress poll sends. */
  async stepsChangedSince(
    orgId: string,
    runId: string,
    since: Date,
  ): Promise<{ id: string; nodeKey: string; updatedAt: Date }[]> {
    return prisma.automationRunStep.findMany({
      where: { runId, run: { organizationId: orgId }, updatedAt: { gt: since } },
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      take: CHANGED_STEPS_BATCH,
      select: { id: true, nodeKey: true, updatedAt: true },
    });
  }

  async latestAttempt(
    orgId: string,
    runId: string,
    nodeKey: string,
  ): Promise<ReviewStepRow | null> {
    return prisma.automationRunStep.findFirst({
      where: { runId, nodeKey, run: { organizationId: orgId } },
      orderBy: { attempt: 'desc' },
      select: { id: true, nodeType: true, status: true, output: true },
    });
  }

  /**
   * Writes a review decision into a waiting step, only while it is still
   * waiting and unanswered. False when someone answered first, or the run
   * moved on.
   */
  async recordReview(
    orgId: string,
    stepId: string,
    output: Prisma.InputJsonValue,
  ): Promise<boolean> {
    const result = await prisma.automationRunStep.updateMany({
      where: {
        id: stepId,
        status: AutomationStepStatus.WAITING,
        output: { equals: Prisma.AnyNull },
        run: { organizationId: orgId },
      },
      data: { output },
    });
    return result.count > 0;
  }

  /** Undoes `recordReview` when the run could not be told, unless the run already moved on. */
  async clearReview(orgId: string, stepId: string): Promise<void> {
    await prisma.automationRunStep.updateMany({
      where: { id: stepId, status: AutomationStepStatus.WAITING, run: { organizationId: orgId } },
      data: { output: Prisma.DbNull },
    });
  }

  /**
   * Cancels a run directly, for a run whose workflow cannot be signalled:
   * only while its status is one of `statuses`, and its open steps with it.
   * False when the run had moved on.
   */
  async cancelRun(
    orgId: string,
    runId: string,
    statuses: readonly AutomationRunStatus[],
  ): Promise<boolean> {
    return prisma.$transaction(async (tx) => {
      const finishedAt = new Date();
      const run = await tx.automationRun.updateMany({
        where: { id: runId, organizationId: orgId, status: { in: [...statuses] } },
        data: { status: AutomationRunStatus.CANCELLED, finishedAt },
      });
      if (run.count === 0) return false;

      await tx.automationRunStep.updateMany({
        where: { runId, status: { in: OPEN_STEP_STATUSES } },
        data: { status: AutomationStepStatus.CANCELLED, finishedAt },
      });
      return true;
    });
  }

  /**
   * Every connection's encrypted credentials in the workspace, deleted ones
   * included: an older run may hold a value of a connection removed since.
   */
  async connectionCredentials(orgId: string): Promise<string[]> {
    const rows = await prisma.automationConnection.findMany({
      where: { organizationId: orgId },
      select: { credentials: true },
    });
    return rows.map((row) => row.credentials);
  }
}
