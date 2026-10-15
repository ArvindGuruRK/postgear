/**
 * The scheduler client never breaks a save.
 *
 * Asserted against a fake Temporal client: which workflow is signalled with
 * which id, that a missing workflow is not an error on cancel, and that an
 * unreachable server is reported as `false` and logged rather than thrown.
 */
import type { ConfigService } from '@nestjs/config';
import {
  ANALYTICS_SYNC_WORKFLOW,
  CANCEL_SIGNAL,
  POST_PUBLISH_WORKFLOW,
  PUBLISH_NOW_SIGNAL,
  SCHEDULING_TASK_QUEUE,
  SYNC_NOW_SIGNAL,
  TOKEN_REFRESH_WORKFLOW,
  WAKE_SIGNAL,
} from '@postgear/scheduling';
import { WorkflowNotFoundError } from '@temporalio/client';
import type { Env } from '../../config/env';
import { type SchedulingClient, SchedulingService } from './scheduling.service';

const config = {
  get: (key: string) => (key === 'TEMPORAL_HOST' ? 'localhost:7233' : 'default'),
} as unknown as ConfigService<Env, true>;

function fakeClient() {
  const signal = jest.fn().mockResolvedValue(undefined);
  const client = {
    workflow: {
      signalWithStart: jest.fn().mockResolvedValue({}),
      getHandle: jest.fn().mockReturnValue({ signal }),
    },
    workflowService: {
      describeTaskQueue: jest.fn().mockResolvedValue({ pollers: [{ identity: 'worker-1' }] }),
    },
    connection: { close: jest.fn().mockResolvedValue(undefined) },
  };

  return { client: client as unknown as SchedulingClient, raw: client, signal };
}

describe('SchedulingService', () => {
  it('starts or wakes one publish workflow per root row, keyed on the row id', async () => {
    const { client, raw } = fakeClient();
    const service = new SchedulingService(config, async () => client);

    await expect(
      service.schedulePublish([
        { postId: 'root-1', organizationId: 'org-1' },
        { postId: 'root-2', organizationId: 'org-1' },
      ]),
    ).resolves.toBe(true);

    expect(raw.workflow.signalWithStart).toHaveBeenCalledTimes(2);
    expect(raw.workflow.signalWithStart).toHaveBeenCalledWith(POST_PUBLISH_WORKFLOW, {
      workflowId: 'post-publish:root-1',
      taskQueue: SCHEDULING_TASK_QUEUE,
      args: [{ postId: 'root-1', organizationId: 'org-1' }],
      signal: WAKE_SIGNAL,
      signalArgs: [],
    });
  });

  it('sends the post-now signal through the same idempotent call', async () => {
    const { client, raw } = fakeClient();
    const service = new SchedulingService(config, async () => client);

    await service.publishNow([{ postId: 'root-1', organizationId: 'org-1' }]);

    expect(raw.workflow.signalWithStart.mock.calls[0][1].signal).toBe(PUBLISH_NOW_SIGNAL);
  });

  it('cancels by signal and treats a missing workflow as already cancelled', async () => {
    const { client, raw, signal } = fakeClient();
    signal.mockRejectedValueOnce(
      new WorkflowNotFoundError('gone', 'post-publish:root-1', undefined),
    );
    const service = new SchedulingService(config, async () => client);

    await expect(service.cancelPublish(['root-1', 'root-2'])).resolves.toBe(true);

    expect(raw.workflow.getHandle).toHaveBeenCalledWith('post-publish:root-1');
    expect(raw.workflow.getHandle).toHaveBeenCalledWith('post-publish:root-2');
    expect(signal).toHaveBeenCalledWith(CANCEL_SIGNAL);
  });

  it('starts the token refresh loop for a channel', async () => {
    const { client, raw } = fakeClient();
    const service = new SchedulingService(config, async () => client);

    await service.ensureTokenRefresh('ch-1', 'org-1');

    expect(raw.workflow.signalWithStart).toHaveBeenCalledWith(TOKEN_REFRESH_WORKFLOW, {
      workflowId: 'token-refresh:ch-1',
      taskQueue: SCHEDULING_TASK_QUEUE,
      args: [{ integrationId: 'ch-1', organizationId: 'org-1' }],
      signal: WAKE_SIGNAL,
      signalArgs: [],
    });
  });

  it('starts or nudges one analytics loop per channel with the sync-now signal (Sprint 7)', async () => {
    const { client, raw } = fakeClient();
    const service = new SchedulingService(config, async () => client);

    await expect(
      service.syncAnalyticsNow([
        { integrationId: 'ch-1', organizationId: 'org-1' },
        { integrationId: 'ch-2', organizationId: 'org-1' },
      ]),
    ).resolves.toBe(true);

    expect(raw.workflow.signalWithStart).toHaveBeenCalledTimes(2);
    expect(raw.workflow.signalWithStart).toHaveBeenCalledWith(ANALYTICS_SYNC_WORKFLOW, {
      workflowId: 'analytics-sync:ch-1',
      taskQueue: SCHEDULING_TASK_QUEUE,
      args: [{ integrationId: 'ch-1', organizationId: 'org-1' }],
      signal: SYNC_NOW_SIGNAL,
      signalArgs: [],
    });

    // Nothing to ask for is not a failure.
    await expect(service.syncAnalyticsNow([])).resolves.toBe(true);
    expect(raw.workflow.signalWithStart).toHaveBeenCalledTimes(2);
  });

  it('reports false instead of throwing when Temporal is unreachable, then reconnects', async () => {
    const connect = jest
      .fn()
      .mockRejectedValueOnce(new Error('connect ECONNREFUSED'))
      .mockResolvedValue(fakeClient().client);
    const service = new SchedulingService(config, connect);

    await expect(
      service.schedulePublish([{ postId: 'root-1', organizationId: 'org-1' }]),
    ).resolves.toBe(false);
    await expect(
      service.schedulePublish([{ postId: 'root-1', organizationId: 'org-1' }]),
    ).resolves.toBe(true);

    expect(connect).toHaveBeenCalledTimes(2);
  });

  it('describes the task queue for the status pill', async () => {
    const { client } = fakeClient();
    const service = new SchedulingService(config, async () => client);

    await expect(service.status()).resolves.toMatchObject({
      reachable: true,
      workerOnline: true,
      taskQueue: SCHEDULING_TASK_QUEUE,
    });

    const offline = new SchedulingService(config, async () => {
      throw new Error('down');
    });

    await expect(offline.status()).resolves.toMatchObject({
      reachable: false,
      workerOnline: null,
    });
  });
});
