/**
 * `clipSpeechWorkflow` (Sprint 13, Module 09) on the time-skipping test
 * server: prepare, `mediaPySpeak` on the Python queue, finish. A failed
 * speaker books a failure, a cancel while Python speaks books a cancel (both
 * bookkeepings remove the job's files and give the AI minutes back), a
 * closed job ends quietly. The payload carries keys, never the line.
 */
import { CANCEL_SIGNAL, MEDIA_PY_TASK_QUEUE } from '@postgear/scheduling';
import { ApplicationFailure } from '@temporalio/common';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { clipSpeechWorkflow } from './job.workflows';

jest.setTimeout(180_000);

const TASK_QUEUE = 'test-speech';
const input = { jobId: '11111111-2222-4333-8444-555555555555', organizationId: 'org-1' };
const BASE = 'clips/org-1/library/11111111222243338444555555555555';
const payload = {
  version: 1,
  jobId: input.jobId,
  orgId: 'org-1',
  textKey: `${BASE}.json`,
  voiceId: 'sim-river',
  outKey: `${BASE}.wav`,
  simulation: { force: null },
};
const spoken = {
  soundKey: `${BASE}.wav`,
  durationMs: 3_000,
  sampleRate: 24_000,
  producer: 'simulation',
};

function nodeMocks(overrides: Record<string, jest.Mock> = {}) {
  return {
    clipSpeechPrepare: jest.fn().mockResolvedValue({ status: 'ready', payload }),
    clipSpeechFinish: jest.fn().mockResolvedValue({ status: 'done' }),
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
  speak: jest.Mock,
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
      activities: { mediaPySpeak: speak },
      maxHeartbeatThrottleInterval: '100 milliseconds',
    }),
  ]);
  return pythonStandIn.runUntil(
    nodeWorker.runUntil(async () => {
      const handle = await env.client.workflow.start(clipSpeechWorkflow, {
        taskQueue: TASK_QUEUE,
        workflowId,
        args: [input],
      });
      if (during) await during(handle);
      return handle.result();
    }),
  );
}

describe('clipSpeechWorkflow', () => {
  it('prepares, speaks on the Python queue and finishes with the WAV key', async () => {
    const node = nodeMocks();
    const speak = jest.fn().mockResolvedValue(spoken);
    await expect(run(node, speak, 'speech-done')).resolves.toBe('done');
    expect(speak).toHaveBeenCalledWith(payload);
    expect(Object.keys(speak.mock.calls[0][0])).not.toContain('text');
    expect(node.clipSpeechFinish).toHaveBeenCalledWith({ ...input, spoken });
    expect(node.clipJobFailed).not.toHaveBeenCalled();
    expect(node.clipJobSettled).toHaveBeenCalledWith(input);
  });

  it('a closed job ends quietly without speaking', async () => {
    const node = nodeMocks({
      clipSpeechPrepare: jest.fn().mockResolvedValue({ status: 'closed' }),
    });
    const speak = jest.fn();
    await expect(run(node, speak, 'speech-closed')).resolves.toBe('closed');
    expect(speak).not.toHaveBeenCalled();
  });

  it('a speaker that is off books a failure at once', async () => {
    const node = nodeMocks();
    const speak = jest
      .fn()
      .mockRejectedValue(
        ApplicationFailure.create({
          message: 'off',
          type: 'MEDIA_BINDING_OFF',
          nonRetryable: true,
        }),
      );
    await expect(run(node, speak, 'speech-failed')).resolves.toBe('failed');
    expect(speak).toHaveBeenCalledTimes(1);
    expect(node.clipJobFailed).toHaveBeenCalledTimes(1);
    expect(node.clipSpeechFinish).not.toHaveBeenCalled();
  });

  it('a cancel while Python speaks books a cancel', async () => {
    const node = nodeMocks();
    let started: () => void = () => undefined;
    const speaking = new Promise<void>((resolve) => {
      started = resolve;
    });
    const speak = jest.fn(async () => {
      const { Context } = await import('@temporalio/activity');
      const context = Context.current();
      started();
      for (;;) {
        context.heartbeat();
        await context.sleep(50);
      }
    });
    const outcome = await run(node, speak, 'speech-cancel', async (handle) => {
      await speaking;
      await handle.signal(CANCEL_SIGNAL);
    });
    expect(outcome).toBe('cancelled');
    expect(node.clipJobCancelled).toHaveBeenCalledWith(input);
    expect(node.clipSpeechFinish).not.toHaveBeenCalled();
  });
});
