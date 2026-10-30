import { type ScheduleConfig, toTemporalScheduleSpec } from '@postgear/automation';
import { AUTOMATION_RUN_WORKFLOW, SCHEDULING_TASK_QUEUE } from '@postgear/scheduling';
import {
  type Client,
  ScheduleAlreadyRunning,
  ScheduleNotFoundError,
  type ScheduleOptions,
  ScheduleOverlapPolicy,
} from '@temporalio/client';
import { graphOf, line, step } from '../automation/testing';
import {
  type ActiveScheduledAutomation,
  automationIdOfSchedule,
  automationScheduleOptions,
  createAutomationSchedule,
  deleteAutomationSchedule,
  reconcileAutomationSchedules,
  scheduleConfigOf,
} from './automation-schedules';

const DAILY: ScheduleConfig = { frequency: 'daily', time: '09:00', timeZone: 'Asia/Kolkata' };

function scheduleGraph(config: Record<string, unknown> = { ...DAILY }) {
  return graphOf(
    [step('every', 'trigger.schedule', { config }), step('bell', 'notify.inApp')],
    [line('every', 'bell')],
  );
}

/** Temporal's schedules in memory: id to the action it starts. */
function fakeTemporal(existing: Record<string, { versionId: string }> = {}) {
  const schedules = new Map<string, { action: { args: unknown[] } }>(
    Object.entries(existing).map(([id, { versionId }]) => [
      id,
      {
        action: { args: [{ scheduled: { automationId: 'x', versionId }, organizationId: 'org' }] },
      },
    ]),
  );
  const created: ScheduleOptions[] = [];
  const deleted: string[] = [];
  const client = {
    schedule: {
      async *list() {
        for (const scheduleId of [...schedules.keys()]) yield { scheduleId };
      },
      getHandle: (id: string) => ({
        describe: async () => {
          const found = schedules.get(id);
          if (!found) throw new ScheduleNotFoundError('Not found.', id);
          return found;
        },
        delete: async () => {
          if (!schedules.delete(id)) throw new ScheduleNotFoundError('Not found.', id);
          deleted.push(id);
        },
      }),
      create: async (options: ScheduleOptions) => {
        if (schedules.has(options.scheduleId)) {
          throw new ScheduleAlreadyRunning('Taken.', options.scheduleId);
        }
        schedules.set(options.scheduleId, {
          action: { args: (options.action.args ?? []) as unknown[] },
        });
        created.push(options);
      },
    },
  };
  return { client: client as unknown as Client, schedules, created, deleted };
}

describe('automation schedules', () => {
  it('builds the schedule exactly as the API does', () => {
    expect(
      automationScheduleOptions({
        automationId: 'auto_1',
        organizationId: 'org_1',
        versionId: 'ver_2',
        config: DAILY,
      }),
    ).toEqual({
      scheduleId: 'automation-schedule:auto_1',
      spec: toTemporalScheduleSpec(DAILY),
      action: {
        type: 'startWorkflow',
        workflowType: AUTOMATION_RUN_WORKFLOW,
        taskQueue: SCHEDULING_TASK_QUEUE,
        workflowId: 'automation-scheduled:auto_1',
        args: [
          { scheduled: { automationId: 'auto_1', versionId: 'ver_2' }, organizationId: 'org_1' },
        ],
      },
      policies: { overlap: ScheduleOverlapPolicy.SKIP, catchupWindow: 60_000 },
    });
    expect(toTemporalScheduleSpec(DAILY)).toMatchObject({ timezone: 'Asia/Kolkata' });
  });

  it('reads the Schedule step of a version, and nothing else', () => {
    expect(scheduleConfigOf(scheduleGraph())).toMatchObject(DAILY);
    expect(scheduleConfigOf(graphOf([step('t', 'trigger.manual')]))).toBeNull();
    expect(scheduleConfigOf(scheduleGraph({ frequency: 'yearly' }))).toBeNull();
    expect(scheduleConfigOf('not a graph')).toBeNull();
    expect(automationIdOfSchedule('automation-schedule:auto_1')).toBe('auto_1');
    expect(automationIdOfSchedule('automation-schedule:')).toBeNull();
    expect(automationIdOfSchedule('maintenance')).toBeNull();
  });

  it('creates once, and deletes what is there', async () => {
    const { client } = fakeTemporal();
    const target = { automationId: 'a', organizationId: 'o', versionId: 'v', config: DAILY };

    await expect(createAutomationSchedule(client, target)).resolves.toBe('created');
    await expect(createAutomationSchedule(client, target)).resolves.toBe('exists');
    await expect(deleteAutomationSchedule(client, 'a')).resolves.toBe(true);
    await expect(deleteAutomationSchedule(client, 'a')).resolves.toBe(false);
  });

  it('reconciles: missing made, outdated replaced, stale deleted, current kept', async () => {
    const temporal = fakeTemporal({
      'automation-schedule:current': { versionId: 'current_v1' },
      'automation-schedule:outdated': { versionId: 'outdated_v1' },
      'automation-schedule:paused': { versionId: 'paused_v1' },
      'another-schedule': { versionId: 'x' },
    });
    const active: ActiveScheduledAutomation[] = [
      {
        automationId: 'current',
        organizationId: 'o',
        versionId: 'current_v1',
        graph: scheduleGraph(),
      },
      {
        automationId: 'outdated',
        organizationId: 'o',
        versionId: 'outdated_v2',
        graph: scheduleGraph(),
      },
      {
        automationId: 'missing',
        organizationId: 'o',
        versionId: 'missing_v1',
        graph: scheduleGraph(),
      },
      { automationId: 'broken', organizationId: 'o', versionId: 'broken_v1', graph: { nodes: 1 } },
    ];

    const report = await reconcileAutomationSchedules(temporal.client, async () => active);

    // The outdated one is replaced (delete, then create): counted as recreated.
    expect(report).toEqual({ recreated: 2, deleted: 1, failures: 1 });
    expect(temporal.deleted.sort()).toEqual([
      'automation-schedule:outdated',
      'automation-schedule:paused',
    ]);
    expect(temporal.created.map((options) => options.scheduleId).sort()).toEqual([
      'automation-schedule:missing',
      'automation-schedule:outdated',
    ]);
    expect([...temporal.schedules.keys()].sort()).toEqual([
      'another-schedule',
      'automation-schedule:current',
      'automation-schedule:missing',
      'automation-schedule:outdated',
    ]);
    const outdated = temporal.created.find(
      (options) => options.scheduleId === 'automation-schedule:outdated',
    );
    expect(outdated?.action.args).toEqual([
      { scheduled: { automationId: 'outdated', versionId: 'outdated_v2' }, organizationId: 'o' },
    ]);
  });
});
