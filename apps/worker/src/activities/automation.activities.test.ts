/**
 * The run activities on the memory store: planning, slots, skipped rows,
 * failure settling, Delay, Manual Review and finishing a run. The step
 * engine's own cases are in automation/executors and automation/providers.
 */
import { AUTOMATION_FAILURE_TYPES } from '@postgear/scheduling';
import { EXPIRED_MESSAGE } from '../automation/finish';
import type { StepRecord } from '../automation/run-store';
import {
  AUTOMATION_ID,
  graphOf,
  harness,
  line,
  NOW,
  OTHER_ORG,
  RUN_ID,
  step,
  testOptions,
} from '../automation/testing';

const linear = graphOf(
  [
    step('trig1', 'trigger.manual'),
    step('bell', 'notify.inApp', { name: 'Tell Me', config: { title: 'Hi', message: 'There' } }),
  ],
  [line('trig1', 'bell')],
);

function row(nodeKey: string, overrides: Partial<StepRecord> = {}): StepRecord {
  return {
    runId: RUN_ID,
    nodeKey,
    nodeType: 'notify.inApp',
    nodeName: nodeKey,
    status: 'SUCCEEDED',
    attempt: 1,
    input: null,
    output: null,
    truncated: false,
    error: null,
    startedAt: NOW,
    finishedAt: NOW,
    durationMs: 5,
    ports: [],
    ...overrides,
  };
}

describe('loadRunPlan', () => {
  it('marks a queued run RUNNING with its start time and returns the plan', async () => {
    const h = harness(linear, {
      status: 'QUEUED',
      startedAt: null,
      options: testOptions({ sendForReal: ['bell'] }),
    });

    const plan = await h.activities.loadRunPlan(h.ref);

    expect(plan).toMatchObject({
      skip: false,
      mode: 'test',
      scope: { kind: 'run' },
      sendForReal: ['bell'],
    });
    expect(plan.skip === false && plan.graph.nodes.map((n) => n.key)).toEqual(['trig1', 'bell']);
    const run = h.store.runs.get(RUN_ID);
    expect(run?.status).toBe('RUNNING');
    expect(run?.startedAt).toEqual(NOW);
  });

  it('continues a run that is already RUNNING (a retry after a lost reply)', async () => {
    const h = harness(linear, { status: 'RUNNING' });
    await expect(h.activities.loadRunPlan(h.ref)).resolves.toMatchObject({ skip: false });
  });

  it('skips a run that is gone, finished, or from another workspace', async () => {
    const h = harness(linear, { status: 'CANCELLED' });
    await expect(h.activities.loadRunPlan(h.ref)).resolves.toEqual({
      skip: true,
      reason: 'finished',
    });
    await expect(
      h.activities.loadRunPlan({ runId: RUN_ID, organizationId: OTHER_ORG }),
    ).resolves.toEqual({ skip: true, reason: 'gone' });
  });

  it('fails a run whose graph cannot be read, once', async () => {
    const h = harness({ nodes: 'nope' } as never, { status: 'QUEUED' });

    await expect(h.activities.loadRunPlan(h.ref)).resolves.toEqual({
      skip: true,
      reason: 'finished',
    });
    expect(h.store.runs.get(RUN_ID)?.status).toBe('FAILED');
  });
});

describe('claimRunSlot', () => {
  it('always lets a test run through', async () => {
    const h = harness(linear);
    await expect(h.activities.claimRunSlot(h.ref)).resolves.toBe(true);
  });

  it('makes a live run wait while 10 earlier live runs of the workspace are running', async () => {
    const h = harness(linear, { mode: 'LIVE', startedAt: new Date(NOW.getTime() + 60_000) });
    for (let i = 0; i < 10; i++) {
      h.store.addRun({
        id: `earlier_${i}`,
        organizationId: h.ref.organizationId,
        automationId: AUTOMATION_ID,
        mode: 'LIVE',
        status: 'RUNNING',
        startedAt: new Date(NOW.getTime() + i),
        graph: linear,
      });
    }
    // A later run and another workspace's run do not count.
    h.store.addRun({
      id: 'later',
      organizationId: h.ref.organizationId,
      automationId: AUTOMATION_ID,
      mode: 'LIVE',
      status: 'RUNNING',
      startedAt: new Date(NOW.getTime() + 120_000),
      graph: linear,
    });

    await expect(h.activities.claimRunSlot(h.ref)).resolves.toBe(false);

    const first = h.store.runs.get('earlier_0');
    if (first) first.status = 'SUCCEEDED';
    await expect(h.activities.claimRunSlot(h.ref)).resolves.toBe(true);
  });
});

describe('recordSkipped', () => {
  it('writes one SKIPPED row per step with its reason, once', async () => {
    const h = harness(linear);
    const steps = [{ nodeKey: 'bell', reason: 'branchNotTaken' as const }];

    await h.activities.recordSkipped({ ...h.ref, steps });
    await h.activities.recordSkipped({ ...h.ref, steps });

    expect(h.store.steps).toHaveLength(1);
    expect(h.store.steps[0]).toMatchObject({
      nodeKey: 'bell',
      nodeName: 'Tell Me',
      nodeType: 'notify.inApp',
      status: 'SKIPPED',
      attempt: 1,
      output: { skipped: 'branchNotTaken' },
    });
  });
});

describe('settleStepFailure', () => {
  it('fails an attempt that timed out while RUNNING', async () => {
    const h = harness(linear);
    h.store.steps.push(row('bell', { status: 'RUNNING', attempt: 2, finishedAt: null }));

    const { attempts } = await h.activities.settleStepFailure({
      ...h.stepRef('bell'),
      mode: 'stop',
      failureType: null,
      message: 'This step took too long and was stopped.',
      timedOut: true,
    });

    expect(attempts).toBe(2);
    expect(h.store.latest(RUN_ID, 'bell')).toMatchObject({
      status: 'FAILED',
      error: { message: 'This step took too long.', code: 'timeout' },
    });
  });

  it('rewrites the failed attempt as HANDLED_ERROR for On Error continue', async () => {
    const h = harness(linear);
    h.store.steps.push(
      row('bell', {
        status: 'FAILED',
        error: { message: 'Slack did not answer.', code: 'unavailable', retryable: true },
      }),
    );

    await h.activities.settleStepFailure({
      ...h.stepRef('bell'),
      mode: 'continue',
      failureType: AUTOMATION_FAILURE_TYPES.retryable,
      message: 'Slack did not answer.',
      timedOut: false,
    });

    expect(h.store.latest(RUN_ID, 'bell')).toMatchObject({
      status: 'HANDLED_ERROR',
      output: { error: { message: 'Slack did not answer.', code: 'unavailable' } },
    });
  });

  it('writes a FAILED row when the attempt never wrote one', async () => {
    const h = harness(linear);

    await h.activities.settleStepFailure({
      ...h.stepRef('bell'),
      mode: 'branch',
      failureType: null,
      message: 'This step stopped because of an unexpected error.',
      timedOut: false,
    });

    expect(h.store.latest(RUN_ID, 'bell')).toMatchObject({
      nodeName: 'Tell Me',
      status: 'HANDLED_ERROR',
      error: { code: 'unexpected' },
    });
  });
});

describe('executeNodeActivity failures', () => {
  it('writes FAILED with the error and throws a final failure for a step without an executor', async () => {
    const graph = graphOf(
      [step('trig1', 'trigger.manual'), step('image1', 'ai.generateImage', { name: 'Picture' })],
      [line('trig1', 'image1')],
    );
    // Generate Image has an executor since Module 11; a registry without it stands in.
    const h = harness(graph, {}, { executors: new Map() });

    await expect(h.activities.executeNodeActivity(h.stepRef('image1'))).rejects.toMatchObject({
      type: AUTOMATION_FAILURE_TYPES.permanent,
      nonRetryable: true,
    });
    expect(h.store.latest(RUN_ID, 'image1')).toMatchObject({
      status: 'FAILED',
      error: { code: 'not_runnable' },
    });
  });

  it('refuses a run of another workspace without writing anything', async () => {
    const h = harness(linear);

    await expect(
      h.activities.executeNodeActivity({
        runId: RUN_ID,
        organizationId: OTHER_ORG,
        nodeKey: 'bell',
      }),
    ).rejects.toMatchObject({ type: AUTOMATION_FAILURE_TYPES.permanent });
    expect(h.store.steps).toHaveLength(0);
    expect(h.store.notifications).toHaveLength(0);
  });

  it('fails an earlier attempt left RUNNING when the next one starts', async () => {
    const h = harness(linear);
    h.store.steps.push(row('bell', { status: 'RUNNING', attempt: 1, finishedAt: null }));
    h.attempt.value = 2;

    await h.activities.executeNodeActivity(h.stepRef('bell'));

    const rows = await h.store.listSteps(h.ref, 'bell');
    expect(rows.map((r) => [r.attempt, r.status])).toEqual([
      [1, 'FAILED'],
      [2, 'SUCCEEDED'],
    ]);
  });
});

describe('Delay', () => {
  const delayGraph = (config: Record<string, unknown>) =>
    graphOf(
      [step('trig1', 'trigger.manual'), step('wait', 'logic.delay', { config })],
      [line('trig1', 'wait')],
    );

  it('writes a WAITING row and returns how long to wait', async () => {
    const h = harness(delayGraph({ mode: 'for', amount: 3, unit: 'days', until: '' }));

    const { waitMs } = await h.activities.prepareDelay(h.stepRef('wait'));

    expect(waitMs).toBe(3 * 24 * 60 * 60_000);
    expect(h.store.latest(RUN_ID, 'wait')).toMatchObject({
      status: 'WAITING',
      output: { waitedUntil: '2026-11-06T09:00:00.000Z' },
    });

    // A retry keeps the first deadline.
    h.clock.now = new Date(NOW.getTime() + 60_000);
    await expect(h.activities.prepareDelay(h.stepRef('wait'))).resolves.toEqual({
      waitMs: 3 * 24 * 60 * 60_000 - 60_000,
    });

    await h.activities.completeStep(h.stepRef('wait'));
    expect(h.store.latest(RUN_ID, 'wait')?.status).toBe('SUCCEEDED');
  });

  it('waits until a date taken from data, and not at all for a past one', async () => {
    const h = harness(
      delayGraph({ mode: 'until', amount: 1, unit: 'hours', until: '{{ trigger.inputs.at }}' }),
      { triggerPayload: { inputs: { at: '2026-11-03T10:30:00Z' } } },
    );
    await expect(h.activities.prepareDelay(h.stepRef('wait'))).resolves.toEqual({
      waitMs: 90 * 60_000,
    });

    const past = harness(
      delayGraph({ mode: 'until', amount: 1, unit: 'hours', until: '2026-01-01T00:00:00Z' }),
    );
    await expect(past.activities.prepareDelay(past.stepRef('wait'))).resolves.toEqual({
      waitMs: 0,
    });
  });

  it('fails plainly on a date it cannot read', async () => {
    const h = harness(
      delayGraph({ mode: 'until', amount: 1, unit: 'hours', until: '{{ trigger.inputs.at }}' }),
      { triggerPayload: { inputs: { at: 'next tuesday' } } },
    );

    await expect(h.activities.prepareDelay(h.stepRef('wait'))).rejects.toMatchObject({
      type: AUTOMATION_FAILURE_TYPES.permanent,
      message: 'This step could not read "next tuesday" as a date and time.',
    });
    expect(h.store.latest(RUN_ID, 'wait')?.status).toBe('FAILED');
  });

  it('never waits past the run timeout', async () => {
    const h = harness(delayGraph({ mode: 'for', amount: 30, unit: 'days', until: '' }), {
      startedAt: new Date(NOW.getTime() - 29 * 24 * 60 * 60_000),
    });

    await expect(h.activities.prepareDelay(h.stepRef('wait'))).resolves.toEqual({
      waitMs: 24 * 60 * 60_000,
    });
  });

  it('writes SUCCEEDED and waits 0 in a step test', async () => {
    const h = harness(delayGraph({ mode: 'for', amount: 2, unit: 'hours', until: '' }), {
      options: testOptions({ scope: { kind: 'step', nodeKey: 'wait' } }),
    });

    await expect(h.activities.prepareDelay(h.stepRef('wait'))).resolves.toEqual({ waitMs: 0 });
    expect(h.store.latest(RUN_ID, 'wait')).toMatchObject({
      status: 'SUCCEEDED',
      output: { waitMs: 2 * 60 * 60_000, until: '2026-11-03T11:00:00.000Z' },
    });
  });
});

describe('Manual Review', () => {
  const reviewGraph = graphOf(
    [
      step('trig1', 'trigger.manual'),
      step('review', 'logic.manualReview', {
        name: 'Check It',
        config: { text: 'Post: {{ trigger.inputs.topic }}', image: '', instructions: '' },
      }),
    ],
    [line('trig1', 'review')],
  );

  it('waits, sets the run WAITING and tells the workspace once', async () => {
    const h = harness(reviewGraph, { triggerPayload: { inputs: { topic: 'Rye' } } });

    await expect(h.activities.openReview(h.stepRef('review'))).resolves.toEqual({ waiting: true });
    h.attempt.value = 2;
    await expect(h.activities.openReview(h.stepRef('review'))).resolves.toEqual({ waiting: true });

    expect(h.store.runs.get(RUN_ID)?.status).toBe('WAITING');
    expect(h.store.latest(RUN_ID, 'review')).toMatchObject({
      status: 'WAITING',
      attempt: 1,
      input: { text: 'Post: Rye' },
    });
    expect(h.store.notifications).toHaveLength(1);
    expect(h.store.notifications[0]).toMatchObject({
      type: 'automation.review',
      title: 'Review needed (Test)',
      content: 'Your Publishing Report is ready for review.',
      link: '/org_test/workflows/auto_1?tab=runs&run=run_1&review=1',
      emailStatus: 'PENDING',
    });
  });

  it('closes with the decision the API wrote, and picks the port', async () => {
    const h = harness(reviewGraph, { triggerPayload: { inputs: { topic: 'Rye' } } });
    await h.activities.openReview(h.stepRef('review'));
    const waiting = h.store.latest(RUN_ID, 'review');
    if (waiting) {
      waiting.output = { decision: 'rejected', decidedById: 'u1', decidedAt: NOW.toISOString() };
    }

    const { ports } = await h.activities.closeReview({
      ...h.stepRef('review'),
      decision: 'rejected',
    });

    expect(ports).toEqual(['rejected']);
    expect(h.store.latest(RUN_ID, 'review')).toMatchObject({
      status: 'SUCCEEDED',
      output: { decision: 'rejected', decidedById: 'u1', text: 'Post: Rye' },
    });
    expect(h.store.runs.get(RUN_ID)?.status).toBe('RUNNING');
  });

  it('writes a DRY_RUN row and does not wait in a step test', async () => {
    const h = harness(reviewGraph, {
      triggerPayload: { inputs: { topic: 'Rye' } },
      options: testOptions({ scope: { kind: 'step', nodeKey: 'review' } }),
    });

    await expect(h.activities.openReview(h.stepRef('review'))).resolves.toEqual({
      waiting: false,
    });
    expect(h.store.latest(RUN_ID, 'review')).toMatchObject({
      status: 'DRY_RUN',
      output: {
        dryRun: true,
        wouldSend: 'A review request to everyone in the workspace: "Post: Rye"',
      },
    });
    expect(h.store.notifications).toHaveLength(0);
  });
});

describe('finishRun', () => {
  it('fails the run with the first failed step, cancels open rows and counts live failures', async () => {
    const h = harness(linear, { mode: 'LIVE' });
    h.store.steps.push(
      row('first', {
        status: 'FAILED',
        finishedAt: new Date(NOW.getTime() + 1_000),
        error: { message: 'Slack did not answer.', code: 'unavailable', retryable: true },
      }),
      row('later', {
        status: 'FAILED',
        finishedAt: new Date(NOW.getTime() + 2_000),
        error: { message: 'Second problem.', code: 'permanent', retryable: false },
      }),
      row('open', { status: 'RUNNING', finishedAt: null }),
    );

    await h.activities.finishRun({ ...h.ref, outcome: 'failed', stepCount: 3 });
    await h.activities.finishRun({ ...h.ref, outcome: 'failed', stepCount: 3 });

    expect(h.store.runs.get(RUN_ID)?.status).toBe('FAILED');
    expect(h.store.runExtras.get(RUN_ID)).toMatchObject({
      error: 'Slack did not answer.',
      stepCount: 3,
    });
    expect(h.store.latest(RUN_ID, 'open')?.status).toBe('CANCELLED');
    expect(h.store.automations.get(AUTOMATION_ID)).toMatchObject({
      lastRunStatus: 'FAILED',
      lastRunError: 'Slack did not answer.',
      consecutiveFailures: 1,
    });
  });

  it('resets the failure count on a live success, and leaves it alone for a test', async () => {
    const live = harness(linear, { mode: 'LIVE' });
    const automation = live.store.automations.get(AUTOMATION_ID);
    if (automation) automation.consecutiveFailures = 4;
    await live.activities.finishRun({ ...live.ref, outcome: 'succeeded', stepCount: 2 });
    expect(live.store.automations.get(AUTOMATION_ID)).toMatchObject({
      lastRunStatus: 'SUCCEEDED',
      lastRunError: null,
      consecutiveFailures: 0,
    });

    const test = harness(linear);
    const testAutomation = test.store.automations.get(AUTOMATION_ID);
    if (testAutomation) testAutomation.consecutiveFailures = 4;
    await test.activities.finishRun({ ...test.ref, outcome: 'failed', stepCount: 1 });
    expect(test.store.automations.get(AUTOMATION_ID)?.consecutiveFailures).toBe(4);
  });

  it('maps every outcome, with the given sentence or a default for an expired review', async () => {
    const h = harness(linear);
    await h.activities.finishRun({ ...h.ref, outcome: 'expired', stepCount: 1 });
    expect(h.store.runs.get(RUN_ID)?.status).toBe('EXPIRED');
    expect(h.store.runExtras.get(RUN_ID)?.error).toBe(EXPIRED_MESSAGE);

    const halted = harness(linear);
    await halted.activities.finishRun({
      ...halted.ref,
      outcome: 'failed',
      stepCount: 201,
      error: 'This run used more than 200 steps.',
    });
    expect(halted.store.runExtras.get(RUN_ID)?.error).toBe('This run used more than 200 steps.');

    for (const [outcome, status] of [
      ['rejected', 'REJECTED'],
      ['cancelled', 'CANCELLED'],
    ] as const) {
      const run = harness(linear);
      await run.activities.finishRun({ ...run.ref, outcome, stepCount: 1 });
      expect(run.store.runs.get(RUN_ID)?.status).toBe(status);
    }
  });

  it('never writes to a run of another workspace', async () => {
    const h = harness(linear);
    await h.activities.finishRun({
      runId: RUN_ID,
      organizationId: OTHER_ORG,
      outcome: 'failed',
      stepCount: 1,
    });
    expect(h.store.runs.get(RUN_ID)?.status).toBe('RUNNING');
  });
});
