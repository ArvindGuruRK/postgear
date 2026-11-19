/**
 * The Media posters backfill (Module 19): which rows a pass picks (twenty at
 * most, newest first, never a checked, deleted or finished one, never an
 * image) and how it starts their workflows (on the media queue, one id per
 * row, a running one counted rather than failed, Temporal down never
 * throwing). The database is the in-memory `prisma.media`.
 */
import {
  MEDIA_TASK_QUEUE,
  MEDIA_VIDEO_FACTS_BATCH,
  MEDIA_VIDEO_FACTS_WORKFLOW,
  mediaVideoFactsWorkflowId,
} from '@postgear/scheduling';
import { type Client, WorkflowExecutionAlreadyStartedError } from '@temporalio/client';
import { FakeMediaDb, mediaRow } from '../clips/testing/media-fakes';
import { createMediaFactsBackfillActivities } from './media-facts.activities';

function fakeClient(start: jest.Mock = jest.fn().mockResolvedValue({})) {
  return { client: { workflow: { start } } as unknown as Client, start };
}

/** `count` unchecked videos with no poster, the newest last, ids `v-00`, `v-01`, ... */
function videos(count: number) {
  return Array.from({ length: count }, (_, index) =>
    mediaRow({
      id: `v-${String(index).padStart(2, '0')}`,
      organizationId: index % 2 === 0 ? 'org-a' : 'org-b',
      createdAt: new Date(Date.UTC(2026, 9, 1, 0, index)),
    }),
  );
}

function backfill(db: FakeMediaDb, client: Client | Error, log = jest.fn()) {
  const activities = createMediaFactsBackfillActivities(
    {
      temporalClient: () =>
        client instanceof Error ? Promise.reject(client) : Promise.resolve(client),
    },
    { db: db.asDb(), log },
  );
  return { run: () => activities.mediaVideoFactsBackfill(), log };
}

describe('mediaVideoFactsBackfill', () => {
  it('starts at most twenty a pass, newest first, on the media queue', async () => {
    const db = new FakeMediaDb(videos(25));
    const { client, start } = fakeClient();

    const report = await backfill(db, client).run();

    expect(report).toEqual({ picked: MEDIA_VIDEO_FACTS_BATCH, started: 20, running: 0, failed: 0 });
    expect(start).toHaveBeenCalledTimes(20);
    expect(start.mock.calls[0]).toEqual([
      MEDIA_VIDEO_FACTS_WORKFLOW,
      expect.objectContaining({
        workflowId: mediaVideoFactsWorkflowId('v-24'),
        taskQueue: MEDIA_TASK_QUEUE,
        args: [{ mediaId: 'v-24', organizationId: 'org-a' }],
      }),
    ]);
    const started = start.mock.calls.map(([, options]) => options.args[0].mediaId);
    expect(started).not.toContain('v-04');
    expect(started).toContain('v-05');
    expect(db.queries[0]?.take).toBe(MEDIA_VIDEO_FACTS_BATCH);
  });

  it('skips checked, deleted and finished videos, and images', async () => {
    const db = new FakeMediaDb([
      mediaRow({ id: 'no-poster' }),
      mediaRow({ id: 'no-length', thumbnail: '2026/11/a.thumb.webp' }),
      mediaRow({ id: 'no-picture-but-length', durationMs: 12_000 }),
      mediaRow({ id: 'checked', factsCheckedAt: new Date('2026-11-18T00:00:00Z') }),
      mediaRow({ id: 'deleted', deletedAt: new Date('2026-11-18T00:00:00Z') }),
      mediaRow({ id: 'finished', thumbnail: '2026/11/b.thumb.webp', durationMs: 9_000 }),
      mediaRow({ id: 'image', type: 'image' }),
    ]);
    const { client, start } = fakeClient();

    const report = await backfill(db, client).run();

    const started = start.mock.calls.map(([, options]) => options.args[0].mediaId).sort();
    expect(started).toEqual(['no-length', 'no-picture-but-length', 'no-poster']);
    expect(report).toEqual({ picked: 3, started: 3, running: 0, failed: 0 });
  });

  it('moves on as rows are checked, until none are left', async () => {
    const db = new FakeMediaDb(videos(25));
    const { client, start } = fakeClient();
    const { run } = backfill(db, client);

    await run();
    // Each run ends by checking its row, readable or not.
    for (const [, options] of start.mock.calls) {
      const row = db.row(options.args[0].mediaId);
      if (row) row.factsCheckedAt = new Date('2026-11-19T00:00:00Z');
    }
    start.mockClear();

    await expect(run()).resolves.toMatchObject({ picked: 5, started: 5 });
    for (const row of db.rows) row.factsCheckedAt = new Date('2026-11-19T00:00:00Z');
    start.mockClear();
    await expect(run()).resolves.toEqual({ picked: 0, started: 0, running: 0, failed: 0 });
    expect(start).not.toHaveBeenCalled();
  });

  it('counts a row whose run is still going, and keeps going past a failed start', async () => {
    const db = new FakeMediaDb(videos(3));
    const start = jest
      .fn()
      .mockRejectedValueOnce(
        new WorkflowExecutionAlreadyStartedError('running', 'media-video-facts:v-02', 'run'),
      )
      .mockRejectedValueOnce(new Error('deadline exceeded'))
      .mockResolvedValueOnce({});
    const { client } = fakeClient(start);
    const { run, log } = backfill(db, client);

    await expect(run()).resolves.toEqual({ picked: 3, started: 1, running: 1, failed: 1 });
    expect(log).toHaveBeenCalledTimes(1);
  });

  it('never throws when Temporal cannot be reached', async () => {
    const db = new FakeMediaDb(videos(2));
    const { run, log } = backfill(db, new Error('connection refused'));

    await expect(run()).resolves.toEqual({ picked: 2, started: 0, running: 0, failed: 2 });
    expect(log).toHaveBeenCalledTimes(1);
  });

  it('does not connect to Temporal when there is nothing to do', async () => {
    const temporalClient = jest.fn();
    const activities = createMediaFactsBackfillActivities(
      { temporalClient },
      { db: new FakeMediaDb([]).asDb() },
    );

    await expect(activities.mediaVideoFactsBackfill()).resolves.toMatchObject({ picked: 0 });
    expect(temporalClient).not.toHaveBeenCalled();
  });
});
