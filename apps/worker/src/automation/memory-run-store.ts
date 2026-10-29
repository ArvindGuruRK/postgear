/**
 * `RunStore` in memory, for tests: the engine runs unchanged against plain
 * arrays, with the same rules as the database (workspace scoping, insert
 * only `writeStep`, conditional `moveStep`). Rows are cloned in and out so a
 * test cannot change stored data by accident.
 */
import type {
  AutomationConnectionStatus,
  AutomationRunMode,
  AutomationRunStatus,
  AutomationStepStatus,
} from '@postgear/db';
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

const OUTPUT_STATUSES: AutomationStepStatus[] = ['SUCCEEDED', 'DRY_RUN', 'HANDLED_ERROR'];
const OPEN_STEP_STATUSES: AutomationStepStatus[] = ['QUEUED', 'RUNNING', 'WAITING'];

export interface MemoryAutomation {
  id: string;
  organizationId: string;
  name: string;
  lastRunAt: Date | null;
  lastRunStatus: AutomationRunStatus | null;
  lastRunError: string | null;
  consecutiveFailures: number;
}

export interface MemoryConnection extends StoredConnection {
  organizationId: string;
  deletedAt?: Date | null;
  lastError?: string | null;
}

export interface MemoryNotification extends NotificationWrite {
  id: string;
  emailStatus: 'PENDING';
  createdAt: Date;
}

function clone<T>(value: T): T {
  return value === undefined ? value : structuredClone(value);
}

export interface SeedRun {
  id: string;
  organizationId: string;
  automationId: string;
  automationName?: string;
  workspaceName?: string;
  mode?: AutomationRunMode;
  status?: AutomationRunStatus;
  graph: unknown;
  triggerPayload?: unknown;
  seedOutputs?: unknown;
  options?: unknown;
  startedAt?: Date | null;
  createdAt?: Date;
}

export class MemoryRunStore implements RunStore {
  readonly runs = new Map<string, RunRecord>();
  readonly steps: StepRecord[] = [];
  readonly connections: MemoryConnection[] = [];
  readonly notifications: MemoryNotification[] = [];
  readonly automations = new Map<string, MemoryAutomation>();
  /** Extra run facts the interface has no field for (finishedAt, stepCount). */
  readonly runExtras = new Map<
    string,
    { finishedAt?: Date; error?: string | null; stepCount?: number }
  >();

  /** Adds a run (and its workflow, when new). */
  addRun(seed: SeedRun): RunRecord {
    const run: RunRecord = {
      id: seed.id,
      organizationId: seed.organizationId,
      automationId: seed.automationId,
      automationName: seed.automationName ?? 'Test Workflow',
      workspaceName: seed.workspaceName ?? 'Bloom Bakery',
      mode: seed.mode ?? 'TEST',
      status: seed.status ?? 'QUEUED',
      graph: clone(seed.graph),
      triggerPayload: clone(seed.triggerPayload ?? {}),
      seedOutputs: clone(seed.seedOutputs ?? null),
      options: clone(seed.options ?? null),
      startedAt: seed.startedAt ?? null,
      createdAt: seed.createdAt ?? new Date('2026-11-03T09:00:00.000Z'),
    };
    this.runs.set(run.id, run);
    if (!this.automations.has(run.automationId)) {
      this.automations.set(run.automationId, {
        id: run.automationId,
        organizationId: run.organizationId,
        name: run.automationName,
        lastRunAt: null,
        lastRunStatus: null,
        lastRunError: null,
        consecutiveFailures: 0,
      });
    }
    return run;
  }

  addConnection(connection: MemoryConnection): void {
    this.connections.push(clone(connection));
  }

  /** The latest attempt of a step, for assertions. */
  latest(runId: string, nodeKey: string): StepRecord | undefined {
    return this.steps
      .filter((step) => step.runId === runId && step.nodeKey === nodeKey)
      .sort((a, b) => b.attempt - a.attempt)[0];
  }

  private owned(ref: RunRef): RunRecord | undefined {
    const run = this.runs.get(ref.runId);
    return run && run.organizationId === ref.organizationId ? run : undefined;
  }

  async loadRun(ref: RunRef): Promise<RunRecord | null> {
    const run = this.owned(ref);
    return run ? clone(run) : null;
  }

  async updateRun(
    ref: RunRef,
    from: readonly AutomationRunStatus[],
    change: RunChange,
  ): Promise<boolean> {
    const run = this.owned(ref);
    if (!run || !from.includes(run.status)) return false;
    if (change.status !== undefined) run.status = change.status;
    if (change.startedAt !== undefined) run.startedAt = change.startedAt;
    const extras = this.runExtras.get(run.id) ?? {};
    if (change.finishedAt !== undefined) extras.finishedAt = change.finishedAt;
    if (change.error !== undefined) extras.error = change.error;
    if (change.stepCount !== undefined) extras.stepCount = change.stepCount;
    this.runExtras.set(run.id, extras);
    return true;
  }

  private stepsOf(ref: RunRef, nodeKey?: string): StepRecord[] {
    if (!this.owned(ref)) return [];
    return this.steps
      .filter(
        (step) => step.runId === ref.runId && (nodeKey === undefined || step.nodeKey === nodeKey),
      )
      .sort((a, b) => a.attempt - b.attempt);
  }

  async stepOutputs(ref: RunRef): Promise<Record<string, PriorOutput>> {
    const outputs: Record<string, PriorOutput> = {};
    for (const step of this.stepsOf(ref)) {
      if (OUTPUT_STATUSES.includes(step.status)) {
        outputs[step.nodeKey] = { output: clone(step.output), status: step.status };
      }
    }
    return outputs;
  }

  async findSucceededStep(ref: RunRef, nodeKey: string): Promise<StepRecord | null> {
    const done = this.stepsOf(ref, nodeKey).filter(
      (step) => step.status === 'SUCCEEDED' || step.status === 'DRY_RUN',
    );
    const last = done[done.length - 1];
    return last ? clone(last) : null;
  }

  async listSteps(ref: RunRef, nodeKey?: string): Promise<StepRecord[]> {
    return this.stepsOf(ref, nodeKey).map(clone);
  }

  async writeStep(ref: RunRef, step: StepRecord): Promise<boolean> {
    if (!this.owned(ref)) return false;
    const exists = this.steps.some(
      (row) =>
        row.runId === ref.runId && row.nodeKey === step.nodeKey && row.attempt === step.attempt,
    );
    if (exists) return false;
    this.steps.push(clone({ ...step, runId: ref.runId }));
    return true;
  }

  async moveStep(
    ref: RunRef,
    key: StepKey,
    from: readonly AutomationStepStatus[],
    change: StepChange,
  ): Promise<boolean> {
    if (!this.owned(ref)) return false;
    const row = this.steps.find(
      (step) =>
        step.runId === key.runId && step.nodeKey === key.nodeKey && step.attempt === key.attempt,
    );
    if (!row || !from.includes(row.status)) return false;
    Object.assign(row, clone(change));
    return true;
  }

  async cancelOpenSteps(ref: RunRef, finishedAt: Date): Promise<number> {
    let count = 0;
    for (const step of this.stepsOf(ref)) {
      if (OPEN_STEP_STATUSES.includes(step.status)) {
        step.status = 'CANCELLED';
        step.finishedAt = finishedAt;
        count += 1;
      }
    }
    return count;
  }

  async countLiveRunsAhead(run: {
    id: string;
    organizationId: string;
    startedAt: Date;
  }): Promise<number> {
    let count = 0;
    for (const other of this.runs.values()) {
      if (other.id === run.id || other.organizationId !== run.organizationId) continue;
      if (other.mode !== 'LIVE' || other.status !== 'RUNNING' || !other.startedAt) continue;
      const before =
        other.startedAt.getTime() < run.startedAt.getTime() ||
        (other.startedAt.getTime() === run.startedAt.getTime() && other.id < run.id);
      if (before) count += 1;
    }
    return count;
  }

  async loadConnection(
    organizationId: string,
    connectionId: string,
  ): Promise<StoredConnection | null> {
    const row = this.connections.find(
      (connection) =>
        connection.id === connectionId &&
        connection.organizationId === organizationId &&
        !connection.deletedAt,
    );
    if (!row) return null;
    return clone({
      id: row.id,
      kind: row.kind,
      name: row.name,
      status: row.status,
      credentials: row.credentials,
    });
  }

  async markConnectionBroken(
    organizationId: string,
    connectionId: string,
    message: string,
  ): Promise<void> {
    const row = this.connections.find(
      (connection) =>
        connection.id === connectionId && connection.organizationId === organizationId,
    );
    if (row) {
      row.status = 'NEEDS_RECONNECT' as AutomationConnectionStatus;
      row.lastError = message;
    }
  }

  async createNotification(notification: NotificationWrite): Promise<{ id: string }> {
    const id = `ntf_${this.notifications.length + 1}`;
    this.notifications.push({
      ...clone(notification),
      id,
      emailStatus: 'PENDING',
      createdAt: new Date(),
    });
    return { id };
  }

  async updateAutomation(
    organizationId: string,
    automationId: string,
    summary: AutomationRunSummary,
  ): Promise<void> {
    const row = this.automations.get(automationId);
    if (!row || row.organizationId !== organizationId) return;
    row.lastRunAt = summary.lastRunAt;
    row.lastRunStatus = summary.lastRunStatus;
    row.lastRunError = summary.lastRunError;
    if (summary.consecutiveFailures === 'increment') row.consecutiveFailures += 1;
    if (summary.consecutiveFailures === 'reset') row.consecutiveFailures = 0;
  }

  transaction<T>(work: (store: RunStore) => Promise<T>): Promise<T> {
    return work(this);
  }
}
