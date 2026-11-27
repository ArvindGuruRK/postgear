/**
 * `clipAutoEditWorkflow` (Sprint 13, Module 10) on the time-skipping test
 * server: one `clipAutoEdit` activity. Done settles and books nothing else;
 * a `transcribe_failed` (the listen job did not finish) is tried once and
 * booked with that code; a cancel while it waits books a cancel, never a
 * failure.
 */
import { CANCEL_SIGNAL, CLIP_FAILURE_TYPES } from '@postgear/scheduling';
import { Context } from '@temporalio/activity';
import { ApplicationFailure, CancelledFailure } from '@temporalio/common';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { clipAutoEditWorkflow } from './job.workflows';

jest.setTimeout(180_000);

const TASK_QUEUE = 'test-auto-edit';
const input = { jobId: '11111111-2222-4333-8444-555555555555', organizationId: 'org-1' };

function mocks(overrides: Record<string, jest.Mock> = {}) {
  return {
    clipAutoEdit: jest.fn().mockResolvedValue({ status: 'done' }),
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
  activities: ReturnType<typeof mocks>,
  workflowId: string,
  during?: (handle: { signal: (name: string) => Promise<void> }) => Promise<void>,
) {
  const worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue: TASK_QUEUE,
    workflowsPath: require.resolve('../index'),
    activities,
    maxHeartbeatThrottleInterval: '100 milliseconds',
  });
  return worker.runUntil(async () => {
    const handle = await env.client.workflow.start(clipAutoEditWorkflow, {
      taskQueue: TASK_QUEUE,
      workflowId,
      args: [input],
    });
    if (during) await during(handle);
    return handle.result();
  });
}

describe('clipAutoEditWorkflow', () => {
  it('a finished edit settles and books nothing else', async () => {
    const activities = mocks();
    await expect(run(activities, 'auto-edit-done')).resolves.toBe('done');
    expect(activities.clipAutoEdit).toHaveBeenCalledWith(input);
    expect(activities.clipJobFailed).not.toHaveBeenCalled();
    expect(activities.clipJobCancelled).not.toHaveBeenCalled();
    expect(activities.clipJobSettled).toHaveBeenCalledWith(input);
  });

  it('a listen job that did not finish is tried once and booked as transcribe_failed', async () => {
    const activities = mocks({
      clipAutoEdit: jest.fn().mockRejectedValue(
        ApplicationFailure.create({
          message: 'clip failed: transcribe_failed',
          type: CLIP_FAILURE_TYPES.permanent,
          nonRetryable: true,
          details: [{ code: 'transcribe_failed' }],
        }),
      ),
    });
    await expect(run(activities, 'auto-edit-listen-failed')).resolves.toBe('failed');
    expect(activities.clipAutoEdit).toHaveBeenCalledTimes(1);
    expect(activities.clipJobFailed).toHaveBeenCalledWith({ ...input, code: 'transcribe_failed' });
    expect(activities.clipJobSettled).toHaveBeenCalledWith(input);
  });

  it('a cancel while it waits for the listening books a cancel', async () => {
    let started: () => void = () => undefined;
    const waiting = new Promise<void>((resolve) => {
      started = resolve;
    });
    const activities = mocks({
      clipAutoEdit: jest.fn(async () => {
        const context = Context.current();
        started();
        for (;;) {
          context.heartbeat();
          if (context.cancellationSignal.aborted) throw new CancelledFailure('cancelled');
          await context.sleep(50).catch(() => undefined);
        }
      }),
    });
    const outcome = await run(activities, 'auto-edit-cancel', async (handle) => {
      await waiting;
      await handle.signal(CANCEL_SIGNAL);
    });
    expect(outcome).toBe('cancelled');
    expect(activities.clipJobCancelled).toHaveBeenCalledWith(input);
    expect(activities.clipJobFailed).not.toHaveBeenCalled();
  });
});
