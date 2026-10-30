/**
 * The workflow rules that live in the queries: every read and write scoped
 * to the workspace and to live rows, the revision check inside the save, run
 * counts as one grouped query, and pinned data written one key at a time.
 * Module 09: activation writes the next version and makes it live in one
 * transaction (a stale revision or a lost race is a conflict), pause and
 * Discard Changes, versions read through the workflow, the runs a delete
 * closes, and no query anywhere in the API that changes or deletes a version.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

jest.mock('@postgear/db', () => {
  const actual = jest.requireActual('@postgear/db');

  const prisma: Record<string, unknown> = {
    automation: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
    automationVersion: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn() },
    automationRun: { groupBy: jest.fn(), findMany: jest.fn(), updateMany: jest.fn() },
    automationRunStep: { updateMany: jest.fn() },
    integration: { findMany: jest.fn() },
    $executeRaw: jest.fn(),
  };
  // An interactive transaction runs against the same mocked client.
  prisma.$transaction = jest.fn(async (run: (tx: unknown) => unknown) => run(prisma));

  return { ...actual, prisma };
});

import {
  AutomationRunStatus,
  AutomationStatus,
  AutomationStepStatus,
  Prisma,
  prisma,
} from '@postgear/db';
import { AutomationsRepository } from './automations.repository';

type PrismaMock = {
  automation: Record<'findMany' | 'findFirst' | 'create' | 'updateMany', jest.Mock>;
  automationVersion: Record<'findMany' | 'findFirst' | 'create', jest.Mock>;
  automationRun: Record<'groupBy' | 'findMany' | 'updateMany', jest.Mock>;
  automationRunStep: { updateMany: jest.Mock };
  $transaction: jest.Mock;
  integration: { findMany: jest.Mock };
  $executeRaw: jest.Mock;
};

const db = prisma as unknown as PrismaMock;
const ORG = 'org_1';
const ID = '3a5c7d2e-1f4b-4c8a-9e6d-0b2a4c6e8f10';

/** The text and values of a tagged-template `$executeRaw` call. */
function rawCall(index = 0): { sql: string; values: unknown[] } {
  const [strings, ...values] = db.$executeRaw.mock.calls[index] as [
    TemplateStringsArray,
    ...unknown[],
  ];
  return { sql: strings.join('?'), values };
}

describe('AutomationsRepository', () => {
  let repository: AutomationsRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    repository = new AutomationsRepository();
  });

  it('lists live workflows of the workspace, newest edit first, one extra row for the next page', async () => {
    db.automation.findMany.mockResolvedValue([]);

    await repository.list(ORG, { take: 50 });
    await repository.list(ORG, { take: 50, status: 'ACTIVE', cursor: ID });

    expect(db.automation.findMany.mock.calls[0][0]).toMatchObject({
      where: { organizationId: ORG, deletedAt: null },
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      take: 51,
    });
    expect(db.automation.findMany.mock.calls[0][0]).not.toHaveProperty('cursor');
    expect(db.automation.findMany.mock.calls[1][0]).toMatchObject({
      where: { organizationId: ORG, deletedAt: null, status: 'ACTIVE' },
      cursor: { id: ID },
      skip: 1,
    });
    // The list never reads the graph.
    expect(db.automation.findMany.mock.calls[0][0].select).not.toHaveProperty('draftGraph');
  });

  it('searches names in the workspace only', async () => {
    db.automation.findMany.mockResolvedValue([]);

    await repository.search(ORG, 'report', { limit: 200 });

    expect(db.automation.findMany.mock.calls[0][0]).toMatchObject({
      where: {
        organizationId: ORG,
        deletedAt: null,
        name: { contains: 'report', mode: 'insensitive' },
      },
      take: 200,
    });
  });

  it('counts live runs for a whole page in one grouped query', async () => {
    db.automationRun.groupBy.mockResolvedValue([{ automationId: ID, _count: { _all: 4 } }]);
    const since = new Date('2026-09-29T00:00:00.000Z');

    const counts = await repository.liveRunCounts(ORG, [ID, 'other'], since);

    expect(counts.get(ID)).toBe(4);
    expect(db.automationRun.groupBy).toHaveBeenCalledTimes(1);
    expect(db.automationRun.groupBy.mock.calls[0][0]).toMatchObject({
      by: ['automationId'],
      where: {
        organizationId: ORG,
        automationId: { in: [ID, 'other'] },
        mode: 'LIVE',
        createdAt: { gte: since },
      },
    });

    await expect(repository.liveRunCounts(ORG, [], since)).resolves.toEqual(new Map());
    expect(db.automationRun.groupBy).toHaveBeenCalledTimes(1);
  });

  it('reads one workflow only within the workspace and only while live', async () => {
    db.automation.findFirst.mockResolvedValue(null);

    await repository.find(ORG, ID);
    await repository.findSaveState(ORG, ID);

    for (const [call] of db.automation.findFirst.mock.calls) {
      expect(call.where).toEqual({ id: ID, organizationId: ORG, deletedAt: null });
    }
  });

  it('creates in the workspace with the creator as the first editor', async () => {
    db.automation.create.mockResolvedValue({});

    await repository.create(ORG, {
      name: 'Flow',
      draftGraph: { schemaVersion: 1, nodes: [], edges: [], notes: [] },
      triggerType: null,
      templateId: null,
      createdById: 'user_1',
    });

    expect(db.automation.create.mock.calls[0][0].data).toMatchObject({
      organizationId: ORG,
      createdById: 'user_1',
      updatedById: 'user_1',
    });
  });

  it('saves only against the expected revision, and bumps it in the same write', async () => {
    db.automation.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(repository.update(ORG, ID, 3, { name: 'New' })).resolves.toBeNull();

    expect(db.automation.updateMany).toHaveBeenCalledWith({
      where: { id: ID, organizationId: ORG, deletedAt: null, draftRevision: 3 },
      data: { name: 'New', draftRevision: { increment: 1 } },
    });
    expect(db.automation.findFirst).not.toHaveBeenCalled();

    db.automation.updateMany.mockResolvedValueOnce({ count: 1 });
    db.automation.findFirst.mockResolvedValueOnce({ id: ID, draftRevision: 4 });
    await expect(repository.update(ORG, ID, 3, { name: 'New' })).resolves.toMatchObject({
      draftRevision: 4,
    });
  });

  it('soft deletes within the workspace', async () => {
    db.automation.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    await expect(repository.softDelete(ORG, ID)).resolves.toBe(true);
    await expect(repository.softDelete(ORG, ID)).resolves.toBe(false);

    expect(db.automation.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: ID, organizationId: ORG, deletedAt: null },
      data: { deletedAt: expect.any(Date) },
    });
  });

  it('pins and unpins one key in SQL, scoped, as bound values', async () => {
    db.$executeRaw.mockResolvedValueOnce(1).mockResolvedValueOnce(0);

    await expect(repository.setPinned(ORG, ID, 'fields', { output: { a: 1 } })).resolves.toBe(true);
    await expect(repository.removePinned(ORG, ID, 'fields')).resolves.toBe(false);

    const pin = rawCall(0);
    expect(pin.sql).toContain('jsonb_set("pinnedData"');
    expect(pin.sql).toContain('"organizationId" = ?');
    expect(pin.sql).toContain('"deletedAt" IS NULL');
    expect(pin.sql).not.toContain('draftRevision');
    expect(pin.values).toEqual(['fields', '{"output":{"a":1}}', ID, ORG]);

    const unpin = rawCall(1);
    expect(unpin.sql).toContain('"pinnedData" - ?::text');
    expect(unpin.values).toEqual(['fields', ID, ORG]);
  });

  it('reads channels of the workspace that are not deleted', async () => {
    db.integration.findMany.mockResolvedValue([]);

    await repository.channels(ORG);

    expect(db.integration.findMany.mock.calls[0][0].where).toEqual({
      organizationId: ORG,
      deletedAt: null,
    });
    // Never a credential column.
    expect(db.integration.findMany.mock.calls[0][0].select).not.toHaveProperty('token');
  });

  describe('activation (Module 09)', () => {
    const GRAPH = { schemaVersion: 1, nodes: [], edges: [], notes: [] };
    const WRITE = {
      expectedRevision: 3,
      graph: GRAPH,
      triggerType: 'trigger.manual',
      note: 'Weekly copy',
      createdById: 'user_1',
    };
    const VERSION = { id: 'ver_5', version: 5 };

    it('writes the next version and makes it live, all in one transaction', async () => {
      db.automation.findFirst.mockResolvedValueOnce({ draftRevision: 3 });
      db.automationVersion.findFirst.mockResolvedValueOnce({ version: 4 });
      db.automationVersion.create.mockResolvedValueOnce(VERSION);
      db.automation.updateMany.mockResolvedValueOnce({ count: 1 });

      await expect(repository.activate(ORG, ID, WRITE)).resolves.toEqual({
        outcome: 'activated',
        version: VERSION,
      });

      expect(db.$transaction).toHaveBeenCalledTimes(1);
      expect(db.automation.findFirst.mock.calls[0][0].where).toEqual({
        id: ID,
        organizationId: ORG,
        deletedAt: null,
      });
      expect(db.automationVersion.findFirst.mock.calls[0][0]).toMatchObject({
        where: { automationId: ID },
        orderBy: { version: 'desc' },
      });
      const created = db.automationVersion.create.mock.calls[0][0];
      expect(created.data).toEqual({
        automationId: ID,
        version: 5,
        graph: GRAPH,
        triggerType: 'trigger.manual',
        note: 'Weekly copy',
        createdById: 'user_1',
      });
      // The answer never carries the graph back.
      expect(created.select).not.toHaveProperty('graph');
      expect(db.automation.updateMany).toHaveBeenCalledWith({
        where: { id: ID, organizationId: ORG, deletedAt: null, draftRevision: 3 },
        data: {
          activeVersionId: 'ver_5',
          status: AutomationStatus.ACTIVE,
          hasUnpublishedChanges: false,
          consecutiveFailures: 0,
        },
      });
    });

    it('numbers the first version 1', async () => {
      db.automation.findFirst.mockResolvedValueOnce({ draftRevision: 3 });
      db.automationVersion.findFirst.mockResolvedValueOnce(null);
      db.automationVersion.create.mockResolvedValueOnce({ id: 'ver_1', version: 1 });
      db.automation.updateMany.mockResolvedValueOnce({ count: 1 });

      await repository.activate(ORG, ID, WRITE);
      expect(db.automationVersion.create.mock.calls[0][0].data.version).toBe(1);
    });

    it('is a conflict before writing when the revision is stale, and not found for another workspace', async () => {
      db.automation.findFirst.mockResolvedValueOnce({ draftRevision: 4 });
      await expect(repository.activate(ORG, ID, WRITE)).resolves.toEqual({
        outcome: 'conflict',
        currentRevision: 4,
      });

      db.automation.findFirst.mockResolvedValueOnce(null);
      await expect(repository.activate(ORG, ID, WRITE)).resolves.toEqual({
        outcome: 'not_found',
      });
      expect(db.automationVersion.create).not.toHaveBeenCalled();
      expect(db.automation.updateMany).not.toHaveBeenCalled();
    });

    it('rolls back and answers a conflict when a save lands between the read and the write', async () => {
      db.automation.findFirst
        .mockResolvedValueOnce({ draftRevision: 3 })
        .mockResolvedValueOnce({ status: 'DRAFT', draftRevision: 5, activeVersion: null });
      db.automationVersion.findFirst.mockResolvedValueOnce({ version: 4 });
      db.automationVersion.create.mockResolvedValueOnce(VERSION);
      db.automation.updateMany.mockResolvedValueOnce({ count: 0 });

      await expect(repository.activate(ORG, ID, WRITE)).resolves.toEqual({
        outcome: 'conflict',
        currentRevision: 5,
      });
    });

    it('answers a conflict when another activation took the same version number', async () => {
      db.automation.findFirst
        .mockResolvedValueOnce({ draftRevision: 3 })
        .mockResolvedValueOnce({ status: 'ACTIVE', draftRevision: 3, activeVersion: null });
      db.automationVersion.findFirst.mockResolvedValueOnce({ version: 4 });
      db.automationVersion.create.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(repository.activate(ORG, ID, WRITE)).resolves.toEqual({
        outcome: 'conflict',
        currentRevision: 3,
      });
    });

    it('lets any other failure through', async () => {
      db.automation.findFirst.mockResolvedValueOnce({ draftRevision: 3 });
      db.automationVersion.findFirst.mockRejectedValueOnce(new Error('connection lost'));

      await expect(repository.activate(ORG, ID, WRITE)).rejects.toThrow('connection lost');
    });

    it('pauses only an active workflow of the workspace', async () => {
      db.automation.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({
        count: 0,
      });

      await expect(repository.pause(ORG, ID)).resolves.toBe(true);
      await expect(repository.pause(ORG, ID)).resolves.toBe(false);
      expect(db.automation.updateMany.mock.calls[0][0]).toEqual({
        where: { id: ID, organizationId: ORG, deletedAt: null, status: AutomationStatus.ACTIVE },
        data: { status: AutomationStatus.PAUSED },
      });
    });

    it('discards the draft back to the live graph and bumps the revision', async () => {
      db.automation.findFirst
        .mockResolvedValueOnce({ activeVersion: { graph: GRAPH, triggerType: 'trigger.manual' } })
        .mockResolvedValueOnce({ id: ID, draftRevision: 4 });
      db.automation.updateMany.mockResolvedValueOnce({ count: 1 });

      await expect(repository.discard(ORG, ID, 'user_1')).resolves.toEqual({
        outcome: 'discarded',
        row: { id: ID, draftRevision: 4 },
      });
      expect(db.automation.updateMany).toHaveBeenCalledWith({
        where: { id: ID, organizationId: ORG, deletedAt: null },
        data: {
          draftGraph: GRAPH,
          triggerType: 'trigger.manual',
          hasUnpublishedChanges: false,
          updatedById: 'user_1',
          draftRevision: { increment: 1 },
        },
      });
      // Only the draft is written: no version is created or changed.
      expect(db.automationVersion.create).not.toHaveBeenCalled();
    });

    it('has nothing to discard to without a live version, and nothing for another workspace', async () => {
      db.automation.findFirst.mockResolvedValueOnce({ activeVersion: null });
      await expect(repository.discard(ORG, ID, null)).resolves.toEqual({
        outcome: 'no_active_version',
      });

      db.automation.findFirst.mockResolvedValueOnce(null);
      await expect(repository.discard(ORG, ID, null)).resolves.toEqual({ outcome: 'not_found' });
      expect(db.automation.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('versions (Module 09)', () => {
    it('lists versions newest first through the live workflow, without their graphs', async () => {
      db.automationVersion.findMany.mockResolvedValueOnce([]);

      await repository.listVersions(ORG, ID);

      const query = db.automationVersion.findMany.mock.calls[0][0];
      expect(query.where).toEqual({
        automationId: ID,
        automation: { organizationId: ORG, deletedAt: null },
      });
      expect(query.orderBy).toEqual({ version: 'desc' });
      expect(query.take).toBe(100);
      expect(query.select).not.toHaveProperty('graph');
    });

    it('reads one version with its graph, through the live workflow', async () => {
      db.automationVersion.findFirst.mockResolvedValueOnce(null);

      await expect(repository.findVersion(ORG, ID, 3)).resolves.toBeNull();

      const query = db.automationVersion.findFirst.mock.calls[0][0];
      expect(query.where).toEqual({
        automationId: ID,
        version: 3,
        automation: { organizationId: ORG, deletedAt: null },
      });
      expect(query.select).toMatchObject({ graph: true, version: true });
    });

    it('never changes or deletes a version anywhere in the API', () => {
      const root = join(__dirname, '..', '..');
      const sources: string[] = [];
      const walk = (dir: string) => {
        for (const name of readdirSync(dir)) {
          const path = join(dir, name);
          if (statSync(path).isDirectory()) walk(path);
          else if (/\.ts$/.test(name) && !/\.(spec|test)\.ts$/.test(name)) sources.push(path);
        }
      };
      walk(root);
      expect(sources.length).toBeGreaterThan(50);

      const offenders = sources.filter((path) => {
        const text = readFileSync(path, 'utf8');
        return (
          /automationVersion\s*\.\s*(update|updateMany|upsert|delete|deleteMany)\b/.test(text) ||
          /(UPDATE|DELETE\s+FROM)\s+"AutomationVersion"/i.test(text)
        );
      });
      expect(offenders).toEqual([]);

      // And the repository has no method that would.
      const methods = Object.getOwnPropertyNames(AutomationsRepository.prototype);
      expect(methods.filter((name) => /version/i.test(name))).toEqual([
        'listVersions',
        'findVersion',
      ]);
    });
  });

  describe('closing runs on delete (Module 09)', () => {
    it('reads the open runs of one workflow in the workspace', async () => {
      db.automationRun.findMany.mockResolvedValueOnce([]);

      await repository.openRuns(ORG, ID);

      expect(db.automationRun.findMany.mock.calls[0][0]).toMatchObject({
        where: {
          organizationId: ORG,
          automationId: ID,
          status: {
            in: [
              AutomationRunStatus.QUEUED,
              AutomationRunStatus.RUNNING,
              AutomationRunStatus.WAITING,
            ],
          },
        },
        select: { id: true, status: true, temporalWorkflowId: true },
      });
    });

    it('closes a run and its open steps only while it has one of the given statuses', async () => {
      db.automationRun.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({
        count: 0,
      });

      await expect(repository.closeRun(ORG, 'run_1', [AutomationRunStatus.QUEUED])).resolves.toBe(
        true,
      );
      expect(db.automationRun.updateMany.mock.calls[0][0]).toEqual({
        where: { id: 'run_1', organizationId: ORG, status: { in: [AutomationRunStatus.QUEUED] } },
        data: { status: AutomationRunStatus.CANCELLED, finishedAt: expect.any(Date) },
      });
      expect(db.automationRunStep.updateMany.mock.calls[0][0]).toMatchObject({
        where: { runId: 'run_1' },
        data: { status: AutomationStepStatus.CANCELLED },
      });

      await expect(repository.closeRun(ORG, 'run_2', [AutomationRunStatus.QUEUED])).resolves.toBe(
        false,
      );
      expect(db.automationRunStep.updateMany).toHaveBeenCalledTimes(1);
    });
  });
});
