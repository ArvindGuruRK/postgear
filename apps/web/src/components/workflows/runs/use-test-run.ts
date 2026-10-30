'use client';

/**
 * The builder's test runs (Module 08, blueprint 7): Test Workflow, Test
 * Step, Stop, the paint on the canvas, and each step's latest result for
 * the Test tab and the Output and Input panes.
 *
 * - **One test at a time** per builder: while one runs, Test Workflow and
 *   Test Step wait (the buttons say so) and Ctrl/Cmd+Enter does nothing.
 * - **Saved first**: a test runs the saved draft, so pending edits are sent
 *   (`flush`) before the request; a draft that cannot be saved does not
 *   start a test.
 * - **Send For Real In Tests** is a set of step keys kept in this hook's
 *   memory only: it starts empty and is gone when the page closes (safe by
 *   default). It goes with each test request, without steps since deleted.
 * - **Paint**: the canvas shows the latest test until Close or an edit to
 *   the steps or lines (`unpaint`); the results stay for the panes.
 * - **The last test** (`lastTest`): each step's newest finished result,
 *   across the tests of this page and, on opening, the latest stored ones.
 *
 * Refusals: 429 reads "Too many test runs. Try again in a minute.", 422
 * `test_blocked` shows its message and asks the page to open the issues.
 */
import type { AutomationGraph } from '@postgear/automation';
import { toast } from '@postgear/ui';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import {
  cancelRun,
  getRun,
  listRuns,
  startStepTest,
  startTestRun,
  type TestRunRequest,
} from '@/lib/workflows-api';
import type { AutomationStepStatus, RunSummary } from '@/types/workflows';
import type { StepRunResult } from '../panel/panel-view-model';
import { buildRunModel, isTerminalRun, type RunModel } from './run-model';
import { useRunStream } from './use-run-stream';

export const TOO_MANY_TESTS = 'Too many test runs. Try again in a minute.';
export const TEST_NOT_STARTED = 'The test did not start. Check your connection and try again.';
export const TEST_NOT_SAVED =
  'Your latest changes are not saved yet, so the test did not start. Try again in a moment.';
export const STOP_FAILED = 'The test was not stopped. Try again.';

export type TriggerDataChoice = NonNullable<TestRunRequest['triggerData']>;

export interface StartTestOptions {
  triggerData?: TriggerDataChoice;
  /** A Manual trigger's fields. */
  inputs?: Record<string, unknown>;
}

/** Why a test did not start, in words; `blocked` asks for the issues list. */
export function testRefusal(cause: unknown): { message: string; blocked: boolean } {
  if (cause instanceof ApiError) {
    if (cause.status === 429) return { message: TOO_MANY_TESTS, blocked: false };
    if (cause.status === 422 && cause.code === 'test_blocked')
      return { message: cause.message, blocked: true };
    if (cause.status !== 0 && cause.message) return { message: cause.message, blocked: false };
  }
  return { message: TEST_NOT_STARTED, blocked: false };
}

/** Rows that are a result: finished, and not just passed over. */
const RESULT_STATUSES: ReadonlySet<AutomationStepStatus> = new Set([
  'SUCCEEDED',
  'DRY_RUN',
  'HANDLED_ERROR',
  'FAILED',
]);

const IN_PROGRESS: ReadonlySet<AutomationStepStatus> = new Set(['QUEUED', 'RUNNING', 'WAITING']);

function resultOf(model: RunModel, key: string): StepRunResult | null {
  const step = model.steps[key];
  if (!step) return null;
  return {
    step,
    runId: model.runId,
    at: step.finishedAt ?? step.updatedAt,
    live: IN_PROGRESS.has(step.status) && !isTerminalRun(model.runStatus),
  };
}

/**
 * Each step's newest result, with a run's finished rows folded in: a
 * newer result wins, so an older run loaded late never hides a newer one.
 * Returns `previous` itself when nothing changed.
 */
export function mergeLastTest(
  previous: Readonly<Record<string, StepRunResult>>,
  model: RunModel,
): Record<string, StepRunResult> {
  let next: Record<string, StepRunResult> | null = null;
  for (const key of Object.keys(model.steps)) {
    const result = resultOf(model, key);
    if (!result || !RESULT_STATUSES.has(result.step.status)) continue;
    const known = (next ?? previous)[key];
    if (known?.runId === model.runId && known.step.updatedAt === result.step.updatedAt) continue;
    if (known && known.runId !== model.runId && known.at > result.at) continue;
    next ??= { ...previous };
    next[key] = { ...result, live: false };
  }
  return next ?? (previous as Record<string, StepRunResult>);
}

/** What a step's Test tab and Output pane show: the running test's row, else its last result. */
export function stepResult(
  key: string,
  model: RunModel | null,
  lastTest: Readonly<Record<string, StepRunResult>>,
): StepRunResult | null {
  return (model ? resultOf(model, key) : null) ?? lastTest[key] ?? null;
}

/** How many stored runs are read on opening, besides the newest whole test. */
const STEP_TESTS_READ = 3;

/** The newest whole test, and the step tests started after it (a few). */
function runsToRead(runs: readonly RunSummary[]): RunSummary[] {
  const whole = runs.findIndex((run) => run.options?.scope.kind !== 'step');
  const newer = (whole === -1 ? runs : runs.slice(0, whole)).slice(0, STEP_TESTS_READ);
  return whole === -1 ? newer : [runs[whole], ...newer];
}

export interface TestRun {
  /** The test this builder started last, until the page closes. */
  runId: string | null;
  /** That test, kept current. */
  model: RunModel | null;
  /** What the canvas paints: the model until Close or a change to the steps or lines. */
  painted: RunModel | null;
  /** A test is starting or going: one at a time. */
  busy: boolean;
  /** The test has not ended (Test Workflow reads Stop). */
  running: boolean;
  stopping: boolean;
  /** The step a running Test Step is for. */
  testingStep: string | null;
  /** The step the latest test was a Test Step for; null for a whole test. */
  stepTestKey: string | null;
  lastTest: Readonly<Record<string, StepRunResult>>;
  liveInTests: ReadonlySet<string>;
  setLiveInTests: (key: string, on: boolean) => void;
  start: (options?: StartTestOptions) => Promise<void>;
  testStep: (key: string) => Promise<void>;
  stop: () => Promise<void>;
  /** Close, or an edit to the steps or lines: the canvas goes back to plain. */
  unpaint: () => void;
  /** Fetch the test again now (after a review answer). */
  refresh: () => void;
}

export function useTestRun({
  automationId,
  flush,
  graph,
  onBlocked,
}: {
  automationId: string;
  /** Saves pending edits; true once the server has everything on screen. */
  flush: () => Promise<boolean>;
  /** The graph now: send-for-real keys of steps deleted since are left out. */
  graph: () => AutomationGraph;
  /** 422 `test_blocked`: its message was shown; the page opens the issues list. */
  onBlocked: (message: string) => void;
}): TestRun {
  const [runId, setRunId] = useState<string | null>(null);
  const [stepKey, setStepKey] = useState<string | null>(null);
  const [startingKey, setStartingKey] = useState<string | null>(null);
  const [painted, setPainted] = useState(false);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [liveInTests, setLive] = useState<ReadonlySet<string>>(() => new Set());
  const [lastTest, setLastTest] = useState<Readonly<Record<string, StepRunResult>>>({});
  const stream = useRunStream(runId);
  const model = stream.model?.runId === runId ? stream.model : null;
  const running =
    runId !== null && (model ? !isTerminalRun(model.runStatus) : stream.error === null);
  const busy = starting || running;

  // Handlers read these through refs, so a double press never starts two tests.
  const busyRef = useRef(busy);
  const liveRef = useRef(liveInTests);
  const blocked = useRef(onBlocked);
  useLayoutEffect(() => {
    busyRef.current = busy;
    liveRef.current = liveInTests;
    blocked.current = onBlocked;
  });

  useEffect(() => {
    if (model) setLastTest((previous) => mergeLastTest(previous, model));
  }, [model]);

  // The latest stored results, so the panes say "Last Test" after a reload too.
  useEffect(() => {
    let live = true;
    listRuns(automationId, { mode: 'TEST' })
      .then((page) =>
        Promise.all(
          runsToRead(page.runs).map((run) =>
            getRun(run.id)
              .then(buildRunModel)
              .catch(() => null),
          ),
        ),
      )
      .then((models) => {
        if (!live) return;
        setLastTest((previous) =>
          models.reduce<Readonly<Record<string, StepRunResult>>>(
            (merged, loaded) => (loaded ? mergeLastTest(merged, loaded) : merged),
            previous,
          ),
        );
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [automationId]);

  const report = useCallback((cause: unknown) => {
    const refusal = testRefusal(cause);
    toast({ title: refusal.message, variant: 'danger' });
    if (refusal.blocked) blocked.current(refusal.message);
  }, []);

  const begin = useCallback(
    async (send: () => Promise<RunSummary>, key: string | null) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setStarting(true);
      setStartingKey(key);
      try {
        if (!(await flush())) {
          toast({ title: TEST_NOT_SAVED, variant: 'danger' });
          return;
        }
        const run = await send();
        setRunId(run.id);
        setStepKey(key);
        setPainted(true);
      } catch (cause) {
        report(cause);
      } finally {
        setStarting(false);
      }
    },
    [flush, report],
  );

  const start = useCallback(
    (options: StartTestOptions = {}) =>
      begin(() => {
        const keys = new Set(graph().nodes.map((node) => node.key));
        const sendForReal = [...liveRef.current].filter((key) => keys.has(key));
        return startTestRun(automationId, {
          ...(sendForReal.length > 0 ? { sendForReal } : {}),
          ...(options.triggerData ? { triggerData: options.triggerData } : {}),
          ...(options.inputs ? { inputs: options.inputs } : {}),
        });
      }, null),
    [begin, graph, automationId],
  );

  const testStep = useCallback(
    (key: string) =>
      begin(
        () =>
          startStepTest(automationId, key, liveRef.current.has(key) ? { sendForReal: true } : {}),
        key,
      ),
    [begin, automationId],
  );

  const refresh = stream.refresh;
  const stop = useCallback(async () => {
    if (!runId) return;
    setStopping(true);
    try {
      await cancelRun(runId);
    } catch (cause) {
      // Ended first: the refresh below shows how.
      if (!(cause instanceof ApiError && cause.status === 409)) {
        toast({
          title: cause instanceof ApiError && cause.status !== 0 ? cause.message : STOP_FAILED,
          variant: 'danger',
        });
      }
    } finally {
      setStopping(false);
      refresh();
    }
  }, [runId, refresh]);

  const setLiveInTests = useCallback((key: string, on: boolean) => {
    setLive((current) => {
      if (current.has(key) === on) return current;
      const next = new Set(current);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);

  const unpaint = useCallback(() => setPainted(false), []);

  return useMemo(
    () => ({
      runId,
      model,
      painted: painted ? model : null,
      busy,
      running,
      stopping,
      testingStep: starting ? startingKey : running ? stepKey : null,
      stepTestKey: stepKey,
      lastTest,
      liveInTests,
      setLiveInTests,
      start,
      testStep,
      stop,
      unpaint,
      refresh,
    }),
    [
      runId,
      model,
      painted,
      busy,
      running,
      stopping,
      starting,
      startingKey,
      stepKey,
      lastTest,
      liveInTests,
      setLiveInTests,
      start,
      testStep,
      stop,
      unpaint,
      refresh,
    ],
  );
}
