/**
 * The analytics workflow against a real Temporal test server with time
 * skipping, activities mocked: the same harness as the publish workflow's
 * test. What is pinned: a channel syncs on start, then a day later; a
 * "sync now" interrupts the wait; repeated requests are held to one sync
 * per two minutes; and every skip reason ends the run without a sync.
 */
import { ApplicationFailure } from '@temporalio/common';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import type { Activities } from '../activities';
import { SYNC_INTERVAL_MS, SYNC_NOW_MIN_GAP_MS } from '../lib/analytics-slot';
import { analyticsSyncWorkflow, syncNowSignal } from './analytics-sync.workflow';

jest.setTimeout(180_000);

const TASK_QUEUE = 'test-analytics';
const input = { integrationId: 'ch-1', organizationId: 'org-1' };

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
    deliverWebhook: jest.fn(),
    markWebhookDeliveryFailed: jest.fn(),
    ...overrides,
  };
}

const synced = { channelDays: 90, postsSynced: 3 };

let env: TestWorkflowEnvironment;

beforeAll(async () => {
  env = await TestWorkflowEnvironment.createTimeSkipping();
});

afterAll(async () => {
  await env?.teardown();
});

async function withWorker<T>(activities: Mocks, fn: () => Promise<T>): Promise<T> {
  const worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue: TASK_QUEUE,
    workflowsPath: require.resolve('./index'),
    activities,
  });

  return worker.runUntil(fn());
}

/** A moment on the test server's clock, which time skipping moves ahead as tests run. */
async function fromNow(ms: number): Promise<string> {
  return new Date((await env.currentTimeMs()) + ms).toISOString();
}

const active = (nextSyncAt: string, lastSyncedAt: string | null = null) => ({
  status: 'active',
  nextSyncAt,
  lastSyncedAt,
});

async function until(check: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (!check()) {
    if (Date.now() > deadline) {
      throw new Error('Condition not met in time');
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/** A sync mock that records the test server's time at each call. */
function timedSync(times: number[]) {
  return jest.fn(async () => {
    times.push(await env.currentTimeMs());
    return synced;
  });
}

describe('analyticsSyncWorkflow', () => {
  it('syncs at once on start when the channel has never been synced, then a day later', async () => {
    const times: number[] = [];
    const activities = mocks({
      loadAnalyticsSchedule: jest
        .fn()
        .mockResolvedValueOnce(active(await fromNow(0)))
        .mockResolvedValueOnce(active(await fromNow(SYNC_INTERVAL_MS)))
        .mockResolvedValueOnce({ status: 'skip', reason: 'gone' }),
      syncChannelAnalytics: timedSync(times),
    });

    const outcome = await withWorker(activities, () =>
      env.client.workflow.execute(analyticsSyncWorkflow, {
        taskQueue: TASK_QUEUE,
        workflowId: 'analytics-daily',
        args: [input],
      }),
    );

    expect(outcome).toBe('gone');
    expect(activities.syncChannelAnalytics).toHaveBeenCalledTimes(2);
    expect(activities.syncChannelAnalytics).toHaveBeenCalledWith(input);
    // The second sync waited for the slot a day out, not for the hour the
    // in-memory slot would have allowed, and not at once.
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(SYNC_INTERVAL_MS - 60 * 60_000);
  });

  it('syncs at once on the sync-now signal instead of waiting for the slot', async () => {
    const times: number[] = [];
    const activities = mocks({
      // Read once before the wait, once more after the signal interrupts it
      // (the workflow re-reads before every sync), then the channel is gone.
      loadAnalyticsSchedule: jest
        .fn()
        .mockResolvedValueOnce(active(await fromNow(SYNC_INTERVAL_MS), await fromNow(0)))
        .mockResolvedValueOnce(active(await fromNow(SYNC_INTERVAL_MS), await fromNow(0)))
        .mockResolvedValueOnce({ status: 'skip', reason: 'gone' }),
      syncChannelAnalytics: timedSync(times),
    });

    const started = await env.currentTimeMs();

    const outcome = await withWorker(activities, async () => {
      const handle = await env.client.workflow.start(analyticsSyncWorkflow, {
        taskQueue: TASK_QUEUE,
        workflowId: 'analytics-sync-now',
        args: [input],
      });
      await until(() => activities.loadAnalyticsSchedule.mock.calls.length >= 1);
      await handle.signal(syncNowSignal);
      return handle.result();
    });

    expect(outcome).toBe('gone');
    expect(activities.syncChannelAnalytics).toHaveBeenCalledTimes(1);
    expect(times[0] - started).toBeLessThan(SYNC_INTERVAL_MS / 2);
  });

  it('holds repeated requests to one sync per two minutes', async () => {
    const times: number[] = [];
    let releaseFirstSync: () => void = () => undefined;
    const firstSyncGate = new Promise<void>((resolve) => {
      releaseFirstSync = resolve;
    });
    const activities = mocks({
      loadAnalyticsSchedule: jest
        .fn()
        .mockResolvedValueOnce(active(await fromNow(0)))
        .mockResolvedValue(active(await fromNow(SYNC_INTERVAL_MS), await fromNow(0))),
      syncChannelAnalytics: jest
        .fn()
        .mockImplementationOnce(async () => {
          times.push(await env.currentTimeMs());
          await firstSyncGate;
          return synced;
        })
        .mockImplementationOnce(async () => {
          times.push(await env.currentTimeMs());
          return synced;
        })
        .mockImplementation(async () => {
          throw new Error('a third sync was not expected');
        }),
    });
    // After the second sync the channel is gone.
    activities.loadAnalyticsSchedule
      .mockReset()
      .mockResolvedValueOnce(active(await fromNow(0)))
      .mockResolvedValueOnce(active(await fromNow(SYNC_INTERVAL_MS), await fromNow(0)))
      .mockResolvedValueOnce({ status: 'skip', reason: 'gone' });

    const outcome = await withWorker(activities, async () => {
      const handle = await env.client.workflow.start(analyticsSyncWorkflow, {
        taskQueue: TASK_QUEUE,
        workflowId: 'analytics-rate-limit',
        args: [input],
      });
      // Three clicks land while the first sync is still running.
      await until(() => activities.syncChannelAnalytics.mock.calls.length >= 1);
      await handle.signal(syncNowSignal);
      await handle.signal(syncNowSignal);
      await handle.signal(syncNowSignal);
      releaseFirstSync();
      return handle.result();
    });

    expect(outcome).toBe('gone');
    expect(activities.syncChannelAnalytics).toHaveBeenCalledTimes(2);
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(SYNC_NOW_MIN_GAP_MS);
    expect(times[1] - times[0]).toBeLessThan(SYNC_INTERVAL_MS / 2);
  });

  it.each(['gone', 'needs_reconnect', 'not_set_up', 'disabled', 'unsupported'] as const)(
    'ends with %s when the schedule says so, without a sync',
    async (reason) => {
      const activities = mocks({
        loadAnalyticsSchedule: jest.fn().mockResolvedValue({ status: 'skip', reason }),
      });

      const outcome = await withWorker(activities, () =>
        env.client.workflow.execute(analyticsSyncWorkflow, {
          taskQueue: TASK_QUEUE,
          workflowId: `analytics-skip-${reason}`,
          args: [input],
        }),
      );

      expect(outcome).toBe(reason);
      expect(activities.syncChannelAnalytics).not.toHaveBeenCalled();
    },
  );

  it('keeps running after a sync fails for good, and does not loop on it', async () => {
    const times: number[] = [];
    const activities = mocks({
      // The database never records a success, so its slot stays "now".
      loadAnalyticsSchedule: jest
        .fn()
        .mockResolvedValueOnce(active(await fromNow(0)))
        .mockResolvedValueOnce(active(await fromNow(0)))
        .mockResolvedValueOnce({ status: 'skip', reason: 'needs_reconnect' }),
      syncChannelAnalytics: jest
        .fn()
        .mockImplementationOnce(async () => {
          times.push(await env.currentTimeMs());
          throw ApplicationFailure.create({
            type: 'AnalyticsRetryable',
            message: 'platform down',
            nonRetryable: true,
          });
        })
        .mockImplementationOnce(async () => {
          times.push(await env.currentTimeMs());
          return synced;
        }),
    });

    const outcome = await withWorker(activities, () =>
      env.client.workflow.execute(analyticsSyncWorkflow, {
        taskQueue: TASK_QUEUE,
        workflowId: 'analytics-failed-then-waits',
        args: [input],
      }),
    );

    expect(outcome).toBe('needs_reconnect');
    expect(activities.syncChannelAnalytics).toHaveBeenCalledTimes(2);
    // The failure did not make it retry at once; it waited for its own next slot.
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(SYNC_INTERVAL_MS - 60 * 60_000);
  });
});
