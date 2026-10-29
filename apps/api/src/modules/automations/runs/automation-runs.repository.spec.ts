/**
 * The run rules that live in the queries: every read scoped to the
 * workspace (step rows through their run), runs of deleted workflows hidden,
 * the latest attempt per step, the newest test run's outputs, and the
 * conditional writes behind a review decision and a direct cancel.
 */
jest.mock('@postgear/db', () => {
  const actual = jest.requireActual('@postgear/db');

  return {
    ...actual,
    prisma: {
      automation: { findFirst: jest.fn() },
      automationRun: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        updateMany: jest.fn(),
      },
      automationRunStep: { findMany: jest.fn(), findFirst: jest.fn(), updateMany: jest.fn() },
      automationConnection: { findMany: jest.fn() },
      $transaction: jest.fn(),
    },
  };
});

import { Prisma, prisma } from '@postgear/db';
import { AutomationRunsRepository } from './automation-runs.repository';

type PrismaMock = {
  automation: { findFirst: jest.Mock };
  automationRun: Record<'findFirst' | 'findMany' | 'create' | 'updateMany', jest.Mock>;
  automationRunStep: Record<'findMany' | 'findFirst' | 'updateMany', jest.Mock>;
  automationConnection: { findMany: jest.Mock };
  $transaction: jest.Mock;
};

const db = prisma as unknown as PrismaMock;
const ORG = 'org_1';
const ID = '3a5c7d2e-1f4b-4c8a-9e6d-0b2a4c6e8f10';
const RUN_ID = '7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f';
const T0 = new Date('2026-10-29T09:00:00.000Z');

describe('AutomationRunsRepository', () => {
  let repository: AutomationRunsRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    db.$transaction.mockImplementation(async (work: (tx: unknown) => unknown) => work(db));
    repository = new AutomationRunsRepository();
  });

  it('reads workflows of the workspace that are not deleted', async () => {
    db.automation.findFirst.mockResolvedValue(null);

    await repository.findAutomation(ORG, ID);
    await repository.automationExists(ORG, ID);

    for (const [query] of db.automation.findFirst.mock.calls) {
      expect(query.where).toEqual({ id: ID, organizationId: ORG, deletedAt: null });
    }
  });

  it('reads runs of the workspace only, and not those of a deleted workflow', async () => {
    db.automationRun.findFirst.mockResolvedValue(null);

    await repository.findRun(ORG, RUN_ID);
    await repository.findRunSummary(ORG, RUN_ID);

    for (const [query] of db.automationRun.findFirst.mock.calls) {
      expect(query.where).toEqual({
        id: RUN_ID,
        organizationId: ORG,
        automation: { deletedAt: null },
      });
    }
  });

  it('lists a workflow runs newest first, one extra row for the next page', async () => {
    db.automationRun.findMany.mockResolvedValue([]);

    await repository.listRuns(ORG, ID, { take: 25 });
    await repository.listRuns(ORG, ID, {
      take: 25,
      mode: 'TEST',
      status: 'FAILED',
      cursor: RUN_ID,
    });

    expect(db.automationRun.findMany.mock.calls[0][0]).toMatchObject({
      where: { organizationId: ORG, automationId: ID },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 26,
    });
    expect(db.automationRun.findMany.mock.calls[0][0]).not.toHaveProperty('cursor');
    expect(db.automationRun.findMany.mock.calls[1][0]).toMatchObject({
      where: { organizationId: ORG, automationId: ID, mode: 'TEST', status: 'FAILED' },
      cursor: { id: RUN_ID },
      skip: 1,
    });
    // The list never loads trigger data or graphs.
    expect(db.automationRun.findMany.mock.calls[0][0].select).not.toHaveProperty('triggerPayload');
  });

  it('creates test runs in the workspace, QUEUED', async () => {
    db.automationRun.create.mockResolvedValue({});

    await repository.createRun(ORG, {
      automationId: ID,
      triggerType: 'trigger.manual',
      triggerPayload: { inputs: {} },
      graphSnapshot: { nodes: [] },
      options: { scope: { kind: 'run' } },
      startedById: 'user_1',
    });

    expect(db.automationRun.create.mock.calls[0][0].data).toMatchObject({
      organizationId: ORG,
      mode: 'TEST',
      status: 'QUEUED',
      automationId: ID,
    });
  });

  it('takes the latest attempt of each step, with how many attempts it took', async () => {
    db.automationRunStep.findMany
      .mockResolvedValueOnce([
        { id: 'a1', nodeKey: 'send', attempt: 1, createdAt: new Date(T0.getTime() + 100) },
        { id: 'a2', nodeKey: 'send', attempt: 2, createdAt: new Date(T0.getTime() + 900) },
        { id: 't1', nodeKey: 'trig', attempt: 1, createdAt: T0 },
      ])
      .mockResolvedValueOnce([
        { id: 'a2', nodeKey: 'send' },
        { id: 't1', nodeKey: 'trig' },
      ]);

    const steps = await repository.latestSteps(ORG, RUN_ID);

    expect(steps.map((entry) => [entry.step.id, entry.attempts])).toEqual([
      ['t1', 1],
      ['a2', 2],
    ]);
    const [light, full] = db.automationRunStep.findMany.mock.calls.map(([query]) => query);
    expect(light.where).toEqual({ runId: RUN_ID, run: { organizationId: ORG } });
    expect(light.select).toEqual({ id: true, nodeKey: true, attempt: true, createdAt: true });
    expect(full.where).toEqual({
      runId: RUN_ID,
      run: { organizationId: ORG },
      id: { in: ['a2', 't1'] },
    });
  });

  it('reads changed steps through their run, oldest change first', async () => {
    db.automationRunStep.findMany.mockResolvedValue([]);
    const since = new Date(T0);

    await repository.stepsChangedSince(ORG, RUN_ID, since);

    expect(db.automationRunStep.findMany.mock.calls[0][0]).toMatchObject({
      where: { runId: RUN_ID, run: { organizationId: ORG }, updatedAt: { gt: since } },
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
    });
  });

  it('seeds from the newest of the recent test runs that has each step', async () => {
    db.automationRun.findMany.mockResolvedValue([{ id: 'run_new' }, { id: 'run_old' }]);
    db.automationRunStep.findMany
      .mockResolvedValueOnce([
        { id: 'old_a', runId: 'run_old', nodeKey: 'stepA', attempt: 1 },
        { id: 'new_a', runId: 'run_new', nodeKey: 'stepA', attempt: 1 },
        { id: 'old_b1', runId: 'run_old', nodeKey: 'stepB', attempt: 1 },
        { id: 'old_b2', runId: 'run_old', nodeKey: 'stepB', attempt: 2 },
      ])
      .mockResolvedValueOnce([
        { nodeKey: 'stepA', output: { from: 'new' } },
        { nodeKey: 'stepB', output: { from: 'old, attempt 2' } },
      ]);

    const outputs = await repository.latestTestOutputs(ORG, ID, ['stepA', 'stepB']);

    expect(db.automationRun.findMany.mock.calls[0][0]).toMatchObject({
      where: { organizationId: ORG, automationId: ID, mode: 'TEST' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    expect(db.automationRunStep.findMany.mock.calls[0][0].where).toMatchObject({
      runId: { in: ['run_new', 'run_old'] },
      nodeKey: { in: ['stepA', 'stepB'] },
      status: { in: ['SUCCEEDED', 'DRY_RUN', 'HANDLED_ERROR'] },
    });
    expect(db.automationRunStep.findMany.mock.calls[1][0].where).toEqual({
      id: { in: ['new_a', 'old_b2'] },
    });
    expect(Object.fromEntries(outputs)).toEqual({
      stepA: { from: 'new' },
      stepB: { from: 'old, attempt 2' },
    });
  });

  it('writes a review decision only into a waiting, unanswered step of the workspace', async () => {
    db.automationRunStep.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    await expect(repository.recordReview(ORG, 'step_1', { decision: 'approved' })).resolves.toBe(
      true,
    );
    await expect(repository.recordReview(ORG, 'step_1', { decision: 'rejected' })).resolves.toBe(
      false,
    );

    expect(db.automationRunStep.updateMany.mock.calls[0][0]).toEqual({
      where: {
        id: 'step_1',
        status: 'WAITING',
        output: { equals: Prisma.AnyNull },
        run: { organizationId: ORG },
      },
      data: { output: { decision: 'approved' } },
    });
  });

  it('takes a decision back only while the step still waits', async () => {
    db.automationRunStep.updateMany.mockResolvedValue({ count: 1 });

    await repository.clearReview(ORG, 'step_1');

    expect(db.automationRunStep.updateMany.mock.calls[0][0]).toEqual({
      where: { id: 'step_1', status: 'WAITING', run: { organizationId: ORG } },
      data: { output: Prisma.DbNull },
    });
  });

  it('cancels a run directly only from the given statuses, with its open steps', async () => {
    db.automationRun.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    db.automationRunStep.updateMany.mockResolvedValue({ count: 2 });

    await expect(repository.cancelRun(ORG, RUN_ID, ['QUEUED'])).resolves.toBe(true);
    expect(db.automationRun.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: RUN_ID, organizationId: ORG, status: { in: ['QUEUED'] } },
      data: { status: 'CANCELLED' },
    });
    expect(db.automationRunStep.updateMany.mock.calls[0][0]).toMatchObject({
      where: { runId: RUN_ID, status: { in: ['QUEUED', 'RUNNING', 'WAITING'] } },
      data: { status: 'CANCELLED' },
    });

    // The run moved on: its steps are left alone.
    await expect(repository.cancelRun(ORG, RUN_ID, ['QUEUED'])).resolves.toBe(false);
    expect(db.automationRunStep.updateMany).toHaveBeenCalledTimes(1);
  });

  it('reads every connection of the workspace, deleted ones too, for redaction', async () => {
    db.automationConnection.findMany.mockResolvedValue([{ credentials: 'v1:a:b:c' }]);

    await expect(repository.connectionCredentials(ORG)).resolves.toEqual(['v1:a:b:c']);
    expect(db.automationConnection.findMany.mock.calls[0][0]).toEqual({
      where: { organizationId: ORG },
      select: { credentials: true },
    });
  });
});
