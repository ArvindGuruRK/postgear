/**
 * The clip workflows against a time-skipping Temporal test server with the
 * activities mocked (the same harness as the publishing workflows' tests).
 * What is pinned: a finished job settles and books nothing else; a permanent
 * failure is tried once and booked with its code; a retryable one is tried
 * as often as the policy says; a cancel stops the running activity and books
 * a cancel, never a failure; an export waits for a running sharp range; a
 * probe failure reaches the API with our code on the cause.
 */
import { CANCEL_SIGNAL, CLIP_FAILURE_TYPES, CLIP_RETRY_POLICY } from '@postgear/scheduling';
import { Context } from '@temporalio/activity';
import { WorkflowFailedError } from '@temporalio/client';
import { ApplicationFailure, CancelledFailure } from '@temporalio/common';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import type { ClipActivities } from '../../clips/activities';
import {
  clipDownloadWorkflow,
  clipHighlightsWorkflow,
  clipImportWorkflow,
  clipRenderWorkflow,
  clipSaveDownloadWorkflow,
} from './job.workflows';
import { clipProbeWorkflow } from './query.workflows';
import { clipSoundCheckWorkflow } from './sound-check.workflow';
import { clipStickerCheckWorkflow } from './sticker-check.workflow';

jest.setTimeout(180_000);

const TASK_QUEUE = 'test-clips';
const input = { jobId: '11111111-2222-4333-8444-555555555555', organizationId: 'org-1' };

type Mocks = { [K in keyof ClipActivities]: jest.Mock };

function mocks(overrides: Partial<Mocks> = {}): Mocks {
  return {
    clipRuntimeCheck: jest.fn(),
    clipProbeLink: jest.fn(),
    clipListChannel: jest.fn(),
    clipCheckSticker: jest.fn(),
    clipCheckSound: jest.fn(),
    clipImport: jest.fn().mockResolvedValue({ status: 'done' }),
    clipSegment: jest.fn().mockResolvedValue({ status: 'done' }),
    clipHighlights: jest.fn().mockResolvedValue({ status: 'done' }),
    clipHighlightsLook: jest.fn().mockResolvedValue({ status: 'look', stills: null }),
    clipHighlightsFinish: jest.fn().mockResolvedValue({ status: 'done' }),
    clipFacesPrepare: jest.fn().mockResolvedValue({ status: 'closed' }),
    clipFacesFinish: jest.fn().mockResolvedValue({ status: 'done' }),
    clipSpeechPrepare: jest.fn().mockResolvedValue({ status: 'closed' }),
    clipSpeechFinish: jest.fn().mockResolvedValue({ status: 'done' }),
    clipTranscribePrepare: jest.fn().mockResolvedValue({ status: 'closed' }),
    clipTranscribeFinish: jest.fn().mockResolvedValue({ status: 'done' }),
    clipRenderWaitState: jest.fn().mockResolvedValue({ closed: false, segmentRunning: false }),
    clipRender: jest.fn().mockResolvedValue({ status: 'done' }),
    clipDownload: jest.fn().mockResolvedValue({ status: 'done' }),
    clipAutoEdit: jest.fn().mockResolvedValue({ status: 'done' }),
    clipSaveDownload: jest.fn().mockResolvedValue({ mediaId: 'media-1' }),
    clipSaveDownloadFailed: jest.fn().mockResolvedValue(undefined),
    clipJobFailed: jest.fn().mockResolvedValue(true),
    clipJobCancelled: jest.fn().mockResolvedValue(true),
    clipJobSettled: jest.fn().mockResolvedValue(undefined),
    mediaVideoFacts: jest.fn(),
    mediaVideoFactsGaveUp: jest.fn(),
    ...overrides,
  };
}

const failure = (code: string, retryable: boolean) =>
  ApplicationFailure.create({
    message: `clip failed: ${code}`,
    type: retryable ? CLIP_FAILURE_TYPES.retryable : CLIP_FAILURE_TYPES.permanent,
    nonRetryable: !retryable,
    details: [{ code }],
  });

let env: TestWorkflowEnvironment;

beforeAll(async () => {
  env = await TestWorkflowEnvironment.createTimeSkipping();
});

afterAll(async () => {
  await env?.teardown();
});

function worker(activities: Mocks) {
  return Worker.create({
    connection: env.nativeConnection,
    taskQueue: TASK_QUEUE,
    workflowsPath: require.resolve('../index'),
    activities,
    // As the clip workers do: a cancel reaches a heartbeating activity at once.
    maxHeartbeatThrottleInterval: '100 milliseconds',
  });
}

describe('clipImportWorkflow', () => {
  it('a finished import settles and books nothing else', async () => {
    const activities = mocks();
    const outcome = await (await worker(activities)).runUntil(
      env.client.workflow.execute(clipImportWorkflow, {
        taskQueue: TASK_QUEUE,
        workflowId: 'clip-import-done',
        args: [input],
      }),
    );
    expect(outcome).toBe('done');
    expect(activities.clipImport).toHaveBeenCalledWith(input);
    expect(activities.clipJobFailed).not.toHaveBeenCalled();
    expect(activities.clipJobCancelled).not.toHaveBeenCalled();
    expect(activities.clipJobSettled).toHaveBeenCalledWith(input);
  });

  it('a permanent failure is tried once and booked with its code', async () => {
    const activities = mocks({
      clipImport: jest.fn().mockRejectedValue(failure('upload_not_video', false)),
    });
    const outcome = await (await worker(activities)).runUntil(
      env.client.workflow.execute(clipImportWorkflow, {
        taskQueue: TASK_QUEUE,
        workflowId: 'clip-import-permanent',
        args: [input],
      }),
    );
    expect(outcome).toBe('failed');
    expect(activities.clipImport).toHaveBeenCalledTimes(1);
    expect(activities.clipJobFailed).toHaveBeenCalledWith({ ...input, code: 'upload_not_video' });
    expect(activities.clipJobSettled).toHaveBeenCalledTimes(1);
  });

  it('a retryable failure is tried as often as the policy allows, then booked once', async () => {
    const activities = mocks({
      clipImport: jest.fn().mockRejectedValue(failure('tool_failed', true)),
    });
    const outcome = await (await worker(activities)).runUntil(
      env.client.workflow.execute(clipImportWorkflow, {
        taskQueue: TASK_QUEUE,
        workflowId: 'clip-import-retryable',
        args: [input],
      }),
    );
    expect(outcome).toBe('failed');
    expect(activities.clipImport).toHaveBeenCalledTimes(CLIP_RETRY_POLICY.maximumAttempts);
    expect(activities.clipJobFailed).toHaveBeenCalledTimes(1);
    expect(activities.clipJobFailed).toHaveBeenCalledWith({ ...input, code: 'tool_failed' });
  });

  it('the cancel signal stops the running activity and books a cancel, not a failure', async () => {
    let started: () => void = () => undefined;
    const running = new Promise<void>((resolve) => {
      started = resolve;
    });
    const activities = mocks({
      clipImport: jest.fn(async () => {
        const context = Context.current();
        started();
        while (!context.cancellationSignal.aborted) {
          context.heartbeat();
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        throw new CancelledFailure('cancelled');
      }),
    });

    const outcome = await (await worker(activities)).runUntil(async () => {
      const handle = await env.client.workflow.start(clipImportWorkflow, {
        taskQueue: TASK_QUEUE,
        workflowId: 'clip-import-cancel',
        args: [input],
      });
      await running;
      await handle.signal(CANCEL_SIGNAL);
      return handle.result();
    });

    expect(outcome).toBe('cancelled');
    expect(activities.clipJobCancelled).toHaveBeenCalledWith(input);
    expect(activities.clipJobFailed).not.toHaveBeenCalled();
    expect(activities.clipJobSettled).toHaveBeenCalledWith(input);
  });

  it('a job closed by someone else ends quietly', async () => {
    const activities = mocks({ clipImport: jest.fn().mockResolvedValue({ status: 'closed' }) });
    const outcome = await (await worker(activities)).runUntil(
      env.client.workflow.execute(clipImportWorkflow, {
        taskQueue: TASK_QUEUE,
        workflowId: 'clip-import-closed',
        args: [input],
      }),
    );
    expect(outcome).toBe('closed');
    expect(activities.clipJobFailed).not.toHaveBeenCalled();
  });
});

describe('clipHighlightsWorkflow (Module 16)', () => {
  it('a finished run settles and books nothing else', async () => {
    const activities = mocks();
    const outcome = await (await worker(activities)).runUntil(
      env.client.workflow.execute(clipHighlightsWorkflow, {
        taskQueue: TASK_QUEUE,
        workflowId: 'clip-highlights-done',
        args: [input],
      }),
    );
    expect(outcome).toBe('done');
    expect(activities.clipHighlights).toHaveBeenCalledTimes(1);
    expect(activities.clipJobFailed).not.toHaveBeenCalled();
    expect(activities.clipJobSettled).toHaveBeenCalledWith(input);
  });

  it('a failed run is booked once (the bookkeeping gives the minutes back)', async () => {
    const activities = mocks({
      clipHighlights: jest.fn().mockRejectedValue(failure('highlights_failed', false)),
    });
    const outcome = await (await worker(activities)).runUntil(
      env.client.workflow.execute(clipHighlightsWorkflow, {
        taskQueue: TASK_QUEUE,
        workflowId: 'clip-highlights-failed',
        args: [input],
      }),
    );
    expect(outcome).toBe('failed');
    expect(activities.clipHighlights).toHaveBeenCalledTimes(1);
    expect(activities.clipJobFailed).toHaveBeenCalledWith({ ...input, code: 'highlights_failed' });
  });

  it('Cancel stops the run and books a cancel', async () => {
    let started: () => void = () => undefined;
    const running = new Promise<void>((resolve) => {
      started = resolve;
    });
    const activities = mocks({
      clipHighlights: jest.fn(async () => {
        const context = Context.current();
        started();
        while (!context.cancellationSignal.aborted) {
          context.heartbeat();
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        throw new CancelledFailure('cancelled');
      }),
    });
    const outcome = await (await worker(activities)).runUntil(async () => {
      const handle = await env.client.workflow.start(clipHighlightsWorkflow, {
        taskQueue: TASK_QUEUE,
        workflowId: 'clip-highlights-cancel',
        args: [input],
      });
      await running;
      await handle.signal(CANCEL_SIGNAL);
      return handle.result();
    });
    expect(outcome).toBe('cancelled');
    expect(activities.clipJobCancelled).toHaveBeenCalledWith(input);
    expect(activities.clipJobFailed).not.toHaveBeenCalled();
  });
});

describe('clipRenderWorkflow', () => {
  it('waits while the sharp range is fetched, then renders once', async () => {
    const activities = mocks({
      clipRenderWaitState: jest
        .fn()
        .mockResolvedValueOnce({ closed: false, segmentRunning: true })
        .mockResolvedValueOnce({ closed: false, segmentRunning: true })
        .mockResolvedValue({ closed: false, segmentRunning: false }),
    });
    const outcome = await (await worker(activities)).runUntil(
      env.client.workflow.execute(clipRenderWorkflow, {
        taskQueue: TASK_QUEUE,
        workflowId: 'clip-render-wait',
        args: [input],
      }),
    );
    expect(outcome).toBe('done');
    expect(activities.clipRenderWaitState).toHaveBeenCalledTimes(3);
    expect(activities.clipRenderWaitState.mock.calls.map(([arg]) => arg.first)).toEqual([
      true,
      false,
      false,
    ]);
    expect(activities.clipRender).toHaveBeenCalledTimes(1);
  });

  it('a document that cannot render fails at once with its code', async () => {
    const activities = mocks({
      clipRender: jest.fn().mockRejectedValue(failure('export_failed', false)),
    });
    const outcome = await (await worker(activities)).runUntil(
      env.client.workflow.execute(clipRenderWorkflow, {
        taskQueue: TASK_QUEUE,
        workflowId: 'clip-render-fail',
        args: [input],
      }),
    );
    expect(outcome).toBe('failed');
    expect(activities.clipRender).toHaveBeenCalledTimes(1);
    expect(activities.clipJobFailed).toHaveBeenCalledWith({ ...input, code: 'export_failed' });
  });
});

describe('clipProbeWorkflow', () => {
  const link = {
    platform: 'youtube',
    kind: 'video',
    externalId: 'simprivate1',
    canonicalUrl: 'https://www.youtube.com/watch?v=simprivate1',
  } as const;

  it('answers what the probe found', async () => {
    const info = { ...link, title: 'Sample' };
    const activities = mocks({ clipProbeLink: jest.fn().mockResolvedValue(info) });
    const answer = await (await worker(activities)).runUntil(
      env.client.workflow.execute(clipProbeWorkflow, {
        taskQueue: TASK_QUEUE,
        workflowId: 'clip-probe-ok',
        args: [link],
      }),
    );
    expect(answer).toEqual(info);
  });

  it('a refusal reaches the API with our code on the failure cause', async () => {
    const activities = mocks({
      clipProbeLink: jest.fn().mockRejectedValue(failure('link_private', false)),
    });
    const result = (await worker(activities)).runUntil(
      env.client.workflow.execute(clipProbeWorkflow, {
        taskQueue: TASK_QUEUE,
        workflowId: 'clip-probe-private',
        args: [link],
      }),
    );
    const error = await result.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(WorkflowFailedError);
    const cause = (error as WorkflowFailedError).cause;
    expect(cause).toBeInstanceOf(ApplicationFailure);
    expect((cause as ApplicationFailure).details).toEqual([{ code: 'link_private' }]);
    expect(activities.clipProbeLink).toHaveBeenCalledTimes(1);
  });
});

describe('clipStickerCheckWorkflow', () => {
  const ref = { organizationId: 'org-1', assetId: '5d1e2f3a-4b5c-4d6e-8f70-819203a4b5c6' };

  it('answers the check, a picture we cannot use included, in one attempt', async () => {
    const activities = mocks({
      clipCheckSticker: jest
        .fn()
        .mockResolvedValue({ status: 'failed', error: 'sticker_unusable' }),
    });
    const answer = await (await worker(activities)).runUntil(
      env.client.workflow.execute(clipStickerCheckWorkflow, {
        taskQueue: TASK_QUEUE,
        workflowId: 'clip-sticker-check-ok',
        args: [ref],
      }),
    );
    expect(answer).toEqual({ status: 'failed', error: 'sticker_unusable' });
    expect(activities.clipCheckSticker).toHaveBeenCalledTimes(1);
  });

  it('a tool fault gets one more attempt, then reaches the API with our code', async () => {
    const activities = mocks({
      clipCheckSticker: jest.fn().mockRejectedValue(failure('tool_failed', true)),
    });
    const error = await (await worker(activities))
      .runUntil(
        env.client.workflow.execute(clipStickerCheckWorkflow, {
          taskQueue: TASK_QUEUE,
          workflowId: 'clip-sticker-check-fault',
          args: [ref],
        }),
      )
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(WorkflowFailedError);
    expect(((error as WorkflowFailedError).cause as ApplicationFailure).details).toEqual([
      { code: 'tool_failed' },
    ]);
    expect(activities.clipCheckSticker).toHaveBeenCalledTimes(2);
  });
});

describe('clipSoundCheckWorkflow', () => {
  const ref = { organizationId: 'org-1', assetId: '6e2f3a4b-5c6d-4e7f-8a91-92a3b4c5d6e7' };

  it('answers the check, a file we cannot use included, in one attempt', async () => {
    const activities = mocks({
      clipCheckSound: jest.fn().mockResolvedValue({ status: 'failed', error: 'sound_unusable' }),
    });
    const answer = await (await worker(activities)).runUntil(
      env.client.workflow.execute(clipSoundCheckWorkflow, {
        taskQueue: TASK_QUEUE,
        workflowId: 'clip-sound-check-ok',
        args: [ref],
      }),
    );
    expect(answer).toEqual({ status: 'failed', error: 'sound_unusable' });
    expect(activities.clipCheckSound).toHaveBeenCalledTimes(1);
  });

  it('a tool fault gets one more attempt, then reaches the API with our code', async () => {
    const activities = mocks({
      clipCheckSound: jest.fn().mockRejectedValue(failure('tool_failed', true)),
    });
    const error = await (await worker(activities))
      .runUntil(
        env.client.workflow.execute(clipSoundCheckWorkflow, {
          taskQueue: TASK_QUEUE,
          workflowId: 'clip-sound-check-fault',
          args: [ref],
        }),
      )
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(WorkflowFailedError);
    expect(((error as WorkflowFailedError).cause as ApplicationFailure).details).toEqual([
      { code: 'tool_failed' },
    ]);
    expect(activities.clipCheckSound).toHaveBeenCalledTimes(2);
  });
});

describe('clipDownloadWorkflow (Module 18)', () => {
  it('a finished download settles and books nothing else', async () => {
    const activities = mocks();
    const outcome = await (await worker(activities)).runUntil(
      env.client.workflow.execute(clipDownloadWorkflow, {
        taskQueue: TASK_QUEUE,
        workflowId: 'clip-download-done',
        args: [input],
      }),
    );
    expect(outcome).toBe('done');
    expect(activities.clipDownload).toHaveBeenCalledWith(input);
    expect(activities.clipJobFailed).not.toHaveBeenCalled();
    expect(activities.clipJobSettled).toHaveBeenCalledWith(input);
  });

  it('a gone quality is tried once and booked with its code', async () => {
    const activities = mocks({
      clipDownload: jest.fn().mockRejectedValue(failure('format_gone', false)),
    });
    const outcome = await (await worker(activities)).runUntil(
      env.client.workflow.execute(clipDownloadWorkflow, {
        taskQueue: TASK_QUEUE,
        workflowId: 'clip-download-gone',
        args: [input],
      }),
    );
    expect(outcome).toBe('failed');
    expect(activities.clipDownload).toHaveBeenCalledTimes(1);
    expect(activities.clipJobFailed).toHaveBeenCalledTimes(1);
    expect(activities.clipJobFailed).toHaveBeenCalledWith({ ...input, code: 'format_gone' });
  });
});

describe('clipSaveDownloadWorkflow (Module 18)', () => {
  it('a saved copy books nothing else', async () => {
    const activities = mocks();
    const outcome = await (await worker(activities)).runUntil(
      env.client.workflow.execute(clipSaveDownloadWorkflow, {
        taskQueue: TASK_QUEUE,
        workflowId: 'clip-save-download-ok',
        args: [input],
      }),
    );
    expect(outcome).toBe('saved');
    expect(activities.clipSaveDownload).toHaveBeenCalledWith(input);
    expect(activities.clipSaveDownloadFailed).not.toHaveBeenCalled();
    expect(activities.clipJobSettled).not.toHaveBeenCalled();
  });

  it('a copy that fails for good gives the button back once', async () => {
    const activities = mocks({
      clipSaveDownload: jest.fn().mockRejectedValue(failure('tool_failed', true)),
    });
    const outcome = await (await worker(activities)).runUntil(
      env.client.workflow.execute(clipSaveDownloadWorkflow, {
        taskQueue: TASK_QUEUE,
        workflowId: 'clip-save-download-fails',
        args: [input],
      }),
    );
    expect(outcome).toBe('failed');
    expect(activities.clipSaveDownload).toHaveBeenCalledTimes(2);
    expect(activities.clipSaveDownloadFailed).toHaveBeenCalledTimes(1);
    expect(activities.clipSaveDownloadFailed).toHaveBeenCalledWith(input);
  });
});
