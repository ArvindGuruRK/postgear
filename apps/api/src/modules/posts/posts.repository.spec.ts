/**
 * How a post becomes rows, and how an edit changes them.
 *
 * Asserted against what reaches Prisma, like the channels repository suite,
 * because the properties that matter are about writes: one group id across
 * every channel, a correct parent chain after a reorder, rows reused by
 * position rather than by any id a client chose, and an optimistic check that
 * cannot be raced.
 */
jest.mock('@postgear/db', () => {
  const actual = jest.requireActual('@postgear/db');

  return {
    ...actual,
    prisma: {
      post: {
        findMany: jest.fn(),
        groupBy: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      $transaction: jest.fn(),
    },
  };
});

import { Prisma, prisma, State } from '@postgear/db';
import { orderChain, PostsRepository } from './posts.repository';

type PrismaMock = {
  post: Record<'findMany' | 'groupBy' | 'create' | 'update' | 'updateMany', jest.Mock>;
  $transaction: jest.Mock;
};

const db = prisma as unknown as PrismaMock;

const part = (label: string) => ({ content: `{"label":"${label}"}`, image: '[]' });

describe('PostsRepository', () => {
  let repository: PostsRepository;
  let nextId: number;

  beforeEach(() => {
    repository = new PostsRepository();
    nextId = 0;
    db.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback(db),
    );
    db.post.create.mockImplementation(async () => ({ id: `new_${++nextId}` }));
  });

  describe('createGroup', () => {
    it('writes every channel under one group, chaining each thread by parent', async () => {
      await repository.createGroup({
        orgId: 'org_1',
        group: 'g_1',
        state: 'DRAFT',
        publishDate: new Date('2026-10-01T09:00:00Z'),
        channels: [
          { integrationId: 'ch_x', customized: false, parts: [part('a'), part('b')] },
          { integrationId: 'ch_li', customized: true, parts: [part('c')] },
        ],
      });

      const writes = db.post.create.mock.calls.map(([args]) => args.data);

      expect(writes).toHaveLength(3);
      // The reference mints a new group per channel. One post, one group.
      expect(new Set(writes.map((data) => data.group))).toEqual(new Set(['g_1']));
      expect(writes[0].parentPost).toBeUndefined();
      expect(writes[1].parentPost).toEqual({ connect: { id: 'new_1' } });
      expect(writes[2].parentPost).toBeUndefined();
      expect(writes[2].settings).toBe('{"customized":true}');
    });

    it('connects each channel scoped to the workspace and alive, not by id alone', async () => {
      await repository.createGroup({
        orgId: 'org_1',
        group: 'g_1',
        state: 'QUEUE',
        publishDate: new Date(),
        channels: [{ integrationId: 'ch_x', customized: false, parts: [part('a')] }],
      });

      expect(db.post.create.mock.calls[0][0].data).toMatchObject({
        state: 'QUEUE',
        creationMethod: 'WEB',
        organization: { connect: { id: 'org_1' } },
        integration: { connect: { id: 'ch_x', organizationId: 'org_1', deletedAt: null } },
      });
    });

    it('runs in a serializable transaction', async () => {
      await repository.createGroup({
        orgId: 'o',
        group: 'g',
        state: 'DRAFT',
        publishDate: new Date(),
        channels: [],
      });

      expect(db.$transaction.mock.calls[0][1]).toMatchObject({
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    });
  });

  describe('replaceGroup', () => {
    const loaded = new Date('2026-09-14T10:00:00.000Z');

    function existing(
      rows: Array<{
        id: string;
        integrationId: string;
        parentPostId: string | null;
        state?: State;
        updatedAt?: Date;
      }>,
    ) {
      db.post.findMany.mockResolvedValueOnce(
        rows.map((row) => ({ state: State.DRAFT, updatedAt: loaded, ...row })),
      );
    }

    const write = (
      channels: Parameters<PostsRepository['replaceGroup']>[0]['channels'],
      overrides = {},
    ) => ({
      orgId: 'org_1',
      group: 'g_1',
      state: 'DRAFT' as const,
      publishDate: new Date('2026-10-01T09:00:00Z'),
      expectedUpdatedAt: loaded,
      channels,
      ...overrides,
    });

    it('reuses rows by position, creates what is new, and detaches what is surplus', async () => {
      existing([
        { id: 'x1', integrationId: 'ch_x', parentPostId: null },
        { id: 'x2', integrationId: 'ch_x', parentPostId: 'x1' },
        { id: 'x3', integrationId: 'ch_x', parentPostId: 'x2' },
      ]);

      await expect(
        repository.replaceGroup(
          write([{ integrationId: 'ch_x', customized: false, parts: [part('B'), part('A')] }]),
        ),
      ).resolves.toBe('saved');

      // The root keeps its id — the row Sprint 5's publish workflow is keyed on.
      expect(
        db.post.update.mock.calls.map(([args]) => [
          args.where.id,
          args.data.parentPostId,
          args.data.content,
        ]),
      ).toEqual([
        ['x1', null, '{"label":"B"}'],
        ['x2', 'x1', '{"label":"A"}'],
      ]);
      expect(db.post.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['x3'] }, organizationId: 'org_1' },
        data: { deletedAt: expect.any(Date), parentPostId: null },
      });
      expect(db.post.create).not.toHaveBeenCalled();
    });

    it('extends a thread from its last existing part', async () => {
      existing([{ id: 'x1', integrationId: 'ch_x', parentPostId: null }]);

      await repository.replaceGroup(
        write([{ integrationId: 'ch_x', customized: false, parts: [part('a'), part('b')] }]),
      );

      expect(db.post.create.mock.calls[0][0].data.parentPost).toEqual({ connect: { id: 'x1' } });
    });

    it('soft-deletes every row of a channel the post no longer targets', async () => {
      existing([
        { id: 'x1', integrationId: 'ch_x', parentPostId: null },
        { id: 'l1', integrationId: 'ch_li', parentPostId: null },
        { id: 'l2', integrationId: 'ch_li', parentPostId: 'l1' },
      ]);

      await repository.replaceGroup(
        write([{ integrationId: 'ch_x', customized: false, parts: [part('a')] }]),
      );

      expect(db.post.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['l1', 'l2'] }, organizationId: 'org_1' },
        data: { deletedAt: expect.any(Date), parentPostId: null },
      });
    });

    it('refuses a save made against an older version', async () => {
      existing([
        {
          id: 'x1',
          integrationId: 'ch_x',
          parentPostId: null,
          updatedAt: new Date('2026-09-14T10:05:00.000Z'),
        },
      ]);

      await expect(
        repository.replaceGroup(
          write([{ integrationId: 'ch_x', customized: false, parts: [part('a')] }]),
        ),
      ).resolves.toBe('conflict');
      expect(db.post.update).not.toHaveBeenCalled();
    });

    it('turns a serialization abort into a conflict rather than a 500', async () => {
      db.$transaction.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('could not serialize access', {
          code: 'P2034',
          clientVersion: '5',
        }),
      );

      await expect(repository.replaceGroup(write([]))).resolves.toBe('conflict');
    });

    it('refuses to change a published post', async () => {
      existing([{ id: 'x1', integrationId: 'ch_x', parentPostId: null, state: State.PUBLISHED }]);

      await expect(
        repository.replaceGroup(
          write([{ integrationId: 'ch_x', customized: false, parts: [part('a')] }]),
        ),
      ).resolves.toBe('locked');
    });

    it('reports a group that is not in this workspace as not found', async () => {
      existing([]);

      await expect(repository.replaceGroup(write([]))).resolves.toBe('not_found');
      expect(db.post.findMany.mock.calls[0][0].where).toEqual({
        organizationId: 'org_1',
        group: 'g_1',
        deletedAt: null,
      });
    });
  });

  describe('deleteGroup', () => {
    it('soft-deletes an unpublished group and refuses a published one', async () => {
      db.post.findMany.mockResolvedValueOnce([{ state: State.DRAFT }]);
      await expect(repository.deleteGroup('org_1', 'g_1')).resolves.toBe('deleted');
      expect(db.post.updateMany.mock.calls[0][0]).toEqual({
        where: { organizationId: 'org_1', group: 'g_1', deletedAt: null },
        data: { deletedAt: expect.any(Date) },
      });

      db.post.findMany.mockResolvedValueOnce([{ state: State.PUBLISHED }]);
      await expect(repository.deleteGroup('org_1', 'g_1')).resolves.toBe('locked');
    });
  });
});

describe('orderChain', () => {
  it('orders a thread by its parent links, not by storage order', () => {
    const rows = [
      { id: 'c', parentPostId: 'b' },
      { id: 'a', parentPostId: null },
      { id: 'b', parentPostId: 'a' },
    ];

    expect(orderChain(rows).map((row) => row.id)).toEqual(['a', 'b', 'c']);
  });

  it('keeps every row of a damaged chain rather than dropping any', () => {
    const rows = [
      { id: 'a', parentPostId: 'gone' },
      { id: 'b', parentPostId: 'c' },
      { id: 'c', parentPostId: 'b' },
    ];

    expect(
      orderChain(rows)
        .map((row) => row.id)
        .sort(),
    ).toEqual(['a', 'b', 'c']);
  });
});
