/**
 * Where a workflow run's rows live, as seen by the run engine (Module 07).
 *
 * The activities and executors only talk to this interface. Production uses
 * `PrismaRunStore`; executor and activity tests use `MemoryRunStore`, so they
 * run the real engine code with no database (TriForms' DryRunStore idea).
 *
 * Rules every implementation keeps:
 *
 * - Every read and write is scoped by `organizationId` as well as the id.
 * - `writeStep` only inserts: it never overwrites an attempt that already
 *   has a row. Moving a row to another status is `moveStep`, which only
 *   applies when the row is still in one of the `from` statuses, so a late
 *   activity can never overwrite a run that was cancelled meanwhile.
 * - Nothing here logs or returns a connection's credentials except
 *   `loadConnection`, which the engine uses for one step and never stores.
 */
import type {
  AutomationConnectionStatus,
  AutomationRunMode,
  AutomationRunStatus,
  AutomationStatus,
  AutomationStepStatus,
} from '@postgear/db';
import type { AutomationStepError } from '@postgear/scheduling';
import type { RunRef } from './activity-contract';

/** A run as the engine reads it. */
export interface RunRecord {
  id: string;
  organizationId: string;
  automationId: string;
  automationName: string;
  workspaceName: string;
  mode: AutomationRunMode;
  status: AutomationRunStatus;
  /**
   * The graph this run executes, as stored: `graphSnapshot` for a test run,
   * the pinned version's graph for a live run. Null when it is missing.
   */
  graph: unknown;
  triggerPayload: unknown;
  /** Step tests: `{ [nodeKey]: output }`. */
  seedOutputs: unknown;
  /** Test runs: `AutomationRunOptions`, as stored. */
  options: unknown;
  startedAt: Date | null;
  createdAt: Date;
}

export interface RunChange {
  status?: AutomationRunStatus;
  startedAt?: Date;
  finishedAt?: Date;
  error?: string | null;
  stepCount?: number;
}

/** One attempt of one step. */
export interface StepRecord {
  runId: string;
  nodeKey: string;
  nodeType: string;
  nodeName: string;
  status: AutomationStepStatus;
  attempt: number;
  input: unknown;
  output: unknown;
  truncated: boolean;
  error: AutomationStepError | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  durationMs: number | null;
  /**
   * The output ports a finished step fired (the ones fed to `planNext`):
   * `['out']`, `['true']`, `['approved']`, `['error']`; `[]` while it runs,
   * when it was skipped, or when it failed and stopped its branch. The run
   * view lights the lines taken from them, and Retry From Here seeds
   * finished steps with them (Module 08).
   */
  ports: string[];
}

export interface StepKey {
  runId: string;
  nodeKey: string;
  attempt: number;
}

export type StepChange = Partial<
  Pick<
    StepRecord,
    | 'status'
    | 'input'
    | 'output'
    | 'truncated'
    | 'error'
    | 'startedAt'
    | 'finishedAt'
    | 'durationMs'
    | 'ports'
  >
>;

/** The output a finished step gave later steps, and how it finished. */
export interface PriorOutput {
  output: unknown;
  status: AutomationStepStatus;
}

/** A connection, decrypted for one step. Never stored, never logged. */
export interface StoredConnection {
  id: string;
  /** The app: 'slack', 'teams', 'discord', 'http', 'google'. */
  kind: string;
  name: string;
  status: AutomationConnectionStatus;
  credentials: unknown;
}

export interface NotificationWrite {
  organizationId: string;
  type: string;
  title: string;
  content: string;
  link: string | null;
  meta: Record<string, unknown>;
  /** Defaults to now; failure alerts pass the run's finish time so the alert window uses one clock. */
  createdAt?: Date;
}

/** A notification as the failure alerts read it back (Module 09). */
export interface StoredNotification {
  id: string;
  createdAt: Date;
  meta: Record<string, unknown>;
}

/** The workflow a run belongs to, as the alerts, the auto-pause and scheduled runs read it. */
export interface AutomationRecord {
  id: string;
  organizationId: string;
  name: string;
  status: AutomationStatus;
  deleted: boolean;
  activeVersionId: string | null;
  consecutiveFailures: number;
}

/** A live run a trigger starts (Module 09): Schedule here, events in lib/automation-enqueue.ts. */
export interface NewLiveRun {
  organizationId: string;
  automationId: string;
  versionId: string;
  triggerType: string;
  triggerEventId: string;
  triggerPayload: unknown;
  /** The Temporal workflow id when it is not `automationRunWorkflowId(id)`. */
  temporalWorkflowId: string | null;
}

/** The run row for a trigger event, whether this call created it or an earlier one did. */
export interface LiveRunRow {
  id: string;
  status: AutomationRunStatus;
  temporalWorkflowId: string | null;
  created: boolean;
}

export interface AutomationRunSummary {
  lastRunAt: Date;
  lastRunStatus: AutomationRunStatus;
  lastRunError: string | null;
  /** Live runs only: `increment` on failed, `reset` on succeeded. */
  consecutiveFailures?: 'increment' | 'reset';
}

export interface RunStore {
  /** The run with its graph, scoped by workspace; null when it does not exist. */
  loadRun(ref: RunRef): Promise<RunRecord | null>;
  /** Applies when the run is still in one of `from`. True when it did. */
  updateRun(ref: RunRef, from: readonly AutomationRunStatus[], change: RunChange): Promise<boolean>;
  /**
   * Per step, the latest attempt that gave data to later steps (SUCCEEDED,
   * DRY_RUN or HANDLED_ERROR).
   */
  stepOutputs(ref: RunRef): Promise<Record<string, PriorOutput>>;
  /** A SUCCEEDED or DRY_RUN row for the step in any attempt (the latest one). */
  findSucceededStep(ref: RunRef, nodeKey: string): Promise<StepRecord | null>;
  /** Rows of the run (of one step when `nodeKey` is given), lowest attempt first. */
  listSteps(ref: RunRef, nodeKey?: string): Promise<StepRecord[]>;
  /** Inserts the attempt's row. False, and nothing written, when that attempt already has one. */
  writeStep(ref: RunRef, step: StepRecord): Promise<boolean>;
  /** Changes the row when its status is one of `from`. True when it did. */
  moveStep(
    ref: RunRef,
    key: StepKey,
    from: readonly AutomationStepStatus[],
    change: StepChange,
  ): Promise<boolean>;
  /** Marks every QUEUED, RUNNING or WAITING row of the run CANCELLED. Returns how many. */
  cancelOpenSteps(ref: RunRef, finishedAt: Date): Promise<number>;
  /**
   * Live runs of the workspace, other than this one, that are RUNNING and
   * started before it (by start time, then id).
   */
  countLiveRunsAhead(run: { id: string; organizationId: string; startedAt: Date }): Promise<number>;
  /** The connection with its credentials decrypted; null when missing or deleted. */
  loadConnection(organizationId: string, connectionId: string): Promise<StoredConnection | null>;
  /** The app refused the credentials: the Connections page asks for a reconnect. */
  markConnectionBroken(
    organizationId: string,
    connectionId: string,
    message: string,
  ): Promise<void>;
  /** An in-app notification, with `emailStatus: PENDING` so the outbox emails it. */
  createNotification(notification: NotificationWrite): Promise<{ id: string }>;
  /** The denormalised "last run" columns of the workflow. */
  updateAutomation(
    organizationId: string,
    automationId: string,
    summary: AutomationRunSummary,
  ): Promise<void>;
  /** The workflow, scoped by workspace; null when it does not exist. Deleted ones are returned with `deleted`. */
  loadAutomation(organizationId: string, automationId: string): Promise<AutomationRecord | null>;
  /** A version's graph as stored; null unless the version belongs to this workflow of this workspace. */
  loadVersionGraph(
    organizationId: string,
    automationId: string,
    versionId: string,
  ): Promise<unknown>;
  /**
   * Inserts the QUEUED live run for a trigger event once: idempotent on the
   * unique `(automationId, triggerEventId)`. Returns the row either way.
   */
  createLiveRun(run: NewLiveRun): Promise<LiveRunRow>;
  /** ACTIVE to PAUSED (the auto-pause). True when it changed. */
  pauseAutomation(organizationId: string, automationId: string): Promise<boolean>;
  /** The newest notification of this type about this workflow (`meta.automationId`). */
  latestNotification(
    organizationId: string,
    type: string,
    automationId: string,
  ): Promise<StoredNotification | null>;
  /** Replaces a notification's `meta` (the failure alert's suppressed count). */
  updateNotificationMeta(
    organizationId: string,
    notificationId: string,
    meta: Record<string, unknown>,
  ): Promise<void>;
  /** Runs `work` atomically where the backend can (a database transaction). */
  transaction<T>(work: (store: RunStore) => Promise<T>): Promise<T>;
}
