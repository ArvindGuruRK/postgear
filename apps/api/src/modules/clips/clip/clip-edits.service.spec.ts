/**
 * Saving, opening, copying and deleting a clip against an in-memory
 * database: the revision lock, the document's checks (schema, its own
 * video, inside the video, size), NEW to DRAFT, the ratio and length copied
 * from the document, an export kept current by a rename, the copy's name,
 * delete keeping a sharp file another clip still uses, and tenancy.
 */
import { HttpException } from '@nestjs/common';
import type { PrivateStorage } from '@postgear/storage';
import {
  type ClipDocument,
  createClipDocument,
  documentFingerprint,
  parseClipDocument,
} from '@postgear/video-engine';
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
import { jobRow, TEST_ORG, TEST_USER, videoRow } from '../testing/rows';
import { ClipVideosRepository } from '../videos/clip-videos.repository';
import { ClipEditsService, copyTitle, MAX_DOCUMENT_BYTES } from './clip-edits.service';
import { patchClipSchema } from './clip-item.schema';
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
const CLIP = '55555555-5555-4555-8555-555555555555';
const SECOND = '55555555-5555-4555-8555-000000000002';
const OTHER_ORG = 'seed-second-org';

function doc(fromMs = 60_000, toMs = 90_000, videoId = VIDEO): ClipDocument {
  return createClipDocument({ videoId, fromMs, toMs, ratio: '9:16' });
}

function seed(): FakeTables {
  const tables = emptyTables();
  tables.videos.push(videoRow({ status: 'READY' }));
  tables.clips.push(
    clipRow({ id: CLIP, videoId: VIDEO, title: 'Team Talk (1:00)', document: doc() }),
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
  const limits = { assertEnabled: jest.fn(async () => undefined) };
  // `requireClip` is the only thing the edits use from the item service; it reads the fake.
  const items = Object.create(ClipItemService.prototype) as ClipItemService;
  const service = new ClipEditsService(
    items,
    jobs as unknown as ClipJobsService,
    new ClipVideosRepository(),
    limits as unknown as ClipLimitsGuard,
    storage as unknown as PrivateStorage,
  );
  return { service, tables, jobs, storage, limits };
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

describe('ClipEditsService.patch', () => {
  it('saves a document, bumps the revision and copies the ratio and length from it', async () => {
    const { service, tables } = setup();
    const horizontal = createClipDocument({
      videoId: VIDEO,
      fromMs: 60_000,
      toMs: 75_000,
      ratio: '16:9',
    });
    const answer = await service.patch(TEST_ORG, CLIP, { revision: 1, document: horizontal });
    expect(answer.clip).toMatchObject({
      revision: 2,
      ratio: '16:9',
      durationMs: 15_000,
      state: 'draft',
    });
    expect(tables.clips[0]).toMatchObject({ revision: 2, ratio: '16:9', durationMs: 15_000 });
  });

  it('refuses a save from an older revision with 409 and the current revision, writing nothing', async () => {
    const { service, tables } = setup();
    await service.patch(TEST_ORG, CLIP, { revision: 1, title: 'First' });
    const answer = await refusal(service.patch(TEST_ORG, CLIP, { revision: 1, title: 'Second' }));
    expect(answer).toEqual({
      status: 409,
      body: {
        code: 'clip_changed_elsewhere',
        message: 'Someone else changed this clip. Reload to see their version.',
        details: { revision: 2 },
      },
    });
    expect(tables.clips[0]?.title).toBe('First');
  });

  it('refuses a document the engine does not read with our sentence, never the schema text', async () => {
    const { service, tables } = setup();
    const broken = { ...doc(), segments: [] } as unknown as Record<string, unknown>;
    const answer = await refusal(service.patch(TEST_ORG, CLIP, { revision: 1, document: broken }));
    expect(answer).toEqual({
      status: 422,
      body: {
        code: 'clip_document_invalid',
        message: 'This change could not be saved because part of it was not recognised.',
      },
    });
    expect(tables.clips[0]?.revision).toBe(1);
  });

  it("refuses a document that plays another video, or runs past this one's end", async () => {
    const { service } = setup();
    const foreign = await refusal(
      service.patch(TEST_ORG, CLIP, { revision: 1, document: doc(0, 5_000, OTHER_VIDEO) }),
    );
    expect(foreign).toMatchObject({ status: 422, body: { code: 'clip_document_invalid' } });
    const past = await refusal(
      service.patch(TEST_ORG, CLIP, { revision: 1, document: doc(590_000, 620_000) }),
    );
    expect(past).toMatchObject({ status: 422, body: { code: 'clip_document_invalid' } });
  });

  it('refuses a document over the size cap with 413 before reading it', async () => {
    const { service } = setup();
    const huge = { ...doc(), padding: 'x'.repeat(MAX_DOCUMENT_BYTES) };
    expect(
      await refusal(service.patch(TEST_ORG, CLIP, { revision: 1, document: huge })),
    ).toMatchObject({
      status: 413,
      body: { code: 'clip_document_too_large' },
    });
  });

  it('moves a NEW clip to DRAFT on any save, and lets the client hide and unhide', async () => {
    const tables = seed();
    const clip = tables.clips[0];
    if (clip) clip.status = 'NEW';
    const { service } = setup(tables);
    expect(
      (await service.patch(TEST_ORG, CLIP, { revision: 1, title: 'Renamed' })).clip.status,
    ).toBe('DRAFT');
    const hidden = await service.patch(TEST_ORG, CLIP, { revision: 2, status: 'HIDDEN' });
    expect(hidden.clip).toMatchObject({ status: 'HIDDEN', state: 'hidden' });
    const shown = await service.patch(TEST_ORG, CLIP, { revision: 3, status: 'DRAFT' });
    expect(shown.clip).toMatchObject({ status: 'DRAFT', state: 'draft' });
  });

  it('keeps an export current through a rename, but not through a new document', async () => {
    const tables = seed();
    const clip = tables.clips[0];
    if (clip) clip.lastExportedRevision = 1;
    const { service } = setup(tables);
    const renamed = await service.patch(TEST_ORG, CLIP, { revision: 1, title: 'Renamed' });
    expect(renamed.clip).toMatchObject({ revision: 2, state: 'exported', exported: true });
    const edited = await service.patch(TEST_ORG, CLIP, {
      revision: 2,
      document: doc(60_000, 70_000),
    });
    expect(edited.clip).toMatchObject({ revision: 3, state: 'draft', exported: false });
  });

  it('keeps an export current when a save returns the document to what was exported (Module 15)', async () => {
    const tables = seed();
    const exported = doc();
    const clip = tables.clips[0];
    if (clip) {
      clip.document = exported as unknown as typeof clip.document;
      clip.lastExportedRevision = 1;
      clip.lastExportedFingerprint = documentFingerprint(parseClipDocument(exported));
    }
    const { service } = setup(tables);
    const edited = await service.patch(TEST_ORG, CLIP, { revision: 1, document: doc(60_000, 70_000) });
    expect(edited.clip).toMatchObject({ revision: 2, exported: false });
    // The undo: the very document that was exported, saved as revision 3.
    const undone = await service.patch(TEST_ORG, CLIP, { revision: 2, document: exported });
    expect(undone.clip).toMatchObject({ revision: 3, state: 'exported', exported: true });
    expect(tables.clips[0]).toMatchObject({ lastExportedRevision: 3 });
  });

  // Module 20 e2e finding: the editor holds a crop at 0.24687499999999996 and
  // the stored clip reads 0.246875 (one bit apart on the way into the
  // database). Saving the editor's copy back is still the exported clip.
  it('keeps an export current when the saved numbers are one bit off what was exported', async () => {
    const tables = seed();
    // One document (its ids are random), drawn at two crop positions.
    const base = doc();
    const withCropX = (x: number) => {
      return {
        ...base,
        layout: {
          ...base.layout,
          areas: base.layout.areas.map((area) => ({
            ...area,
            crop: area.crop.map((key) => ({ ...key, rect: { ...key.rect, x } })),
          })),
        },
      };
    };
    const stored = withCropX(0.246875);
    const clip = tables.clips[0];
    if (clip) {
      clip.document = stored as unknown as typeof clip.document;
      clip.lastExportedRevision = 1;
      clip.lastExportedFingerprint = documentFingerprint(parseClipDocument(stored));
    }
    const { service } = setup(tables);
    await service.patch(TEST_ORG, CLIP, { revision: 1, document: doc(60_000, 70_000) });
    const undone = await service.patch(TEST_ORG, CLIP, {
      revision: 2,
      document: withCropX(0.24687499999999996),
    });
    expect(undone.clip).toMatchObject({ revision: 3, exported: true });
  });

  it('never carries an export forward for a clip exported before fingerprints', async () => {
    const tables = seed();
    const exported = doc();
    const clip = tables.clips[0];
    if (clip) {
      clip.document = exported as unknown as typeof clip.document;
      clip.lastExportedRevision = 1;
    }
    const { service } = setup(tables);
    await service.patch(TEST_ORG, CLIP, { revision: 1, document: doc(60_000, 70_000) });
    const undone = await service.patch(TEST_ORG, CLIP, { revision: 2, document: exported });
    expect(undone.clip).toMatchObject({ revision: 3, exported: false });
  });

  it("answers 404 for another workspace's clip, even with a broken body", async () => {
    const { service } = setup();
    const answer = await refusal(
      service.patch(OTHER_ORG, CLIP, { revision: 1, document: { nonsense: true } }),
    );
    expect(answer).toMatchObject({ status: 404, body: { code: 'clip_not_found' } });
  });

  it('takes a revision and at least one change, and only DRAFT or HIDDEN', () => {
    expect(patchClipSchema.safeParse({ revision: 1 }).success).toBe(false);
    expect(patchClipSchema.safeParse({ title: 'x' }).success).toBe(false);
    expect(patchClipSchema.safeParse({ revision: 1, status: 'NEW' }).success).toBe(false);
    expect(patchClipSchema.safeParse({ revision: 1, status: 'HIDDEN' }).success).toBe(true);
    expect(patchClipSchema.safeParse({ revision: 1, title: '   ' }).success).toBe(false);
    expect(patchClipSchema.safeParse({ revision: 1, document: [] }).success).toBe(false);
    expect(patchClipSchema.safeParse({ revision: 1, title: 'x', extra: 1 }).success).toBe(false);
    expect(patchClipSchema.parse({ revision: 1, title: ' A\u0000  name ' }).title).toBe('A name');
  });
});

describe('ClipEditsService.open', () => {
  it('moves a NEW clip to DRAFT without a revision bump, and is idempotent', async () => {
    const tables = seed();
    const clip = tables.clips[0];
    if (clip) clip.status = 'NEW';
    const { service } = setup(tables);
    const first = await service.open(TEST_ORG, CLIP);
    expect(first.clip).toMatchObject({ status: 'DRAFT', state: 'draft', revision: 1 });
    const second = await service.open(TEST_ORG, CLIP);
    expect(second.clip).toMatchObject({ status: 'DRAFT', revision: 1 });
  });

  it('leaves a hidden clip hidden, and 404s for another workspace', async () => {
    const tables = seed();
    const clip = tables.clips[0];
    if (clip) clip.status = 'HIDDEN';
    const { service } = setup(tables);
    expect((await service.open(TEST_ORG, CLIP)).clip.status).toBe('HIDDEN');
    expect(await refusal(service.open(OTHER_ORG, CLIP))).toMatchObject({ status: 404 });
  });
});

describe('ClipEditsService.duplicate', () => {
  it('makes a new DRAFT with the same document and " (Copy)" on the name', async () => {
    const tables = seed();
    const clip = tables.clips[0];
    if (clip) Object.assign(clip, { status: 'NEW', revision: 4, lastExportedRevision: 4 });
    const { service } = setup(tables);
    const answer = await service.duplicate(TEST_ORG, TEST_USER, CLIP);
    expect(answer.clip).toMatchObject({
      title: 'Team Talk (1:00) (Copy)',
      status: 'DRAFT',
      state: 'draft',
      revision: 1,
      lastExportedRevision: null,
      videoId: VIDEO,
    });
    expect(answer.clip.id).not.toBe(CLIP);
    expect(answer.clip.document).toEqual(tables.clips[0]?.document);
    expect(tables.clips).toHaveLength(2);
  });

  it('keeps the name inside the title limit', () => {
    const name = copyTitle('x'.repeat(200));
    expect(name).toHaveLength(200);
    expect(name.endsWith(' (Copy)')).toBe(true);
    expect(copyTitle('Team Talk (1:23)')).toBe('Team Talk (1:23) (Copy)');
  });

  it("answers 404 for another workspace's clip, and for a deleted video", async () => {
    const { service } = setup();
    expect(await refusal(service.duplicate(OTHER_ORG, TEST_USER, CLIP))).toMatchObject({
      status: 404,
    });
    const tables = seed();
    const video = tables.videos[0];
    if (video) video.deletedAt = new Date();
    const gone = setup(tables);
    expect(await refusal(gone.service.duplicate(TEST_ORG, TEST_USER, CLIP))).toMatchObject({
      status: 404,
      body: { code: 'video_not_found' },
    });
  });
});

describe('ClipEditsService.remove', () => {
  function withFiles() {
    const tables = seed();
    tables.clips.push(clipRow({ id: SECOND, videoId: VIDEO, document: doc(300_000, 330_000) }));
    tables.assets.push(
      // Covers only this clip: goes.
      assetRow({
        id: 'own',
        clipId: CLIP,
        kind: 'SEGMENT',
        key: 'k/own',
        meta: { fromMs: 30_000, toMs: 120_000, height: 1080, fps: 30 },
      }),
      // Made for this clip, but also covers the second one: stays.
      assetRow({
        id: 'shared',
        clipId: CLIP,
        kind: 'SEGMENT',
        key: 'k/shared',
        meta: { fromMs: 0, toMs: 400_000, height: 1080, fps: 30 },
      }),
      // The video's light copy: never this route's.
      assetRow({ id: 'proxy', kind: 'PROXY', key: 'k/proxy' }),
    );
    tables.jobs.push(
      jobRow({
        id: '44444444-4444-4444-8444-444444444444',
        kind: 'RENDER',
        status: 'RUNNING',
        clipId: CLIP,
      }),
    );
    tables.clipPosts.push({
      id: 'cp',
      organizationId: TEST_ORG,
      clipId: CLIP,
      postGroup: 'g',
      mediaId: 'm',
      createdAt: new Date(),
    });
    return tables;
  }

  it('cancels its jobs, removes the row and its own sharp files, and keeps what others use', async () => {
    const { service, tables, jobs, storage } = setup(withFiles());
    expect(await service.remove(TEST_ORG, CLIP)).toEqual({ message: 'Clip deleted.' });
    expect(jobs.cancel).toHaveBeenCalledWith(TEST_ORG, '44444444-4444-4444-8444-444444444444');
    expect(tables.clips.map((clip) => clip.id)).toEqual([SECOND]);
    expect(tables.assets.map((asset) => asset.id).sort()).toEqual(['proxy', 'shared']);
    expect(storage.delete).toHaveBeenCalledWith('k/own');
    expect(storage.delete).toHaveBeenCalledTimes(1);
    expect(tables.clipPosts).toEqual([]);
  });

  it('still deletes when a job cannot be stopped or a file cannot be removed', async () => {
    const { service, tables, jobs, storage } = setup(withFiles());
    jobs.cancel.mockRejectedValueOnce(new Error('temporal away'));
    storage.delete.mockRejectedValueOnce(new Error('storage away'));
    await expect(service.remove(TEST_ORG, CLIP)).resolves.toEqual({ message: 'Clip deleted.' });
    expect(tables.clips.map((clip) => clip.id)).toEqual([SECOND]);
  });

  it("answers 404 for another workspace's clip and touches nothing", async () => {
    const { service, tables, jobs } = setup(withFiles());
    expect(await refusal(service.remove(OTHER_ORG, CLIP))).toMatchObject({ status: 404 });
    expect(tables.clips).toHaveLength(2);
    expect(jobs.cancel).not.toHaveBeenCalled();
  });
});
