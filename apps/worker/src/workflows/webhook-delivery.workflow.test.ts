/**
 * The delivery workflow against a time-skipping Temporal test server with
 * the activities mocked: the same harness as the publish workflow's test.
 * What is pinned: a 2xx on the first try ends it; a retryable failure is
 * tried again with the policy's backoff; a rejection is final after one
 * attempt; six retryable failures exhaust the policy; and only the final
 * outcome marks the row failed, exactly once.
 */

import { WEBHOOK_DELIVERY_RETRY_POLICY, WEBHOOK_FAILURE_TYPES } from '@postgear/scheduling';
import { ApplicationFailure } from '@temporalio/common';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import type { Activities } from '../activities';
import { webhookDeliveryWorkflow } from './webhook-delivery.workflow';

jest.setTimeout(180_000);

const TASK_QUEUE = 'test-webhooks';
const input = { deliveryId: 'd-1', organizationId: 'org-1' };

type Mocks = { [K in keyof Activities]: jest.Mock };

function mocks(overrides: Partial<Mocks> = {}): Mocks {
  return {
    loadPublishJob: jest.fn(),
    publishPost: jest.fn(),
    recordPublished: jest.fn(),
    markPublishFailed: jest.fn(),
    queueNextOccurrence: jest.fn(),
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

let env: TestWorkflowEnvironment;

beforeAll(async () => {
  env = await TestWorkflowEnvironment.createTimeSkipping();
});

afterAll(async () => {
  await env?.teardown();
});

async function run(activities: Mocks, workflowId: string) {
  const worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue: TASK_QUEUE,
    workflowsPath: require.resolve('./index'),
    activities,
  });

  return worker.runUntil(
    env.client.workflow.execute(webhookDeliveryWorkflow, {
      taskQueue: TASK_QUEUE,
      workflowId,
      args: [input],
    }),
  );
}

const retryable = (message: string) =>
  ApplicationFailure.create({
    type: WEBHOOK_FAILURE_TYPES.retryable,
    nonRetryable: false,
    message,
  });
const rejected = (message: string) =>
  ApplicationFailure.create({ type: WEBHOOK_FAILURE_TYPES.rejected, nonRetryable: true, message });

describe('webhookDeliveryWorkflow', () => {
  it('ends after a delivered first attempt without touching the failure path', async () => {
    const activities = mocks({
      deliverWebhook: jest.fn().mockResolvedValue({ statusCode: 200, attempt: 1 }),
    });

    const outcome = await run(activities, 'wh-delivered');

    expect(outcome).toEqual({ outcome: 'delivered', statusCode: 200, attempts: 1 });
    expect(activities.deliverWebhook).toHaveBeenCalledTimes(1);
    expect(activities.deliverWebhook).toHaveBeenCalledWith(input);
    expect(activities.markWebhookDeliveryFailed).not.toHaveBeenCalled();
  });

  it('retries a retryable failure with backoff and succeeds on a later attempt', async () => {
    const times: number[] = [];
    const activities = mocks({
      deliverWebhook: jest.fn(async () => {
        times.push(await env.currentTimeMs());
        if (times.length < 3) throw retryable('Receiver answered 503');
        return { statusCode: 200, attempt: 3 };
      }),
    });

    const outcome = await run(activities, 'wh-retried');

    expect(outcome).toEqual({ outcome: 'delivered', statusCode: 200, attempts: 3 });
    expect(times).toHaveLength(3);
    // 30 s, then 2 min (× 4), on the test server's skipping clock.
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(
      WEBHOOK_DELIVERY_RETRY_POLICY.initialIntervalMs,
    );
    expect(times[2] - times[1]).toBeGreaterThanOrEqual(
      WEBHOOK_DELIVERY_RETRY_POLICY.initialIntervalMs *
        WEBHOOK_DELIVERY_RETRY_POLICY.backoffCoefficient,
    );
    expect(activities.markWebhookDeliveryFailed).not.toHaveBeenCalled();
  });

  it('fails at once on a rejection and marks the row failed exactly once', async () => {
    const activities = mocks({
      deliverWebhook: jest.fn().mockRejectedValue(rejected('Receiver answered 404')),
      markWebhookDeliveryFailed: jest.fn().mockResolvedValue(undefined),
    });

    const outcome = await run(activities, 'wh-rejected');

    expect(outcome).toEqual({
      outcome: 'failed',
      reason: 'rejected',
      message: 'Receiver answered 404',
    });
    expect(activities.deliverWebhook).toHaveBeenCalledTimes(1);
    expect(activities.markWebhookDeliveryFailed).toHaveBeenCalledTimes(1);
    expect(activities.markWebhookDeliveryFailed).toHaveBeenCalledWith({
      ...input,
      message: 'Receiver answered 404',
    });
  });

  it('gives up after the policy is exhausted and reports retries_exhausted', async () => {
    const activities = mocks({
      deliverWebhook: jest.fn().mockRejectedValue(retryable('Connection refused')),
      markWebhookDeliveryFailed: jest.fn().mockResolvedValue(undefined),
    });

    const outcome = await run(activities, 'wh-exhausted');

    expect(outcome).toEqual({
      outcome: 'failed',
      reason: 'retries_exhausted',
      message: 'Connection refused',
    });
    expect(activities.deliverWebhook).toHaveBeenCalledTimes(
      WEBHOOK_DELIVERY_RETRY_POLICY.maximumAttempts,
    );
    expect(activities.markWebhookDeliveryFailed).toHaveBeenCalledTimes(1);
  });

  it('treats a skipped delivery (hook removed) as nothing to do', async () => {
    const activities = mocks({
      deliverWebhook: jest.fn().mockRejectedValue(
        ApplicationFailure.create({
          type: WEBHOOK_FAILURE_TYPES.skipped,
          nonRetryable: true,
          message: 'The webhook was removed or disabled.',
        }),
      ),
    });

    const outcome = await run(activities, 'wh-skipped');

    expect(outcome).toEqual({
      outcome: 'skipped',
      message: 'The webhook was removed or disabled.',
    });
    expect(activities.markWebhookDeliveryFailed).not.toHaveBeenCalled();
  });
});
