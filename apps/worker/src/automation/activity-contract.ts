/**
 * The seam between `automationRunWorkflow` and its activities (Module 07).
 *
 * The workflow is a deterministic interpreter: it keeps only small state
 * (per step `{ status, ports }`), asks `planNext` what to start, and calls
 * these activities. Everything that touches the database, the clock or an
 * outside app happens in an activity; outputs stay in `AutomationRunStep`
 * rows and never travel through workflow history.
 *
 * `createAutomationActivities(deps)` returns an object that `satisfies`
 * this interface; the workflow proxies it by type only. Every input carries
 * `organizationId`, and every row read is scoped by it as well as the id.
 *
 * Row rules both sides rely on:
 *
 * - One `AutomationRunStep` row per attempt, `@@unique([runId, nodeKey,
 *   attempt])`. Readers take the highest attempt per step.
 * - A step row is only moved out of RUNNING, QUEUED or WAITING by a
 *   conditional write, so a late activity cannot overwrite a run that was
 *   cancelled or finished meanwhile.
 * - Skipped rows (`SKIPPED`) carry `output: { skipped: AutomationSkipReason }`.
 */
import type { AutomationGraph, PortId } from '@postgear/automation';
import type {
  AutomationRunOutcome,
  AutomationRunScope,
  AutomationSkipReason,
  ReviewDecision,
} from '@postgear/scheduling';

export interface RunRef {
  runId: string;
  organizationId: string;
}

export interface StepRef extends RunRef {
  nodeKey: string;
}

/**
 * What a run executes. `graph` is the pinned version's graph for live runs
 * and `graphSnapshot` for test runs. `skip` when the run row is gone or
 * already terminal (QUEUED, RUNNING and WAITING all continue, so an activity
 * retry after a lost reply never drops a run).
 */
export type RunPlan =
  | { skip: true; reason: 'gone' | 'finished' }
  | {
      skip: false;
      graph: AutomationGraph;
      mode: 'test' | 'live';
      scope: AutomationRunScope;
      sendForReal: string[];
    };

/** What a finished step tells the workflow: small, so history stays short. */
export interface NodeRunResult {
  /** `handledError` only when the executor itself chose to carry on. */
  status: 'succeeded' | 'dryRun' | 'handledError';
  /** Ports the run continues through; `[]` for a Filter that did not pass. */
  ports: PortId[];
  /** `Context.current().info.attempt` of the attempt that succeeded (counts towards the step budget). */
  attempt: number;
}

export interface SettleFailureInput extends StepRef {
  /**
   * The On Error mode the workflow applied: `stop` leaves (or makes) the
   * latest attempt FAILED; `continue` and `branch` rewrite it as
   * HANDLED_ERROR with output `{ error: { message, code } }`.
   */
  mode: 'stop' | 'continue' | 'branch';
  /** The `ApplicationFailure.type` (null for a timeout or an unexpected error). */
  failureType: string | null;
  /** The one sentence the user sees. */
  message: string;
  /** True when the attempt timed out (no row may have been written for it). */
  timedOut: boolean;
}

export interface FinishRunInput extends RunRef {
  outcome: AutomationRunOutcome;
  /** Overrides the first failed step's sentence (the step budget, an interruption). */
  error?: string;
  /** Step executions, retries included. */
  stepCount: number;
}

export interface AutomationActivities {
  /** Reads the run and marks it RUNNING with `startedAt` (QUEUED only). */
  loadRunPlan(input: RunRef): Promise<RunPlan>;
  /**
   * Live runs only: true when fewer than `LIMITS.maxConcurrentRunsPerWorkspace`
   * live runs of the workspace that started before this one are RUNNING. Ordering by
   * start (then id) makes waiting runs go first come, first served without a lock.
   */
  claimRunSlot(input: RunRef): Promise<boolean>;
  /** Writes one SKIPPED row per step (attempt 1), with `output: { skipped: reason }`. */
  recordSkipped(
    input: RunRef & { steps: { nodeKey: string; reason: AutomationSkipReason }[] },
  ): Promise<void>;
  /**
   * Runs one step: resolves its data, runs the executor (or a dry run), and
   * writes the attempt's row through `redact()`. Throws `ApplicationFailure`
   * typed from `AUTOMATION_FAILURE_TYPES` after writing a FAILED row.
   */
  executeNodeActivity(input: StepRef): Promise<NodeRunResult>;
  /** After the activity's last attempt failed: applies On Error to the rows. Returns attempts used. */
  settleStepFailure(input: SettleFailureInput): Promise<{ attempts: number }>;
  /**
   * Delay: resolves the config, writes a WAITING row and returns how long to
   * wait (capped at the run timeout). In a step test it writes the row as
   * SUCCEEDED with `{ waitMs, until }` and returns `waitMs: 0`.
   */
  prepareDelay(input: StepRef): Promise<{ waitMs: number }>;
  /**
   * Manual Review: writes a WAITING row, sets the run WAITING and notifies the
   * workspace ("Your {workflow} is ready for review."). In a step test it
   * writes a DRY_RUN row instead and returns `waiting: false` (port `approved`).
   */
  openReview(input: StepRef): Promise<{ waiting: boolean }>;
  /**
   * After the decision signal: the WAITING row becomes SUCCEEDED (the API
   * already wrote the decision into its output) and the run RUNNING again.
   * Returns the port to follow.
   */
  closeReview(input: StepRef & { decision: ReviewDecision }): Promise<{ ports: PortId[] }>;
  /** Delay done: the WAITING row becomes SUCCEEDED. */
  completeStep(input: StepRef): Promise<void>;
  /**
   * Writes the final status, `finishedAt`, `stepCount`, `creditsUsed`,
   * `error`, marks any QUEUED, RUNNING or WAITING step rows CANCELLED, and
   * updates `lastRunAt`, `lastRunStatus`, `lastRunError` on the Automation
   * (plus `consecutiveFailures` for live runs: +1 on failed, 0 on succeeded).
   */
  finishRun(input: FinishRunInput): Promise<void>;
}
