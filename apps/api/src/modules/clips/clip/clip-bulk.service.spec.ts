/**
 * Many clips at once (Sprint 13, Module 11) against an in-memory database:
 * Hide and Unhide (all or nothing, the revision and a current export, a clip
 * already in that status left alone), Delete (all or nothing, jobs, sharp
 * files kept while a staying clip or a montage still uses them, a clip's own
 * transcript handed on or removed), and the 50 cap.
 */
import { HttpException } from '@nestjs/common';
import type { PrivateStorage } from '@postgear/storage';
import {
  type ClipDocument,
  createCaptionsTrack,
  createClipDocument,
  createMontage,
  withCaptionsTrack,
} from '@postgear/video-engine';
import { ClipCaptionsService } from '../captions/clip-captions.service';
import type { ClipJobsService } from '../jobs/clip-jobs.service';
import type { ClipLimitsGuard } from '../limits/clip-limits.guard';
import {
  assetRow,
  clipRow,
  emptyTables,
  type FakeClipDb,
  type FakeTables,
  fakeClipDb,
} from '../testing/fake-clip-db';
import { jobRow, TEST_ORG, videoRow } from '../testing/rows';
import { ClipVideosRepository } from '../videos/clip-videos.repository';
import { ClipBulkService } from './clip-bulk.service';
import { ClipEditsService } from './clip-edits.service';
import { BULK_MAX_CLIPS, bulkDeleteClipsSchema, bulkPatchClipsSchema } from './clip-item.schema';
import { ClipItemService } from './clip-item.service';

let mockDb: FakeClipDb;
jest.mock('@postgear/db', () => {
  const actual = jest.requireActual('@postgear/db');
  return {
    ...actual,
    prisma: new Proxy(
      {},
      { get: (_target, key) => (mockDb as Record<string | symbol, unknown>)[key] },
    ),
  };
});

const VIDEO = videoRow().id;
const OTHER_VIDEO = '99999999-9999-4999-8999-999999999999';
const A = '55555555-5555-4555-8555-00000000000a';
const B = '55555555-5555-4555-8555-00000000000b';
const C = '55555555-5555-4555-8555-00000000000c';
const MONTAGE = '55555555-5555-4555-8555-0000000000ff';
const TRANSCRIPT = '70000000-0000-4000-8000-000000000001';
const OTHER_ORG = 'seed-second-org';

function doc(fromMs: number, toMs: number, videoId = VIDEO): ClipDocument {
  return createClipDocument({ videoId, fromMs, toMs, ratio: '9:16' });
}

function seed(): FakeTables {
  const tables = emptyTables();
  tables.videos.push(
    videoRow({ status: 'READY' }),
    videoRow({ id: OTHER_VIDEO, status: 'READY', externalId: '900000002' }),
  );
  tables.clips.push(
    clipRow({ id: A, title: 'A', document: doc(60_000, 90_000) }),
    clipRow({
      id: B,
      title: 'B',
      status: 'NEW',
      document: doc(300_000, 330_000),
      revision: 3,
      lastExportedRevision: 3,
    }),
    clipRow({ id: C, title: 'C', status: 'HIDDEN', document: doc(400_000, 430_000) }),
  );
  return tables;
}

function setup(tables = seed()) {
  mockDb = fakeClipDb(tables);
  const jobs = {
    cancel: jest.fn(async (_org: string, jobId: string) => {
      const job = tables.jobs.find((row) => row.id === jobId);
      if (job) job.status = 'CANCELLED';
      return { id: jobId };
    }),
  };
  const storage = { delete: jest.fn(async () => undefined) };
  const edits = new ClipEditsService(
    Object.create(ClipItemService.prototype) as ClipItemService,
    jobs as unknown as ClipJobsService,
    new ClipVideosRepository(),
    { assertEnabled: jest.fn() } as unknown as ClipLimitsGuard,
    storage as unknown as PrivateStorage,
    // Only `releaseClip` is used, and it reads the fake database alone.
    Object.create(ClipCaptionsService.prototype) as ClipCaptionsService,
  );
  return { service: new ClipBulkService(edits), edits, tables, jobs, storage };
}

async function refusal(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpException) {
      return { status: error.getStatus(), body: error.getResponse() as Record<string, unknown> };
    }
    throw error;
  }
  throw new Error('expected a refusal');
}

const byId = (tables: FakeTables, id: string) => tables.clips.find((clip) => clip.id === id);

describe('ClipBulkService.patch', () => {
  it('hides every clip asked, as the single PATCH would, and counts the ones that changed', async () => {
    const { service, tables } = setup();
    expect(await service.patch(TEST_ORG, { clipIds: [A, B, C], status: 'HIDDEN' })).toEqual({
      updated: 2,
    });
    expect(tables.clips.map((clip) => [clip.id, clip.status, clip.revision])).toEqual([
      [A, 'HIDDEN', 2],
      [B, 'HIDDEN', 4],
      // Already hidden: left as it was, so an editor open on it never sees a conflict.
      [C, 'HIDDEN', 1],
    ]);
    // A hide is not the picture: the export that drew B stays current.
    expect(byId(tables, B)?.lastExportedRevision).toBe(4);
  });

  it('unhides back to a draft', async () => {
    const { service, tables } = setup();
    expect(await service.patch(TEST_ORG, { clipIds: [C], status: 'DRAFT' })).toEqual({
      updated: 1,
    });
    expect(byId(tables, C)).toMatchObject({ status: 'DRAFT', revision: 2 });
  });

  it("refuses the lot with 404 when one id is another workspace's or unknown, changing nothing", async () => {
    const tables = seed();
    tables.clips.push(clipRow({ id: MONTAGE, organizationId: OTHER_ORG, document: doc(0, 5_000) }));
    const { service } = setup(tables);
    for (const stranger of [MONTAGE, '55555555-5555-4555-8555-000000000999']) {
      expect(
        await refusal(service.patch(TEST_ORG, { clipIds: [A, stranger], status: 'HIDDEN' })),
      ).toMatchObject({ status: 404, body: { code: 'clip_not_found' } });
    }
    expect(tables.clips.map((clip) => [clip.status, clip.revision])).toEqual([
      ['DRAFT', 1],
      ['NEW', 3],
      ['HIDDEN', 1],
      ['DRAFT', 1],
    ]);
  });
});

describe('ClipBulkService.remove', () => {
  it('deletes every clip asked with its jobs and own sharp files, and answers the count', async () => {
    const tables = seed();
    tables.assets.push(
      assetRow({
        id: 'seg-a',
        clipId: A,
        kind: 'SEGMENT',
        key: 'k/a',
        meta: { fromMs: 50_000, toMs: 100_000, height: 1080, fps: 30 },
      }),
      assetRow({
        id: 'seg-b',
        clipId: B,
        kind: 'SEGMENT',
        key: 'k/b',
        meta: { fromMs: 290_000, toMs: 340_000, height: 1080, fps: 30 },
      }),
      // B's file also covers C, which stays: kept.
      assetRow({
        id: 'seg-wide',
        clipId: B,
        kind: 'SEGMENT',
        key: 'k/wide',
        meta: { fromMs: 290_000, toMs: 440_000, height: 1080, fps: 30 },
      }),
    );
    tables.jobs.push(
      jobRow({ id: '44444444-4444-4444-8444-00000000000a', kind: 'RENDER', clipId: A }),
      jobRow({
        id: '44444444-4444-4444-8444-00000000000b',
        kind: 'SEGMENT',
        status: 'RUNNING',
        clipId: B,
      }),
    );
    const { service, jobs, storage } = setup(tables);

    expect(await service.remove(TEST_ORG, { clipIds: [A, B] })).toEqual({ deleted: 2 });
    expect(tables.clips.map((clip) => clip.id)).toEqual([C]);
    expect(tables.assets.map((asset) => asset.id)).toEqual(['seg-wide']);
    expect(storage.delete.mock.calls.map((call) => (call as unknown[])[0]).sort()).toEqual([
      'k/a',
      'k/b',
    ]);
    expect(jobs.cancel).toHaveBeenCalledTimes(2);
  });

  it('does not hand a transcript to a clip deleted in the same request', async () => {
    const tables = seed();
    tables.assets.push(
      assetRow({ id: TRANSCRIPT, clipId: A, kind: 'TRANSCRIPT', key: 'k/transcript' }),
    );
    const showing = withCaptionsTrack(
      doc(300_000, 330_000),
      createCaptionsTrack({
        transcriptAssetId: TRANSCRIPT,
        language: 'en',
        styleId: 'bold-pop',
        look: { sizePx: 86, maxWords: 3 },
      }),
    );
    (byId(tables, B) as { document: unknown }).document = showing;
    const { service, storage } = setup(tables);

    await service.remove(TEST_ORG, { clipIds: [A, B] });
    expect(tables.assets).toEqual([]);
    expect(storage.delete).toHaveBeenCalledWith('k/transcript');
  });

  it("refuses the lot with 404 when one id is another workspace's, deleting nothing", async () => {
    const tables = seed();
    tables.clips.push(clipRow({ id: MONTAGE, organizationId: OTHER_ORG, document: doc(0, 5_000) }));
    tables.jobs.push(jobRow({ id: '44444444-4444-4444-8444-00000000000a', clipId: A }));
    const { service, jobs } = setup(tables);
    expect(await refusal(service.remove(TEST_ORG, { clipIds: [A, MONTAGE] }))).toMatchObject({
      status: 404,
      body: { code: 'clip_not_found' },
    });
    expect(tables.clips).toHaveLength(4);
    expect(jobs.cancel).not.toHaveBeenCalled();
  });
});

// Module 11: a montage relies on the sharp files and transcripts its clips hold.
describe('deleting a clip a montage was made from', () => {
  function withMontage() {
    const tables = seed();
    const captioned = withCaptionsTrack(
      doc(60_000, 90_000),
      createCaptionsTrack({
        transcriptAssetId: TRANSCRIPT,
        language: 'en',
        styleId: 'bold-pop',
        look: { sizePx: 86, maxWords: 3 },
      }),
    );
    (byId(tables, A) as { document: unknown }).document = captioned;
    const made = createMontage(
      [
        {
          id: '55555555-5555-4555-8555-000000000001',
          title: 'Other',
          document: doc(0, 20_000, OTHER_VIDEO),
        },
        { id: A, title: 'A', document: captioned },
      ],
      { transition: 'cut' },
    );
    if (!made.ok) throw new Error(made.code);
    tables.clips.push(
      clipRow({
        id: MONTAGE,
        videoId: OTHER_VIDEO,
        origin: 'MONTAGE',
        meta: { videoIds: [VIDEO] },
        document: made.document,
      }),
    );
    tables.assets.push(
      assetRow({
        id: 'seg-a',
        clipId: A,
        kind: 'SEGMENT',
        key: 'k/a',
        meta: { fromMs: 50_000, toMs: 100_000, height: 1080, fps: 30 },
      }),
      assetRow({ id: TRANSCRIPT, clipId: A, kind: 'TRANSCRIPT', key: 'k/transcript' }),
    );
    return tables;
  }

  it('keeps its sharp file and hands its own transcript to the montage', async () => {
    const tables = withMontage();
    const { edits, storage } = setup(tables);
    await edits.remove(TEST_ORG, A);
    expect(byId(tables, A)).toBeUndefined();
    expect(tables.assets.map((asset) => [asset.id, asset.clipId])).toEqual([
      ['seg-a', A],
      [TRANSCRIPT, MONTAGE],
    ]);
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('lets both go when the montage is deleted with it', async () => {
    const tables = withMontage();
    const { service } = setup(tables);
    expect(await service.remove(TEST_ORG, { clipIds: [A, MONTAGE] })).toEqual({ deleted: 2 });
    expect(tables.assets).toEqual([]);
  });
});

describe('the bulk bodies', () => {
  const ids = (n: number) =>
    Array.from({ length: n }, (_, i) => `55555555-5555-4555-8555-${String(i).padStart(12, '0')}`);

  it('take 1 to 50 distinct clip ids, and only DRAFT or HIDDEN', () => {
    expect(BULK_MAX_CLIPS).toBe(50);
    expect(bulkDeleteClipsSchema.safeParse({ clipIds: ids(50) }).success).toBe(true);
    expect(bulkDeleteClipsSchema.safeParse({ clipIds: ids(51) }).success).toBe(false);
    expect(bulkDeleteClipsSchema.safeParse({ clipIds: [] }).success).toBe(false);
    expect(bulkDeleteClipsSchema.safeParse({ clipIds: [A, A] }).success).toBe(false);
    expect(bulkDeleteClipsSchema.safeParse({ clipIds: ['layouts'] }).success).toBe(false);
    expect(bulkDeleteClipsSchema.safeParse({ clipIds: [A], status: 'HIDDEN' }).success).toBe(false);
    expect(bulkPatchClipsSchema.safeParse({ clipIds: [A], status: 'HIDDEN' }).success).toBe(true);
    expect(bulkPatchClipsSchema.safeParse({ clipIds: [A], status: 'NEW' }).success).toBe(false);
    expect(bulkPatchClipsSchema.safeParse({ clipIds: [A] }).success).toBe(false);
    expect(bulkPatchClipsSchema.safeParse({ clipIds: ids(51), status: 'DRAFT' }).success).toBe(
      false,
    );
  });
});
