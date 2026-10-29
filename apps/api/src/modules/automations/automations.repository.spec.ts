/**
 * The workflow rules that live in the queries: every read and write scoped
 * to the workspace and to live rows, the revision check inside the save, run
 * counts as one grouped query, and pinned data written one key at a time.
 */
jest.mock('@postgear/db', () => {
  const actual = jest.requireActual('@postgear/db');

  return {
    ...actual,
    prisma: {
      automation: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        updateMany: jest.fn(),
      },
      automationRun: { groupBy: jest.fn() },
      integration: { findMany: jest.fn() },
      $executeRaw: jest.fn(),
    },
  };
});

import { prisma } from '@postgear/db';
import { AutomationsRepository } from './automations.repository';

type PrismaMock = {
  automation: Record<'findMany' | 'findFirst' | 'create' | 'updateMany', jest.Mock>;
  automationRun: { groupBy: jest.Mock };
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
});
