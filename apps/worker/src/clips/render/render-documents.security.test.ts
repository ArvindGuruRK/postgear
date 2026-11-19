/**
 * Security sweep, Module 20: "Documents", the export side. The worker reads
 * the job's copy of the document again with the strict schema, and every
 * file it names is looked up inside the job's own workspace: another
 * workspace's video stops the export before anything is downloaded, and its
 * stickers and sounds read as missing.
 *
 * Existing tests this builds on: render.run.test.ts:295 (an upload sticker
 * from another workspace stops with `sticker_missing`) and
 * sounds/files.test.ts:108 (a sound from another workspace is left out, so
 * the plan stops with `sound_missing`). The schema half is in
 * packages/video-engine/src/document/document.security.test.ts, and the save
 * refusing another video in apps/api clip-edits.service.spec.ts:146.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { createClipDocument, type RenderInput } from '@postgear/video-engine';

interface RecordedQuery {
  model: string;
  op: string;
  args: unknown;
}
const mockQueries: RecordedQuery[] = [];

jest.mock('@postgear/db', () => {
  const actual = jest.requireActual('@postgear/db');
  const table = (model: string) =>
    new Proxy(
      {},
      {
        get: (_t, op: string) => async (args: unknown) => {
          mockQueries.push({ model, op, args });
          return op === 'findMany' ? [] : null;
        },
      },
    );
  return { ...actual, prisma: new Proxy({}, { get: (_t, model: string) => table(model) }) };
});

import { ClipStepError } from '../failures';
import { openJob } from '../job-outcomes';
import { prismaClipRows } from '../rows';
import { prismaSoundFileRows } from '../sounds/rows';
import { prismaStickerFileRows } from '../stickers/rows';
import {
  CLIP_ID,
  FakePrivateStorage,
  FakeRows,
  fakeProgress,
  JOB_ID,
  jobRow,
  ORG,
  sampleFacts,
  VIDEO_ID,
  videoRow,
} from '../testing/fakes';
import { type RenderRun, renderPrepare } from './render.run';

const OTHER_ORG = 'seed-second-org';
const THEIR_VIDEO = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
const THEIR_KEY = `clips/${OTHER_ORG}/${THEIR_VIDEO}/proxy-0123456789abcdef0123456789abcdef.mp4`;

function input(videoId: string): RenderInput {
  return {
    clipId: CLIP_ID,
    videoId: VIDEO_ID,
    revision: 1,
    document: createClipDocument({ videoId, fromMs: 0, toMs: 10_000, ratio: '9:16' }),
    quality: '720p',
    proof: false,
    watermark: false,
    name: 'Best Moment',
  };
}

describe('Clips security: Documents (export side)', () => {
  let dir: string;

  beforeEach(async () => {
    mockQueries.length = 0;
    dir = await mkdtemp(path.join(tmpdir(), 'render-sweep-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("stops before downloading anything when the document plays another workspace's video", async () => {
    const storage = new FakePrivateStorage();
    storage.objects.set(THEIR_KEY, Buffer.from('their video'));
    const getToFile = jest.spyOn(storage, 'getToFile');
    const rows = new FakeRows();
    rows.videos.set(
      THEIR_VIDEO,
      videoRow({ id: THEIR_VIDEO, organizationId: OTHER_ORG, status: 'READY' }),
    );
    rows.assets.push({
      id: 'their-proxy',
      kind: 'PROXY',
      key: THEIR_KEY,
      bytes: 11,
      videoId: THEIR_VIDEO,
      clipId: null,
      meta: {},
      createdAt: new Date('2026-11-18T10:00:00Z'),
    });
    const probe = jest.fn(async () => sampleFacts());
    const run = {
      job: jobRow({ kind: 'RENDER', clipId: CLIP_ID }),
      input: input(THEIR_VIDEO),
      dir,
      signal: new AbortController().signal,
      tools: { probe, render: jest.fn(), poster: jest.fn() },
      privateStorage: storage,
      storage: { put: jest.fn(), delete: jest.fn(), read: jest.fn(async () => null) },
      internal: {},
      rows,
      stickerRows: {
        librarySticker: jest.fn(async () => null),
        stickerAsset: jest.fn(async () => null),
      },
      progress: { ...fakeProgress().progress, done: async () => true },
      fonts: null,
      heartbeat: () => undefined,
    } as unknown as RenderRun;

    const failure = await renderPrepare(run).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(ClipStepError);
    expect((failure as ClipStepError).code).toBe('export_failed');
    expect(getToFile).not.toHaveBeenCalled();
    expect(probe).not.toHaveBeenCalled();
  });

  it("refuses to open another workspace's job, and a stored input the schema does not read", async () => {
    const rows = new FakeRows();
    const clean = input(VIDEO_ID);
    rows.jobs.set(JOB_ID, jobRow({ kind: 'RENDER', clipId: CLIP_ID, input: clean as never }));
    await expect(
      openJob(rows, { organizationId: ORG, jobId: JOB_ID }, 'RENDER'),
    ).resolves.toBeTruthy();
    await expect(
      openJob(rows, { organizationId: OTHER_ORG, jobId: JOB_ID }, 'RENDER'),
    ).rejects.toBeInstanceOf(ClipStepError);

    const quiet = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      rows.jobs.set(
        JOB_ID,
        jobRow({
          kind: 'RENDER',
          clipId: CLIP_ID,
          input: { ...clean, document: { ...clean.document, key: THEIR_KEY } } as never,
        }),
      );
      await expect(
        openJob(rows, { organizationId: ORG, jobId: JOB_ID }, 'RENDER'),
      ).rejects.toBeInstanceOf(ClipStepError);
      // The log names where the input broke, never what it held.
      const logged = quiet.mock.calls.flat().join('\n');
      expect(logged).toContain('clips.job.bad_input');
      expect(logged).not.toContain(THEIR_KEY);
    } finally {
      quiet.mockRestore();
    }
  });

  it("looks up every video, light copy, sharp range, sticker and sound inside the job's workspace", async () => {
    await prismaClipRows.video(ORG, VIDEO_ID);
    await prismaClipRows.videoAssets(ORG, VIDEO_ID);
    await prismaClipRows.segmentAssets(ORG, CLIP_ID);
    await prismaStickerFileRows.stickerAsset(ORG, THEIR_VIDEO);
    await prismaSoundFileRows.soundAsset(ORG, THEIR_VIDEO);
    await prismaStickerFileRows.librarySticker(THEIR_VIDEO);
    await prismaSoundFileRows.librarySound(THEIR_VIDEO);

    const scoped = mockQueries.filter(
      (query) => !['clipSticker', 'clipSound'].includes(query.model),
    );
    expect(scoped.map((query) => query.model)).toEqual([
      'clipVideo',
      'clipAsset',
      'clipAsset',
      'clipAsset',
      'clipAsset',
    ]);
    for (const query of scoped) {
      expect((query.args as { where: { organizationId?: string } }).where.organizationId).toBe(ORG);
    }
    // The shared library is read by id, and only what is live (a removed item reads as missing).
    for (const query of mockQueries.filter((q) => ['clipSticker', 'clipSound'].includes(q.model))) {
      expect((query.args as { where: unknown }).where).toEqual({
        id: THEIR_VIDEO,
        status: { in: ['ACTIVE', 'HIDDEN'] },
      });
    }
  });
});
