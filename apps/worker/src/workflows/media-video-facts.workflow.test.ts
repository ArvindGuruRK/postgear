/**
 * `mediaVideoFactsWorkflow` against a time-skipping Temporal test server
 * with its activities mocked: a finished run answers the activity's status
 * and books nothing else; a tool fault is tried as often as the contract's
 * policy allows and then the row is marked checked once; a permanent failure
 * is tried once; a mark that fails too never fails the workflow.
 */
import {
  CLIP_FAILURE_TYPES,
  MEDIA_VIDEO_FACTS_RETRY_POLICY,
  mediaVideoFactsWorkflowId,
} from '@postgear/scheduling';
import { ApplicationFailure } from '@temporalio/common';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import type { ClipActivities } from '../clips/activities';
import { mediaVideoFactsWorkflow } from './media-video-facts.workflow';

jest.setTimeout(180_000);

const TASK_QUEUE = 'test-media-facts';
const input = { mediaId: '0b5f5a8e-1c0d-4f7e-9a62-5d2c7e1f3a4b', organizationId: 'org-1' };

type Mocks = Pick<
  { [K in keyof ClipActivities]: jest.Mock },
  'mediaVideoFacts' | 'mediaVideoFactsGaveUp'
>;

function mocks(overrides: Partial<Mocks> = {}): Mocks {
  return {
    mediaVideoFacts: jest.fn().mockResolvedValue({ status: 'written', poster: true }),
    mediaVideoFactsGaveUp: jest.fn().mockResolvedValue(undefined),
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

async function run(activities: Mocks, name: string) {
  const worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue: TASK_QUEUE,
    workflowsPath: require.resolve('./index'),
    activities,
  });
  return worker.runUntil(
    env.client.workflow.execute(mediaVideoFactsWorkflow, {
      taskQueue: TASK_QUEUE,
      workflowId: `${mediaVideoFactsWorkflowId(input.mediaId)}:${name}`,
      args: [input],
    }),
  );
}

describe('mediaVideoFactsWorkflow', () => {
  it('answers what the activity did and books nothing else', async () => {
    const activities = mocks();
    await expect(run(activities, 'written')).resolves.toBe('written');
    expect(activities.mediaVideoFacts).toHaveBeenCalledWith(input);
    expect(activities.mediaVideoFactsGaveUp).not.toHaveBeenCalled();
  });

  it('a file it cannot read is an answer, not a failure', async () => {
    const activities = mocks({
      mediaVideoFacts: jest.fn().mockResolvedValue({ status: 'unreadable' }),
    });
    await expect(run(activities, 'unreadable')).resolves.toBe('unreadable');
    expect(activities.mediaVideoFacts).toHaveBeenCalledTimes(1);
    expect(activities.mediaVideoFactsGaveUp).not.toHaveBeenCalled();
  });

  it('a tool fault is retried by the policy, then the row is marked checked once', async () => {
    const activities = mocks({
      mediaVideoFacts: jest.fn().mockRejectedValue(failure('tool_failed', true)),
    });
    await expect(run(activities, 'retried')).resolves.toBe('gave_up');
    expect(activities.mediaVideoFacts).toHaveBeenCalledTimes(
      MEDIA_VIDEO_FACTS_RETRY_POLICY.maximumAttempts,
    );
    expect(activities.mediaVideoFactsGaveUp).toHaveBeenCalledTimes(1);
    expect(activities.mediaVideoFactsGaveUp).toHaveBeenCalledWith(input);
  });

  it('a permanent failure is tried once', async () => {
    const activities = mocks({
      mediaVideoFacts: jest.fn().mockRejectedValue(failure('tool_failed', false)),
    });
    await expect(run(activities, 'permanent')).resolves.toBe('gave_up');
    expect(activities.mediaVideoFacts).toHaveBeenCalledTimes(1);
    expect(activities.mediaVideoFactsGaveUp).toHaveBeenCalledTimes(1);
  });

  it('never fails when the mark fails too (the next pass tries the row again)', async () => {
    const activities = mocks({
      mediaVideoFacts: jest.fn().mockRejectedValue(failure('tool_failed', false)),
      mediaVideoFactsGaveUp: jest.fn().mockRejectedValue(new Error('database down')),
    });
    await expect(run(activities, 'mark-failed')).resolves.toBe('gave_up');
  });
});
