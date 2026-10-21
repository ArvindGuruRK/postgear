/**
 * What search asks the database: live rows of the workspace only, a superset
 * by one term (content in both its plain and its JSON-escaped form, or a live
 * tag's name), newest edit first with a stable tie-break, paged by group.
 */
jest.mock('@postgear/db', () => {
  const actual = jest.requireActual('@postgear/db');

  return {
    ...actual,
    prisma: { post: { findMany: jest.fn(), groupBy: jest.fn() } },
  };
});

import { prisma } from '@postgear/db';
import { PostsRepository } from './posts.repository';

type PrismaMock = { post: Record<'findMany' | 'groupBy', jest.Mock> };

const db = prisma as unknown as PrismaMock;

describe('PostsRepository search', () => {
  let repository: PostsRepository;

  beforeEach(() => {
    repository = new PostsRepository();
    db.post.groupBy.mockReset();
    db.post.findMany.mockReset();
  });

  it('returns the group ids in the order the database gave them', async () => {
    db.post.groupBy.mockResolvedValue([{ group: 'g2' }, { group: 'g1' }]);

    await expect(
      repository.searchGroups({ orgId: 'org_1', term: 'launch', take: 40, skip: 0 }),
    ).resolves.toEqual(['g2', 'g1']);
  });

  it('is scoped to the workspace, skips deleted rows and matches content or a live tag name', async () => {
    db.post.groupBy.mockResolvedValue([]);

    await repository.searchGroups({ orgId: 'org_1', term: 'launch', take: 40, skip: 0 });

    const call = db.post.groupBy.mock.calls[0][0];

    expect(call.by).toEqual(['group']);
    expect(call.where.organizationId).toBe('org_1');
    expect(call.where.deletedAt).toBeNull();
    expect(call.where.OR).toEqual([
      { content: { contains: 'launch', mode: 'insensitive' } },
      {
        tags: {
          some: {
            tag: {
              orgId: 'org_1',
              deletedAt: null,
              name: { contains: 'launch', mode: 'insensitive' },
            },
          },
        },
      },
    ]);
  });

  it('also searches the JSON-escaped form of a term that has a quote', async () => {
    db.post.groupBy.mockResolvedValue([]);

    await repository.searchGroups({ orgId: 'org_1', term: 'say "hi"', take: 40, skip: 0 });

    const contents = db.post.groupBy.mock.calls[0][0].where.OR.filter(
      (clause: Record<string, unknown>) => 'content' in clause,
    );

    expect(
      contents.map((clause: { content: { contains: string } }) => clause.content.contains),
    ).toEqual(['say "hi"', 'say \\"hi\\"']);
  });

  it('orders by latest edit with the group id as tie-break, and pages', async () => {
    db.post.groupBy.mockResolvedValue([]);

    await repository.searchGroups({ orgId: 'org_1', term: 'launch', take: 40, skip: 80 });

    expect(db.post.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ _max: { updatedAt: 'desc' } }, { group: 'asc' }],
        skip: 80,
        take: 40,
      }),
    );
  });

  it('loads the rows of the given groups, scoped and live only', async () => {
    db.post.findMany.mockResolvedValue([]);

    await repository.findGroups('org_1', ['g1', 'g2']);

    expect(db.post.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: 'org_1', deletedAt: null, group: { in: ['g1', 'g2'] } },
      }),
    );
  });

  it('does not query for no groups', async () => {
    await expect(repository.findGroups('org_1', [])).resolves.toEqual([]);
    expect(db.post.findMany).not.toHaveBeenCalled();
  });
});
