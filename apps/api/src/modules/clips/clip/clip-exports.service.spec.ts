/**
 * Module 15's routes against an in-memory database: an export (the plan's
 * quality lock, the revision, one at a time, the fingerprint and the plan
 * values it freezes), the history, Preview Export (low priority, no lock,
 * one at a time) and its signed address, the card ring's progress, and
 * tenancy on every route.
 */
import { HttpException } from '@nestjs/common';
import type { ClipJob } from '@postgear/db';
import type { PrivateStorage, StorageBackend } from '@postgear/storage';
import {
  createClipDocument,
  documentFingerprint,
  qualityLockedSentence,
} from '@postgear/video-engine';
import type { EntitlementResolver } from '../../entitlements/entitlement-resolver';
import type { ClipJobsRepository, NewClipJob } from '../jobs/clip-jobs.repository';
import type { ClipJobsService } from '../jobs/clip-jobs.service';
import type { ClipLimitsGuard } from '../limits/clip-limits.guard';
import {
  clipRow,
  emptyTables,
  type FakeClipDb,
  type FakeMedia,
  type FakeTables,
  fakeClipDb,
} from '../testing/fake-clip-db';
import { jobRow, TEST_ORG, TEST_USER, videoRow } from '../testing/rows';
import { ClipVideosRepository } from '../videos/clip-videos.repository';
import { exportClipSchema, previewClipSchema } from './clip-item.schema';
import {
  ClipExportsService,
  EXPORT_HISTORY_SIZE,
  PREVIEW_KEEP_MS,
  PREVIEW_URL_SECONDS,
} from './clip-exports.service';
import { exportProgressOf } from './export-progress';

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
const CLIP = '55555555-5555-4555-8555-555555555555';
const OTHER_CLIP = '56565656-5656-4565-8565-565656565656';
const OTHER_ORG = 'seed-second-org';
const DOCUMENT = createClipDocument({
  videoId: VIDEO,
  fromMs: 60_000,
  toMs: 90_000,
  ratio: '9:16',
});
const MEDIA_ID = '0d9c8b7a-6f5e-4d3c-8b2a-190817263544';
const NOW = new Date('2026-11-19T12:00:00.000Z');

function seed(): FakeTables {
  const tables = emptyTables();
  tables.videos.push(videoRow({ status: 'READY' }));
  tables.clips.push(clipRow({ id: CLIP, videoId: VIDEO, document: DOCUMENT, revision: 4 }));
  return tables;
}

let jobCount = 0;
function renderJob(overrides: Partial<ClipJob> & { proof?: boolean; quality?: string }): ClipJob {
  jobCount += 1;
  const { proof = false, quality = '1080p', ...rest } = overrides;
  return jobRow({
    id: `99999999-9999-4999-8999-${String(jobCount).padStart(12, '0')}`,
    kind: 'RENDER',
    clipId: CLIP,
    input: {
      clipId: CLIP,
      videoId: VIDEO,
      revision: 4,
      document: DOCUMENT,
      quality,
      proof,
      watermark: false,
      name: 'A clip.mp4',
      fingerprint: 'v1-old',
    } as unknown as ClipJob['input'],
    ...rest,
  });
}

interface Plan {
  'clips.export_max_quality': string;
  'clips.export_watermark': boolean;
  'clips.queue_priority': string;
}

function setup(
  tables = seed(),
  plan: Plan = {
    'clips.export_max_quality': '1080p',
    'clips.export_watermark': true,
    'clips.queue_priority': 'high',
  },
) {
  mockDb = fakeClipDb(tables);
  const jobs = {
    newJobId: jest.fn(() => {
      jobCount += 1;
      return `88888888-8888-4888-8888-${String(jobCount).padStart(12, '0')}`;
    }),
    build: jest.fn(
      async (params: {
        id: string;
        orgId: string;
        kind: string;
        videoId: string;
        clipId: string;
        input: unknown;
        priority?: string;
      }) => ({
        id: params.id,
        organizationId: params.orgId,
        kind: params.kind,
        priority: params.priority ?? 'normal',
        input: params.input,
        videoId: params.videoId,
        clipId: params.clipId,
        highlightRunId: null,
        createdById: TEST_USER,
        expiresAt: null,
      }),
    ),
    start: jest.fn(async () => true),
  };
  const jobsRepository = {
    create: jest.fn(async (job: NewClipJob) => {
      const row = jobRow({
        ...(job as unknown as Partial<ClipJob>),
        status: 'QUEUED',
        createdAt: NOW,
      });
      tables.jobs.push(row);
      return row;
    }),
    find: jest.fn(
      async (_org: string, jobId: string) => tables.jobs.find((job) => job.id === jobId) ?? null,
    ),
  };
  const limits = { assertEnabled: jest.fn(async () => undefined) };
  const resolver = {
    get: jest.fn(async (_org: string, key: keyof Plan) => plan[key]),
    getMany: jest.fn(async (_org: string, keys: readonly (keyof Plan)[]) =>
      Object.fromEntries(keys.map((key) => [key, plan[key]])),
    ),
  };
  const storage = { publicUrl: jest.fn((key: string) => `https://cdn.example/${key}`) };
  const privateStorage = {
    signedUrl: jest.fn(async (key: string) => `https://signed.example/${key}`),
  };
  const service = new ClipExportsService(
    jobs as unknown as ClipJobsService,
    jobsRepository as unknown as ClipJobsRepository,
    new ClipVideosRepository(),
    limits as unknown as ClipLimitsGuard,
    resolver as unknown as EntitlementResolver,
    storage as unknown as StorageBackend,
    privateStorage as unknown as PrivateStorage,
  );
  return { service, tables, jobs, jobsRepository, resolver, privateStorage };
}

async function refusal(
  promise: Promise<unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(HttpException);
  const http = error as HttpException;
  return { status: http.getStatus(), body: http.getResponse() as Record<string, unknown> };
}

function newestJob(tables: FakeTables): ClipJob {
  return tables.jobs[tables.jobs.length - 1] as ClipJob;
}

describe('ClipExportsService.start (POST /clips/:clipId/exports)', () => {
  it('freezes the document, its fingerprint and the plan values into a RENDER job', async () => {
    const { service, tables, jobs, resolver } = setup();
    const answer = await service.start(TEST_ORG, TEST_USER, CLIP, {
      quality: '1080p',
      revision: 4,
    });
    expect(answer.job).toMatchObject({ kind: 'RENDER', status: 'QUEUED', clipId: CLIP });
    expect(resolver.getMany).toHaveBeenCalledWith(TEST_ORG, [
      'clips.export_max_quality',
      'clips.export_watermark',
      'clips.queue_priority',
    ]);
    const job = newestJob(tables);
    expect(job.priority).toBe('high');
    expect(job.input).toMatchObject({
      clipId: CLIP,
      revision: 4,
      quality: '1080p',
      proof: false,
      watermark: true,
      name: 'A clip.mp4',
      fingerprint: documentFingerprint(DOCUMENT),
    });
    expect(jobs.start).toHaveBeenCalledTimes(1);
  });

  it('refuses a quality above the plan with the plan sentence, and starts nothing', async () => {
    const { service, tables, jobs } = setup(seed(), {
      'clips.export_max_quality': '720p',
      'clips.export_watermark': true,
      'clips.queue_priority': 'normal',
    });
    const { status, body } = await refusal(
      service.start(TEST_ORG, TEST_USER, CLIP, { quality: '1080p60' }),
    );
    expect(status).toBe(402);
    expect(body).toMatchObject({
      code: 'clips_quality_requires_plan',
      message: qualityLockedSentence('1080p60'),
    });
    expect(tables.jobs).toHaveLength(0);
    expect(jobs.start).not.toHaveBeenCalled();
  });

  it('answers 409 clip_changed_elsewhere when the clip moved on, with the revision it is at', async () => {
    const { service, tables } = setup();
    const { status, body } = await refusal(
      service.start(TEST_ORG, TEST_USER, CLIP, { quality: '720p', revision: 3 }),
    );
    expect(status).toBe(409);
    expect(body).toMatchObject({ code: 'clip_changed_elsewhere', details: { revision: 4 } });
    expect(tables.jobs).toHaveLength(0);
  });

  it('allows one export at a time, and a running preview does not count', async () => {
    const tables = seed();
    tables.jobs.push(renderJob({ status: 'RUNNING', proof: true }));
    const { service } = setup(tables);
    await service.start(TEST_ORG, TEST_USER, CLIP, { quality: '720p' });
    const { status, body } = await refusal(
      service.start(TEST_ORG, TEST_USER, CLIP, { quality: '720p' }),
    );
    expect(status).toBe(409);
    expect(body).toMatchObject({ code: 'export_running' });
  });

  it('answers 409 video_not_ready while the video is still coming in', async () => {
    const tables = seed();
    (tables.videos[0] as { status: string }).status = 'IMPORTING';
    const { service } = setup(tables);
    const { status, body } = await refusal(
      service.start(TEST_ORG, TEST_USER, CLIP, { quality: '720p' }),
    );
    expect(status).toBe(409);
    expect(body).toMatchObject({ code: 'video_not_ready' });
  });

  it("answers 404 for another workspace's clip before looking at the plan", async () => {
    const { service, resolver } = setup(seed(), {
      'clips.export_max_quality': '720p',
      'clips.export_watermark': true,
      'clips.queue_priority': 'normal',
    });
    expect(
      (await refusal(service.start(OTHER_ORG, TEST_USER, CLIP, { quality: '1080p60' }))).status,
    ).toBe(404);
    expect(
      (await refusal(service.start(TEST_ORG, TEST_USER, 'status', { quality: '720p' }))).status,
    ).toBe(404);
    expect(resolver.getMany).not.toHaveBeenCalled();
  });

  it('takes { quality, revision? } only', () => {
    expect(exportClipSchema.safeParse({ quality: '720p' }).success).toBe(true);
    expect(exportClipSchema.safeParse({ quality: '720p', revision: 2 }).success).toBe(true);
    expect(exportClipSchema.safeParse({ quality: '720p', watermark: false }).success).toBe(false);
    expect(exportClipSchema.safeParse({ quality: '4k' }).success).toBe(false);
  });
});

describe('ClipExportsService.history (GET /clips/:clipId/exports)', () => {
  function media(overrides: Partial<FakeMedia> = {}): FakeMedia {
    return {
      id: MEDIA_ID,
      organizationId: TEST_ORG,
      name: 'A clip.mp4',
      path: 'media/seed-demo-org/2026/11/export.mp4',
      thumbnail: 'media/seed-demo-org/2026/11/export.jpg',
      fileSize: 4_200_000,
      width: 1080,
      height: 1920,
      durationMs: 30_000,
      deletedAt: null,
      ...overrides,
    };
  }

  it('lists the last five exports newest first, any status, never a preview', async () => {
    const tables = seed();
    for (let index = 0; index < 6; index += 1) {
      tables.jobs.push(
        renderJob({
          status: index === 5 ? 'FAILED' : 'DONE',
          createdAt: new Date(Date.UTC(2026, 10, 19, 10, index)),
        }),
      );
    }
    tables.jobs.push(
      renderJob({ status: 'DONE', proof: true, createdAt: new Date(Date.UTC(2026, 10, 19, 11)) }),
    );
    tables.jobs.push(
      renderJob({
        status: 'RUNNING',
        clipId: OTHER_CLIP,
        createdAt: new Date(Date.UTC(2026, 10, 19, 11)),
      }),
    );
    const { service } = setup(tables);
    const { exports } = await service.history(TEST_ORG, CLIP);
    expect(exports).toHaveLength(EXPORT_HISTORY_SIZE);
    expect(exports.map((entry) => entry.job.createdAt)).toEqual(
      [5, 4, 3, 2, 1].map((minute) => new Date(Date.UTC(2026, 10, 19, 10, minute)).toISOString()),
    );
    expect(exports[0]?.job.status).toBe('FAILED');
    expect(
      exports.every((entry) => entry.quality === '1080p' && entry.fingerprint === 'v1-old'),
    ).toBe(true);
  });

  it('gives a done export its Media file by public address, and the sound it ended with', async () => {
    const tables = seed();
    tables.media = [media()];
    const loudness = { inputLufs: -20, inputTp: -9, finalLufs: -14, mode: 'linear' as const };
    tables.jobs.push(
      renderJob({
        status: 'DONE',
        quality: '1080p',
        output: { mediaId: MEDIA_ID, proofKey: null, durationMs: 30_000, loudness },
      }),
    );
    const { service } = setup(tables);
    const [entry] = (await service.history(TEST_ORG, CLIP)).exports;
    expect(entry).toMatchObject({
      quality: '1080p',
      fingerprint: 'v1-old',
      loudness,
      media: {
        id: MEDIA_ID,
        url: 'https://cdn.example/media/seed-demo-org/2026/11/export.mp4',
        posterUrl: 'https://cdn.example/media/seed-demo-org/2026/11/export.jpg',
        name: 'A clip.mp4',
        bytes: 4_200_000,
        width: 1080,
        height: 1920,
        durationMs: 30_000,
      },
    });
    // Never a storage key in the job's view.
    expect(JSON.stringify(entry?.job)).not.toContain('media/seed-demo-org');
  });

  it('shows no file for a deleted Media row, another workspace, or a job still running', async () => {
    const tables = seed();
    tables.media = [
      media({ deletedAt: NOW }),
      media({ id: 'b'.repeat(8), organizationId: OTHER_ORG }),
    ];
    tables.jobs.push(
      renderJob({
        status: 'DONE',
        output: { mediaId: MEDIA_ID, proofKey: null, durationMs: 30_000 },
      }),
    );
    tables.jobs.push(renderJob({ status: 'RUNNING', progress: 40 }));
    const { service } = setup(tables);
    const { exports } = await service.history(TEST_ORG, CLIP);
    expect(exports.map((entry) => entry.media)).toEqual([null, null]);
    expect(exports.map((entry) => entry.loudness)).toEqual([null, null]);
  });

  it("answers 404 for another workspace's clip", async () => {
    const { service } = setup();
    expect((await refusal(service.history(OTHER_ORG, CLIP))).status).toBe(404);
  });
});

describe('ClipExportsService.startPreview (POST /clips/:clipId/previews)', () => {
  it('starts a low priority proof with the mark, whatever the plan allows, at no charge', async () => {
    const { service, tables, jobs, resolver } = setup(seed(), {
      'clips.export_max_quality': '720p',
      'clips.export_watermark': true,
      'clips.queue_priority': 'high',
    });
    const answer = await service.startPreview(TEST_ORG, TEST_USER, CLIP, { revision: 4 });
    expect(answer.job).toMatchObject({ kind: 'RENDER', status: 'QUEUED' });
    const job = newestJob(tables);
    expect(job.priority).toBe('low');
    expect(job.input).toMatchObject({
      proof: true,
      quality: '720p',
      watermark: true,
      revision: 4,
      fingerprint: documentFingerprint(DOCUMENT),
    });
    expect(resolver.getMany).not.toHaveBeenCalled();
    expect(jobs.start).toHaveBeenCalledTimes(1);
  });

  it('answers the preview already queued or running instead of starting another', async () => {
    const tables = seed();
    const open = renderJob({ status: 'RUNNING', proof: true, progress: 30 });
    tables.jobs.push(open);
    const { service, jobs } = setup(tables);
    const answer = await service.startPreview(TEST_ORG, TEST_USER, CLIP, {});
    expect(answer.job.id).toBe(open.id);
    expect(tables.jobs).toHaveLength(1);
    expect(jobs.start).not.toHaveBeenCalled();
  });

  it('is not blocked by a running export', async () => {
    const tables = seed();
    tables.jobs.push(renderJob({ status: 'RUNNING' }));
    const { service } = setup(tables);
    await service.startPreview(TEST_ORG, TEST_USER, CLIP, {});
    expect(
      tables.jobs.filter((job) => (job.input as { proof?: boolean }).proof === true),
    ).toHaveLength(1);
  });

  it('answers 409 clip_changed_elsewhere and 404 for another workspace', async () => {
    const { service } = setup();
    expect(
      (await refusal(service.startPreview(TEST_ORG, TEST_USER, CLIP, { revision: 9 }))).body,
    ).toMatchObject({
      code: 'clip_changed_elsewhere',
      details: { revision: 4 },
    });
    expect((await refusal(service.startPreview(OTHER_ORG, TEST_USER, CLIP, {}))).status).toBe(404);
  });

  it('takes { revision? } only, and an empty body', () => {
    expect(previewClipSchema.parse(undefined)).toEqual({});
    expect(previewClipSchema.safeParse({ revision: 3 }).success).toBe(true);
    expect(previewClipSchema.safeParse({ quality: '1080p' }).success).toBe(false);
  });
});

describe('ClipExportsService.latestPreview (GET /clips/:clipId/previews/latest)', () => {
  const PROOF_KEY = `clips/${TEST_ORG}/proofs/x/proof.mp4`;

  it('answers null when the clip has no preview', async () => {
    const tables = seed();
    tables.jobs.push(renderJob({ status: 'DONE' }));
    const { service } = setup(tables);
    expect(await service.latestPreview(TEST_ORG, CLIP, NOW)).toEqual({ preview: null });
  });

  it('signs the newest done preview for an hour while its file is kept', async () => {
    const tables = seed();
    const finishedAt = new Date(NOW.getTime() - 60 * 60 * 1000);
    tables.jobs.push(
      renderJob({
        status: 'DONE',
        proof: true,
        finishedAt,
        output: { mediaId: null, proofKey: PROOF_KEY, durationMs: 30_000 },
      }),
    );
    const { service, privateStorage } = setup(tables);
    const { preview } = await service.latestPreview(TEST_ORG, CLIP, NOW);
    expect(preview).toMatchObject({
      fingerprint: 'v1-old',
      url: `https://signed.example/${PROOF_KEY}`,
      expiresAt: new Date(finishedAt.getTime() + PREVIEW_KEEP_MS).toISOString(),
    });
    expect(privateStorage.signedUrl).toHaveBeenCalledWith(PROOF_KEY, {
      expiresInSeconds: PREVIEW_URL_SECONDS,
    });
    expect(JSON.stringify(preview?.job)).not.toContain('proofs/');
  });

  it('gives no address to a preview past its 24 hours, or one still running', async () => {
    const tables = seed();
    tables.jobs.push(
      renderJob({
        status: 'DONE',
        proof: true,
        createdAt: new Date('2026-11-17T10:00:00Z'),
        finishedAt: new Date('2026-11-17T10:01:00Z'),
        output: { mediaId: null, proofKey: PROOF_KEY, durationMs: 30_000 },
      }),
    );
    const { service, privateStorage } = setup(tables);
    expect((await service.latestPreview(TEST_ORG, CLIP, NOW)).preview).toMatchObject({ url: null });

    tables.jobs.push(renderJob({ status: 'RUNNING', proof: true, createdAt: NOW, progress: 50 }));
    const { preview } = await service.latestPreview(TEST_ORG, CLIP, NOW);
    expect(preview).toMatchObject({ url: null, expiresAt: null, job: { status: 'RUNNING' } });
    expect(privateStorage.signedUrl).not.toHaveBeenCalled();
  });

  it("answers 404 for another workspace's clip", async () => {
    const { service } = setup();
    expect((await refusal(service.latestPreview(OTHER_ORG, CLIP, NOW))).status).toBe(404);
  });
});

describe('exportProgressOf (the card ring)', () => {
  it("reads each clip's newest open export, never a preview or a finished one", async () => {
    const tables = seed();
    tables.jobs.push(
      renderJob({ status: 'RUNNING', progress: 20.4, createdAt: new Date('2026-11-19T10:00:00Z') }),
    );
    tables.jobs.push(
      renderJob({ status: 'QUEUED', progress: 0, createdAt: new Date('2026-11-19T11:00:00Z') }),
    );
    tables.jobs.push(
      renderJob({ status: 'RUNNING', progress: 70, proof: true, clipId: OTHER_CLIP }),
    );
    tables.jobs.push(renderJob({ status: 'DONE', progress: 100, clipId: OTHER_CLIP }));
    tables.jobs.push(renderJob({ status: 'RUNNING', progress: 55, organizationId: OTHER_ORG }));
    setup(tables);
    const progress = await exportProgressOf(TEST_ORG, [CLIP, OTHER_CLIP]);
    expect([...progress.entries()]).toEqual([[CLIP, 0]]);
    expect((await exportProgressOf(TEST_ORG, [])).size).toBe(0);
  });
});
