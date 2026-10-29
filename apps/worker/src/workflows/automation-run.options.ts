/**
 * Pure helpers of `automationRunWorkflow` (Module 07): how one step's
 * activity is called, and how its final failure is read.
 *
 * They live next to the workflow because the workflow bundle imports them,
 * so the same rules as `workflows/index.ts` apply: nothing here may touch
 * the clock, the network, Prisma or Node built-ins. They are plain
 * functions so the mapping is unit-tested without a Temporal server.
 */
import type { GraphNode, NodeDefinition } from '@postgear/automation';
import {
  AUTOMATION_FAILURE_TYPES,
  AUTOMATION_STEP_TIMEOUTS,
  type AutomationTimeoutClass,
  automationStepRetryPolicy,
  NON_RETRYABLE_AUTOMATION_FAILURES,
  RUN_STOPPING_AUTOMATION_FAILURES,
} from '@postgear/scheduling';
import {
  ActivityFailure,
  type ActivityOptions,
  ApplicationFailure,
  TimeoutFailure,
} from '@temporalio/workflow';

type StepDefinition = Pick<NodeDefinition, 'retry' | 'timeoutClass' | 'canHandleErrors'>;

/**
 * The options `executeNodeActivity` runs with for one step: the timeout of
 * its definition's `timeoutClass` (slow steps also heartbeat) and the retry
 * policy of its `retry` class plus its own On Error retries.
 *
 * A type this worker does not know (an old pinned version, say) gets the
 * strictest options: fast, one attempt. The activity then fails it with a
 * sentence the user can act on.
 */
export function stepActivityOptions(
  def: StepDefinition | undefined,
  node: Pick<GraphNode, 'onError'>,
): ActivityOptions {
  const timeoutClass: AutomationTimeoutClass = def?.timeoutClass ?? 'fast';
  const timeouts: { startToCloseMs: number; heartbeatMs?: number } =
    AUTOMATION_STEP_TIMEOUTS[timeoutClass];
  // On Error belongs to steps that can handle errors; a trigger or a Manual
  // Review carrying one (a validation issue) does not get extra attempts.
  const own = def?.canHandleErrors ? node.onError?.retries : undefined;
  const policy = automationStepRetryPolicy(def?.retry ?? 'none', own);

  return {
    startToCloseTimeout: timeouts.startToCloseMs,
    ...(timeouts.heartbeatMs ? { heartbeatTimeout: timeouts.heartbeatMs } : {}),
    retry: {
      initialInterval: policy.initialIntervalMs,
      backoffCoefficient: policy.backoffCoefficient,
      // A step's own wait may be up to 10 minutes, above the policy's
      // 5 minute cap, and Temporal refuses a cap below the first interval
      // (the workflow task would fail on every attempt), so the cap rises
      // to meet it.
      maximumInterval: Math.max(policy.maximumIntervalMs, policy.initialIntervalMs),
      maximumAttempts: policy.maximumAttempts,
      nonRetryableErrorTypes: NON_RETRYABLE_AUTOMATION_FAILURES,
    },
  };
}

/**
 * The bookkeeping activities (`loadRunPlan`, `recordSkipped`, `finishRun`,
 * ...): database reads and writes, retried generously so a blip in Postgres
 * never fails a run, but never retrying a failure the activity called final.
 */
export const BOOKKEEPING_ACTIVITY_OPTIONS: ActivityOptions = {
  startToCloseTimeout: '1 minute',
  retry: {
    initialInterval: '5 seconds',
    backoffCoefficient: 2,
    maximumInterval: '5 minutes',
    maximumAttempts: 10,
    nonRetryableErrorTypes: NON_RETRYABLE_AUTOMATION_FAILURES,
  },
};

/** What the workflow tells `settleStepFailure` about a step's last failure. */
export interface StepFailure {
  /** One of `AUTOMATION_FAILURE_TYPES`; null for a timeout or an unexpected error. */
  failureType: string | null;
  /** The one sentence the user sees. */
  message: string;
  timedOut: boolean;
  /** Not connected or out of credits: the run stops, whatever On Error says. */
  stopsRun: boolean;
}

export const STEP_TIMED_OUT_MESSAGE = 'This step took too long and was stopped.';
export const STEP_UNEXPECTED_MESSAGE = 'This step stopped because of an unexpected error.';

const KNOWN_FAILURE_TYPES: readonly string[] = Object.values(AUTOMATION_FAILURE_TYPES);

/**
 * Reads what Temporal hands back after a step's last attempt: an
 * `ActivityFailure` whose cause is the `ApplicationFailure` the activity
 * threw, or a `TimeoutFailure` when the attempt ran out of time. Anything
 * the activity did not type (a bug) gets a plain sentence; its details are
 * in the worker log and the step row the activity wrote.
 */
export function classifyStepFailure(error: unknown): StepFailure {
  const cause = error instanceof ActivityFailure ? error.cause : error;

  if (cause instanceof TimeoutFailure) {
    return {
      failureType: null,
      message: STEP_TIMED_OUT_MESSAGE,
      timedOut: true,
      stopsRun: false,
    };
  }

  if (
    cause instanceof ApplicationFailure &&
    cause.type &&
    KNOWN_FAILURE_TYPES.includes(cause.type)
  ) {
    return {
      failureType: cause.type,
      message: cause.message || STEP_UNEXPECTED_MESSAGE,
      timedOut: false,
      stopsRun: RUN_STOPPING_AUTOMATION_FAILURES.includes(cause.type),
    };
  }

  return { failureType: null, message: STEP_UNEXPECTED_MESSAGE, timedOut: false, stopsRun: false };
}
