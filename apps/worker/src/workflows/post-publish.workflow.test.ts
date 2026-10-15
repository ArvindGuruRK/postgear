/**
 * The publish workflow against a real Temporal test server with time skipping.
 *
 * Activities are mocked, so these pin the *orchestration*: when the publish
 * happens, which signals interrupt the wait, how each failure type branches,
 * and what is recorded. The time-skipping server fast-forwards every timer, so
 * an hour-long wait and a four-minute backoff cost milliseconds here.
 */

import { PUBLISH_FAILURE_TYPES, PUBLISH_RETRY_POLICY } from '@postgear/scheduling';
import { ApplicationFailure } from '@temporalio/common';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import type { Activities } from '../activities';
import {
  cancelSignal,
  postPublishWorkflow,
  publishNowSignal,
  wakeSignal,
} from './post-publish.workflow';
import { tokenRefreshWorkflow } from './token-refresh.workflow';

jest.setTimeout(180_000);

const TASK_QUEUE = 'test-publishing';
const input = { postId: 'root-1', organizationId: 'org-1' };
const refreshInput = { integrationId: 'ch-1', organizationId: 'org-1' };

type Mocks = { [K in keyof Activities]: jest.Mock };

function mocks(overrides: Partial<Mocks> = {}): Mocks {
  return {
    loadPublishJob: jest.fn(),
    publishPost: jest.fn(),
    recordPublished: jest.fn(),
    markPublishFailed: jest.fn(),
    loadIntegrationSchedule: jest.fn(),
    refreshChannelToken: jest.fn(),
    loadAnalyticsSchedule: jest.fn(),
    syncChannelAnalytics: jest.fn(),
    reconcileSchedules: jest.fn(),
    ...overrides,
  };
}

const retryable = (message: string) =>
  ApplicationFailure.create({
    type: PUBLISH_FAILURE_TYPES.retryable,
    message,
    nonRetryable: false,
  });

const nonRetryable = (type: string, message: string, details?: unknown[]) =>
  ApplicationFailure.create({ type, message, nonRetryable: true, details });

let env: TestWorkflowEnvironment;

beforeAll(async () => {
  env = await TestWorkflowEnvironment.createTimeSkipping();
});

afterAll(async () => {
  await env?.teardown();
});

/** Runs `fn` with a worker serving the given activity mocks. */
async function withWorker<T>(activities: Mocks, fn: () => Promise<T>): Promise<T> {
  const worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue: TASK_QUEUE,
    workflowsPath: require.resolve('./index'),
    activities,
  });

  return worker.runUntil(fn());
}

/**
 * A moment on the *test server's* clock. Time skipping moves that clock days
 * ahead as tests run, so a wall-clock "in an hour" is already in the past by
 * the second test — and a post whose time has passed publishes at once.
 */
async function fromNow(ms: number): Promise<string> {
  return new Date((await env.currentTimeMs()) + ms).toISOString();
}

const inAnHour = () => fromNow(60 * 60_000);

async function until(check: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (!check()) {
    if (Date.now() > deadline) {
      throw new Error('Condition not met in time');
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe('postPublishWorkflow', () => {
  it('waits for the scheduled time, then publishes and reports the release URL', async () => {
    const activities = mocks({
      loadPublishJob: jest
        .fn()
        .mockResolvedValue({ status: 'ready', publishAt: await inAnHour(), integrationId: 'ch-1' }),
      publishPost: jest
        .fn()
        .mockResolvedValue({ recorded: true, releaseURL: 'https://x.test/1', results: [] }),
    });

    const outcome = await withWorker(activities, () =>
      env.client.workflow.execute(postPublishWorkflow, {
        taskQueue: TASK_QUEUE,
        workflowId: 'publish-waits',
        args: [input],
      }),
    );

    expect(outcome).toEqual({ outcome: 'published', releaseURL: 'https://x.test/1' });
    expect(activities.publishPost).toHaveBeenCalledTimes(1);
    expect(activities.recordPublished).not.toHaveBeenCalled();
    expect(activities.markPublishFailed).not.toHaveBeenCalled();
  });

  it('publishes at once on the post-now signal', async () => {
    const farAway = await fromNow(30 * 24 * 60 * 60_000);
    const activities = mocks({
      loadPublishJob: jest
        .fn()
        .mockResolvedValue({ status: 'ready', publishAt: farAway, integrationId: 'ch-1' }),
      publishPost: jest.fn().mockResolvedValue({ recorded: true, releaseURL: null, results: [] }),
    });

    const outcome = await withWorker(activities, async () => {
      const handle = await env.client.workflow.start(postPublishWorkflow, {
        taskQueue: TASK_QUEUE,
        workflowId: 'publish-now',
        args: [input],
      });
      await handle.signal(publishNowSignal);
      return handle.result();
    });

    expect(outcome).toEqual({ outcome: 'published', releaseURL: null });
    expect(activities.publishPost).toHaveBeenCalledTimes(1);
  });

  it('ends without publishing when cancelled while waiting', async () => {
    const activities = mocks({
      loadPublishJob: jest
        .fn()
        .mockResolvedValue({ status: 'ready', publishAt: await inAnHour(), integrationId: 'ch-1' }),
    });

    const outcome = await withWorker(activities, async () => {
      const handle = await env.client.workflow.start(postPublishWorkflow, {
        taskQueue: TASK_QUEUE,
        workflowId: 'publish-cancelled',
        args: [input],
      });
      await handle.signal(cancelSignal);
      return handle.result();
    });

    expect(outcome).toEqual({ outcome: 'cancelled' });
    expect(activities.publishPost).not.toHaveBeenCalled();
  });

  it('re-reads the row on wake and skips a post that left the queue', async () => {
    const activities = mocks({
      loadPublishJob: jest
        .fn()
        .mockResolvedValueOnce({
          status: 'ready',
          publishAt: await inAnHour(),
          integrationId: 'ch-1',
        })
        .mockResolvedValueOnce({ status: 'skip', reason: 'not_queued' }),
    });

    const outcome = await withWorker(activities, async () => {
      const handle = await env.client.workflow.start(postPublishWorkflow, {
        taskQueue: TASK_QUEUE,
        workflowId: 'publish-woken',
        args: [input],
      });
      // A wake that lands before the first read changes nothing — the read
      // already sees it — so the test waits for that read before signalling.
      await until(() => activities.loadPublishJob.mock.calls.length >= 1);
      await handle.signal(wakeSignal);
      return handle.result();
    });

    expect(outcome).toEqual({ outcome: 'skipped', reason: 'not_queued' });
    expect(activities.loadPublishJob).toHaveBeenCalledTimes(2);
    expect(activities.publishPost).not.toHaveBeenCalled();
  });

  it('retries transient failures with the policy and succeeds', async () => {
    const activities = mocks({
      loadPublishJob: jest.fn().mockResolvedValue({
        status: 'ready',
        publishAt: new Date().toISOString(),
        integrationId: 'ch-1',
      }),
      publishPost: jest
        .fn()
        .mockRejectedValueOnce(retryable('rate limited'))
        .mockRejectedValueOnce(retryable('rate limited'))
        .mockResolvedValue({ recorded: true, releaseURL: 'https://x.test/2', results: [] }),
    });

    const outcome = await withWorker(activities, () =>
      env.client.workflow.execute(postPublishWorkflow, {
        taskQueue: TASK_QUEUE,
        workflowId: 'publish-retries',
        args: [input],
      }),
    );

    expect(outcome).toEqual({ outcome: 'published', releaseURL: 'https://x.test/2' });
    expect(activities.publishPost).toHaveBeenCalledTimes(3);
    expect(activities.markPublishFailed).not.toHaveBeenCalled();
  });

  it('fails as retries_exhausted after the last attempt', async () => {
    const activities = mocks({
      loadPublishJob: jest.fn().mockResolvedValue({
        status: 'ready',
        publishAt: new Date().toISOString(),
        integrationId: 'ch-1',
      }),
      publishPost: jest.fn().mockRejectedValue(retryable('still rate limited')),
    });

    const outcome = await withWorker(activities, () =>
      env.client.workflow.execute(postPublishWorkflow, {
        taskQueue: TASK_QUEUE,
        workflowId: 'publish-exhausted',
        args: [input],
      }),
    );

    expect(outcome).toEqual({ outcome: 'failed', reason: 'retries_exhausted' });
    expect(activities.publishPost).toHaveBeenCalledTimes(PUBLISH_RETRY_POLICY.maximumAttempts);
    expect(activities.markPublishFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'retries_exhausted',
        message: 'still rate limited',
        attempts: PUBLISH_RETRY_POLICY.maximumAttempts,
      }),
    );
  });

  it('refreshes dead credentials once and publishes with the new token', async () => {
    const activities = mocks({
      loadPublishJob: jest.fn().mockResolvedValue({
        status: 'ready',
        publishAt: new Date().toISOString(),
        integrationId: 'ch-1',
      }),
      publishPost: jest
        .fn()
        .mockRejectedValueOnce(nonRetryable(PUBLISH_FAILURE_TYPES.refreshToken, 'expired'))
        .mockResolvedValue({ recorded: true, releaseURL: 'https://x.test/3', results: [] }),
      refreshChannelToken: jest.fn().mockResolvedValue(true),
    });

    const outcome = await withWorker(activities, () =>
      env.client.workflow.execute(postPublishWorkflow, {
        taskQueue: TASK_QUEUE,
        workflowId: 'publish-refresh',
        args: [input],
      }),
    );

    expect(outcome).toEqual({ outcome: 'published', releaseURL: 'https://x.test/3' });
    expect(activities.refreshChannelToken).toHaveBeenCalledWith({
      integrationId: 'ch-1',
      organizationId: 'org-1',
    });
    expect(activities.publishPost).toHaveBeenCalledTimes(2);
  });

  it('fails as needs_reconnect when the refresh fails too', async () => {
    const activities = mocks({
      loadPublishJob: jest.fn().mockResolvedValue({
        status: 'ready',
        publishAt: new Date().toISOString(),
        integrationId: 'ch-1',
      }),
      publishPost: jest
        .fn()
        .mockRejectedValue(nonRetryable(PUBLISH_FAILURE_TYPES.refreshToken, 'expired')),
      refreshChannelToken: jest.fn().mockResolvedValue(false),
    });

    const outcome = await withWorker(activities, () =>
      env.client.workflow.execute(postPublishWorkflow, {
        taskQueue: TASK_QUEUE,
        workflowId: 'publish-reconnect',
        args: [input],
      }),
    );

    expect(outcome).toEqual({ outcome: 'failed', reason: 'needs_reconnect' });
    expect(activities.publishPost).toHaveBeenCalledTimes(1);
    expect(activities.markPublishFailed).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'needs_reconnect', message: 'expired' }),
    );
  });

  it('fails a rejected post immediately, without retrying', async () => {
    const activities = mocks({
      loadPublishJob: jest.fn().mockResolvedValue({
        status: 'ready',
        publishAt: new Date().toISOString(),
        integrationId: 'ch-1',
      }),
      publishPost: jest
        .fn()
        .mockRejectedValue(nonRetryable(PUBLISH_FAILURE_TYPES.badBody, 'Duplicate content')),
    });

    const outcome = await withWorker(activities, () =>
      env.client.workflow.execute(postPublishWorkflow, {
        taskQueue: TASK_QUEUE,
        workflowId: 'publish-rejected',
        args: [input],
      }),
    );

    expect(outcome).toEqual({ outcome: 'failed', reason: 'rejected' });
    expect(activities.publishPost).toHaveBeenCalledTimes(1);
    expect(activities.markPublishFailed).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'rejected', message: 'Duplicate content', attempts: 1 }),
    );
  });

  it('records a publish whose own write failed, through the retried activity', async () => {
    const results = [{ id: 'root-1', postId: 'p1', releaseURL: 'https://x.test/4' }];
    const activities = mocks({
      loadPublishJob: jest.fn().mockResolvedValue({
        status: 'ready',
        publishAt: new Date().toISOString(),
        integrationId: 'ch-1',
      }),
      publishPost: jest
        .fn()
        .mockResolvedValue({ recorded: false, releaseURL: 'https://x.test/4', results }),
      recordPublished: jest
        .fn()
        .mockRejectedValueOnce(new Error('db blip'))
        .mockResolvedValue(undefined),
    });

    const outcome = await withWorker(activities, () =>
      env.client.workflow.execute(postPublishWorkflow, {
        taskQueue: TASK_QUEUE,
        workflowId: 'publish-record-late',
        args: [input],
      }),
    );

    expect(outcome).toEqual({ outcome: 'published', releaseURL: 'https://x.test/4' });
    expect(activities.publishPost).toHaveBeenCalledTimes(1);
    expect(activities.recordPublished).toHaveBeenCalledTimes(2);
    expect(activities.recordPublished).toHaveBeenLastCalledWith({ ...input, results });
  });

  it('skips a post that was deleted after the timer fired', async () => {
    const activities = mocks({
      loadPublishJob: jest.fn().mockResolvedValue({
        status: 'ready',
        publishAt: new Date().toISOString(),
        integrationId: 'ch-1',
      }),
      publishPost: jest
        .fn()
        .mockRejectedValue(nonRetryable(PUBLISH_FAILURE_TYPES.skipped, 'deleted', ['deleted'])),
    });

    const outcome = await withWorker(activities, () =>
      env.client.workflow.execute(postPublishWorkflow, {
        taskQueue: TASK_QUEUE,
        workflowId: 'publish-skipped-late',
        args: [input],
      }),
    );

    expect(outcome).toEqual({ outcome: 'skipped', reason: 'deleted' });
    expect(activities.markPublishFailed).not.toHaveBeenCalled();
  });
});

describe('postPublishWorkflow during the publish phase', () => {
  it('goes back to waiting when the post is moved during a retry backoff, then publishes at the new time', async () => {
    const now = await fromNow(0);
    const later = await fromNow(60 * 60_000);
    const activities = mocks({
      // Due now; after the wake, an hour away; after that hour, due again.
      loadPublishJob: jest
        .fn()
        .mockResolvedValueOnce({ status: 'ready', publishAt: now, integrationId: 'ch-1' })
        .mockResolvedValue({ status: 'ready', publishAt: later, integrationId: 'ch-1' }),
      publishPost: jest
        .fn()
        .mockRejectedValueOnce(retryable('rate limited'))
        .mockResolvedValue({ recorded: true, releaseURL: 'https://x.test/5', results: [] }),
    });

    const outcome = await withWorker(activities, async () => {
      const handle = await env.client.workflow.start(postPublishWorkflow, {
        taskQueue: TASK_QUEUE,
        workflowId: 'publish-moved-mid-retry',
        args: [input],
      });
      // The first attempt has failed and the policy is backing off: move the post.
      await until(() => activities.publishPost.mock.calls.length >= 1);
      await handle.signal(wakeSignal);
      return handle.result();
    });

    expect(outcome).toEqual({ outcome: 'published', releaseURL: 'https://x.test/5' });
    // One attempt before the move, one after the hour — never the retry at the
    // old time with the row already pointing elsewhere.
    expect(activities.publishPost).toHaveBeenCalledTimes(2);
    expect(activities.markPublishFailed).not.toHaveBeenCalled();
  });

  it('fails as channel_unavailable, visibly, when the channel was disconnected while waiting', async () => {
    const activities = mocks({
      loadPublishJob: jest.fn().mockResolvedValue({ status: 'skip', reason: 'channel_gone' }),
    });

    const outcome = await withWorker(activities, () =>
      env.client.workflow.execute(postPublishWorkflow, {
        taskQueue: TASK_QUEUE,
        workflowId: 'publish-channel-gone',
        args: [input],
      }),
    );

    expect(outcome).toEqual({ outcome: 'failed', reason: 'channel_unavailable' });
    expect(activities.markPublishFailed).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'channel_unavailable' }),
    );
    expect(activities.publishPost).not.toHaveBeenCalled();
  });

  it('hands an interrupted attempt to a person rather than posting again', async () => {
    const activities = mocks({
      loadPublishJob: jest
        .fn()
        .mockResolvedValue({ status: 'ready', publishAt: await fromNow(0), integrationId: 'ch-1' }),
      publishPost: jest
        .fn()
        .mockRejectedValue(nonRetryable(PUBLISH_FAILURE_TYPES.interrupted, 'cut off')),
    });

    const outcome = await withWorker(activities, () =>
      env.client.workflow.execute(postPublishWorkflow, {
        taskQueue: TASK_QUEUE,
        workflowId: 'publish-interrupted',
        args: [input],
      }),
    );

    expect(outcome).toEqual({ outcome: 'failed', reason: 'interrupted' });
    expect(activities.publishPost).toHaveBeenCalledTimes(1);
  });

  it('does not flag the channel when the refresh itself was unreachable', async () => {
    const activities = mocks({
      loadPublishJob: jest
        .fn()
        .mockResolvedValue({ status: 'ready', publishAt: await fromNow(0), integrationId: 'ch-1' }),
      publishPost: jest
        .fn()
        .mockRejectedValue(nonRetryable(PUBLISH_FAILURE_TYPES.refreshToken, 'expired')),
      // Every attempt of the refresh activity fails with a transient error.
      refreshChannelToken: jest.fn().mockRejectedValue(
        ApplicationFailure.create({
          type: 'Transient',
          message: 'platform down',
          nonRetryable: true,
        }),
      ),
    });

    const outcome = await withWorker(activities, () =>
      env.client.workflow.execute(postPublishWorkflow, {
        taskQueue: TASK_QUEUE,
        workflowId: 'publish-refresh-unreachable',
        args: [input],
      }),
    );

    expect(outcome).toEqual({ outcome: 'failed', reason: 'unexpected' });
    expect(activities.markPublishFailed).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'unexpected' }),
    );
  });
});

describe('tokenRefreshWorkflow', () => {
  it('refreshes before expiry and keeps going until the channel is gone', async () => {
    const expiresAt = new Date(Date.now() + 2 * 60 * 60_000);
    const activities = mocks({
      loadIntegrationSchedule: jest
        .fn()
        .mockResolvedValueOnce({
          status: 'active',
          refreshAt: new Date(expiresAt.getTime() - 30 * 60_000).toISOString(),
          expiresAt: expiresAt.toISOString(),
        })
        .mockResolvedValueOnce({ status: 'skip', reason: 'gone' }),
      refreshChannelToken: jest.fn().mockResolvedValue(true),
    });

    const outcome = await withWorker(activities, () =>
      env.client.workflow.execute(tokenRefreshWorkflow, {
        taskQueue: TASK_QUEUE,
        workflowId: 'refresh-ok',
        args: [refreshInput],
      }),
    );

    expect(outcome).toBe('gone');
    expect(activities.refreshChannelToken).toHaveBeenCalledTimes(1);
    expect(activities.refreshChannelToken).toHaveBeenCalledWith(refreshInput);
  });

  it('stops when a refresh fails, leaving the channel flagged by the activity', async () => {
    const activities = mocks({
      loadIntegrationSchedule: jest.fn().mockResolvedValue({
        status: 'active',
        refreshAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      }),
      refreshChannelToken: jest.fn().mockResolvedValue(false),
    });

    const outcome = await withWorker(activities, () =>
      env.client.workflow.execute(tokenRefreshWorkflow, {
        taskQueue: TASK_QUEUE,
        workflowId: 'refresh-failed',
        args: [refreshInput],
      }),
    );

    expect(outcome).toBe('refresh_failed');
  });
});
