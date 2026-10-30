/**
 * Sprint 10: the contract between the API and the worker for workflow runs.
 *
 * The UI says "workflow"; the code says "automation", because Temporal
 * already owns the word "workflow" here. One Temporal workflow per
 * `AutomationRun` row, keyed on the row id: the API writes the row first,
 * then starts `automationRunWorkflow`, so the maintenance reconcile can
 * start any run whose start was lost.
 *
 * Pure, like the rest of this package: the run workflow imports it inside
 * Temporal's sandbox.
 */
import type { RetryPolicyValues } from './retry-policy';

export const AUTOMATION_RUN_WORKFLOW = 'automationRunWorkflow';

export function automationRunWorkflowId(runId: string): string {
  return `automation-run:${runId}`;
}

/**
 * Answers a waiting Manual Review. The API records the decision on the step
 * row first, then signals; the workflow only learns which port to follow.
 * Cancelling a run reuses `CANCEL_SIGNAL` from `workflows.ts`.
 */
export const REVIEW_DECISION_SIGNAL = 'reviewDecision';

export type ReviewDecision = 'approved' | 'rejected';

export interface ReviewDecisionPayload {
  nodeKey: string;
  decision: ReviewDecision;
}

export interface AutomationRunInput {
  runId: string;
  organizationId: string;
}

/**
 * Module 09: a run started by a Temporal Schedule. A schedule cannot know a
 * run row in advance, so the workflow creates its own row first, keyed on
 * `scheduleTriggerEventId(automationId, scheduledAt)`: a retried start
 * creates nothing new. The row stores the Temporal workflow id
 * (`AutomationRun.temporalWorkflowId`) so Cancel can find it.
 */
export interface AutomationScheduledRunInput {
  scheduled: { automationId: string; versionId: string };
  organizationId: string;
}

export type AutomationRunWorkflowInput = AutomationRunInput | AutomationScheduledRunInput;

export function isScheduledRunInput(
  input: AutomationRunWorkflowInput,
): input is AutomationScheduledRunInput {
  return 'scheduled' in input && input.scheduled !== undefined;
}

/** The Temporal Schedule of a workflow whose trigger is Schedule: one per workflow. */
export function automationScheduleId(automationId: string): string {
  return `automation-schedule:${automationId}`;
}

/** The workflow id a schedule gives its runs; Temporal appends the scheduled time. */
export function automationScheduledWorkflowIdPrefix(automationId: string): string {
  return `automation-scheduled:${automationId}`;
}

/**
 * Never two scheduled runs of one workflow at once (`SKIP`), and a one minute
 * catch-up window: a short worker outage loses no run, but nothing piles up.
 * Pausing deletes the schedule, so a paused workflow never catches up.
 */
export const AUTOMATION_SCHEDULE_POLICIES = {
  overlap: 'SKIP',
  catchupWindowMs: 60_000,
} as const;

/**
 * `AutomationRun.triggerEventId`, unique per workflow, so a replayed publish
 * activity or a retried schedule start inserts no second run.
 * - Post Published: the chain's root row publishes once; a repeat spawns new roots.
 * - Post Failed: the publish workflow's Temporal run id, stable across retries of
 *   the failing activity and new when the post is queued again (never a timestamp).
 * - Schedule: the scheduled start time, not the actual one.
 */
export function postPublishedTriggerEventId(rootPostId: string): string {
  return `post.published:${rootPostId}`;
}

export function postFailedTriggerEventId(rootPostId: string, publishRunId: string): string {
  return `post.failed:${rootPostId}:${publishRunId}`;
}

export function scheduleTriggerEventId(automationId: string, scheduledAtIso: string): string {
  return `schedule:${automationId}:${scheduledAtIso}`;
}

/** Notification `type` values workflows write (the API's catalogue lists them). */
export const AUTOMATION_NOTIFICATION_TYPES = {
  /** An In-App Notification step. */
  message: 'automation',
  /** A Manual Review is waiting. */
  review: 'automation.review',
  /** A live run failed (grouped: at most one an hour per workflow). */
  failed: 'automation.failed',
  /** The workflow was paused after too many failed runs in a row. */
  paused: 'automation.paused',
} as const;

/** Finished runs older than this are pruned with their steps. */
export const AUTOMATION_RUN_RETENTION_DAYS = 30;

/** Live runs failing in a row before the worker pauses the workflow. */
export const AUTOMATION_AUTO_PAUSE_AFTER_FAILURES = 5;

/** One failure alert per workflow per window; later failures are counted into the next. */
export const AUTOMATION_FAILURE_ALERT_WINDOW_MS = 60 * 60_000;

/** How a run ended. `rejected` and `expired` are outcomes, not failures. */
export type AutomationRunOutcome = 'succeeded' | 'failed' | 'rejected' | 'cancelled' | 'expired';

/**
 * What a test run covers, stored on `AutomationRun.options` by the API and
 * read by the worker. A whole-workflow test runs from the trigger; a step
 * test runs one step, its upstream data taken from `AutomationRun.seedOutputs`
 * (`{ [nodeKey]: output }`, the trigger's under its own key).
 */
export type AutomationRunScope = { kind: 'run' } | { kind: 'step'; nodeKey: string };

/** Where a test run's trigger data came from. */
export type AutomationTriggerData = 'last' | 'sample' | 'pinned';

export interface AutomationRunOptions {
  scope: AutomationRunScope;
  /** Steps with an outside effect that a test sends for real (the user said so per step). */
  sendForReal: string[];
  triggerData: AutomationTriggerData;
  /** Set on a Retry From Here run (Module 08), live or test. */
  retry?: AutomationRetryOptions;
}

/**
 * Retry From Here (Module 08): a new run of the same version and trigger
 * payload. Every step that finished before `fromNodeKey` is seeded as
 * finished, its output in `AutomationRun.seedOutputs` and the ports it fired
 * here, and is never run again; the interpreter carries on from there. A
 * live run's retry is live too (`triggerData` is then `'last'`).
 */
export interface AutomationRetryOptions {
  /** The run being retried. */
  of: string;
  fromNodeKey: string;
  /** Seeded step key to the output ports it fired (`AutomationRunStep.ports`). */
  ports: Record<string, string[]>;
}

/**
 * `ApplicationFailure.type` values a step throws. Only `retryable` is
 * retried by Temporal; the rest are final at once. `notConnected` and
 * `outOfCredits` also stop the run whatever the step's On Error says: there
 * is no sensible way to carry on without a connection or credits.
 */
export const AUTOMATION_FAILURE_TYPES = {
  /** Network, 429, 5xx, timeouts. */
  retryable: 'AutomationRetryable',
  /** 4xx, validation, bad data: retrying would not change it. */
  permanent: 'AutomationPermanent',
  /** A missing or broken connection. */
  notConnected: 'AutomationNotConnected',
  /** The workspace ran out of AI credits (Module 11). */
  outOfCredits: 'AutomationOutOfCredits',
  /** The run used up its step budget. */
  limit: 'AutomationLimit',
} as const;

export type AutomationFailureType =
  (typeof AUTOMATION_FAILURE_TYPES)[keyof typeof AUTOMATION_FAILURE_TYPES];

export const NON_RETRYABLE_AUTOMATION_FAILURES: string[] = [
  AUTOMATION_FAILURE_TYPES.permanent,
  AUTOMATION_FAILURE_TYPES.notConnected,
  AUTOMATION_FAILURE_TYPES.outOfCredits,
  AUTOMATION_FAILURE_TYPES.limit,
];

/** Failures that ignore On Error continue and branch and always stop the run. */
export const RUN_STOPPING_AUTOMATION_FAILURES: string[] = [
  AUTOMATION_FAILURE_TYPES.notConnected,
  AUTOMATION_FAILURE_TYPES.outOfCredits,
];

/**
 * Retries of transient errors, before a step's own On Error retries: 5 s,
 * 15 s, 45 s between four attempts, about a minute end to end.
 */
export const AUTOMATION_STEP_RETRY_POLICY: RetryPolicyValues = {
  initialIntervalMs: 5_000,
  backoffCoefficient: 3,
  maximumIntervalMs: 5 * 60_000,
  maximumAttempts: 4,
};

/**
 * How long one attempt of a step may take, by the definition's
 * `timeoutClass`. Slow steps (AI, Render Design) heartbeat while they wait
 * on a model, so a dead worker is noticed in 30 s, not 5 minutes.
 */
export const AUTOMATION_STEP_TIMEOUTS = {
  fast: { startToCloseMs: 30_000 },
  slow: { startToCloseMs: 5 * 60_000, heartbeatMs: 30_000 },
} as const;

export type AutomationTimeoutClass = keyof typeof AUTOMATION_STEP_TIMEOUTS;

/** A step's own retries from its On Error setting (`onError.retries`). */
export interface StepOwnRetries {
  max: number;
  waitSeconds: number;
}

/**
 * The Temporal retry policy for one step, from its definition's `retry`
 * class and its own On Error retries.
 *
 * - `none`, no own retries: one attempt.
 * - `none` with own retries: `1 + max` attempts, `waitSeconds` apart.
 * - `transient` or `safe`: `AUTOMATION_STEP_RETRY_POLICY`; own retries add
 *   `max` attempts and their wait replaces the first interval.
 *
 * Own retries never retry a final failure (permanent, not connected, out of
 * credits, limit): "retries come on top of the automatic retries of
 * transient errors".
 */
export function automationStepRetryPolicy(
  retry: 'none' | 'transient' | 'safe',
  own?: StepOwnRetries | null,
): RetryPolicyValues {
  const extra = own ? Math.max(0, Math.min(5, Math.floor(own.max))) : 0;
  const waitMs = own ? Math.max(1, own.waitSeconds) * 1000 : null;

  if (retry === 'none') {
    const interval = waitMs ?? AUTOMATION_STEP_RETRY_POLICY.initialIntervalMs;
    return {
      initialIntervalMs: interval,
      backoffCoefficient: 1,
      maximumIntervalMs: interval,
      maximumAttempts: 1 + extra,
    };
  }

  const initialIntervalMs = waitMs ?? AUTOMATION_STEP_RETRY_POLICY.initialIntervalMs;
  return {
    ...AUTOMATION_STEP_RETRY_POLICY,
    initialIntervalMs,
    // Temporal refuses a first interval above the cap (a 10 minute own wait).
    maximumIntervalMs: Math.max(AUTOMATION_STEP_RETRY_POLICY.maximumIntervalMs, initialIntervalMs),
    maximumAttempts: AUTOMATION_STEP_RETRY_POLICY.maximumAttempts + extra,
  };
}

/** How long a live run waits before asking again for a workspace run slot. */
export const AUTOMATION_SLOT_RETRY_MS = 30_000;

/** `AutomationRunStep.error`: one sentence for the user, the rest for support. */
export interface AutomationStepError {
  message: string;
  /** A short machine code: `permanent`, `not_connected`, `timeout`, `missing_data`, ... */
  code: string;
  retryable: boolean;
  details?: unknown;
}

/** What a dry run stores as the step's output (status `DRY_RUN`). */
export interface AutomationDryRunOutput {
  dryRun: true;
  /** Plain words, redacted: "Slack message to Marketing Slack: 'New post on ...'". */
  wouldSend: string;
}

/** Why a step was recorded as skipped; stored as the skipped row's output `{ skipped }`. */
export type AutomationSkipReason = 'branchNotTaken' | 'upstreamFailed' | 'off';

/** A Manual Review step's output once answered (the API writes it before signalling). */
export interface AutomationReviewOutput {
  decision: ReviewDecision;
  decidedById: string;
  decidedAt: string;
  /** The reviewer's name, the catalog's `reviewedBy` output (Module 08). */
  reviewedBy?: string;
  /** Rejections only: the reviewer's reason, the catalog's `reason` output (Module 08). */
  reason?: string;
  /** P1: the reviewer's edited text. */
  editedText?: string;
}
