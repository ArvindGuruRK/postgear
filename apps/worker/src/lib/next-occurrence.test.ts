/**
 * Repeating posts: the derived next group, the next date, the plan for one
 * channel, and the copy written to the database with `prisma` mocked. The
 * properties that matter are about idempotency: every channel of a post
 * lands in one next post, a retry creates nothing twice, and a deleted
 * upcoming occurrence is never brought back.
 */
jest.mock('@postgear/db', () => {
  const actual = jest.requireActual('@postgear/db');

  return {
    ...actual,
    prisma: {
      post: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn() },
      tagsPosts: { findMany: jest.fn(), createMany: jest.fn() },
      $transaction: jest.fn(),
    },
  };
});

import { Prisma, prisma, State } from '@postgear/db';
import {
  POST_PUBLISH_WORKFLOW,
  publishWorkflowId,
  SCHEDULING_TASK_QUEUE,
} from '@postgear/scheduling';
import { WorkflowExecutionAlreadyStartedError } from '@temporalio/client';
import {
  isRepeatInterval,
  type NextGroupRow,
  nextOccurrenceDate,
  nextOccurrenceGroup,
  planNextOccurrence,
  queueNextOccurrence,
  uuidV5,
} from './next-occurrence';

const DAY = 24 * 60 * 60 * 1_000;
const GROUP = '0b8f3f3e-8a1f-4c55-9a55-2f1f5d1c9e11';
const NOW = new Date('2026-10-19T12:00:00.000Z');

describe('uuidV5', () => {
  it('matches the RFC 4122 test vector', () => {
    // www.example.com in the DNS namespace.
    expect(uuidV5('www.example.com', '6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe(
      '2ed6657d-e927-568b-95e1-2665a8aea6a2',
    );
  });
});

describe('nextOccurrenceGroup', () => {
  it('derives the same UUID from the same group, and a different one per group', () => {
    const next = nextOccurrenceGroup(GROUP);

    expect(next).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(nextOccurrenceGroup(GROUP)).toBe(next);
    expect(nextOccurrenceGroup(next)).not.toBe(next);
  });
});

describe('nextOccurrenceDate', () => {
  it('adds the interval when that is still ahead', () => {
    const previous = new Date('2026-10-19T09:00:00.000Z');
    expect(nextOccurrenceDate(previous, 7, NOW)).toEqual(new Date('2026-10-26T09:00:00.000Z'));
  });

  it('steps over occurrences already in the past, keeping the time of day', () => {
    const previous = new Date('2026-10-01T09:00:00.000Z');
    // +2 days is the 3rd, long past; the first step after noon on the 19th is the 21st.
    expect(nextOccurrenceDate(previous, 2, NOW)).toEqual(new Date('2026-10-21T09:00:00.000Z'));
  });

  it('never lands exactly on now', () => {
    const previous = new Date(NOW.getTime() - DAY);
    expect(nextOccurrenceDate(previous, 1, NOW)).toEqual(new Date(NOW.getTime() + DAY));
  });
});

describe('isRepeatInterval', () => {
  it('accepts whole days within a year and nothing else', () => {
    expect([1, 7, 30, 365].every(isRepeatInterval)).toBe(true);
    expect([0, -1, 1.5, 366, null, undefined].some((value) => isRepeatInterval(value))).toBe(false);
  });
});

describe('planNextOccurrence', () => {
  const row = (overrides: Partial<NextGroupRow>): NextGroupRow => ({
    id: 'n1',
    integrationId: 'ch_x',
    parentPostId: null,
    deletedAt: null,
    state: State.QUEUE,
    publishDate: new Date(NOW.getTime() + 6 * DAY),
    intervalInDays: 7,
    ...overrides,
  });
  const base = {
    integrationId: 'ch_x',
    previousPublishDate: new Date('2026-10-19T09:00:00.000Z'),
    intervalInDays: 7,
    now: NOW,
  };

  it('creates the first channel’s occurrence one interval on', () => {
    expect(planNextOccurrence({ ...base, existing: [] })).toEqual({
      action: 'create',
      publishDate: new Date('2026-10-26T09:00:00.000Z'),
      intervalInDays: 7,
      state: State.QUEUE,
    });
  });

  it('finds this channel’s occurrence when an earlier run made it', () => {
    expect(planNextOccurrence({ ...base, existing: [row({ id: 'mine' })] })).toEqual({
      action: 'exists',
      rootId: 'mine',
      state: State.QUEUE,
    });
  });

  it('ends the chain when this channel’s occurrence was deleted, or the whole post was', () => {
    expect(planNextOccurrence({ ...base, existing: [row({ deletedAt: NOW })] })).toEqual({
      action: 'ended',
    });
    expect(
      planNextOccurrence({ ...base, existing: [row({ integrationId: 'ch_li', deletedAt: NOW })] }),
    ).toEqual({ action: 'ended' });
  });

  it('joins another channel’s occurrence, respecting what the person changed on it', () => {
    const moved = new Date(NOW.getTime() + 3 * DAY);

    expect(
      planNextOccurrence({
        ...base,
        existing: [
          row({
            integrationId: 'ch_li',
            publishDate: moved,
            intervalInDays: null,
            state: State.DRAFT,
          }),
        ],
      }),
    ).toEqual({ action: 'create', publishDate: moved, intervalInDays: null, state: State.DRAFT });
  });

  it('does not join a time already past, such as an occurrence that already published', () => {
    expect(
      planNextOccurrence({
        ...base,
        existing: [
          row({
            integrationId: 'ch_li',
            publishDate: new Date(NOW.getTime() - DAY),
            state: State.PUBLISHED,
          }),
        ],
      }),
    ).toMatchObject({
      action: 'create',
      publishDate: new Date('2026-10-26T09:00:00.000Z'),
      state: State.QUEUE,
    });
  });
});

type PrismaMock = {
  post: Record<'findFirst' | 'findMany' | 'create', jest.Mock>;
  tagsPosts: Record<'findMany' | 'createMany', jest.Mock>;
  $transaction: jest.Mock;
};

const db = prisma as unknown as PrismaMock;

describe('queueNextOccurrence', () => {
  const input = { postId: 'root_1', organizationId: 'org_1' };
  let start: jest.Mock;
  let log: jest.Mock;
  let nextId: number;

  const deps = () => ({
    temporalClient: async () => ({ workflow: { start } }) as never,
    log,
    now: () => NOW,
  });

  function published(overrides: Record<string, unknown> = {}) {
    db.post.findFirst.mockResolvedValueOnce({
      id: 'root_1',
      group: GROUP,
      integrationId: 'ch_x',
      parentPostId: null,
      state: State.PUBLISHED,
      publishDate: new Date('2026-10-19T09:00:00.000Z'),
      intervalInDays: 7,
      creationMethod: 'WEB',
      integration: { deletedAt: null },
      ...overrides,
    });
  }

  const chainRow = (id: string, parentPostId: string | null, label: string) => ({
    id,
    parentPostId,
    content: `{"label":"${label}"}`,
    image: '[{"id":"m1"}]',
    settings: '{"customized":true,"replySettings":"following"}',
    delay: 0,
    title: null,
    description: null,
  });

  beforeEach(() => {
    start = jest.fn().mockResolvedValue({});
    log = jest.fn();
    nextId = 0;
    db.$transaction.mockImplementation(async (work: (tx: unknown) => Promise<unknown>) => work(db));
    db.post.create.mockImplementation(async () => ({ id: `next_${++nextId}` }));
    db.tagsPosts.findMany.mockResolvedValue([{ tagId: 'tag_b' }, { tagId: 'tag_a' }]);
  });

  it('copies the chain into the next group, queued an interval later, and starts its workflow', async () => {
    published();
    db.post.findMany
      // The chain, stored out of order: the walk follows the parent links.
      .mockResolvedValueOnce([chainRow('part_2', 'root_1', 'two'), chainRow('root_1', null, 'one')])
      // Nothing in the next group yet.
      .mockResolvedValueOnce([]);

    const result = await queueNextOccurrence(input, deps());
    const group = nextOccurrenceGroup(GROUP);

    expect(result).toEqual({ status: 'created', postId: 'next_1', group, scheduled: true });

    const writes = db.post.create.mock.calls.map(([args]) => args.data);
    expect(writes.map((data) => data.content)).toEqual(['{"label":"one"}', '{"label":"two"}']);
    expect(writes[0]).toMatchObject({
      group,
      state: State.QUEUE,
      publishDate: new Date('2026-10-26T09:00:00.000Z'),
      intervalInDays: 7,
      image: '[{"id":"m1"}]',
      settings: '{"customized":true,"replySettings":"following"}',
      creationMethod: 'WEB',
      organization: { connect: { id: 'org_1' } },
      integration: { connect: { id: 'ch_x', organizationId: 'org_1', deletedAt: null } },
    });
    expect(writes[0].parentPost).toBeUndefined();
    expect(writes[1].parentPost).toEqual({ connect: { id: 'next_1' } });

    expect(
      db.tagsPosts.createMany.mock.calls[0][0].data.map(
        (link: { postId: string; tagId: string }) => [link.postId, link.tagId],
      ),
    ).toEqual([
      ['next_1', 'tag_b'],
      ['next_1', 'tag_a'],
    ]);
    // Only the workspace's live tags are carried over.
    expect(db.tagsPosts.findMany.mock.calls[0][0].where).toEqual({
      postId: 'root_1',
      tag: { orgId: 'org_1', deletedAt: null },
    });

    expect(db.$transaction.mock.calls[0][1]).toEqual({
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    expect(start).toHaveBeenCalledWith(POST_PUBLISH_WORKFLOW, {
      workflowId: publishWorkflowId('next_1'),
      taskQueue: SCHEDULING_TASK_QUEUE,
      args: [{ postId: 'next_1', organizationId: 'org_1' }],
    });
  });

  it('creates nothing on a retry, and treats an already running workflow as scheduled', async () => {
    published();
    db.post.findMany
      .mockResolvedValueOnce([chainRow('root_1', null, 'one')])
      .mockResolvedValueOnce([
        {
          id: 'next_root',
          integrationId: 'ch_x',
          parentPostId: null,
          deletedAt: null,
          state: State.QUEUE,
          publishDate: new Date('2026-10-26T09:00:00.000Z'),
          intervalInDays: 7,
        },
      ]);
    start.mockRejectedValueOnce(new WorkflowExecutionAlreadyStartedError('started', 'wf', 'type'));

    await expect(queueNextOccurrence(input, deps())).resolves.toEqual({
      status: 'exists',
      postId: 'next_root',
      group: nextOccurrenceGroup(GROUP),
      scheduled: true,
    });
    expect(db.post.create).not.toHaveBeenCalled();
    expect(db.tagsPosts.createMany).not.toHaveBeenCalled();
  });

  it('ends the chain when the person deleted the upcoming occurrence', async () => {
    published();
    db.post.findMany
      .mockResolvedValueOnce([chainRow('root_1', null, 'one')])
      .mockResolvedValueOnce([
        {
          id: 'next_root',
          integrationId: 'ch_x',
          parentPostId: null,
          deletedAt: NOW,
          state: State.QUEUE,
          publishDate: new Date('2026-10-26T09:00:00.000Z'),
          intervalInDays: 7,
        },
      ]);

    await expect(queueNextOccurrence(input, deps())).resolves.toEqual({ status: 'ended' });
    expect(db.post.create).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });

  it.each([
    ['a post that does not repeat', { intervalInDays: null }],
    ['a post that has not published', { state: State.ERROR }],
    ['a part rather than a root', { parentPostId: 'root_0' }],
    ['a channel that was disconnected', { integration: { deletedAt: NOW } }],
  ])('does nothing for %s', async (_label, overrides) => {
    published(overrides);

    await expect(queueNextOccurrence(input, deps())).resolves.toEqual({ status: 'none' });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('does nothing for a root of another workspace or a deleted one', async () => {
    db.post.findFirst.mockResolvedValueOnce(null);

    await expect(queueNextOccurrence(input, deps())).resolves.toEqual({ status: 'none' });
    expect(db.post.findFirst.mock.calls[0][0].where).toEqual({
      id: 'root_1',
      organizationId: 'org_1',
      deletedAt: null,
    });
  });

  it('keeps a paused occurrence paused: a late channel joins it as a draft, with no workflow', async () => {
    published();
    db.post.findMany
      .mockResolvedValueOnce([chainRow('root_1', null, 'one')])
      .mockResolvedValueOnce([
        {
          id: 'li_root',
          integrationId: 'ch_li',
          parentPostId: null,
          deletedAt: null,
          state: State.DRAFT,
          publishDate: new Date('2026-10-27T10:00:00.000Z'),
          intervalInDays: 7,
        },
      ]);

    await expect(queueNextOccurrence(input, deps())).resolves.toMatchObject({
      status: 'created',
      scheduled: false,
    });
    expect(db.post.create.mock.calls[0][0].data).toMatchObject({
      state: State.DRAFT,
      publishDate: new Date('2026-10-27T10:00:00.000Z'),
    });
    expect(start).not.toHaveBeenCalled();
  });

  it('logs, rather than fails, when the workflow cannot be started', async () => {
    published();
    db.post.findMany
      .mockResolvedValueOnce([chainRow('root_1', null, 'one')])
      .mockResolvedValueOnce([]);
    start.mockRejectedValueOnce(new Error('temporal away'));

    await expect(queueNextOccurrence(input, deps())).resolves.toMatchObject({
      status: 'created',
      scheduled: false,
    });
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('reconcile'),
      expect.objectContaining({ postId: 'next_1', error: 'temporal away' }),
    );
  });
});
