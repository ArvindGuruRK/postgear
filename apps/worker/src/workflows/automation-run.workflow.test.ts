/**
 * The run workflow against a time-skipping Temporal test server with its
 * activities mocked: the same harness as the webhook delivery test, with
 * the workflow code bundled once for the whole file.
 *
 * The graphs are real (`automationGraphSchema` parses each one) and the
 * mocks decide each step's result and ports, so what is pinned is the
 * interpreter: branches, skips, the parallel cap, Delay and Manual Review
 * waits, cancel, On Error, retries, the step budget and step tests. The last
 * test replays a recorded history to prove the workflow is deterministic.
 */
import {
  type AutomationGraph,
  automationGraphSchema,
  edgeId,
  GRAPH_SCHEMA_VERSION,
  type GraphEdge,
  type GraphNode,
  getDefinition,
  LIMITS,
  type NodeType,
  type PortId,
} from '@postgear/automation';
import {
  AUTOMATION_FAILURE_TYPES,
  AUTOMATION_SLOT_RETRY_MS,
  AUTOMATION_STEP_RETRY_POLICY,
  type AutomationRunScope,
} from '@postgear/scheduling';
import type { WorkflowHandle } from '@temporalio/client';
import { ApplicationFailure } from '@temporalio/common';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { bundleWorkflowCode, Worker } from '@temporalio/worker';
import type { AutomationActivities, NodeRunResult, StepRef } from '../automation/activity-contract';
import {
  automationCancelSignal,
  automationRunWorkflow,
  REVIEW_EXPIRED_MESSAGE,
  reviewDecisionSignal,
  STEP_LIMIT_MESSAGE,
  STEP_MISSING_MESSAGE,
} from './automation-run.workflow';

jest.setTimeout(180_000);

const input = { runId: 'run-1', organizationId: 'org-1' };
const DAY_MS = 24 * 60 * 60 * 1000;

// Graphs

function step(key: string, type: NodeType, extra: Partial<GraphNode> = {}): GraphNode {
  const def = getDefinition(type);
  if (!def) throw new Error(`No definition for ${type}`);
  return {
    key,
    type,
    typeVersion: def.typeVersion,
    name: key,
    position: { x: 0, y: 0 },
    config: JSON.parse(JSON.stringify(def.defaultConfig)) as Record<string, unknown>,
    ...extra,
  };
}

function line(source: string, target: string, sourcePort: PortId = 'out'): GraphEdge {
  return { id: edgeId(source, sourcePort, target), source, sourcePort, target, targetPort: 'in' };
}

function graphOf(nodes: GraphNode[], edges: GraphEdge[]): AutomationGraph {
  return automationGraphSchema.parse({
    schemaVersion: GRAPH_SCHEMA_VERSION,
    nodes,
    edges,
    notes: [],
  });
}

const trigger = () => step('trigger', 'trigger.manual');

/** Manual, then Manual Review; Approved goes to `publish`, Rejected (optionally) to `revise`. */
function reviewGraph(withRejectedLine: boolean): AutomationGraph {
  return graphOf(
    [
      trigger(),
      step('review', 'logic.manualReview'),
      step('publish', 'notify.inApp'),
      ...(withRejectedLine ? [step('revise', 'logic.setFields')] : []),
    ],
    [
      line('trigger', 'review'),
      line('review', 'publish', 'approved'),
      ...(withRejectedLine ? [line('review', 'revise', 'rejected')] : []),
    ],
  );
}

/**
 * Manual, then `post` (a Slack step, transient retries), then `after`;
 * `other` runs beside it. With `errorBranch`, `alert` hangs off On Error.
 */
function postGraph(post: Partial<GraphNode> = {}, errorBranch = false): AutomationGraph {
  return graphOf(
    [
      trigger(),
      step('post', 'notify.slack', post),
      step('after', 'notify.inApp'),
      step('other', 'logic.setFields'),
      ...(errorBranch ? [step('alert', 'notify.inApp')] : []),
    ],
    [
      line('trigger', 'post'),
      line('post', 'after'),
      line('trigger', 'other'),
      ...(errorBranch ? [line('post', 'alert', 'error')] : []),
    ],
  );
}

// Activities

type Mocks = { [K in keyof AutomationActivities]: jest.Mock };
type StepBehaviour = (input: StepRef, call: number) => Promise<NodeRunResult> | NodeRunResult;

const ok = (ports: PortId[] = ['out'], attempt = 1): NodeRunResult => ({
  status: 'succeeded',
  ports,
  attempt,
});

const failure = (type: string, message: string) =>
  ApplicationFailure.create({
    type,
    message,
    nonRetryable: type !== AUTOMATION_FAILURE_TYPES.retryable,
  });

interface Setup {
  graph: AutomationGraph;
  mode?: 'test' | 'live';
  scope?: AutomationRunScope;
  steps?: Record<string, StepBehaviour>;
  overrides?: Partial<Mocks>;
}

interface Harness {
  activities: Mocks;
  /** Node keys in the order `executeNodeActivity` was called, retries included. */
  executed: string[];
}

function harness({
  graph,
  mode = 'test',
  scope = { kind: 'run' },
  steps = {},
  overrides = {},
}: Setup): Harness {
  const executed: string[] = [];
  const callsOf = (key: string) => executed.filter((k) => k === key).length;

  const activities: Mocks = {
    loadRunPlan: jest.fn(async () => ({ skip: false, graph, mode, scope, sendForReal: [] })),
    claimRunSlot: jest.fn(async () => true),
    recordSkipped: jest.fn(async () => undefined),
    executeNodeActivity: jest.fn(async (ref: StepRef) => {
      executed.push(ref.nodeKey);
      const behaviour = steps[ref.nodeKey];
      return behaviour ? behaviour(ref, callsOf(ref.nodeKey)) : ok();
    }),
    settleStepFailure: jest.fn(async (ref: StepRef) => ({
      attempts: Math.max(1, callsOf(ref.nodeKey)),
    })),
    prepareDelay: jest.fn(async () => ({ waitMs: 60_000 })),
    openReview: jest.fn(async () => ({ waiting: true })),
    closeReview: jest.fn(async (ref: { decision: string }) => ({ ports: [ref.decision] })),
    completeStep: jest.fn(async () => undefined),
    finishRun: jest.fn(async () => undefined),
    ...overrides,
  };

  return { activities, executed };
}

// Temporal

let env: TestWorkflowEnvironment;
let workflowBundle: { code: string };
let seq = 0;

beforeAll(async () => {
  env = await TestWorkflowEnvironment.createTimeSkipping();
  workflowBundle = await bundleWorkflowCode({ workflowsPath: require.resolve('./index') });
});

afterAll(async () => {
  await env?.teardown();
});

/** Starts the workflow on a fresh worker and hands its handle to `drive`. */
async function withRun<T>(
  activities: Mocks,
  drive: (handle: WorkflowHandle<typeof automationRunWorkflow>) => Promise<T>,
): Promise<T> {
  seq += 1;
  const taskQueue = `test-automation-${seq}`;
  const worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue,
    workflowBundle,
    activities,
  });

  return worker.runUntil(async () => {
    const handle = await env.client.workflow.start(automationRunWorkflow, {
      taskQueue,
      workflowId: `automation-run:test-${seq}`,
      args: [input],
    });
    return drive(handle);
  });
}

const runToEnd = (activities: Mocks) => withRun(activities, (handle) => handle.result());

/** Waits in real time for a mock to have been called (the worker runs alongside). */
async function until(check: () => boolean, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('Condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

const realSleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const skippedCalls = (activities: Mocks) =>
  activities.recordSkipped.mock.calls.map(([call]) => call.steps);

const finishedWith = (activities: Mocks) => {
  expect(activities.finishRun).toHaveBeenCalledTimes(1);
  return activities.finishRun.mock.calls[0][0];
};

describe('automationRunWorkflow: branches', () => {
  it('runs a straight line in order and finishes succeeded', async () => {
    const graph = graphOf(
      [trigger(), step('fields', 'logic.setFields'), step('notify', 'notify.inApp')],
      [line('trigger', 'fields'), line('fields', 'notify')],
    );
    const { activities, executed } = harness({ graph });

    await expect(runToEnd(activities)).resolves.toEqual({ outcome: 'succeeded' });

    expect(executed).toEqual(['trigger', 'fields', 'notify']);
    expect(activities.executeNodeActivity).toHaveBeenCalledWith({ ...input, nodeKey: 'fields' });
    expect(activities.recordSkipped).not.toHaveBeenCalled();
    // Test runs never wait for a workspace slot.
    expect(activities.claimRunSlot).not.toHaveBeenCalled();
    expect(activities.finishRun).toHaveBeenCalledWith({
      ...input,
      outcome: 'succeeded',
      stepCount: 3,
    });
  });

  it('ends at once when the run is already finished (a duplicate start)', async () => {
    const { activities } = harness({
      graph: graphOf([trigger()], []),
      overrides: { loadRunPlan: jest.fn(async () => ({ skip: true, reason: 'finished' })) },
    });

    await expect(runToEnd(activities)).resolves.toEqual({ outcome: 'skipped' });
    expect(activities.executeNodeActivity).not.toHaveBeenCalled();
    expect(activities.finishRun).not.toHaveBeenCalled();
  });

  it('follows If / Else to the false side and records the true side skipped', async () => {
    const graph = graphOf(
      [
        trigger(),
        step('check', 'logic.ifElse'),
        step('yesStep', 'notify.inApp'),
        step('noStep', 'logic.setFields'),
      ],
      [
        line('trigger', 'check'),
        line('check', 'yesStep', 'true'),
        line('check', 'noStep', 'false'),
      ],
    );
    const { activities, executed } = harness({ graph, steps: { check: () => ok(['false']) } });

    await expect(runToEnd(activities)).resolves.toEqual({ outcome: 'succeeded' });

    expect(executed).toEqual(['trigger', 'check', 'noStep']);
    expect(activities.recordSkipped).toHaveBeenCalledTimes(1);
    expect(activities.recordSkipped).toHaveBeenCalledWith({
      ...input,
      steps: [{ nodeKey: 'yesStep', reason: 'branchNotTaken' }],
    });
    expect(finishedWith(activities)).toMatchObject({ outcome: 'succeeded', stepCount: 3 });
  });

  it('records a turned-off step as off and runs what follows it', async () => {
    const graph = graphOf(
      [
        trigger(),
        step('quiet', 'logic.setFields', { disabled: true }),
        step('after', 'notify.inApp'),
      ],
      [line('trigger', 'quiet'), line('quiet', 'after')],
    );
    const { activities, executed } = harness({ graph });

    await expect(runToEnd(activities)).resolves.toEqual({ outcome: 'succeeded' });

    expect(executed).toEqual(['trigger', 'after']);
    expect(skippedCalls(activities)).toEqual([[{ nodeKey: 'quiet', reason: 'off' }]]);
  });

  it('sends Paths to Otherwise and skips every case', async () => {
    const graph = graphOf(
      [
        trigger(),
        step('route', 'logic.switch'),
        step('pathA', 'notify.inApp'),
        step('pathB', 'notify.inApp'),
        step('other', 'logic.setFields'),
      ],
      [
        line('trigger', 'route'),
        line('route', 'pathA', 'case:a'),
        line('route', 'pathB', 'case:b'),
        line('route', 'other', 'fallback'),
      ],
    );
    const { activities, executed } = harness({ graph, steps: { route: () => ok(['fallback']) } });

    await expect(runToEnd(activities)).resolves.toEqual({ outcome: 'succeeded' });

    expect(executed).toEqual(['trigger', 'route', 'other']);
    expect(skippedCalls(activities)).toEqual([
      [
        { nodeKey: 'pathA', reason: 'branchNotTaken' },
        { nodeKey: 'pathB', reason: 'branchNotTaken' },
      ],
    ]);
  });

  it('lets a Filter that does not pass end only its own branch', async () => {
    const graph = graphOf(
      [
        trigger(),
        step('gate', 'logic.filter'),
        step('gated', 'notify.inApp'),
        step('always', 'notify.inApp'),
      ],
      [line('trigger', 'gate'), line('gate', 'gated'), line('trigger', 'always')],
    );
    const { activities, executed } = harness({ graph, steps: { gate: () => ok([]) } });

    await expect(runToEnd(activities)).resolves.toEqual({ outcome: 'succeeded' });

    expect(executed).toContain('always');
    expect(executed).not.toContain('gated');
    expect(skippedCalls(activities)).toEqual([[{ nodeKey: 'gated', reason: 'branchNotTaken' }]]);
  });

  it('plans again when a step finishes while skipped steps are being written', async () => {
    const graph = graphOf(
      [
        trigger(),
        step('gate', 'logic.filter'),
        step('gated', 'notify.inApp'),
        step('always', 'notify.inApp'),
      ],
      [line('trigger', 'gate'), line('gate', 'gated'), line('trigger', 'always')],
    );
    // `always` finishes only once the skip write has started, and the write
    // returns after it: the plan made before the write is out of date.
    const writing = deferred();
    const { activities } = harness({
      graph,
      steps: {
        gate: () => ok([]),
        always: async () => {
          await writing.promise;
          return ok();
        },
      },
      overrides: {
        recordSkipped: jest.fn(async () => {
          writing.resolve();
          await realSleep(500);
        }),
      },
    });

    await expect(runToEnd(activities)).resolves.toEqual({ outcome: 'succeeded' });
    expect(finishedWith(activities)).toMatchObject({ outcome: 'succeeded', stepCount: 3 });
  });

  it('runs at most 4 steps at once, and a Delay wait does not take a slot', async () => {
    const branches = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `branch${n}`);
    const graph = graphOf(
      [
        trigger(),
        step('pause', 'logic.delay'),
        ...branches.map((key) => step(key, 'logic.setFields')),
      ],
      [line('trigger', 'pause'), ...branches.map((key) => line('trigger', key))],
    );
    let active = 0;
    let most = 0;
    const slow: StepBehaviour = async () => {
      active += 1;
      most = Math.max(most, active);
      await realSleep(250);
      active -= 1;
      return ok();
    };
    const { activities, executed } = harness({
      graph,
      steps: Object.fromEntries(branches.map((key) => [key, slow])),
    });

    await expect(runToEnd(activities)).resolves.toEqual({ outcome: 'succeeded' });

    expect(most).toBe(LIMITS.maxParallelBranches);
    expect([...executed].sort()).toEqual(['trigger', ...branches].sort());
    expect(activities.completeStep).toHaveBeenCalledWith({ ...input, nodeKey: 'pause' });
    expect(finishedWith(activities)).toMatchObject({ outcome: 'succeeded', stepCount: 10 });
  });
});

describe('automationRunWorkflow: live runs', () => {
  const graph = graphOf([trigger()], []);

  it('asks for a workspace slot every 30 seconds until it gets one', async () => {
    const asked: number[] = [];
    const { activities } = harness({
      graph,
      mode: 'live',
      overrides: {
        claimRunSlot: jest.fn(async () => {
          asked.push(await env.currentTimeMs());
          return asked.length === 3;
        }),
      },
    });

    await expect(runToEnd(activities)).resolves.toEqual({ outcome: 'succeeded' });

    expect(asked).toHaveLength(3);
    expect(asked[2] - asked[0]).toBeGreaterThanOrEqual(2 * AUTOMATION_SLOT_RETRY_MS);
  });

  it('ends cancelled when cancelled while waiting for a slot', async () => {
    const { activities } = harness({
      graph,
      mode: 'live',
      overrides: { claimRunSlot: jest.fn(async () => false) },
    });

    const result = await withRun(activities, async (handle) => {
      await until(() => activities.claimRunSlot.mock.calls.length > 0);
      await handle.signal(automationCancelSignal);
      return handle.result();
    });

    expect(result).toEqual({ outcome: 'cancelled' });
    expect(activities.executeNodeActivity).not.toHaveBeenCalled();
    expect(activities.finishRun).toHaveBeenCalledWith({
      ...input,
      outcome: 'cancelled',
      stepCount: 0,
    });
  });
});

describe('automationRunWorkflow: Delay and Manual Review', () => {
  it('waits out a 3 day Delay durably, then goes on', async () => {
    const graph = graphOf(
      [trigger(), step('wait', 'logic.delay'), step('notify', 'notify.inApp')],
      [line('trigger', 'wait'), line('wait', 'notify')],
    );
    const times: number[] = [];
    const { activities, executed } = harness({
      graph,
      overrides: {
        prepareDelay: jest.fn(async () => {
          times.push(await env.currentTimeMs());
          return { waitMs: 3 * DAY_MS };
        }),
        completeStep: jest.fn(async () => {
          times.push(await env.currentTimeMs());
        }),
      },
    });

    await expect(runToEnd(activities)).resolves.toEqual({ outcome: 'succeeded' });

    expect(times[1] - times[0]).toBeGreaterThanOrEqual(3 * DAY_MS);
    expect(activities.completeStep).toHaveBeenCalledWith({ ...input, nodeKey: 'wait' });
    expect(executed).toEqual(['trigger', 'notify']);
    expect(finishedWith(activities)).toMatchObject({ outcome: 'succeeded', stepCount: 3 });
  });

  it('follows Approved, ignoring a second answer and one for another step', async () => {
    const secondSent = deferred();
    const { activities, executed } = harness({
      graph: reviewGraph(true),
      overrides: {
        closeReview: jest.fn(async (ref: { decision: string }) => {
          await secondSent.promise;
          return { ports: [ref.decision] };
        }),
      },
    });

    const result = await withRun(activities, async (handle) => {
      await until(() => activities.openReview.mock.calls.length > 0);
      await handle.signal(reviewDecisionSignal, { nodeKey: 'publish', decision: 'rejected' });
      await handle.signal(reviewDecisionSignal, { nodeKey: 'review', decision: 'approved' });
      await handle.signal(reviewDecisionSignal, { nodeKey: 'review', decision: 'rejected' });
      secondSent.resolve();
      return handle.result();
    });

    expect(result).toEqual({ outcome: 'succeeded' });
    expect(activities.openReview).toHaveBeenCalledWith({ ...input, nodeKey: 'review' });
    expect(activities.closeReview).toHaveBeenCalledTimes(1);
    expect(activities.closeReview).toHaveBeenCalledWith({
      ...input,
      nodeKey: 'review',
      decision: 'approved',
    });
    expect(executed).toEqual(['trigger', 'publish']);
    expect(skippedCalls(activities)).toEqual([[{ nodeKey: 'revise', reason: 'branchNotTaken' }]]);
    expect(finishedWith(activities)).toMatchObject({ outcome: 'succeeded', stepCount: 3 });
  });

  async function decide(withRejectedLine: boolean, decision: 'approved' | 'rejected') {
    const setup = harness({ graph: reviewGraph(withRejectedLine) });
    const result = await withRun(setup.activities, async (handle) => {
      await until(() => setup.activities.openReview.mock.calls.length > 0);
      await handle.signal(reviewDecisionSignal, { nodeKey: 'review', decision });
      return handle.result();
    });
    return { ...setup, result };
  }

  it('follows Rejected when a line leaves it, and the run succeeds', async () => {
    const { result, executed, activities } = await decide(true, 'rejected');

    expect(result).toEqual({ outcome: 'succeeded' });
    expect(executed).toEqual(['trigger', 'revise']);
    expect(skippedCalls(activities)).toEqual([[{ nodeKey: 'publish', reason: 'branchNotTaken' }]]);
  });

  it('ends the run rejected when nothing is connected to Rejected', async () => {
    const { result, executed, activities } = await decide(false, 'rejected');

    expect(result).toEqual({ outcome: 'rejected' });
    expect(executed).toEqual(['trigger']);
    expect(finishedWith(activities)).toMatchObject({ outcome: 'rejected', stepCount: 2 });
  });

  it('expires the run after 7 days without an answer', async () => {
    const times: number[] = [];
    const { activities, executed } = harness({
      graph: reviewGraph(true),
      overrides: {
        openReview: jest.fn(async () => {
          times.push(await env.currentTimeMs());
          return { waiting: true };
        }),
        finishRun: jest.fn(async () => {
          times.push(await env.currentTimeMs());
        }),
      },
    });

    await expect(runToEnd(activities)).resolves.toEqual({ outcome: 'expired' });

    expect(times[1] - times[0]).toBeGreaterThanOrEqual(LIMITS.reviewTimeoutDays * DAY_MS);
    expect(activities.closeReview).not.toHaveBeenCalled();
    expect(executed).toEqual(['trigger']);
    expect(activities.finishRun).toHaveBeenCalledWith({
      ...input,
      outcome: 'expired',
      error: REVIEW_EXPIRED_MESSAGE,
      stepCount: 2,
    });
  });
});

describe('automationRunWorkflow: cancel', () => {
  it('cancels a running step and starts nothing after it', async () => {
    const graph = graphOf(
      [trigger(), step('slow', 'logic.setFields'), step('after', 'notify.inApp')],
      [line('trigger', 'slow'), line('slow', 'after')],
    );
    // The step only returns once the run has finished, so it is surely in
    // flight when the cancel arrives.
    const finished = deferred();
    const { activities, executed } = harness({
      graph,
      steps: {
        slow: async () => {
          await finished.promise;
          return ok();
        },
      },
      overrides: {
        finishRun: jest.fn(async () => {
          finished.resolve();
        }),
      },
    });

    const result = await withRun(activities, async (handle) => {
      await until(() => executed.includes('slow'));
      await handle.signal(automationCancelSignal);
      return handle.result();
    });

    expect(result).toEqual({ outcome: 'cancelled' });
    expect(executed).toEqual(['trigger', 'slow']);
    expect(activities.settleStepFailure).not.toHaveBeenCalled();
    expect(activities.finishRun).toHaveBeenCalledWith({
      ...input,
      outcome: 'cancelled',
      stepCount: 1,
    });
  });

  it('cancels a Manual Review wait', async () => {
    const { activities, executed } = harness({ graph: reviewGraph(true) });

    const result = await withRun(activities, async (handle) => {
      await until(() => activities.openReview.mock.calls.length > 0);
      await handle.signal(automationCancelSignal);
      return handle.result();
    });

    expect(result).toEqual({ outcome: 'cancelled' });
    expect(activities.closeReview).not.toHaveBeenCalled();
    expect(executed).toEqual(['trigger']);
    expect(finishedWith(activities)).toMatchObject({ outcome: 'cancelled', stepCount: 2 });
  });

  it('still finishes the run cancelled when Temporal itself cancels the workflow', async () => {
    const graph = graphOf([trigger(), step('slow', 'logic.setFields')], [line('trigger', 'slow')]);
    const finished = deferred();
    const { activities } = harness({
      graph,
      steps: {
        slow: async () => {
          await finished.promise;
          return ok();
        },
      },
      overrides: {
        finishRun: jest.fn(async () => {
          finished.resolve();
        }),
      },
    });

    const outcome = await withRun(activities, async (handle) => {
      await until(() => activities.executeNodeActivity.mock.calls.length === 2);
      await handle.cancel();
      return handle.result().then(
        () => 'completed',
        () => 'cancelled',
      );
    });

    expect(outcome).toBe('cancelled');
    expect(activities.finishRun).toHaveBeenCalledWith({
      ...input,
      outcome: 'cancelled',
      stepCount: 1,
    });
  });
});

describe('automationRunWorkflow: On Error and retries', () => {
  const settled = (activities: Mocks) => activities.settleStepFailure.mock.calls[0][0];

  it('stop: fails the step once (a permanent failure is not retried), skips what it feeds, finishes the rest', async () => {
    const { activities, executed } = harness({
      graph: postGraph(),
      steps: {
        post: () => {
          throw failure(AUTOMATION_FAILURE_TYPES.permanent, 'Slack refused the message.');
        },
      },
    });

    await expect(runToEnd(activities)).resolves.toEqual({ outcome: 'failed' });

    expect(executed.filter((key) => key === 'post')).toHaveLength(1);
    expect(executed).toContain('other');
    expect(executed).not.toContain('after');
    expect(activities.settleStepFailure).toHaveBeenCalledWith({
      ...input,
      nodeKey: 'post',
      mode: 'stop',
      failureType: AUTOMATION_FAILURE_TYPES.permanent,
      message: 'Slack refused the message.',
      timedOut: false,
    });
    expect(skippedCalls(activities)).toEqual([[{ nodeKey: 'after', reason: 'upstreamFailed' }]]);
    expect(finishedWith(activities)).toMatchObject({ outcome: 'failed', stepCount: 3 });
    expect(finishedWith(activities).error).toBeUndefined();
  });

  it('continue: the run goes on through Out and succeeds', async () => {
    const { activities, executed } = harness({
      graph: postGraph({ onError: { mode: 'continue' } }),
      steps: {
        post: () => {
          throw failure(AUTOMATION_FAILURE_TYPES.permanent, 'Slack refused the message.');
        },
      },
    });

    await expect(runToEnd(activities)).resolves.toEqual({ outcome: 'succeeded' });

    expect(settled(activities)).toMatchObject({ nodeKey: 'post', mode: 'continue' });
    expect(executed).toContain('after');
    expect(activities.recordSkipped).not.toHaveBeenCalled();
  });

  it('branch: the error goes down On Error and Out is skipped', async () => {
    const { activities, executed } = harness({
      graph: postGraph({ onError: { mode: 'branch' } }, true),
      steps: {
        post: () => {
          throw failure(AUTOMATION_FAILURE_TYPES.permanent, 'Slack refused the message.');
        },
      },
    });

    await expect(runToEnd(activities)).resolves.toEqual({ outcome: 'succeeded' });

    expect(settled(activities)).toMatchObject({ nodeKey: 'post', mode: 'branch' });
    expect(executed).toContain('alert');
    expect(executed).not.toContain('after');
    expect(skippedCalls(activities)).toEqual([[{ nodeKey: 'after', reason: 'branchNotTaken' }]]);
  });

  it('retries a transient failure with backoff and carries on when it then succeeds', async () => {
    const times: number[] = [];
    const { activities, executed } = harness({
      graph: postGraph(),
      steps: {
        post: async (_ref, call) => {
          times.push(await env.currentTimeMs());
          if (call === 1)
            throw failure(AUTOMATION_FAILURE_TYPES.retryable, 'Slack did not answer.');
          return ok(['out'], call);
        },
      },
    });

    await expect(runToEnd(activities)).resolves.toEqual({ outcome: 'succeeded' });

    expect(times).toHaveLength(2);
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(
      AUTOMATION_STEP_RETRY_POLICY.initialIntervalMs,
    );
    expect(activities.settleStepFailure).not.toHaveBeenCalled();
    expect(executed).toContain('after');
    // trigger 1, post 2 attempts, after 1, other 1.
    expect(finishedWith(activities)).toMatchObject({ outcome: 'succeeded', stepCount: 5 });
  });

  it('adds the step’s own retries on top of the transient ones before it fails', async () => {
    const { activities, executed } = harness({
      graph: postGraph({ onError: { mode: 'stop', retries: { max: 2, waitSeconds: 5 } } }),
      steps: {
        post: () => {
          throw failure(AUTOMATION_FAILURE_TYPES.retryable, 'Slack did not answer.');
        },
      },
    });

    await expect(runToEnd(activities)).resolves.toEqual({ outcome: 'failed' });

    const attempts = AUTOMATION_STEP_RETRY_POLICY.maximumAttempts + 2;
    expect(executed.filter((key) => key === 'post')).toHaveLength(attempts);
    expect(settled(activities)).toMatchObject({
      mode: 'stop',
      failureType: AUTOMATION_FAILURE_TYPES.retryable,
    });
    expect(finishedWith(activities)).toMatchObject({ stepCount: 1 + attempts + 1 });
  });

  it.each([AUTOMATION_FAILURE_TYPES.notConnected, AUTOMATION_FAILURE_TYPES.outOfCredits])(
    '%s stops the whole run even with continue, ending other waits',
    async (type) => {
      const graph = graphOf(
        [
          trigger(),
          step('post', 'notify.slack', { onError: { mode: 'continue' } }),
          step('after', 'notify.inApp'),
          step('pause', 'logic.delay'),
          step('later', 'notify.inApp'),
        ],
        [
          line('trigger', 'post'),
          line('post', 'after'),
          line('trigger', 'pause'),
          line('pause', 'later'),
        ],
      );
      const { activities, executed } = harness({
        graph,
        steps: {
          post: () => {
            throw failure(type, 'Connect Slack again.');
          },
        },
        overrides: { prepareDelay: jest.fn(async () => ({ waitMs: DAY_MS })) },
      });

      await expect(runToEnd(activities)).resolves.toEqual({ outcome: 'failed' });

      expect(executed).toEqual(['trigger', 'post']);
      expect(settled(activities)).toMatchObject({
        nodeKey: 'post',
        mode: 'stop',
        failureType: type,
      });
      expect(activities.completeStep).not.toHaveBeenCalled();
      expect(finishedWith(activities)).toEqual({ ...input, outcome: 'failed', stepCount: 3 });
    },
  );

  it(`fails the run once it has used ${LIMITS.maxStepExecutionsPerRun} step runs`, async () => {
    const graph = graphOf(
      [
        trigger(),
        step('first', 'logic.setFields'),
        step('second', 'logic.setFields', { onError: { mode: 'continue' } }),
        step('third', 'notify.inApp'),
      ],
      [line('trigger', 'first'), line('first', 'second'), line('second', 'third')],
    );
    const { activities, executed } = harness({
      graph,
      steps: {
        first: () => ok(['out'], 120),
        second: () => {
          throw failure(AUTOMATION_FAILURE_TYPES.permanent, 'Bad data.');
        },
      },
      overrides: { settleStepFailure: jest.fn(async () => ({ attempts: 79 })) },
    });

    await expect(runToEnd(activities)).resolves.toEqual({ outcome: 'failed' });

    expect(STEP_LIMIT_MESSAGE).toBe('This run used more than 200 steps.');
    expect(executed).not.toContain('third');
    expect(activities.finishRun).toHaveBeenCalledWith({
      ...input,
      outcome: 'failed',
      error: STEP_LIMIT_MESSAGE,
      stepCount: LIMITS.maxStepExecutionsPerRun,
    });
  });
});

describe('automationRunWorkflow: step tests', () => {
  const graph = graphOf(
    [
      trigger(),
      step('fields', 'logic.setFields'),
      step('wait', 'logic.delay'),
      step('review', 'logic.manualReview'),
      step('notify', 'notify.inApp'),
    ],
    [
      line('trigger', 'fields'),
      line('fields', 'wait'),
      line('wait', 'review'),
      line('review', 'notify', 'approved'),
    ],
  );
  const only = (nodeKey: string): AutomationRunScope => ({ kind: 'step', nodeKey });

  it('runs only the one step, without planning the rest', async () => {
    const { activities, executed } = harness({ graph, scope: only('fields') });

    await expect(runToEnd(activities)).resolves.toEqual({ outcome: 'succeeded' });

    expect(executed).toEqual(['fields']);
    expect(activities.recordSkipped).not.toHaveBeenCalled();
    expect(activities.finishRun).toHaveBeenCalledWith({
      ...input,
      outcome: 'succeeded',
      stepCount: 1,
    });
  });

  it('fails when the step fails', async () => {
    const { activities } = harness({
      graph,
      scope: only('fields'),
      steps: {
        fields: () => {
          throw failure(AUTOMATION_FAILURE_TYPES.permanent, 'Bad data.');
        },
      },
    });

    await expect(runToEnd(activities)).resolves.toEqual({ outcome: 'failed' });
    expect(activities.settleStepFailure.mock.calls[0][0]).toMatchObject({ mode: 'stop' });
  });

  it('tests a Delay without waiting', async () => {
    const { activities, executed } = harness({
      graph,
      scope: only('wait'),
      overrides: { prepareDelay: jest.fn(async () => ({ waitMs: 0 })) },
    });

    await expect(runToEnd(activities)).resolves.toEqual({ outcome: 'succeeded' });

    expect(activities.prepareDelay).toHaveBeenCalledWith({ ...input, nodeKey: 'wait' });
    expect(activities.completeStep).not.toHaveBeenCalled();
    expect(executed).toEqual([]);
  });

  it('tests a Manual Review without waiting for an answer', async () => {
    const { activities } = harness({
      graph,
      scope: only('review'),
      overrides: { openReview: jest.fn(async () => ({ waiting: false })) },
    });

    await expect(runToEnd(activities)).resolves.toEqual({ outcome: 'succeeded' });

    expect(activities.openReview).toHaveBeenCalledWith({ ...input, nodeKey: 'review' });
    expect(activities.closeReview).not.toHaveBeenCalled();
  });

  it('fails a test of a step that is no longer in the workflow', async () => {
    const { activities, executed } = harness({ graph, scope: only('ghost') });

    await expect(runToEnd(activities)).resolves.toEqual({ outcome: 'failed' });

    expect(executed).toEqual([]);
    expect(activities.finishRun).toHaveBeenCalledWith({
      ...input,
      outcome: 'failed',
      error: STEP_MISSING_MESSAGE,
      stepCount: 0,
    });
  });
});

describe('automationRunWorkflow: replay', () => {
  it('replays a recorded run with branches, a Delay, a review and a handled error', async () => {
    const graph = graphOf(
      [
        trigger(),
        step('check', 'logic.ifElse'),
        step('yesStep', 'notify.inApp'),
        step('noStep', 'logic.setFields'),
        step('pause', 'logic.delay'),
        step('review', 'logic.manualReview'),
        step('post', 'notify.slack', { onError: { mode: 'branch' } }),
        step('after', 'notify.inApp'),
        step('alert', 'notify.inApp'),
      ],
      [
        line('trigger', 'check'),
        line('check', 'yesStep', 'true'),
        line('check', 'noStep', 'false'),
        line('trigger', 'pause'),
        line('pause', 'review'),
        line('review', 'post', 'approved'),
        line('post', 'after'),
        line('post', 'alert', 'error'),
      ],
    );
    const { activities } = harness({
      graph,
      // Real time: the test server only skips time while a client awaits the result.
      overrides: { prepareDelay: jest.fn(async () => ({ waitMs: 500 })) },
      steps: {
        check: () => ok(['true']),
        post: async (_ref, call) => {
          throw failure(
            call === 1 ? AUTOMATION_FAILURE_TYPES.retryable : AUTOMATION_FAILURE_TYPES.permanent,
            'Slack refused the message.',
          );
        },
      },
    });

    const { result, history, workflowId } = await withRun(activities, async (handle) => {
      await until(() => activities.openReview.mock.calls.length > 0);
      await handle.signal(reviewDecisionSignal, { nodeKey: 'review', decision: 'approved' });
      const outcome = await handle.result();
      return {
        result: outcome,
        history: await handle.fetchHistory(),
        workflowId: handle.workflowId,
      };
    });

    expect(result).toEqual({ outcome: 'succeeded' });
    expect(activities.settleStepFailure.mock.calls[0][0]).toMatchObject({ mode: 'branch' });

    await expect(
      Worker.runReplayHistory({ workflowBundle }, history, workflowId),
    ).resolves.toBeUndefined();
  });
});
