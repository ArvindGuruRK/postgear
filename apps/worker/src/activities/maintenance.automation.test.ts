/**
 * The workflow-run part of the maintenance reconcile, with `prisma` and
 * the Temporal client faked: queued runs are started with the run options,
 * and open runs whose workflow is gone are marked FAILED.
 */
jest.mock('@postgear/db', () => {
  const actual = jest.requireActual('@postgear/db');
  return {
    ...actual,
    prisma: { automationRun: { findMany: jest.fn() } },
  };
});

import { LIMITS } from '@postgear/automation';
import { prisma } from '@postgear/db';
import { AUTOMATION_RUN_RETENTION_DAYS, SCHEDULING_TASK_QUEUE } from '@postgear/scheduling';
import {
  type Client,
  WorkflowExecutionAlreadyStartedError,
  WorkflowNotFoundError,
} from '@temporalio/client';
import { INTERRUPTED_MESSAGE } from '../automation/finish';
import { MemoryRunStore } from '../automation/memory-run-store';
import { graphOf, ORG, step } from '../automation/testing';
import {
  AUTOMATION_PRUNE_BATCH,
  type PruneClient,
  pruneAutomationRuns,
  reconcileAutomationRuns,
} from './maintenance.activities';

const findMany = prisma.automationRun.findMany as unknown as jest.Mock;
const NOW = Date.parse('2026-11-03T09:00:00Z');

function fakeClient(statuses: Record<string, string | 'missing'>) {
  const start = jest.fn(async (_name: string, options: { workflowId: string }) => {
    if (statuses[options.workflowId]) {
      throw new WorkflowExecutionAlreadyStartedError(
        'started',
        options.workflowId,
        'automationRunWorkflow',
      );
    }
  });
  const getHandle = jest.fn((workflowId: string) => ({
    describe: jest.fn(async () => {
      const status = statuses[workflowId];
      if (!status || status === 'missing') {
        throw new WorkflowNotFoundError('not found', workflowId, undefined);
      }
      return { status: { name: status } };
    }),
  }));
  return { client: { workflow: { start, getHandle } } as unknown as Client, start };
}

function storeWith(...runs: { id: string; status: 'QUEUED' | 'RUNNING' | 'WAITING' }[]) {
  const store = new MemoryRunStore();
  for (const run of runs) {
    store.addRun({
      ...run,
      organizationId: ORG,
      automationId: 'auto_1',
      mode: 'LIVE',
      graph: graphOf([step('trig1', 'trigger.manual')]),
    });
  }
  return store;
}

describe('reconcileAutomationRuns', () => {
  it('starts queued runs with the run timeout and reject-duplicate ids', async () => {
    findMany
      .mockResolvedValueOnce([{ id: 'run_q', organizationId: ORG }])
      .mockResolvedValueOnce([]);
    const { client, start } = fakeClient({});

    const report = await reconcileAutomationRuns(client, storeWith(), NOW);

    expect(report).toEqual({ queued: 1, interrupted: 0, failures: 0 });
    expect(start).toHaveBeenCalledWith('automationRunWorkflow', {
      workflowId: 'automation-run:run_q',
      taskQueue: SCHEDULING_TASK_QUEUE,
      args: [{ runId: 'run_q', organizationId: ORG }],
      workflowExecutionTimeout: `${LIMITS.runTimeoutDays} days`,
      workflowIdReusePolicy: 'REJECT_DUPLICATE',
    });
    expect(findMany.mock.calls[0][0].where.createdAt.lt).toEqual(new Date(NOW - 60_000));
  });

  it('marks open runs whose workflow is gone or closed as interrupted, and leaves live ones', async () => {
    findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
      { id: 'run_gone', organizationId: ORG },
      { id: 'run_closed', organizationId: ORG },
      { id: 'run_live', organizationId: ORG },
    ]);
    const store = storeWith(
      { id: 'run_gone', status: 'RUNNING' },
      { id: 'run_closed', status: 'WAITING' },
      { id: 'run_live', status: 'RUNNING' },
    );
    store.steps.push({
      runId: 'run_closed',
      nodeKey: 'review',
      nodeType: 'logic.manualReview',
      nodeName: 'Review',
      status: 'WAITING',
      attempt: 1,
      input: null,
      output: null,
      truncated: false,
      error: null,
      startedAt: null,
      finishedAt: null,
      durationMs: null,
      ports: [],
    });
    const { client } = fakeClient({
      'automation-run:run_gone': 'missing',
      'automation-run:run_closed': 'COMPLETED',
      'automation-run:run_live': 'RUNNING',
    });

    const report = await reconcileAutomationRuns(client, store, NOW);

    expect(report).toEqual({ queued: 0, interrupted: 2, failures: 0 });
    expect(store.runs.get('run_gone')?.status).toBe('FAILED');
    expect(store.runExtras.get('run_gone')?.error).toBe(INTERRUPTED_MESSAGE);
    expect(store.runs.get('run_closed')?.status).toBe('FAILED');
    expect(store.latest('run_closed', 'review')?.status).toBe('CANCELLED');
    expect(store.runs.get('run_live')?.status).toBe('RUNNING');
  });
});

describe('reconcileAutomationRuns: scheduled runs (Module 09)', () => {
  const scheduledId = 'automation-scheduled:auto_1-2026-11-03T09:00:00Z';

  it('never starts a second workflow for a queued scheduled run', async () => {
    findMany
      .mockResolvedValueOnce([
        { id: 'run_waiting', organizationId: ORG, temporalWorkflowId: scheduledId },
        { id: 'run_lost', organizationId: ORG, temporalWorkflowId: `${scheduledId}-lost` },
      ])
      .mockResolvedValueOnce([]);
    const store = storeWith(
      { id: 'run_waiting', status: 'QUEUED' },
      { id: 'run_lost', status: 'QUEUED' },
    );
    const { client, start } = fakeClient({ [scheduledId]: 'RUNNING' });

    const report = await reconcileAutomationRuns(client, store, NOW);

    expect(start).not.toHaveBeenCalled();
    // `queued` counts the queued rows looked at.
    expect(report).toEqual({ queued: 2, interrupted: 1, failures: 0 });
    expect(store.runs.get('run_waiting')?.status).toBe('QUEUED');
    expect(store.runs.get('run_lost')?.status).toBe('FAILED');
  });

  it('checks an open scheduled run under the workflow id the Schedule gave it', async () => {
    findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: 'run_s', organizationId: ORG, temporalWorkflowId: scheduledId },
      ]);
    const store = storeWith({ id: 'run_s', status: 'RUNNING' });
    const { client } = fakeClient({ [scheduledId]: 'RUNNING' });

    const report = await reconcileAutomationRuns(client, store, NOW);

    expect(report.interrupted).toBe(0);
    expect(store.runs.get('run_s')?.status).toBe('RUNNING');
  });

  it('an interrupted live run counts as a failure and alerts', async () => {
    findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'run_gone', organizationId: ORG }]);
    const store = storeWith({ id: 'run_gone', status: 'RUNNING' });
    const { client } = fakeClient({});

    await reconcileAutomationRuns(client, store, NOW);

    expect(store.automations.get('auto_1')?.consecutiveFailures).toBe(1);
    expect(store.notifications).toEqual([
      expect.objectContaining({ type: 'automation.failed', title: 'Workflow failed' }),
    ]);
  });
});

describe('pruneAutomationRuns', () => {
  function pruneClient(total: number) {
    let left = total;
    const findRuns = jest.fn(async (args: { take: number }) =>
      Array.from({ length: Math.min(left, args.take) }, (_, i) => ({ id: `run_${left - i}` })),
    );
    const deleteMany = jest.fn(async (args: { where: { id: { in: string[] } } }) => {
      left -= args.where.id.in.length;
      return { count: args.where.id.in.length };
    });
    const deleteEffects = jest.fn(async () => ({ count: 7 }));
    return {
      client: {
        automationRun: { findMany: findRuns, deleteMany },
        automationEffect: { deleteMany: deleteEffects },
      } as unknown as PruneClient,
      findRuns,
      deleteMany,
      deleteEffects,
    };
  }

  it('deletes finished runs older than the retention, 500 at a time', async () => {
    const { client, findRuns, deleteMany } = pruneClient(1_200);

    await expect(pruneAutomationRuns(client, new Date(NOW))).resolves.toEqual({
      runs: 1_200,
      effects: 7,
    });

    expect(deleteMany).toHaveBeenCalledTimes(3);
    expect(deleteMany.mock.calls.map(([args]) => args.where.id.in.length)).toEqual([
      AUTOMATION_PRUNE_BATCH,
      AUTOMATION_PRUNE_BATCH,
      200,
    ]);
    const [{ where, take, orderBy }] = findRuns.mock.calls[0] as unknown as [
      {
        where: { status: { in: string[] }; finishedAt: { lt: Date } };
        take: number;
        orderBy: unknown;
      },
    ];
    expect(take).toBe(AUTOMATION_PRUNE_BATCH);
    expect(orderBy).toEqual({ finishedAt: 'asc' });
    expect(where.finishedAt.lt).toEqual(
      new Date(NOW - AUTOMATION_RUN_RETENTION_DAYS * 24 * 60 * 60_000),
    );
    // Open runs are never pruned, however old.
    expect(where.status.in.sort()).toEqual(
      ['CANCELLED', 'EXPIRED', 'FAILED', 'REJECTED', 'SUCCEEDED'].sort(),
    );
    expect(deleteMany.mock.calls[0][0]).toMatchObject({
      where: { status: { in: where.status.in } },
    });
  });

  it('does nothing when nothing is old enough', async () => {
    const { client, deleteMany } = pruneClient(0);
    await expect(pruneAutomationRuns(client, new Date(NOW))).resolves.toMatchObject({ runs: 0 });
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it('deletes step gateway effects older than the retention (Module 10)', async () => {
    const { client, deleteEffects } = pruneClient(0);
    await expect(pruneAutomationRuns(client, new Date(NOW))).resolves.toEqual({
      runs: 0,
      effects: 7,
    });
    expect(deleteEffects).toHaveBeenCalledWith({
      where: {
        createdAt: { lt: new Date(NOW - AUTOMATION_RUN_RETENTION_DAYS * 24 * 60 * 60_000) },
      },
    });
  });
});
