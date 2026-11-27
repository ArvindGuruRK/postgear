/**
 * Export All (Sprint 13, Module 11) against an in-memory database: the
 * notes (a locked quality lowered, a current clip skipped, a running export
 * left alone), the batch id and the plan values frozen into every job,
 * all-or-nothing tenancy, the list with its counts (a failure never stops
 * the rest), the list rebuilt without Redis, and the open batches.
 */
import { HttpException } from '@nestjs/common';
import type { ClipJob } from '@postgear/db';
import {
  CLIP_JOB_INPUT_SCHEMAS,
  createClipDocument,
  documentFingerprint,
  qualityLockedSentence,
  safeParseClipDocument,
} from '@postgear/video-engine';
import type { EntitlementResolver } from '../../entitlements/entitlement-resolver';
import type { RedisService } from '../../redis/redis.service';
import type { ClipJobsRepository, NewClipJob } from '../jobs/clip-jobs.repository';
import type { ClipJobsService } from '../jobs/clip-jobs.service';
import type { ClipLimitsGuard } from '../limits/clip-limits.guard';
import type { ClipRetentionService } from '../retention/clip-retention.service';
import {
  clipRow,
  emptyTables,
  type FakeClipDb,
  type FakeTables,
  fakeClipDb,
} from '../testing/fake-clip-db';
import { jobRow, TEST_ORG, TEST_USER, videoRow } from '../testing/rows';
import { ClipVideosRepository } from '../videos/clip-videos.repository';
import { batchExportSchema } from './clip-batch-exports.schema';
import { batchQuality, ClipBatchExportsService, manifestKey } from './clip-batch-exports.service';

type Db = FakeClipDb & { $queryRaw: jest.Mock };

let mockDb: Db;
jest.mock('@postgear/db', () => {
  const actual = jest.requireActual('@postgear/db');
  return {
    ...actual,
    prisma: new Proxy(
      {},
      { get: (_target, key) => (mockDb as unknown as Record<string | symbol, unknown>)[key] },
    ),
  };
});

const VIDEO = videoRow().id;
const FRESH = '55555555-5555-4555-8555-555555555551';
const CURRENT = '55555555-5555-4555-8555-555555555552';
const RUNNING = '55555555-5555-4555-8555-555555555553';
const FOREIGN = '55555555-5555-4555-8555-555555555554';
const REMOVED = '55555555-5555-4555-8555-555555555555';
const OTHER_ORG = 'seed-second-org';
const RUNNING_JOB = '77777777-7777-4777-8777-777777777771';
const DONE_JOB = '77777777-7777-4777-8777-777777777772';
const DOCUMENT = createClipDocument({
  videoId: VIDEO,
  fromMs: 60_000,
  toMs: 90_000,
  ratio: '9:16',
});
const PARSED = safeParseClipDocument(DOCUMENT);
const FINGERPRINT = documentFingerprint(PARSED.ok ? PARSED.doc : (DOCUMENT as never));
const NOW = new Date('2026-11-27T12:00:00.000Z');

function seed(): FakeTables {
  const tables = emptyTables();
  tables.videos.push(videoRow({ status: 'READY' }));
  for (const [id, title] of [
    [FRESH, 'Fresh clip'],
    [CURRENT, 'Current clip'],
    [RUNNING, 'Running clip'],
  ] as const) {
    tables.clips.push(clipRow({ id, title, videoId: VIDEO, document: DOCUMENT, revision: 2 }));
  }
  tables.clips.push(
    clipRow({ id: FOREIGN, organizationId: OTHER_ORG, videoId: VIDEO, document: DOCUMENT }),
    clipRow({ id: REMOVED, videoId: VIDEO, document: DOCUMENT, removedAt: NOW }),
  );
  tables.jobs.push(
    jobRow({
      id: DONE_JOB,
      kind: 'RENDER',
      status: 'DONE',
      clipId: CURRENT,
      finishedAt: NOW,
      input: { proof: false, quality: '720p', fingerprint: FINGERPRINT } as never,
    }),
    jobRow({
      id: RUNNING_JOB,
      kind: 'RENDER',
      status: 'RUNNING',
      clipId: RUNNING,
      input: { proof: false, quality: '1080p', fingerprint: 'v1-older' } as never,
    }),
  );
  return tables;
}

/** The fake database, with a rollback of the job rows when a transaction throws. */
function database(tables: FakeTables): Db {
  const db = fakeClipDb(tables) as Db;
  db.$queryRaw = jest.fn(async () => []);
  db.$transaction = jest.fn(async (work: unknown) => {
    const before = [...tables.jobs];
    try {
      return await (work as (tx: unknown) => Promise<unknown>)(db);
    } catch (error) {
      tables.jobs.splice(0, tables.jobs.length, ...before);
      throw error;
    }
  }) as unknown as Db['$transaction'];
  return db;
}

interface Plan {
  'clips.export_max_quality': string | null;
  'clips.export_watermark': boolean;
  'clips.queue_priority': string;
}

let ids = 0;
function setup(
  tables = seed(),
  plan: Plan = {
    'clips.export_max_quality': '1080p',
    'clips.export_watermark': true,
    'clips.queue_priority': 'high',
  },
) {
  mockDb = database(tables);
  const jobs = {
    newJobId: jest.fn(() => {
      ids += 1;
      return `88888888-8888-4888-8888-${String(ids).padStart(12, '0')}`;
    }),
    // The real schema check, so the batch id is proven to be part of a RENDER input.
    build: jest.fn(
      async (params: {
        id: string;
        orgId: string;
        kind: 'RENDER';
        videoId: string;
        clipId: string;
        input: unknown;
        priority?: string;
      }) => ({
        id: params.id,
        organizationId: params.orgId,
        kind: params.kind,
        priority: params.priority ?? 'normal',
        input: CLIP_JOB_INPUT_SCHEMAS.RENDER.parse(params.input),
        videoId: params.videoId,
        clipId: params.clipId,
        highlightRunId: null,
        createdById: TEST_USER,
        expiresAt: null,
      }),
    ),
    startRendersQuietly: jest.fn(async () => []),
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
  };
  const limits = { assertEnabled: jest.fn(async () => undefined) };
  const resolver = {
    getMany: jest.fn(async (_org: string, keys: readonly (keyof Plan)[]) =>
      Object.fromEntries(keys.map((key) => [key, plan[key]])),
    ),
  };
  const retention = { touchVideo: jest.fn(async () => false) };
  const store = new Map<string, string>();
  const redis = {
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    set: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
  };
  const service = new ClipBatchExportsService(
    jobs as unknown as ClipJobsService,
    jobsRepository as unknown as ClipJobsRepository,
    new ClipVideosRepository(),
    limits as unknown as ClipLimitsGuard,
    resolver as unknown as EntitlementResolver,
    retention as unknown as ClipRetentionService,
    redis as unknown as RedisService,
  );
  return { service, tables, jobs, retention, store, redis };
}

async function refusal(promise: Promise<unknown>) {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(HttpException);
  const http = error as HttpException;
  return { status: http.getStatus(), body: http.getResponse() as Record<string, unknown> };
}

function batchJobs(tables: FakeTables, batchId: string): ClipJob[] {
  return tables.jobs.filter((job) => (job.input as { batchId?: string }).batchId === batchId);
}

describe('ClipBatchExportsService.start (POST /clips/exports)', () => {
  it('exports a fresh clip, skips a current one and leaves a running one alone', async () => {
    const { service, tables, jobs, retention } = setup();
    const answer = await service.start(TEST_ORG, TEST_USER, {
      clipIds: [FRESH, CURRENT, RUNNING],
      quality: '720p',
    });

    const made = batchJobs(tables, answer.batchId);
    expect(made).toHaveLength(1);
    expect(answer.jobs).toEqual([
      { clipId: FRESH, jobId: made[0]?.id, quality: '720p', note: 'queued' },
      { clipId: CURRENT, jobId: null, quality: '720p', note: 'current' },
      { clipId: RUNNING, jobId: RUNNING_JOB, quality: '1080p', note: 'running' },
    ]);
    // The same freezing as the single export, plus the batch id.
    expect(made[0]).toMatchObject({
      kind: 'RENDER',
      status: 'QUEUED',
      clipId: FRESH,
      priority: 'high',
      input: expect.objectContaining({
        clipId: FRESH,
        revision: 2,
        quality: '720p',
        proof: false,
        watermark: true,
        name: 'Fresh clip.mp4',
        fingerprint: FINGERPRINT,
        batchId: answer.batchId,
      }),
    });
    expect(jobs.startRendersQuietly).toHaveBeenCalledTimes(1);
    expect(retention.touchVideo).toHaveBeenCalledTimes(1);
  });

  it('re-exports a current clip asked for at another quality', async () => {
    const { service, tables } = setup();
    const answer = await service.start(TEST_ORG, TEST_USER, {
      clipIds: [CURRENT],
      quality: '1080p',
    });
    expect(answer.jobs[0]).toMatchObject({ note: 'queued', quality: '1080p' });
    expect(batchJobs(tables, answer.batchId)).toHaveLength(1);
  });

  it('lowers a quality the plan does not allow to the best one it does, and says so', async () => {
    const { service, tables } = setup(seed(), {
      'clips.export_max_quality': '720p60',
      'clips.export_watermark': false,
      'clips.queue_priority': 'low',
    });
    const answer = await service.start(TEST_ORG, TEST_USER, {
      clipIds: [FRESH],
      quality: '1080p60',
    });
    expect(answer.jobs).toEqual([
      expect.objectContaining({ clipId: FRESH, quality: '720p60', note: 'lowered' }),
    ]);
    expect(batchJobs(tables, answer.batchId)[0]).toMatchObject({
      priority: 'low',
      input: expect.objectContaining({ quality: '720p60', watermark: false }),
    });
    expect(batchQuality('720p', '1080p')).toEqual({ quality: '720p', lowered: false });
    expect(batchQuality('1080p', '720p')).toEqual({ quality: '720p', lowered: true });
    expect(batchQuality('720p', null)).toBeNull();
  });

  it('refuses the batch with the plan lock when the plan allows no quality at all', async () => {
    const { service, tables } = setup(seed(), {
      'clips.export_max_quality': null,
      'clips.export_watermark': true,
      'clips.queue_priority': 'normal',
    });
    const { status, body } = await refusal(
      service.start(TEST_ORG, TEST_USER, { clipIds: [FRESH], quality: '720p' }),
    );
    expect(status).toBe(402);
    expect(body).toMatchObject({
      code: 'clips_quality_requires_plan',
      message: qualityLockedSentence('720p'),
    });
    expect(tables.jobs).toHaveLength(2);
  });

  it("refuses the whole batch when one id is another workspace's clip, removed or unknown", async () => {
    for (const bad of [FOREIGN, REMOVED, '55555555-5555-4555-8555-999999999999']) {
      const { service, tables, redis } = setup();
      const { status, body } = await refusal(
        service.start(TEST_ORG, TEST_USER, { clipIds: [FRESH, bad], quality: '720p' }),
      );
      expect(status).toBe(404);
      expect(body).toMatchObject({ code: 'clip_not_found' });
      expect(tables.jobs).toHaveLength(2);
      expect(redis.set).not.toHaveBeenCalled();
    }
  });

  it('refuses the whole batch, making nothing, when one clip cannot be exported', async () => {
    const tables = seed();
    const notReady = videoRow({ id: '22222222-2222-4222-8222-000000000009', status: 'IMPORTING' });
    tables.videos.push(notReady);
    const late = '55555555-5555-4555-8555-555555555556';
    tables.clips.push(clipRow({ id: late, videoId: notReady.id, document: DOCUMENT }));
    const { service, jobs } = setup(tables);

    const { status, body } = await refusal(
      service.start(TEST_ORG, TEST_USER, { clipIds: [FRESH, late], quality: '720p' }),
    );
    expect(status).toBe(409);
    expect(body).toMatchObject({ code: 'video_not_ready' });
    // FRESH's job was rolled back with the transaction.
    expect(tables.jobs).toHaveLength(2);
    expect(jobs.startRendersQuietly).not.toHaveBeenCalled();
  });

  it('skips a montage that plays a removed video with the note removed, and exports the rest', async () => {
    const tables = seed();
    const gone = videoRow({ id: '22222222-2222-4222-8222-000000000008', status: 'REMOVED' });
    tables.videos.push(gone);
    const montage = '55555555-5555-4555-8555-555555555558';
    tables.clips.push(
      clipRow({
        id: montage,
        origin: 'MONTAGE',
        videoId: VIDEO,
        meta: { videoIds: [gone.id] },
        document: DOCUMENT,
      }),
    );
    const { service } = setup(tables);
    const answer = await service.start(TEST_ORG, TEST_USER, {
      clipIds: [FRESH, montage],
      quality: '720p',
    });
    expect(answer.jobs).toEqual([
      expect.objectContaining({ clipId: FRESH, note: 'queued' }),
      { clipId: montage, jobId: null, quality: '720p', note: 'removed' },
    ]);
    expect(batchJobs(tables, answer.batchId)).toHaveLength(1);
    const view = await service.view(TEST_ORG, answer.batchId);
    expect(view).toMatchObject({ total: 2, done: 0, failed: 1, finished: false });
  });

  it('takes 1 to 30 distinct ids', () => {
    const many = Array.from(
      { length: 31 },
      (_, index) => `55555555-5555-4555-8555-${String(index).padStart(12, '0')}`,
    );
    expect(
      batchExportSchema.safeParse({ clipIds: many.slice(0, 30), quality: '720p' }).success,
    ).toBe(true);
    expect(batchExportSchema.safeParse({ clipIds: many, quality: '720p' }).success).toBe(false);
    expect(batchExportSchema.safeParse({ clipIds: [], quality: '720p' }).success).toBe(false);
    expect(batchExportSchema.safeParse({ clipIds: [FRESH, FRESH], quality: '720p' }).success).toBe(
      false,
    );
  });
});

describe('ClipBatchExportsService.view (GET /clips/exports/batches/:batchId)', () => {
  it('lists every clip with its note and job; a failure never stops the rest', async () => {
    const { service, tables } = setup();
    const extra = '55555555-5555-4555-8555-555555555557';
    tables.clips.push(
      clipRow({ id: extra, title: 'Extra clip', videoId: VIDEO, document: DOCUMENT }),
    );
    const answer = await service.start(TEST_ORG, TEST_USER, {
      clipIds: [FRESH, extra, CURRENT, RUNNING],
      quality: '720p',
    });
    const [first, second] = batchJobs(tables, answer.batchId);
    Object.assign(first as ClipJob, { status: 'FAILED', finishedAt: NOW });
    Object.assign(second as ClipJob, { status: 'RUNNING', progress: 40 });

    let view = await service.view(TEST_ORG, answer.batchId);
    expect(view).toMatchObject({ batchId: answer.batchId, total: 4, done: 1, failed: 1 });
    expect(view.finished).toBe(false);
    expect(view.jobs.map((row) => [row.clipTitle, row.note, row.job?.status ?? null])).toEqual([
      ['Fresh clip', 'queued', 'FAILED'],
      ['Extra clip', 'queued', 'RUNNING'],
      ['Current clip', 'current', null],
      ['Running clip', 'running', 'RUNNING'],
    ]);

    Object.assign(second as ClipJob, { status: 'DONE', finishedAt: NOW });
    Object.assign(tables.jobs.find((job) => job.id === RUNNING_JOB) as ClipJob, {
      status: 'DONE',
      finishedAt: NOW,
    });
    view = await service.view(TEST_ORG, answer.batchId);
    expect(view).toMatchObject({ total: 4, done: 3, failed: 1, finished: true });
  });

  it("answers 404 for another workspace's batch, an unknown one and a word", async () => {
    const { service } = setup();
    const answer = await service.start(TEST_ORG, TEST_USER, { clipIds: [FRESH], quality: '720p' });
    for (const [org, batchId] of [
      [OTHER_ORG, answer.batchId],
      [TEST_ORG, '12121212-1212-4121-8121-121212121212'],
      [TEST_ORG, 'batches'],
    ] as const) {
      const { status, body } = await refusal(service.view(org, batchId));
      expect(status).toBe(404);
      expect(body).toMatchObject({ code: 'batch_not_found' });
    }
  });

  it('rebuilds the list from the batch jobs when Redis lost it', async () => {
    const { service, store } = setup();
    const answer = await service.start(TEST_ORG, TEST_USER, {
      clipIds: [FRESH, CURRENT],
      quality: '720p',
    });
    store.delete(manifestKey(TEST_ORG, answer.batchId));
    const view = await service.view(TEST_ORG, answer.batchId);
    expect(view.jobs).toEqual([
      expect.objectContaining({ clipId: FRESH, note: 'queued', clipTitle: 'Fresh clip' }),
    ]);
    expect(view.total).toBe(1);
  });

  it('follows the batch jobs and the running export it noted', async () => {
    const { service, tables } = setup();
    const answer = await service.start(TEST_ORG, TEST_USER, {
      clipIds: [FRESH, CURRENT, RUNNING],
      quality: '720p',
    });
    const [made] = batchJobs(tables, answer.batchId);
    expect(await service.jobIdsOf(TEST_ORG, answer.batchId)).toEqual([made?.id, RUNNING_JOB]);
  });
});

describe('ClipBatchExportsService.open (GET /clips/exports/batches?open=1)', () => {
  it("answers this person's running batches with their counts", async () => {
    const { service } = setup();
    const answer = await service.start(TEST_ORG, TEST_USER, {
      clipIds: [FRESH, CURRENT],
      quality: '720p',
    });
    mockDb.$queryRaw.mockResolvedValue([
      { batchId: answer.batchId },
      { batchId: '12121212-1212-4121-8121-121212121212' },
      { batchId: 'not-a-uuid' },
    ]);
    await expect(service.open(TEST_ORG, TEST_USER)).resolves.toEqual({
      batches: [{ batchId: answer.batchId, total: 2, done: 1, failed: 0 }],
    });
  });
});
