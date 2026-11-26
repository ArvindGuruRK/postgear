/**
 * `clipTranscribeWorkflow` (Sprint 13, Module 02) on the time-skipping test
 * server: prepare, the Python call on its own queue, finish; a closed job
 * ends quietly; a Python failure is booked once with its code; a cancel
 * books a cancel, never a failure.
 */
import { CANCEL_SIGNAL, MEDIA_PY_TASK_QUEUE } from '@postgear/scheduling';
import { ApplicationFailure } from '@temporalio/common';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { clipTranscribeWorkflow } from './job.workflows';

jest.setTimeout(180_000);

const TASK_QUEUE = 'test-transcribe';
const input = { jobId: '11111111-2222-4333-8444-555555555555', organizationId: 'org-1' };
const payload = { version: 1, jobId: input.jobId, ranges: [{ fromMs: 0, toMs: 60_000 }] };
const heard = {
  heardKey:
    'clips/org-1/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/heard-11111111222243338444555555555555.json.gz',
  language: 'en',
  languageProbability: null,
  model: 'simulation',
  secondsListened: 60,
  wordCount: 120,
  noSpeech: false,
};

function nodeMocks(overrides: Record<string, jest.Mock> = {}) {
  return {
    clipTranscribePrepare: jest.fn().mockResolvedValue({ status: 'ready', payload }),
    clipTranscribeFinish: jest.fn().mockResolvedValue({ status: 'done' }),
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
  mediaPyTranscribe: jest.Mock,
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
      activities: { mediaPyTranscribe },
      maxHeartbeatThrottleInterval: '100 milliseconds',
    }),
  ]);
  return pythonStandIn.runUntil(
    nodeWorker.runUntil(async () => {
      const handle = await env.client.workflow.start(clipTranscribeWorkflow, {
        taskQueue: TASK_QUEUE,
        workflowId,
        args: [input],
      });
      if (during) await during(handle);
      return handle.result();
    }),
  );
}

describe('clipTranscribeWorkflow', () => {
  it('prepares, listens on the Python queue, finishes, and settles', async () => {
    const node = nodeMocks();
    const python = jest.fn().mockResolvedValue(heard);
    await expect(run(node, python, 'transcribe-done')).resolves.toBe('done');
    expect(node.clipTranscribePrepare).toHaveBeenCalledWith(input);
    expect(python).toHaveBeenCalledWith(payload);
    expect(node.clipTranscribeFinish).toHaveBeenCalledWith({ ...input, heard });
    expect(node.clipJobFailed).not.toHaveBeenCalled();
    expect(node.clipJobSettled).toHaveBeenCalledTimes(1);
  });

  it('a job closed before it started never reaches Python', async () => {
    const node = nodeMocks({
      clipTranscribePrepare: jest.fn().mockResolvedValue({ status: 'closed' }),
    });
    const python = jest.fn();
    await expect(run(node, python, 'transcribe-closed')).resolves.toBe('closed');
    expect(python).not.toHaveBeenCalled();
    expect(node.clipTranscribeFinish).not.toHaveBeenCalled();
    expect(node.clipJobSettled).toHaveBeenCalledTimes(1);
  });

  it('a Python failure a retry cannot fix is tried once and booked as a failure', async () => {
    const node = nodeMocks();
    const python = jest
      .fn()
      .mockRejectedValue(
        ApplicationFailure.create({
          message: 'bad sound',
          type: 'MEDIA_BAD_AUDIO',
          nonRetryable: true,
        }),
      );
    await expect(run(node, python, 'transcribe-bad-audio')).resolves.toBe('failed');
    expect(python).toHaveBeenCalledTimes(1);
    expect(node.clipJobFailed).toHaveBeenCalledWith({ ...input, code: 'tool_failed' });
    expect(node.clipTranscribeFinish).not.toHaveBeenCalled();
    expect(node.clipJobSettled).toHaveBeenCalledTimes(1);
  });

  it('a failure worth another try is tried twice, then booked once', async () => {
    const node = nodeMocks();
    const python = jest
      .fn()
      .mockRejectedValue(ApplicationFailure.create({ message: 'busy', type: 'MEDIA_TOOL_FAILED' }));
    await expect(run(node, python, 'transcribe-retry')).resolves.toBe('failed');
    expect(python).toHaveBeenCalledTimes(2);
    expect(node.clipJobFailed).toHaveBeenCalledTimes(1);
  });

  it('a cancel while Python listens books a cancel, never a failure', async () => {
    const node = nodeMocks();
    let started: () => void = () => undefined;
    const listening = new Promise<void>((resolve) => {
      started = resolve;
    });
    const python = jest.fn(async () => {
      const { Context } = await import('@temporalio/activity');
      const context = Context.current();
      started();
      for (;;) {
        context.heartbeat();
        await context.sleep(50);
      }
    });
    const outcome = await run(
      node,
      python as unknown as jest.Mock,
      'transcribe-cancel',
      async (handle) => {
        await listening;
        await handle.signal(CANCEL_SIGNAL);
      },
    );
    expect(outcome).toBe('cancelled');
    expect(node.clipJobCancelled).toHaveBeenCalledWith(input);
    expect(node.clipJobFailed).not.toHaveBeenCalled();
    expect(node.clipTranscribeFinish).not.toHaveBeenCalled();
  });
});
