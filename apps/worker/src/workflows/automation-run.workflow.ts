/**
 * Runs one workflow run (Sprint 10, Module 07): one Temporal workflow per
 * `AutomationRun` row, started by the API (or the maintenance reconcile)
 * after the row is written.
 *
 * ## A deterministic interpreter
 *
 * The graph is the program. `planNext` from `@postgear/automation` (pure,
 * safe in this sandbox) says which steps are ready, which will never run
 * and when the run is over; this file starts the ready steps, feeds their
 * results back in and repeats. The only state kept here is per step
 * `{ status, ports }`: outputs stay in `AutomationRunStep` rows, read and
 * written by the activities, so a 50-step run keeps a short history.
 *
 * ## Steps as lanes
 *
 * Each started step is its own lane (a promise the loop does not await), so
 * branches run side by side. At most `LIMITS.maxParallelBranches`
 * `executeNodeActivity` calls are in flight at once; Delay and Manual Review
 * wait in the workflow itself (a durable timer, a signal) and take no slot.
 * A started step is marked `running` at once, so `planNext` never returns it
 * twice.
 *
 * ## Stopping early
 *
 * - Cancel (`CANCEL_SIGNAL`) and an expired review cancel every lane's work
 *   (activities, timers, waits) through one `CancellationScope`, start
 *   nothing new, then finish the run (`cancelled` or `expired`) in a
 *   non-cancellable scope. Late activities cannot overwrite the result: step
 *   rows only leave RUNNING, QUEUED or WAITING by a conditional write.
 * - A halt (not connected or out of credits, or the 200-step budget) starts
 *   nothing new and ends any Delay or Review wait, lets running activities
 *   finish, then fails the run.
 * - A plain failure with On Error `stop` only ends its branch; `planNext`
 *   skips what depends on it and the other branches finish.
 *
 * ## Scheduled runs and retries (Modules 08 and 09)
 *
 * - A Temporal Schedule starts this workflow with `{ scheduled }` instead of
 *   a run id: `startScheduledRun` creates the run row first (once per
 *   scheduled time, read from the `TemporalScheduledStartTime` search
 *   attribute), then the run goes on as any other. A workflow that is no
 *   longer on, or on another version, ends without a run.
 * - A Retry From Here run starts with its seeded steps already finished
 *   (`plan.seeded`, with the ports they fired): they never run again, and
 *   the interpreter carries on from the retried step.
 *
 * ## Versioning
 *
 * Runs wait up to 30 days. A change that would make an asleep run take a
 * different path on replay ships as a new named workflow (or behind
 * `patched`), never as an edit here; the replay test catches accidents.
 */
import {
  buildIndex,
  type GraphNode,
  getDefinition,
  LIMITS,
  type NodeDefinition,
  type PlanOutcome,
  type PlanResult,
  type PlanStepState,
  planNext,
} from '@postgear/automation';
import {
  AUTOMATION_SLOT_RETRY_MS,
  type AutomationRunOutcome,
  type AutomationRunWorkflowInput,
  type AutomationSkipReason,
  CANCEL_SIGNAL,
  isScheduledRunInput,
  REVIEW_DECISION_SIGNAL,
  type ReviewDecision,
  type ReviewDecisionPayload,
} from '@postgear/scheduling';
import { defineSearchAttributeKey, SearchAttributeType } from '@temporalio/common';
import {
  ActivityFailure,
  CancellationScope,
  condition,
  defineSignal,
  isCancellation,
  proxyActivities,
  setHandler,
  type WorkflowInfo,
  workflowInfo,
} from '@temporalio/workflow';
import type { AutomationActivities, RunRef, StepRef } from '../automation/activity-contract';
import {
  BOOKKEEPING_ACTIVITY_OPTIONS,
  classifyStepFailure,
  stepActivityOptions,
} from './automation-run.options';

export const automationCancelSignal = defineSignal(CANCEL_SIGNAL);
export const reviewDecisionSignal = defineSignal<[ReviewDecisionPayload]>(REVIEW_DECISION_SIGNAL);

export const STEP_LIMIT_MESSAGE = `This run used more than ${LIMITS.maxStepExecutionsPerRun} steps.`;
export const REVIEW_EXPIRED_MESSAGE = `No one answered the review within ${LIMITS.reviewTimeoutDays} days.`;
export const STEP_MISSING_MESSAGE = 'This step is no longer in the workflow.';

const {
  startScheduledRun,
  loadRunPlan,
  claimRunSlot,
  recordSkipped,
  settleStepFailure,
  prepareDelay,
  openReview,
  closeReview,
  completeStep,
  finishRun,
} = proxyActivities<AutomationActivities>(BOOKKEEPING_ACTIVITY_OPTIONS);

export type AutomationRunResult = { outcome: AutomationRunOutcome | 'skipped' };

/** Set by Temporal on every workflow a Schedule starts: the time it was meant to start. */
const SCHEDULED_START_TIME = defineSearchAttributeKey(
  'TemporalScheduledStartTime',
  SearchAttributeType.DATETIME,
);

/**
 * When a scheduled run was meant to start (ISO): the search attribute the
 * Schedule sets, else the workflow's own start time. A late or retried start
 * keeps the scheduled time, so its run row is the same one.
 */
export function scheduledStartIso(info: WorkflowInfo): string {
  let at: Date | undefined;
  try {
    at = info.typedSearchAttributes.get(SCHEDULED_START_TIME);
  } catch {
    at = undefined;
  }
  return (at instanceof Date && !Number.isNaN(at.getTime()) ? at : info.startTime).toISOString();
}

/** Why a run stops early, other than the cancel signal. */
interface StopState {
  /** A Manual Review waited `reviewTimeoutDays` without an answer. */
  expired: boolean;
  /** No new steps, waits end, running activities finish, the run fails. */
  halt: { error?: string } | null;
  /** A lane hit something it cannot settle (bookkeeping gave up, or a bug). */
  fatal: { error: unknown } | null;
}

export async function automationRunWorkflow(
  input: AutomationRunWorkflowInput,
): Promise<AutomationRunResult> {
  let cancelled = false;
  const decisions = new Map<string, ReviewDecision>();
  let reviewKeys: ReadonlySet<string> | null = null;

  setHandler(automationCancelSignal, () => {
    cancelled = true;
  });
  // The API checks the step is WAITING and records the decision before it
  // signals; here a decision only picks the port. A second answer, or one
  // for a step that is not a Manual Review of this run, changes nothing.
  setHandler(reviewDecisionSignal, (payload) => {
    if (!reviewKeys?.has(payload.nodeKey) || decisions.has(payload.nodeKey)) return;
    if (payload.decision !== 'approved' && payload.decision !== 'rejected') return;
    decisions.set(payload.nodeKey, payload.decision);
  });

  // A Schedule's start: the run row is made here, once per scheduled time.
  let run: RunRef;
  if (isScheduledRunInput(input)) {
    const info = workflowInfo();
    const started = await startScheduledRun({
      organizationId: input.organizationId,
      automationId: input.scheduled.automationId,
      versionId: input.scheduled.versionId,
      workflowId: info.workflowId,
      scheduledAt: scheduledStartIso(info),
    });
    if ('skip' in started) return { outcome: 'skipped' };
    run = { runId: started.runId, organizationId: input.organizationId };
  } else {
    run = { runId: input.runId, organizationId: input.organizationId };
  }

  let stepCount = 0;

  async function finish(
    outcome: AutomationRunOutcome,
    error?: string,
  ): Promise<{ outcome: AutomationRunOutcome }> {
    await CancellationScope.nonCancellable(() =>
      finishRun({ ...run, outcome, stepCount, ...(error ? { error } : {}) }),
    );
    return { outcome };
  }

  try {
    const plan = await loadRunPlan(run);
    if (plan.skip) return { outcome: 'skipped' };

    const index = buildIndex(plan.graph);
    const definitionOf = (node: GraphNode): NodeDefinition | undefined =>
      getDefinition(node.type, node.typeVersion);
    reviewKeys = new Set(
      [...index.nodes.values()]
        .filter((node) => definitionOf(node)?.blocking === 'review')
        .map((node) => node.key),
    );

    // Live runs wait their turn: at most `maxConcurrentRunsPerWorkspace`
    // per workspace. Test runs never wait.
    if (plan.mode === 'live') {
      for (;;) {
        if (cancelled) return await finish('cancelled');
        if (await claimRunSlot(run)) break;
        await condition(() => cancelled, AUTOMATION_SLOT_RETRY_MS);
      }
    }

    const scope = plan.scope;
    const stepTest = scope.kind === 'step';
    if (scope.kind === 'step' && !index.nodes.has(scope.nodeKey)) {
      return await finish('failed', STEP_MISSING_MESSAGE);
    }

    /** Per step: what `planNext` needs, nothing more. */
    const state: Record<string, PlanStepState> = {};

    // Retry From Here: seeded steps start finished and never run again.
    if (scope.kind === 'run' && plan.seeded) {
      for (const [key, seeded] of Object.entries(plan.seeded)) {
        if (index.nodes.has(key)) state[key] = { status: seeded.status, ports: [...seeded.ports] };
      }
    }

    /**
     * A step test runs its one step; its upstream data was seeded on the
     * run by the API. Same shape as `planNext`, so the loop is shared.
     */
    const planFor = (): PlanResult => {
      if (scope.kind === 'run') return planNext(index, state);
      const step = state[scope.nodeKey];
      const none = { skipped: [], bypassed: [] };
      if (!step) return { ...none, ready: [scope.nodeKey], finished: false };
      if (step.status === 'running') return { ...none, ready: [], finished: false };
      return {
        ...none,
        ready: [],
        finished: true,
        outcome: step.status === 'failed' ? 'failed' : 'succeeded',
      };
    };

    const stop: StopState = { expired: false, halt: null, fatal: null };
    const cancelRequested = () => cancelled || stop.expired;
    const stopRequested = () => cancelRequested() || stop.halt !== null || stop.fatal !== null;

    // Every lane's work runs in this scope; cancelling it cancels running
    // activities, Delay timers and Review waits together.
    const stepScope = new CancellationScope();
    let scopeCancelled = false;

    const queue: string[] = [];
    let lanes = 0;
    let executing = 0;
    let changes = 0;
    let planOutcome: PlanOutcome | undefined;

    const isBlocking = (key: string): boolean => {
      const node = index.nodes.get(key);
      return Boolean(node && definitionOf(node)?.blocking);
    };

    /** Applies On Error after a step's last attempt failed; returns its new state. */
    async function settle(
      ref: StepRef,
      node: GraphNode,
      def: NodeDefinition | undefined,
      error: ActivityFailure,
    ): Promise<PlanStepState> {
      const failure = classifyStepFailure(error);
      const mode =
        failure.stopsRun || !def?.canHandleErrors ? 'stop' : (node.onError?.mode ?? 'stop');
      // Set before the write, so no other branch starts a step meanwhile.
      if (failure.stopsRun && !stop.halt) stop.halt = {};

      const { attempts } = await settleStepFailure({
        ...ref,
        mode,
        failureType: failure.failureType,
        message: failure.message,
        timedOut: failure.timedOut,
      });
      stepCount += Math.max(1, attempts);

      if (mode === 'stop') return { status: 'failed' };
      return { status: 'handled', ports: [mode === 'branch' ? 'error' : 'out'] };
    }

    /** One step's work; null when it was stopped before it finished. */
    async function work(
      ref: StepRef,
      node: GraphNode,
      def: NodeDefinition | undefined,
    ): Promise<PlanStepState | null> {
      if (def?.blocking === 'delay') {
        const { waitMs } = await prepareDelay(ref);
        stepCount += 1;
        // A step test writes the row as done and never waits.
        if (stepTest) return { status: 'succeeded', ports: ['out'] };
        if (waitMs > 0 && (await condition(stopRequested, waitMs))) return null;
        await completeStep(ref);
        return { status: 'succeeded', ports: ['out'] };
      }

      if (def?.blocking === 'review') {
        const { waiting } = await openReview(ref);
        stepCount += 1;
        // A step test shows the review without waiting (a DRY_RUN row).
        if (stepTest || !waiting) return { status: 'succeeded', ports: ['approved'] };

        const answered = await condition(
          () => decisions.has(ref.nodeKey) || stopRequested(),
          `${LIMITS.reviewTimeoutDays} days`,
        );
        const decision = decisions.get(ref.nodeKey);
        if (!decision) {
          if (!answered) stop.expired = true;
          return null;
        }
        const { ports } = await closeReview({ ...ref, decision });
        return { status: 'succeeded', ports: [...ports] };
      }

      const { executeNodeActivity } = proxyActivities<AutomationActivities>(
        stepActivityOptions(def, node),
      );
      const result = await executeNodeActivity(ref);
      stepCount += Math.max(1, result.attempt);
      return {
        status: result.status === 'handledError' ? 'handled' : 'succeeded',
        ports: [...result.ports],
      };
    }

    async function runStep(key: string): Promise<void> {
      const node = index.nodes.get(key);
      if (!node) return;
      const def = definitionOf(node);
      const ref: StepRef = { ...run, nodeKey: key };

      let next: PlanStepState | null;
      try {
        next = await work(ref, node, def);
      } catch (error) {
        // A cancelled lane just ends; a failed activity is the step failing.
        if (isCancellation(error) || !(error instanceof ActivityFailure)) throw error;
        next = await settle(ref, node, def, error);
      }
      if (next) state[key] = next;
    }

    function startLane(key: string): void {
      const holdsSlot = !isBlocking(key);
      lanes += 1;
      if (holdsSlot) executing += 1;

      stepScope
        .run(() => runStep(key))
        .then(
          () => undefined,
          (error: unknown) => {
            if (!isCancellation(error) && !stop.fatal) stop.fatal = { error };
          },
        )
        .finally(() => {
          lanes -= 1;
          if (holdsSlot) executing -= 1;
          changes += 1;
        });
    }

    /** Starts queued steps, in run order, while slots and the budget allow. */
    function startQueued(): void {
      let i = 0;
      while (i < queue.length && !stopRequested()) {
        const key = queue[i];
        if (!isBlocking(key) && executing >= LIMITS.maxParallelBranches) {
          i += 1;
          continue;
        }
        if (stepCount >= LIMITS.maxStepExecutionsPerRun) {
          stop.halt = { error: STEP_LIMIT_MESSAGE };
          return;
        }
        queue.splice(i, 1);
        startLane(key);
      }
    }

    for (;;) {
      if (cancelRequested() && !scopeCancelled) {
        scopeCancelled = true;
        stepScope.cancel();
      }

      if (!stopRequested()) {
        const next = planFor();
        const steps: { nodeKey: string; reason: AutomationSkipReason }[] = [
          ...next.skipped.map((skip) => ({ nodeKey: skip.key, reason: skip.reason })),
          ...next.bypassed.map((key) => ({ nodeKey: key, reason: 'off' as const })),
        ];
        if (steps.length > 0) {
          await recordSkipped({ ...run, steps });
          for (const skip of next.skipped) state[skip.key] = { status: 'skipped' };
          for (const key of next.bypassed) state[key] = { status: 'off' };
          // Lanes may have finished during the write, so this plan's
          // `finished` is stale: plan again with what is known now.
          continue;
        }
        for (const key of next.ready) {
          state[key] = { status: 'running' };
          queue.push(key);
        }
        if (next.finished) {
          planOutcome = next.outcome;
          break;
        }
      }

      startQueued();

      if (lanes === 0) {
        if (stopRequested()) break;
        // planNext says a step is running, yet no lane runs it.
        throw new Error('automationRunWorkflow: the plan is not finished but nothing is running');
      }

      const seen = changes;
      await condition(() => changes !== seen || (cancelRequested() && !scopeCancelled));
    }

    if (cancelled) return await finish('cancelled');
    if (stop.expired) return await finish('expired', REVIEW_EXPIRED_MESSAGE);
    if (stop.fatal) throw stop.fatal.error;
    if (stop.halt) return await finish('failed', stop.halt.error);
    return await finish(planOutcome ?? 'succeeded');
  } catch (error) {
    // The workflow itself was cancelled through Temporal (the UI, a script)
    // rather than by the signal: still leave the run row truthful.
    if (isCancellation(error)) {
      await finish('cancelled');
    }
    throw error;
  }
}
