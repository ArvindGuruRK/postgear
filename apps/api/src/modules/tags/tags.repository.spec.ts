/**
 * The tag rules that live in the writes: names unique per workspace ignoring
 * case and only among live tags, a cap, a serializable transaction that is
 * retried when Postgres aborts it, and a delete that is soft and scoped.
 */
jest.mock('@postgear/db', () => {
  const actual = jest.requireActual('@postgear/db');

  return {
    ...actual,
    prisma: {
      tags: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      $transaction: jest.fn(),
    },
  };
});

import { Prisma, prisma } from '@postgear/db';
import { TagsRepository } from './tags.repository';

type PrismaMock = {
  tags: Record<'findMany' | 'findFirst' | 'count' | 'create' | 'update' | 'updateMany', jest.Mock>;
  $transaction: jest.Mock;
};

const db = prisma as unknown as PrismaMock;

describe('TagsRepository', () => {
  let repository: TagsRepository;

  beforeEach(() => {
    repository = new TagsRepository();
    db.$transaction.mockImplementation(async (work: (tx: unknown) => Promise<unknown>) => work(db));
    db.tags.count.mockResolvedValue(0);
    db.tags.findFirst.mockResolvedValue(null);
    db.tags.create.mockImplementation(async ({ data }) => ({
      id: 't-new',
      name: data.name,
      color: data.color,
    }));
  });

  it('lists live tags of the workspace by name', async () => {
    db.tags.findMany.mockResolvedValue([]);

    await repository.list('org_1');

    expect(db.tags.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { orgId: 'org_1', deletedAt: null },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      }),
    );
  });

  it('creates a tag in a serializable transaction', async () => {
    await expect(
      repository.create('org_1', { name: 'Launch', color: 'teal' }, 200),
    ).resolves.toEqual({
      outcome: 'created',
      tag: { id: 't-new', name: 'Launch', color: 'teal' },
    });
    expect(db.$transaction.mock.calls[0][1]).toEqual({
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    expect(db.tags.create.mock.calls[0][0].data).toEqual({
      orgId: 'org_1',
      name: 'Launch',
      color: 'teal',
    });
  });

  it('refuses a name a live tag of the workspace already has, ignoring case', async () => {
    db.tags.findFirst.mockResolvedValueOnce({ id: 't-1' });

    await expect(
      repository.create('org_1', { name: 'launch', color: 'teal' }, 200),
    ).resolves.toEqual({
      outcome: 'name_taken',
    });
    expect(db.tags.findFirst.mock.calls[0][0].where).toEqual({
      orgId: 'org_1',
      deletedAt: null,
      name: { equals: 'launch', mode: 'insensitive' },
    });
    expect(db.tags.create).not.toHaveBeenCalled();
  });

  it('stops at the cap', async () => {
    db.tags.count.mockResolvedValueOnce(200);

    await expect(
      repository.create('org_1', { name: 'One more', color: 'rose' }, 200),
    ).resolves.toEqual({
      outcome: 'too_many',
    });
  });

  it('retries a transaction Postgres aborted for serializability, then gives up', async () => {
    const abort = () =>
      new Prisma.PrismaClientKnownRequestError('could not serialize access', {
        code: 'P2034',
        clientVersion: '5',
      });
    db.$transaction.mockRejectedValueOnce(abort());

    await expect(
      repository.create('org_1', { name: 'Launch', color: 'teal' }, 200),
    ).resolves.toMatchObject({
      outcome: 'created',
    });

    db.$transaction.mockRejectedValue(abort());
    await expect(
      repository.create('org_1', { name: 'Launch', color: 'teal' }, 200),
    ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
  });

  it('lets a tag be renamed to another casing of its own name, but not to another tag’s', async () => {
    db.tags.findFirst.mockResolvedValueOnce({ id: 't-1' }).mockResolvedValueOnce(null);
    db.tags.update.mockResolvedValue({ id: 't-1', name: 'LAUNCH', color: 'teal' });

    await expect(repository.update('org_1', 't-1', { name: 'LAUNCH' })).resolves.toMatchObject({
      outcome: 'updated',
    });
    expect(db.tags.findFirst.mock.calls[1][0].where).toMatchObject({ id: { not: 't-1' } });

    db.tags.findFirst.mockResolvedValueOnce({ id: 't-1' }).mockResolvedValueOnce({ id: 't-2' });
    await expect(repository.update('org_1', 't-1', { name: 'Other' })).resolves.toEqual({
      outcome: 'name_taken',
    });
  });

  it('reports a tag of another workspace, or a deleted one, as not found', async () => {
    await expect(repository.update('org_1', 't-9', { color: 'rose' })).resolves.toEqual({
      outcome: 'not_found',
    });
    expect(db.tags.findFirst.mock.calls[0][0].where).toEqual({
      id: 't-9',
      orgId: 'org_1',
      deletedAt: null,
    });
  });

  it('soft-deletes only a live tag of the workspace', async () => {
    db.tags.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });

    await expect(repository.softDelete('org_1', 't-1')).resolves.toBe(true);
    expect(db.tags.updateMany.mock.calls[0][0]).toEqual({
      where: { id: 't-1', orgId: 'org_1', deletedAt: null },
      data: { deletedAt: expect.any(Date) },
    });
    await expect(repository.softDelete('org_1', 't-1')).resolves.toBe(false);
  });
});
