/**
 * `clipFacesWorkflow` (Sprint 13, Module 07) on the time-skipping test
 * server: prepare, `mediaPyDetectFaces` on the Python queue, finish. A failed
 * detector books a failure, a cancel while Python looks books a cancel (both
 * bookkeepings delete the face file), a closed job ends quietly.
 */
import { CANCEL_SIGNAL, MEDIA_PY_TASK_QUEUE } from '@postgear/scheduling';
import { ApplicationFailure } from '@temporalio/common';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { clipFacesWorkflow } from './job.workflows';

jest.setTimeout(180_000);

const TASK_QUEUE = 'test-faces';
const input = { jobId: '11111111-2222-4333-8444-555555555555', organizationId: 'org-1' };
const HEX = '11111111222243338444555555555555';
const BASE = 'clips/org-1/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const payload = { version: 1, jobId: input.jobId, ranges: [{ fromMs: 0, toMs: 60_000 }] };
const found = {
  facesKey: `${BASE}/faces-${HEX}.json.gz`,
  sampled: 300,
  found: 290,
  producer: 'simulation',
};

function nodeMocks(overrides: Record<string, jest.Mock> = {}) {
  return {
    clipFacesPrepare: jest.fn().mockResolvedValue({ status: 'ready', payload }),
    clipFacesFinish: jest.fn().mockResolvedValue({ status: 'done' }),
    clipJobFailed: jest.fn().mockResolvedValue(true),
    clipJobCancelled: jest.fn().mockResolvedValue(true),
    clipJobSettled: jest.fn().mockResolvedValue(undefined),
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
  detect: jest.Mock,
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
      activities: { mediaPyDetectFaces: detect },
      maxHeartbeatThrottleInterval: '100 milliseconds',
    }),
  ]);
  return pythonStandIn.runUntil(
    nodeWorker.runUntil(async () => {
      const handle = await env.client.workflow.start(clipFacesWorkflow, {
        taskQueue: TASK_QUEUE,
        workflowId,
        args: [input],
      });
      if (during) await during(handle);
      return handle.result();
    }),
  );
}

describe('clipFacesWorkflow', () => {
  it('prepares, looks for faces on the Python queue and finishes with the file key', async () => {
    const node = nodeMocks();
    const detect = jest.fn().mockResolvedValue(found);
    await expect(run(node, detect, 'faces-done')).resolves.toBe('done');
    expect(detect).toHaveBeenCalledWith(payload);
    expect(node.clipFacesFinish).toHaveBeenCalledWith({ ...input, found });
    expect(node.clipJobFailed).not.toHaveBeenCalled();
  });

  it('a closed job ends quietly without looking', async () => {
    const node = nodeMocks({ clipFacesPrepare: jest.fn().mockResolvedValue({ status: 'closed' }) });
    const detect = jest.fn();
    await expect(run(node, detect, 'faces-closed')).resolves.toBe('closed');
    expect(detect).not.toHaveBeenCalled();
  });

  it('a failed detector books a failure', async () => {
    const node = nodeMocks();
    const detect = jest
      .fn()
      .mockRejectedValue(
        ApplicationFailure.create({ message: 'no', type: 'MEDIA_BAD_VIDEO', nonRetryable: true }),
      );
    await expect(run(node, detect, 'faces-failed')).resolves.toBe('failed');
    expect(node.clipJobFailed).toHaveBeenCalledTimes(1);
    expect(node.clipFacesFinish).not.toHaveBeenCalled();
  });

  it('a cancel while Python looks books a cancel', async () => {
    const node = nodeMocks();
    let started: () => void = () => undefined;
    const looking = new Promise<void>((resolve) => {
      started = resolve;
    });
    const detect = jest.fn(async () => {
      const { Context } = await import('@temporalio/activity');
      const context = Context.current();
      started();
      for (;;) {
        context.heartbeat();
        await context.sleep(50);
      }
    });
    const outcome = await run(node, detect, 'faces-cancel', async (handle) => {
      await looking;
      await handle.signal(CANCEL_SIGNAL);
    });
    expect(outcome).toBe('cancelled');
    expect(node.clipJobCancelled).toHaveBeenCalledWith(input);
    expect(node.clipFacesFinish).not.toHaveBeenCalled();
  });
});
