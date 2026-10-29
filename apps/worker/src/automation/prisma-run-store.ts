/**
 * `RunStore` on the database. The only place the run engine touches Prisma.
 *
 * Step rows are read and written through their run's workspace
 * (`run: { organizationId }`), so a run id from another workspace never
 * matches. `credentials` is decrypted in `loadConnection` only, for the one
 * step that needs it, and never selected anywhere else.
 */
import {
  AutomationConnectionStatus,
  AutomationRunMode,
  AutomationRunStatus,
  AutomationStepStatus,
  decrypt,
  NotificationEmailStatus,
  Prisma,
  type PrismaTransactionClient,
  prisma,
} from '@postgear/db';
import type { AutomationStepError } from '@postgear/scheduling';
import type { RunRef } from './activity-contract';
import type {
  AutomationRunSummary,
  NotificationWrite,
  PriorOutput,
  RunChange,
  RunRecord,
  RunStore,
  StepChange,
  StepKey,
  StepRecord,
  StoredConnection,
} from './run-store';

type Db = typeof prisma | PrismaTransactionClient;

const OUTPUT_STATUSES: AutomationStepStatus[] = [
  AutomationStepStatus.SUCCEEDED,
  AutomationStepStatus.DRY_RUN,
  AutomationStepStatus.HANDLED_ERROR,
];

const OPEN_STEP_STATUSES: AutomationStepStatus[] = [
  AutomationStepStatus.QUEUED,
  AutomationStepStatus.RUNNING,
  AutomationStepStatus.WAITING,
];

const STEP_SELECT = {
  runId: true,
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
} as const;

type StepRow = Prisma.AutomationRunStepGetPayload<{ select: typeof STEP_SELECT }>;

/** A JSON column value: SQL NULL for nothing, the value otherwise. */
function json(value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return value === undefined || value === null ? Prisma.DbNull : (value as Prisma.InputJsonValue);
}

function toStep(row: StepRow): StepRecord {
  return {
    ...row,
    error: (row.error ?? null) as AutomationStepError | null,
  };
}

function stepData(change: StepChange): Prisma.AutomationRunStepUpdateManyMutationInput {
  const data: Prisma.AutomationRunStepUpdateManyMutationInput = {};
  if (change.status !== undefined) data.status = change.status;
  if (change.input !== undefined) data.input = json(change.input);
  if (change.output !== undefined) data.output = json(change.output);
  if (change.truncated !== undefined) data.truncated = change.truncated;
  if (change.error !== undefined) data.error = json(change.error);
  if (change.startedAt !== undefined) data.startedAt = change.startedAt;
  if (change.finishedAt !== undefined) data.finishedAt = change.finishedAt;
  if (change.durationMs !== undefined) data.durationMs = change.durationMs;
  return data;
}

export class PrismaRunStore implements RunStore {
  constructor(private readonly db: Db = prisma) {}

  async loadRun(ref: RunRef): Promise<RunRecord | null> {
    const run = await this.db.automationRun.findFirst({
      where: { id: ref.runId, organizationId: ref.organizationId },
      select: {
        id: true,
        organizationId: true,
        automationId: true,
        mode: true,
        status: true,
        graphSnapshot: true,
        triggerPayload: true,
        seedOutputs: true,
        options: true,
        startedAt: true,
        createdAt: true,
        automation: { select: { name: true } },
        organization: { select: { name: true } },
        version: { select: { graph: true } },
      },
    });

    if (!run) {
      return null;
    }

    return {
      id: run.id,
      organizationId: run.organizationId,
      automationId: run.automationId,
      automationName: run.automation.name,
      workspaceName: run.organization.name,
      mode: run.mode,
      status: run.status,
      graph:
        run.mode === AutomationRunMode.LIVE
          ? (run.version?.graph ?? null)
          : (run.graphSnapshot ?? null),
      triggerPayload: run.triggerPayload,
      seedOutputs: run.seedOutputs,
      options: run.options,
      startedAt: run.startedAt,
      createdAt: run.createdAt,
    };
  }

  async updateRun(
    ref: RunRef,
    from: readonly AutomationRunStatus[],
    change: RunChange,
  ): Promise<boolean> {
    const result = await this.db.automationRun.updateMany({
      where: { id: ref.runId, organizationId: ref.organizationId, status: { in: [...from] } },
      data: change,
    });
    return result.count > 0;
  }

  async stepOutputs(ref: RunRef): Promise<Record<string, PriorOutput>> {
    const rows = await this.db.automationRunStep.findMany({
      where: {
        runId: ref.runId,
        run: { organizationId: ref.organizationId },
        status: { in: OUTPUT_STATUSES },
      },
      select: { nodeKey: true, output: true, status: true, attempt: true },
      orderBy: { attempt: 'asc' },
    });

    // Ascending attempts, so the latest attempt of each step wins.
    const outputs: Record<string, PriorOutput> = {};
    for (const row of rows) {
      outputs[row.nodeKey] = { output: row.output, status: row.status };
    }
    return outputs;
  }

  async findSucceededStep(ref: RunRef, nodeKey: string): Promise<StepRecord | null> {
    const row = await this.db.automationRunStep.findFirst({
      where: {
        runId: ref.runId,
        nodeKey,
        run: { organizationId: ref.organizationId },
        status: { in: [AutomationStepStatus.SUCCEEDED, AutomationStepStatus.DRY_RUN] },
      },
      select: STEP_SELECT,
      orderBy: { attempt: 'desc' },
    });
    return row ? toStep(row) : null;
  }

  async listSteps(ref: RunRef, nodeKey?: string): Promise<StepRecord[]> {
    const rows = await this.db.automationRunStep.findMany({
      where: {
        runId: ref.runId,
        run: { organizationId: ref.organizationId },
        ...(nodeKey === undefined ? {} : { nodeKey }),
      },
      select: STEP_SELECT,
      orderBy: [{ attempt: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map(toStep);
  }

  async writeStep(ref: RunRef, step: StepRecord): Promise<boolean> {
    // The run must belong to the workspace before a row is attached to it.
    const owned = await this.db.automationRun.count({
      where: { id: ref.runId, organizationId: ref.organizationId },
    });
    if (owned === 0) {
      return false;
    }

    // ON CONFLICT DO NOTHING rather than catching the unique violation, so a
    // duplicate inside a transaction does not abort the transaction.
    const result = await this.db.automationRunStep.createMany({
      data: [
        {
          runId: ref.runId,
          nodeKey: step.nodeKey,
          nodeType: step.nodeType,
          nodeName: step.nodeName,
          status: step.status,
          attempt: step.attempt,
          input: json(step.input),
          output: json(step.output),
          truncated: step.truncated,
          error: json(step.error),
          startedAt: step.startedAt,
          finishedAt: step.finishedAt,
          durationMs: step.durationMs,
        },
      ],
      skipDuplicates: true,
    });
    return result.count > 0;
  }

  async moveStep(
    ref: RunRef,
    key: StepKey,
    from: readonly AutomationStepStatus[],
    change: StepChange,
  ): Promise<boolean> {
    const result = await this.db.automationRunStep.updateMany({
      where: {
        runId: key.runId,
        nodeKey: key.nodeKey,
        attempt: key.attempt,
        run: { organizationId: ref.organizationId },
        status: { in: [...from] },
      },
      data: stepData(change),
    });
    return result.count > 0;
  }

  async cancelOpenSteps(ref: RunRef, finishedAt: Date): Promise<number> {
    const result = await this.db.automationRunStep.updateMany({
      where: {
        runId: ref.runId,
        run: { organizationId: ref.organizationId },
        status: { in: OPEN_STEP_STATUSES },
      },
      data: { status: AutomationStepStatus.CANCELLED, finishedAt },
    });
    return result.count;
  }

  countLiveRunsAhead(run: {
    id: string;
    organizationId: string;
    startedAt: Date;
  }): Promise<number> {
    return this.db.automationRun.count({
      where: {
        organizationId: run.organizationId,
        mode: AutomationRunMode.LIVE,
        status: AutomationRunStatus.RUNNING,
        id: { not: run.id },
        OR: [
          { startedAt: { lt: run.startedAt } },
          { startedAt: run.startedAt, id: { lt: run.id } },
        ],
      },
    });
  }

  async loadConnection(
    organizationId: string,
    connectionId: string,
  ): Promise<StoredConnection | null> {
    const row = await this.db.automationConnection.findFirst({
      where: { id: connectionId, organizationId, deletedAt: null },
      select: { id: true, provider: true, name: true, status: true, credentials: true },
    });

    if (!row) {
      return null;
    }

    let credentials: unknown = null;
    try {
      credentials = JSON.parse(decrypt(row.credentials));
    } catch {
      // Unreadable credentials (a rotated key, a damaged row) are a broken
      // connection: the step reports "not connected" and the user reconnects.
      return {
        id: row.id,
        kind: row.provider,
        name: row.name,
        status: AutomationConnectionStatus.ERROR,
        credentials: null,
      };
    }

    return { id: row.id, kind: row.provider, name: row.name, status: row.status, credentials };
  }

  async markConnectionBroken(
    organizationId: string,
    connectionId: string,
    message: string,
  ): Promise<void> {
    await this.db.automationConnection.updateMany({
      where: { id: connectionId, organizationId, deletedAt: null },
      data: {
        status: AutomationConnectionStatus.NEEDS_RECONNECT,
        lastError: message,
        lastCheckedAt: new Date(),
      },
    });
  }

  async createNotification(notification: NotificationWrite): Promise<{ id: string }> {
    const row = await this.db.notifications.create({
      data: {
        organizationId: notification.organizationId,
        type: notification.type,
        title: notification.title,
        content: notification.content,
        link: notification.link,
        emailStatus: NotificationEmailStatus.PENDING,
        meta: notification.meta as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    return row;
  }

  async updateAutomation(
    organizationId: string,
    automationId: string,
    summary: AutomationRunSummary,
  ): Promise<void> {
    await this.db.automation.updateMany({
      where: { id: automationId, organizationId },
      data: {
        lastRunAt: summary.lastRunAt,
        lastRunStatus: summary.lastRunStatus,
        lastRunError: summary.lastRunError,
        ...(summary.consecutiveFailures === 'increment'
          ? { consecutiveFailures: { increment: 1 } }
          : summary.consecutiveFailures === 'reset'
            ? { consecutiveFailures: 0 }
            : {}),
      },
    });
  }

  transaction<T>(work: (store: RunStore) => Promise<T>): Promise<T> {
    if ('$transaction' in this.db) {
      return this.db.$transaction((tx) => work(new PrismaRunStore(tx)));
    }
    // Already inside one.
    return work(this);
  }
}
