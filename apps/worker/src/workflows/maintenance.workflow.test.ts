/**
 * The maintenance pass against a time-skipping Temporal test server with its
 * activities mocked. Pinned here: the order of the steps in one pass (the
 * Media posters backfill runs last, after the Clips sweep), and that a
 * failing sweep or backfill never stops the loop.
 */
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import type { Activities } from '../activities';
import { maintenanceWorkflow } from './maintenance.workflow';

jest.setTimeout(180_000);

const TASK_QUEUE = 'test-maintenance';

type StepName =
  | 'reconcileSchedules'
  | 'pruneAutomationRuns'
  | 'discoverMaintenance'
  | 'clipsReconcile'
  | 'clipsSweep'
  | 'mediaVideoFactsBackfill';

type Mocks = Pick<{ [K in keyof Activities]: jest.Mock }, StepName>;

let env: TestWorkflowEnvironment;

beforeAll(async () => {
  env = await TestWorkflowEnvironment.createTimeSkipping();
});

afterAll(async () => {
  await env?.teardown();
});

/** Every step answers at once and records itself; `fail` names the steps that throw on the first pass. */
function steps(fail: StepName[] = []) {
  const calls: StepName[] = [];
  const waiting: { call: number; resolve: () => void }[] = [];
  const step = (name: StepName) =>
    jest.fn(async () => {
      calls.push(name);
      const pass = calls.filter((call) => call === name).length;
      if (name === 'mediaVideoFactsBackfill') {
        for (const waiter of waiting.filter((entry) => entry.call <= pass)) waiter.resolve();
      }
      if (pass === 1 && fail.includes(name)) throw new Error(`${name} failed`);
      return {};
    });
  const activities: Mocks = {
    reconcileSchedules: step('reconcileSchedules'),
    pruneAutomationRuns: step('pruneAutomationRuns'),
    discoverMaintenance: step('discoverMaintenance'),
    clipsReconcile: step('clipsReconcile'),
    clipsSweep: step('clipsSweep'),
    mediaVideoFactsBackfill: step('mediaVideoFactsBackfill'),
  };
  /** Resolves once the backfill has been called `call` times (1 for the first pass). */
  const backfillCall = (call: number) =>
    new Promise<void>((resolve) => waiting.push({ call, resolve }));
  return { activities, calls, backfillCall };
}

type Handle = Awaited<ReturnType<typeof env.client.workflow.start<typeof maintenanceWorkflow>>>;

/**
 * Waits until the loop has no activity in flight (it sleeps between passes).
 * Ending it, or moving the clock, with an activity still running would leave
 * the test server holding its clock until that activity's timeout, in real
 * time, which slows every later test.
 */
async function settled(handle: Handle): Promise<void> {
  for (;;) {
    const described = await handle.describe();
    if ((described.raw.pendingActivities ?? []).length === 0) return;
    // A quarter second: polling faster flooded the test server during a full
    // `npm run validate` (gRPC "excess pings", a 60 s reconnect) and timed out.
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/**
 * Starts the loop on a queue of its own, runs `drive` against it, and ends
 * it (the loop never ends by itself) once it is between passes.
 */
async function runLoop(
  activities: Mocks,
  workflowId: string,
  drive: (handle: Handle) => Promise<void>,
): Promise<void> {
  const taskQueue = `${TASK_QUEUE}-${workflowId}`;
  const worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue,
    workflowsPath: require.resolve('./index'),
    activities,
  });
  await worker.runUntil(async () => {
    const handle = await env.client.workflow.start(maintenanceWorkflow, { taskQueue, workflowId });
    await drive(handle);
    await settled(handle);
    await handle.terminate('test done');
  });
}

describe('maintenanceWorkflow', () => {
  it('runs the Media posters backfill last in a pass, after the Clips sweep', async () => {
    const { activities, calls, backfillCall } = steps();

    const first = backfillCall(1);
    await runLoop(activities, 'maintenance-order', () => first);

    expect(calls.slice(0, 6)).toEqual([
      'reconcileSchedules',
      'pruneAutomationRuns',
      'discoverMaintenance',
      'clipsReconcile',
      'clipsSweep',
      'mediaVideoFactsBackfill',
    ]);
  });

  it('keeps going when the sweep and the backfill fail, and backfills again next pass', async () => {
    const { activities, backfillCall } = steps(['clipsSweep', 'mediaVideoFactsBackfill']);

    const first = backfillCall(1);
    const second = backfillCall(2);
    await runLoop(activities, 'maintenance-failures', async (handle) => {
      await first;
      await settled(handle);
      // The fifteen minutes between passes, skipped.
      await env.sleep('16 minutes');
      await second;
    });

    expect(activities.clipsSweep.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(activities.mediaVideoFactsBackfill.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
