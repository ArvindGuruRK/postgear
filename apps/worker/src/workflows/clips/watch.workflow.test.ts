/**
 * `clipHighlightsWorkflow` with Look For Action (Sprint 13, Module 06) on the
 * time-skipping test server: gather, the motion measure and the stills on
 * the Python queue, look, finish. A failed motion measure or failed stills
 * never fail the run; a cancel while Python watches books a cancel.
 */
import { CANCEL_SIGNAL, MEDIA_PY_TASK_QUEUE } from '@postgear/scheduling';
import { ApplicationFailure } from '@temporalio/common';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { clipHighlightsWorkflow } from './job.workflows';

jest.setTimeout(180_000);

const TASK_QUEUE = 'test-watch';
const input = { jobId: '11111111-2222-4333-8444-555555555555', organizationId: 'org-1' };
const HEX = '11111111222243338444555555555555';
const BASE = 'clips/org-1/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const motionInput = { version: 1, jobId: input.jobId, ranges: [{ fromMs: 0, toMs: 60_000 }] };
const stillsInput = { version: 1, jobId: input.jobId, momentsMs: [1_000, 2_000, 3_000, 4_000] };
const MOTION_KEY = `${BASE}/motion-${HEX}.json.gz`;
const STILL_KEYS = [0, 1, 2, 3].map((n) => `${BASE}/still-${n}-${HEX}.jpg`);

function nodeMocks(overrides: Record<string, jest.Mock> = {}) {
  return {
    clipHighlights: jest.fn().mockResolvedValue({ status: 'watch', motion: motionInput }),
    clipHighlightsLook: jest.fn().mockResolvedValue({ status: 'look', stills: stillsInput }),
    clipHighlightsFinish: jest.fn().mockResolvedValue({ status: 'done' }),
    clipJobFailed: jest.fn().mockResolvedValue(true),
    clipJobCancelled: jest.fn().mockResolvedValue(true),
    clipJobSettled: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function pythonMocks(overrides: Record<string, jest.Mock> = {}) {
  return {
    mediaPyMotion: jest
      .fn()
      .mockResolvedValue({ trackKey: MOTION_KEY, sampled: 120, producer: 'simulation' }),
    mediaPyStills: jest.fn().mockResolvedValue({ keys: STILL_KEYS }),
    ...overrides,
  };
}

let env: TestWorkflowEnvironment;
beforeAll(async () => {
  env = await TestWorkflowEnvironment.createTimeSkipping();
});
afterAll(async () => {
  await env?.teardown();
});

async function run(
  node: ReturnType<typeof nodeMocks>,
  python: ReturnType<typeof pythonMocks>,
  workflowId: string,
  during?: (handle: { signal: (name: string) => Promise<void> }) => Promise<void>,
) {
  const [nodeWorker, pythonStandIn] = await Promise.all([
    Worker.create({
      connection: env.nativeConnection,
      taskQueue: TASK_QUEUE,
      workflowsPath: require.resolve('../index'),
      activities: node,
    }),
    Worker.create({
      connection: env.nativeConnection,
      taskQueue: MEDIA_PY_TASK_QUEUE,
      activities: python,
      maxHeartbeatThrottleInterval: '100 milliseconds',
    }),
  ]);
  return pythonStandIn.runUntil(
    nodeWorker.runUntil(async () => {
      const handle = await env.client.workflow.start(clipHighlightsWorkflow, {
        taskQueue: TASK_QUEUE,
        workflowId,
        args: [input],
      });
      if (during) await during(handle);
      return handle.result();
    }),
  );
}

const permanent = (message: string) =>
  ApplicationFailure.create({ message, type: 'MEDIA_BAD_VIDEO', nonRetryable: true });

describe('clipHighlightsWorkflow with Look For Action', () => {
  it('gathers, measures motion, looks, cuts stills and finishes with their keys', async () => {
    const node = nodeMocks();
    const python = pythonMocks();
    await expect(run(node, python, 'watch-done')).resolves.toBe('done');
    expect(python.mediaPyMotion).toHaveBeenCalledWith(motionInput);
    expect(node.clipHighlightsLook).toHaveBeenCalledWith({
      ...input,
      motionKey: MOTION_KEY,
      motionFailed: false,
    });
    expect(python.mediaPyStills).toHaveBeenCalledWith(stillsInput);
    expect(node.clipHighlightsFinish).toHaveBeenCalledWith({ ...input, stillKeys: STILL_KEYS });
    expect(node.clipJobFailed).not.toHaveBeenCalled();
    expect(node.clipJobSettled).toHaveBeenCalledTimes(1);
  });

  it('a run without Look For Action is the one step it always was', async () => {
    const node = nodeMocks({ clipHighlights: jest.fn().mockResolvedValue({ status: 'done' }) });
    const python = pythonMocks();
    await expect(run(node, python, 'watch-quick')).resolves.toBe('done');
    expect(python.mediaPyMotion).not.toHaveBeenCalled();
    expect(node.clipHighlightsLook).not.toHaveBeenCalled();
    expect(node.clipHighlightsFinish).not.toHaveBeenCalled();
  });

  it('a stored motion track: no measure, and no stills without the vision check', async () => {
    const node = nodeMocks({
      clipHighlights: jest.fn().mockResolvedValue({ status: 'watch', motion: null }),
      clipHighlightsLook: jest.fn().mockResolvedValue({ status: 'look', stills: null }),
    });
    const python = pythonMocks();
    await expect(run(node, python, 'watch-stored')).resolves.toBe('done');
    expect(python.mediaPyMotion).not.toHaveBeenCalled();
    expect(python.mediaPyStills).not.toHaveBeenCalled();
    expect(node.clipHighlightsLook).toHaveBeenCalledWith({
      ...input,
      motionKey: null,
      motionFailed: false,
    });
    expect(node.clipHighlightsFinish).toHaveBeenCalledWith({ ...input, stillKeys: null });
  });

  it('a failed motion measure does not fail the run: the look is told, the run finishes', async () => {
    const node = nodeMocks({
      clipHighlightsLook: jest.fn().mockResolvedValue({ status: 'look', stills: null }),
    });
    const python = pythonMocks({ mediaPyMotion: jest.fn().mockRejectedValue(permanent('no')) });
    await expect(run(node, python, 'watch-motion-failed')).resolves.toBe('done');
    expect(node.clipHighlightsLook).toHaveBeenCalledWith({
      ...input,
      motionKey: null,
      motionFailed: true,
    });
    expect(node.clipJobFailed).not.toHaveBeenCalled();
  });

  it('failed stills leave the bursts unchecked, and the run finishes', async () => {
    const node = nodeMocks();
    const python = pythonMocks({ mediaPyStills: jest.fn().mockRejectedValue(permanent('no')) });
    await expect(run(node, python, 'watch-stills-failed')).resolves.toBe('done');
    expect(node.clipHighlightsFinish).toHaveBeenCalledWith({ ...input, stillKeys: null });
    expect(node.clipJobFailed).not.toHaveBeenCalled();
  });

  it('a job closed during the look ends quietly', async () => {
    const node = nodeMocks({
      clipHighlightsLook: jest.fn().mockResolvedValue({ status: 'closed', stills: null }),
    });
    const python = pythonMocks();
    await expect(run(node, python, 'watch-closed')).resolves.toBe('closed');
    expect(python.mediaPyStills).not.toHaveBeenCalled();
    expect(node.clipHighlightsFinish).not.toHaveBeenCalled();
  });

  it('a cancel while Python measures books a cancel (its bookkeeping deletes the files)', async () => {
    const node = nodeMocks();
    let started: () => void = () => undefined;
    const measuring = new Promise<void>((resolve) => {
      started = resolve;
    });
    const python = pythonMocks({
      mediaPyMotion: jest.fn(async () => {
        const { Context } = await import('@temporalio/activity');
        const context = Context.current();
        started();
        for (;;) {
          context.heartbeat();
          await context.sleep(50);
        }
      }) as unknown as jest.Mock,
    });
    const outcome = await run(node, python, 'watch-cancel', async (handle) => {
      await measuring;
      await handle.signal(CANCEL_SIGNAL);
    });
    expect(outcome).toBe('cancelled');
    expect(node.clipJobCancelled).toHaveBeenCalledWith(input);
    expect(node.clipJobFailed).not.toHaveBeenCalled();
    expect(node.clipHighlightsLook).not.toHaveBeenCalled();
  });
});
