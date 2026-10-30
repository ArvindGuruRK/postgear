/**
 * What turning a workflow on, off or deleting it asks of Temporal (Module
 * 09), against a fake scheduler and repository: a Schedule trigger puts the
 * workflow's Temporal Schedule (create or replace) built from the live
 * version, any other trigger deletes a leftover one, and a delete cancels
 * every open run, closing here the ones nobody can tell.
 */
import {
  type AutomationGraph,
  emptyGraph,
  type GraphNode,
  getDefinition,
  type NodeType,
} from '@postgear/automation';
import { AutomationRunStatus } from '@postgear/db';
import type { SchedulingService } from '../scheduling/scheduling.service';
import { AutomationTriggers } from './automation-triggers';
import type { AutomationsRepository, OpenRun } from './automations.repository';

const ORG = 'org_1';
const ID = '3a5c7d2e-1f4b-4c8a-9e6d-0b2a4c6e8f10';

function node(key: string, type: NodeType, config: Record<string, unknown> = {}): GraphNode {
  const definition = getDefinition(type);
  if (!definition) throw new Error(`No definition for ${type}`);
  return {
    key,
    type,
    typeVersion: definition.typeVersion,
    name: key,
    position: { x: 0, y: 0 },
    config: { ...JSON.parse(JSON.stringify(definition.defaultConfig)), ...config },
  };
}

function graphWith(trigger: GraphNode): AutomationGraph {
  return {
    ...emptyGraph(),
    nodes: [trigger, node('bell01', 'notify.inApp', { title: 'Hello', message: 'World' })],
    edges: [
      {
        id: `${trigger.key}:out->bell01`,
        source: trigger.key,
        sourcePort: 'out',
        target: 'bell01',
        targetPort: 'in',
      },
    ],
  };
}

function openRun(id: string, temporalWorkflowId: string | null = null): OpenRun {
  return { id, status: AutomationRunStatus.RUNNING, temporalWorkflowId };
}

describe('AutomationTriggers', () => {
  let scheduling: {
    putAutomationSchedule: jest.Mock;
    deleteAutomationSchedule: jest.Mock;
    cancelAutomationRun: jest.Mock;
  };
  let repository: { openRuns: jest.Mock; closeRun: jest.Mock };
  let triggers: AutomationTriggers;

  beforeEach(() => {
    scheduling = {
      putAutomationSchedule: jest.fn().mockResolvedValue(true),
      deleteAutomationSchedule: jest.fn().mockResolvedValue(true),
      cancelAutomationRun: jest.fn().mockResolvedValue('signalled'),
    };
    repository = {
      openRuns: jest.fn().mockResolvedValue([]),
      closeRun: jest.fn().mockResolvedValue(true),
    };
    triggers = new AutomationTriggers(
      scheduling as unknown as SchedulingService,
      repository as unknown as AutomationsRepository,
    );
  });

  describe('start', () => {
    it('puts the Temporal Schedule of a Schedule trigger from the live version', async () => {
      const graph = graphWith(
        node('trig01', 'trigger.schedule', {
          frequency: 'daily',
          time: '08:00',
          timeZone: 'Asia/Kolkata',
        }),
      );

      await expect(triggers.start(ORG, ID, { id: 'ver_2', graph })).resolves.toBe(true);

      expect(scheduling.putAutomationSchedule).toHaveBeenCalledWith({
        automationId: ID,
        organizationId: ORG,
        versionId: 'ver_2',
        spec: { calendars: [{ hour: 8, minute: 0 }], timezone: 'Asia/Kolkata' },
      });
      expect(scheduling.deleteAutomationSchedule).not.toHaveBeenCalled();
    });

    it('answers false when the schedule could not be set up, so the caller warns', async () => {
      scheduling.putAutomationSchedule.mockResolvedValue(false);
      const graph = graphWith(
        node('trig01', 'trigger.schedule', { frequency: 'daily', time: '08:00', timeZone: 'UTC' }),
      );

      await expect(triggers.start(ORG, ID, { id: 'ver_2', graph })).resolves.toBe(false);
    });

    it('answers false for a schedule it cannot read, without calling Temporal', async () => {
      const graph = graphWith(node('trig01', 'trigger.schedule', { frequency: 'hourly' }));

      await expect(triggers.start(ORG, ID, { id: 'ver_2', graph })).resolves.toBe(false);
      expect(scheduling.putAutomationSchedule).not.toHaveBeenCalled();
    });

    it('deletes a schedule an older version left when the trigger is not Schedule', async () => {
      const graph = graphWith(node('trig01', 'trigger.manual'));

      // A failed delete is the reconcile's job, not the admin's problem.
      scheduling.deleteAutomationSchedule.mockResolvedValue(false);
      await expect(triggers.start(ORG, ID, { id: 'ver_3', graph })).resolves.toBe(true);

      expect(scheduling.deleteAutomationSchedule).toHaveBeenCalledWith(ID);
      expect(scheduling.putAutomationSchedule).not.toHaveBeenCalled();
    });
  });

  it('stop deletes the schedule', async () => {
    await expect(triggers.stop(ORG, ID)).resolves.toBe(true);
    expect(scheduling.deleteAutomationSchedule).toHaveBeenCalledWith(ID);
  });

  describe('stopRuns (a delete)', () => {
    it('tells every open run to cancel, through its own Temporal workflow id', async () => {
      repository.openRuns.mockResolvedValue([openRun('r1'), openRun('r2', 'scheduled-wf-1')]);

      await triggers.stopRuns(ORG, ID);

      expect(repository.openRuns).toHaveBeenCalledWith(ORG, ID);
      expect(scheduling.cancelAutomationRun).toHaveBeenCalledWith('r1', null);
      expect(scheduling.cancelAutomationRun).toHaveBeenCalledWith('r2', 'scheduled-wf-1');
      expect(repository.closeRun).not.toHaveBeenCalled();
    });

    it('closes a run here when its workflow is gone, and only a QUEUED one when Temporal is down', async () => {
      repository.openRuns.mockResolvedValue([openRun('gone'), openRun('down')]);
      scheduling.cancelAutomationRun.mockImplementation(async (runId: string) =>
        runId === 'gone' ? 'notFound' : 'unavailable',
      );
      repository.closeRun.mockImplementation(
        async (_org: string, runId: string) => runId === 'gone',
      );

      await triggers.stopRuns(ORG, ID);

      expect(repository.closeRun).toHaveBeenCalledWith(ORG, 'gone', [
        AutomationRunStatus.QUEUED,
        AutomationRunStatus.RUNNING,
        AutomationRunStatus.WAITING,
      ]);
      expect(repository.closeRun).toHaveBeenCalledWith(ORG, 'down', [AutomationRunStatus.QUEUED]);
    });

    it('works through many runs in batches', async () => {
      repository.openRuns.mockResolvedValue(Array.from({ length: 23 }, (_, i) => openRun(`r${i}`)));

      await triggers.stopRuns(ORG, ID);
      expect(scheduling.cancelAutomationRun).toHaveBeenCalledTimes(23);
    });
  });
});
