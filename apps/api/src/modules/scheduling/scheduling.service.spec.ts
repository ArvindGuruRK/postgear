/**
 * The scheduler client never breaks a save.
 *
 * Asserted against a fake Temporal client: which workflow is signalled with
 * which id, that a missing workflow is not an error on cancel, and that an
 * unreachable server is reported as `false` and logged rather than thrown.
 */
import type { ConfigService } from '@nestjs/config';
import { type ScheduleConfig, toTemporalScheduleSpec } from '@postgear/automation';
import {
  ANALYTICS_SYNC_WORKFLOW,
  AUTOMATION_RUN_WORKFLOW,
  CANCEL_SIGNAL,
  POST_PUBLISH_WORKFLOW,
  PUBLISH_NOW_SIGNAL,
  REVIEW_DECISION_SIGNAL,
  SCHEDULING_TASK_QUEUE,
  SYNC_NOW_SIGNAL,
  TOKEN_REFRESH_WORKFLOW,
  WAKE_SIGNAL,
} from '@postgear/scheduling';
import {
  ScheduleAlreadyRunning,
  ScheduleNotFoundError,
  ScheduleOverlapPolicy,
  WorkflowExecutionAlreadyStartedError,
  WorkflowIdReusePolicy,
  WorkflowNotFoundError,
} from '@temporalio/client';
import type { Env } from '../../config/env';
import {
  automationScheduleOptions,
  type SchedulingClient,
  SchedulingService,
} from './scheduling.service';

const config = {
  get: (key: string) => (key === 'TEMPORAL_HOST' ? 'localhost:7233' : 'default'),
} as unknown as ConfigService<Env, true>;

function fakeClient() {
  const signal = jest.fn().mockResolvedValue(undefined);
  const scheduleHandle = {
    update: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  const client = {
    workflow: {
      signalWithStart: jest.fn().mockResolvedValue({}),
      getHandle: jest.fn().mockReturnValue({ signal }),
      start: jest.fn().mockResolvedValue({}),
    },
    schedule: {
      create: jest.fn().mockResolvedValue(scheduleHandle),
      getHandle: jest.fn().mockReturnValue(scheduleHandle),
    },
    workflowService: {
      describeTaskQueue: jest.fn().mockResolvedValue({ pollers: [{ identity: 'worker-1' }] }),
    },
    connection: { close: jest.fn().mockResolvedValue(undefined) },
  };

  return { client: client as unknown as SchedulingClient, raw: client, signal, scheduleHandle };
}

/** Every day at 08:00 in Kolkata, as `toTemporalScheduleSpec` builds it. */
const DAILY_SPEC = toTemporalScheduleSpec({
  frequency: 'daily',
  time: '08:00',
  timeZone: 'Asia/Kolkata',
} as ScheduleConfig);

const SCHEDULE_REQUEST = {
  automationId: 'auto-1',
  organizationId: 'org-1',
  versionId: 'ver-2',
  spec: DAILY_SPEC,
};

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

  it('starts one run workflow per workflow run row, with a 30-day timeout and no duplicate (Sprint 10)', async () => {
    const { client, raw } = fakeClient();
    const service = new SchedulingService(config, async () => client);

    await expect(service.startAutomationRun('run-1', 'org-1')).resolves.toBe(true);

    expect(raw.workflow.start).toHaveBeenCalledWith(AUTOMATION_RUN_WORKFLOW, {
      workflowId: 'automation-run:run-1',
      taskQueue: SCHEDULING_TASK_QUEUE,
      args: [{ runId: 'run-1', organizationId: 'org-1' }],
      workflowExecutionTimeout: 30 * 24 * 60 * 60 * 1000,
      workflowIdReusePolicy: WorkflowIdReusePolicy.REJECT_DUPLICATE,
    });

    // A workflow already there for this row is the job done, not a failure.
    raw.workflow.start.mockRejectedValueOnce(
      new WorkflowExecutionAlreadyStartedError(
        'started',
        'automation-run:run-1',
        'automationRunWorkflow',
      ),
    );
    await expect(service.startAutomationRun('run-1', 'org-1')).resolves.toBe(true);
  });

  it('signals cancel and review decisions to a run, telling a missing workflow from an unreachable server', async () => {
    const { client, raw, signal } = fakeClient();
    const service = new SchedulingService(config, async () => client);

    await expect(service.cancelAutomationRun('run-1')).resolves.toBe('signalled');
    expect(raw.workflow.getHandle).toHaveBeenCalledWith('automation-run:run-1');
    expect(signal).toHaveBeenCalledWith(CANCEL_SIGNAL);

    await expect(
      service.signalReviewDecision('run-1', { nodeKey: 'review1', decision: 'approved' }),
    ).resolves.toBe('signalled');
    expect(signal).toHaveBeenLastCalledWith(REVIEW_DECISION_SIGNAL, {
      nodeKey: 'review1',
      decision: 'approved',
    });

    signal.mockRejectedValueOnce(
      new WorkflowNotFoundError('gone', 'automation-run:run-1', undefined),
    );
    await expect(service.cancelAutomationRun('run-1')).resolves.toBe('notFound');

    signal.mockRejectedValueOnce(new Error('14 UNAVAILABLE'));
    await expect(
      service.signalReviewDecision('run-1', { nodeKey: 'review1', decision: 'rejected' }),
    ).resolves.toBe('unavailable');
  });

  it('signals a run a Schedule started by its own Temporal workflow id (Module 09)', async () => {
    const { client, raw, signal } = fakeClient();
    const service = new SchedulingService(config, async () => client);
    const scheduledId = 'automation-scheduled:auto-1-2026-10-29T08:00:00Z';

    await service.cancelAutomationRun('run-1', scheduledId);
    expect(raw.workflow.getHandle).toHaveBeenLastCalledWith(scheduledId);
    expect(signal).toHaveBeenLastCalledWith(CANCEL_SIGNAL);

    await service.signalReviewDecision(
      'run-1',
      { nodeKey: 'review1', decision: 'approved' },
      scheduledId,
    );
    expect(raw.workflow.getHandle).toHaveBeenLastCalledWith(scheduledId);

    await service.cancelAutomationRun('run-1', null);
    expect(raw.workflow.getHandle).toHaveBeenLastCalledWith('automation-run:run-1');
  });

  describe('workflow schedules (Module 09)', () => {
    it('creates the schedule with the spec, zone, overlap SKIP and a one minute catch-up', async () => {
      const { client, raw } = fakeClient();
      const service = new SchedulingService(config, async () => client);

      await expect(service.putAutomationSchedule(SCHEDULE_REQUEST)).resolves.toBe(true);

      expect(raw.schedule.create).toHaveBeenCalledWith({
        scheduleId: 'automation-schedule:auto-1',
        spec: { calendars: [{ hour: 8, minute: 0 }], timezone: 'Asia/Kolkata' },
        action: {
          type: 'startWorkflow',
          workflowType: AUTOMATION_RUN_WORKFLOW,
          taskQueue: SCHEDULING_TASK_QUEUE,
          workflowId: 'automation-scheduled:auto-1',
          args: [
            { scheduled: { automationId: 'auto-1', versionId: 'ver-2' }, organizationId: 'org-1' },
          ],
        },
        policies: { overlap: 'SKIP', catchupWindow: 60_000 },
      });
      expect(automationScheduleOptions(SCHEDULE_REQUEST).policies?.overlap).toBe(
        ScheduleOverlapPolicy.SKIP,
      );
      expect(raw.schedule.getHandle).not.toHaveBeenCalled();
    });

    it('replaces a schedule that already exists with the new version and time', async () => {
      const { client, raw, scheduleHandle } = fakeClient();
      const service = new SchedulingService(config, async () => client);
      raw.schedule.create.mockRejectedValueOnce(
        new ScheduleAlreadyRunning('exists', 'automation-schedule:auto-1'),
      );

      await expect(service.putAutomationSchedule(SCHEDULE_REQUEST)).resolves.toBe(true);

      expect(raw.schedule.getHandle).toHaveBeenCalledWith('automation-schedule:auto-1');
      const update = scheduleHandle.update.mock.calls[0][0] as (previous: unknown) => unknown;
      const options = automationScheduleOptions(SCHEDULE_REQUEST);
      expect(update({})).toEqual({
        spec: options.spec,
        action: options.action,
        policies: options.policies,
        state: {},
      });
    });

    it('deletes the schedule, and counts one that is already gone as deleted', async () => {
      const { client, raw, scheduleHandle } = fakeClient();
      const service = new SchedulingService(config, async () => client);

      await expect(service.deleteAutomationSchedule('auto-1')).resolves.toBe(true);
      expect(raw.schedule.getHandle).toHaveBeenCalledWith('automation-schedule:auto-1');
      expect(scheduleHandle.delete).toHaveBeenCalledTimes(1);

      scheduleHandle.delete.mockRejectedValueOnce(
        new ScheduleNotFoundError('gone', 'automation-schedule:auto-1'),
      );
      await expect(service.deleteAutomationSchedule('auto-1')).resolves.toBe(true);
    });

    it('reports false, never throws, when Temporal cannot be reached', async () => {
      const { client, raw, scheduleHandle } = fakeClient();
      const service = new SchedulingService(config, async () => client);
      raw.schedule.create.mockRejectedValueOnce(new Error('14 UNAVAILABLE'));
      scheduleHandle.delete.mockRejectedValueOnce(new Error('14 UNAVAILABLE'));

      await expect(service.putAutomationSchedule(SCHEDULE_REQUEST)).resolves.toBe(false);
      await expect(service.deleteAutomationSchedule('auto-1')).resolves.toBe(false);
    });
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
