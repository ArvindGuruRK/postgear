/**
 * Modules 08 and 09 on the memory store: scheduled runs made once per
 * scheduled time, Retry From Here seeds, the ports every finished row
 * keeps, grouped failure alerts and the auto-pause.
 */
import {
  AUTOMATION_AUTO_PAUSE_AFTER_FAILURES,
  AUTOMATION_FAILURE_ALERT_WINDOW_MS,
  AUTOMATION_NOTIFICATION_TYPES,
  scheduleTriggerEventId,
} from '@postgear/scheduling';
import type { Client } from '@temporalio/client';
import type { StepRecord } from '../automation/run-store';
import {
  AUTOMATION_ID,
  graphOf,
  harness,
  line,
  NOW,
  ORG,
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

function row(runId: string, nodeKey: string, overrides: Partial<StepRecord> = {}): StepRecord {
  return {
    runId,
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
    ports: ['out'],
    ...overrides,
  };
}

describe('startScheduledRun', () => {
  const scheduleGraph = graphOf(
    [
      step('every', 'trigger.schedule', {
        config: { frequency: 'daily', time: '09:00', timeZone: 'Asia/Kolkata' },
      }),
      step('bell', 'notify.inApp'),
    ],
    [line('every', 'bell')],
  );

  function scheduled() {
    const h = harness(scheduleGraph);
    h.store.addAutomation({
      id: 'auto_s',
      organizationId: ORG,
      name: 'Daily Report',
      activeVersionId: 'ver_1',
    });
    h.store.addVersion({
      id: 'ver_1',
      automationId: 'auto_s',
      organizationId: ORG,
      graph: scheduleGraph,
    });
    const start = (overrides: Partial<Parameters<typeof h.activities.startScheduledRun>[0]> = {}) =>
      h.activities.startScheduledRun({
        organizationId: ORG,
        automationId: 'auto_s',
        versionId: 'ver_1',
        workflowId: 'automation-scheduled:auto_s-2026-11-03T03:30:00Z',
        scheduledAt: '2026-11-03T03:30:00.000Z',
        ...overrides,
      });
    return { h, start };
  }

  it('creates one QUEUED live run per scheduled time, however often it is started', async () => {
    const { h, start } = scheduled();

    const first = await start();
    const again = await start();

    expect(first).toEqual(again);
    expect('runId' in first).toBe(true);
    expect(h.store.liveRuns.size).toBe(1);
    const [live] = [...h.store.liveRuns.values()];
    expect(live).toMatchObject({
      automationId: 'auto_s',
      versionId: 'ver_1',
      triggerType: 'trigger.schedule',
      triggerEventId: scheduleTriggerEventId('auto_s', '2026-11-03T03:30:00.000Z'),
      temporalWorkflowId: 'automation-scheduled:auto_s-2026-11-03T03:30:00Z',
      triggerPayload: { scheduledFor: '2026-11-03T03:30:00.000Z', timeZone: 'Asia/Kolkata' },
    });
    expect(h.store.runs.get(live.id)).toMatchObject({ mode: 'LIVE', status: 'QUEUED' });

    await start({
      scheduledAt: '2026-11-04T03:30:00.000Z',
      workflowId: 'automation-scheduled:auto_s-2026-11-04T03:30:00Z',
    });
    expect(h.store.liveRuns.size).toBe(2);
  });

  it('never lets a second workflow run the same scheduled time', async () => {
    const { start } = scheduled();
    await start();

    await expect(start({ workflowId: 'automation-scheduled:auto_s-other' })).resolves.toEqual({
      skip: true,
      reason: 'otherWorkflow',
    });
  });

  it('ends without a run when the workflow is paused, deleted or on another version', async () => {
    for (const change of [
      { status: 'PAUSED' as const },
      { deletedAt: NOW },
      { activeVersionId: 'ver_2' },
    ]) {
      const { h, start } = scheduled();
      Object.assign(h.store.automations.get('auto_s') ?? {}, change);
      await expect(start()).resolves.toEqual({ skip: true, reason: 'notActive' });
      expect(h.store.liveRuns.size).toBe(0);
    }
  });
});

describe('Retry From Here', () => {
  const retryGraph = graphOf(
    [
      step('trig1', 'trigger.manual'),
      step('check', 'logic.ifElse'),
      step('bell', 'notify.inApp', {
        name: 'Tell Me',
        config: { title: 'Was {{ nodes.check.output.result }}', message: 'Again' },
      }),
    ],
    [line('trig1', 'check'), line('check', 'bell', 'true')],
  );

  function retried() {
    const h = harness(retryGraph, {
      status: 'QUEUED',
      startedAt: null,
      options: testOptions({
        retry: { of: 'run_0', fromNodeKey: 'bell', ports: { trig1: ['out'], check: ['true'] } },
      }),
      seedOutputs: { trig1: { inputs: {} }, check: { result: true, details: [] } },
    });
    // The API copies the seeded steps' rows into the new run.
    h.store.steps.push(
      row(RUN_ID, 'trig1', { nodeType: 'trigger.manual' }),
      row(RUN_ID, 'check', {
        nodeType: 'logic.ifElse',
        status: 'HANDLED_ERROR',
        ports: ['true'],
      }),
    );
    return h;
  }

  it('plans the seeded steps as finished, with their ports and handled errors', async () => {
    const h = retried();

    const plan = await h.activities.loadRunPlan(h.ref);

    expect(plan).toMatchObject({
      skip: false,
      seeded: {
        trig1: { status: 'succeeded', ports: ['out'] },
        check: { status: 'handled', ports: ['true'] },
      },
    });
  });

  it('reads the seeded outputs for data, and runs only the retried step', async () => {
    const h = retried();
    await h.activities.loadRunPlan(h.ref);

    const result = await h.activities.executeNodeActivity(h.stepRef('bell'));

    expect(result).toEqual({ status: 'succeeded', ports: ['out'], attempt: 1 });
    expect(h.store.notifications[0]).toMatchObject({ title: 'Was true (Test)' });
    expect(h.store.steps.filter((s) => s.nodeKey === 'check')).toHaveLength(1);
  });
});

describe('ports on step rows', () => {
  it('stores the ports a step fired, none for a skipped one', async () => {
    const h = harness(linear);

    await h.activities.executeNodeActivity(h.stepRef('trig1'));
    await h.activities.recordSkipped({
      ...h.ref,
      steps: [{ nodeKey: 'bell', reason: 'branchNotTaken' }],
    });

    expect(h.store.latest(RUN_ID, 'trig1')?.ports).toEqual(['out']);
    expect(h.store.latest(RUN_ID, 'bell')?.ports).toEqual([]);
  });

  it('stores error for an On Error branch and nothing for a stop', async () => {
    const failed = { error: { message: 'No.', code: 'permanent', retryable: false } };
    for (const [mode, ports] of [
      ['branch', ['error']],
      ['continue', ['out']],
      ['stop', []],
    ] as const) {
      const h = harness(linear);
      h.store.steps.push(row(RUN_ID, 'bell', { status: 'FAILED', ports: [], ...failed }));
      await h.activities.settleStepFailure({
        ...h.stepRef('bell'),
        mode,
        failureType: 'AutomationPermanent',
        message: 'No.',
        timedOut: false,
      });
      expect(h.store.latest(RUN_ID, 'bell')?.ports).toEqual(ports);
    }
  });

  it('stores the decision port on a closed review, and links its notification to the card', async () => {
    const reviewGraph = graphOf(
      [
        step('trig1', 'trigger.manual'),
        step('review', 'logic.manualReview', {
          config: { text: 'Post this?', image: '', instructions: '' },
        }),
      ],
      [line('trig1', 'review')],
    );
    const h = harness(reviewGraph);
    await h.activities.openReview(h.stepRef('review'));
    const waiting = h.store.latest(RUN_ID, 'review');
    if (waiting) {
      waiting.output = {
        decision: 'rejected',
        decidedById: 'u1',
        decidedAt: NOW.toISOString(),
        reviewedBy: 'Priya',
        reason: 'Off brand.',
      };
    }

    await h.activities.closeReview({ ...h.stepRef('review'), decision: 'rejected' });

    expect(h.store.notifications[0]).toMatchObject({
      type: AUTOMATION_NOTIFICATION_TYPES.review,
      link: `/${ORG}/workflows/${AUTOMATION_ID}?tab=runs&run=${RUN_ID}&review=1`,
    });
    expect(h.store.latest(RUN_ID, 'review')).toMatchObject({
      status: 'SUCCEEDED',
      ports: ['rejected'],
      output: { decision: 'rejected', reviewedBy: 'Priya', reason: 'Off brand.' },
    });
  });
});

describe('failure alerts and auto-pause', () => {
  const HOUR = AUTOMATION_FAILURE_ALERT_WINDOW_MS;

  function live(options: { client?: Client } = {}) {
    const h = harness(
      linear,
      { mode: 'LIVE' },
      options.client ? { temporalClient: async () => options.client as Client } : {},
    );
    let sequence = 0;
    /** One more live run of the workflow that ends as told, `atMs` after NOW. */
    const end = async (
      atMs: number,
      outcome: 'failed' | 'succeeded' | 'rejected' | 'expired' | 'cancelled' = 'failed',
    ) => {
      sequence += 1;
      const runId = `live_run_${sequence}`;
      h.store.addRun({
        id: runId,
        organizationId: ORG,
        automationId: AUTOMATION_ID,
        mode: 'LIVE',
        status: 'RUNNING',
        startedAt: NOW,
        graph: linear,
      });
      if (outcome === 'failed') {
        h.store.steps.push(
          row(runId, 'bell', {
            nodeName: 'Tell Me',
            status: 'FAILED',
            ports: [],
            error: {
              message: `Slack did not answer (${sequence}).`,
              code: 'unavailable',
              retryable: true,
            },
          }),
        );
      }
      h.clock.now = new Date(NOW.getTime() + atMs);
      await h.activities.finishRun({ runId, organizationId: ORG, outcome, stepCount: 1 });
      return runId;
    };
    const alerts = () =>
      h.store.notifications.filter((n) => n.type === AUTOMATION_NOTIFICATION_TYPES.failed);
    return { h, end, alerts };
  }

  it('writes one alert an hour per workflow, then the grouped sentence', async () => {
    const { h, end, alerts } = live();

    const first = await end(0);
    await end(10 * 60_000);
    await end(20 * 60_000);

    expect(alerts()).toHaveLength(1);
    expect(alerts()[0]).toMatchObject({
      title: 'Workflow failed',
      content: 'Publishing Report failed at Tell Me: Slack did not answer (1).',
      link: `/${ORG}/workflows/${AUTOMATION_ID}?tab=runs&run=${first}`,
      meta: { automationId: AUTOMATION_ID, runId: first, count: 1, suppressed: 2 },
    });

    const latest = await end(HOUR + 60_000);

    expect(alerts()).toHaveLength(2);
    expect(alerts()[1]).toMatchObject({
      content:
        'Publishing Report failed 3 more times since the last alert. Latest: at Tell Me: Slack did not answer (4).',
      link: `/${ORG}/workflows/${AUTOMATION_ID}?tab=runs&run=${latest}`,
      meta: { count: 3, suppressed: 0 },
    });
    expect(h.store.automations.get(AUTOMATION_ID)?.consecutiveFailures).toBe(4);
  });

  it('a failure after a quiet hour reads as a single one again', async () => {
    const { end, alerts } = live();
    await end(0);
    await end(2 * HOUR);
    expect(alerts().map((n) => n.content)).toEqual([
      'Publishing Report failed at Tell Me: Slack did not answer (1).',
      'Publishing Report failed at Tell Me: Slack did not answer (2).',
    ]);
  });

  it('never alerts or counts for rejected, expired, cancelled or test runs', async () => {
    const { h, end, alerts } = live();
    await end(0, 'rejected');
    await end(1, 'expired');
    await end(2, 'cancelled');

    const test = harness(linear);
    test.store.steps.push(
      row(RUN_ID, 'bell', {
        status: 'FAILED',
        error: { message: 'No.', code: 'permanent', retryable: false },
      }),
    );
    await test.activities.finishRun({ ...test.ref, outcome: 'failed', stepCount: 1 });

    expect(alerts()).toHaveLength(0);
    expect(test.store.notifications).toHaveLength(0);
    expect(h.store.automations.get(AUTOMATION_ID)?.consecutiveFailures).toBe(0);
  });

  it(`pauses the workflow after ${AUTOMATION_AUTO_PAUSE_AFTER_FAILURES} failed runs in a row and deletes its schedule`, async () => {
    const deleted: string[] = [];
    const client = {
      schedule: {
        getHandle: (id: string) => ({
          delete: async () => {
            deleted.push(id);
          },
        }),
      },
    } as unknown as Client;
    const { h, end } = live({ client });

    for (let i = 0; i < AUTOMATION_AUTO_PAUSE_AFTER_FAILURES - 1; i++) await end(i * 1_000);
    expect(h.store.automations.get(AUTOMATION_ID)?.status).toBe('ACTIVE');

    // A success resets the count.
    await end(10_000, 'succeeded');
    for (let i = 0; i < AUTOMATION_AUTO_PAUSE_AFTER_FAILURES - 1; i++) await end(20_000 + i);
    expect(h.store.automations.get(AUTOMATION_ID)?.status).toBe('ACTIVE');

    const fifth = await end(30_000);

    expect(h.store.automations.get(AUTOMATION_ID)?.status).toBe('PAUSED');
    const paused = h.store.notifications.filter(
      (n) => n.type === AUTOMATION_NOTIFICATION_TYPES.paused,
    );
    expect(paused).toHaveLength(1);
    expect(paused[0]).toMatchObject({
      title: 'Workflow paused',
      content:
        'Publishing Report was paused after 5 failed runs in a row. Fix it and turn it back on.',
      link: `/${ORG}/workflows/${AUTOMATION_ID}?tab=runs&run=${fifth}`,
    });
    expect(deleted).toEqual([`automation-schedule:${AUTOMATION_ID}`]);

    // Already paused: a sixth failure alerts (grouped) but pauses nothing again.
    await end(40_000);
    expect(
      h.store.notifications.filter((n) => n.type === AUTOMATION_NOTIFICATION_TYPES.paused),
    ).toHaveLength(1);
    expect(deleted).toHaveLength(1);
  });
});
