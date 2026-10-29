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
import { SCHEDULING_TASK_QUEUE } from '@postgear/scheduling';
import {
  type Client,
  WorkflowExecutionAlreadyStartedError,
  WorkflowNotFoundError,
} from '@temporalio/client';
import { INTERRUPTED_MESSAGE } from '../automation/finish';
import { MemoryRunStore } from '../automation/memory-run-store';
import { graphOf, ORG, step } from '../automation/testing';
import { reconcileAutomationRuns } from './maintenance.activities';

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
