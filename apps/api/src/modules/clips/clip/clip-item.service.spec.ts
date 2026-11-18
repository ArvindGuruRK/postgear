/**
 * One clip's routes against an in-memory database: Edit Whole Video (the
 * video's length, the 30 minute refusal), the editor's read (pictures,
 * sound and state), More Video (already covered, already fetching, a new
 * job, uploads, a gone copy, the per-clip throttle) and tenancy.
 */
import { HttpException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { ClipJob, ClipVideo } from '@postgear/db';
import { createClipDocument, HANDLE_MS } from '@postgear/video-engine';
import { RedisService } from '../../redis/redis.service';
import type { ClipJobsRepository, NewClipJob } from '../jobs/clip-jobs.repository';
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
import type { ClipPlaybackService } from '../videos/clip-playback.service';
import { ClipVideosRepository } from '../videos/clip-videos.repository';
import { createClipSchema } from './clip-item.schema';
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
const CLIP = '55555555-5555-4555-8555-555555555555';
const OTHER_ORG = 'seed-second-org';
const LINK = {
  platform: 'twitch',
  kind: 'past_stream',
  externalId: '900000001',
  canonicalUrl: 'https://www.twitch.tv/videos/900000001',
};

function importJob(videoId: string, origin: unknown): ClipJob {
  return jobRow({
    id: '77777777-7777-4777-8777-777777777777',
    kind: 'IMPORT',
    status: 'DONE',
    videoId,
    input: {
      videoId,
      origin,
      limits: { maxVideoMs: 1, storageBytes: 1, retentionDays: 1 },
      expectedBytes: null,
    } as unknown as ClipJob['input'],
  });
}

function seed(video: Partial<ClipVideo> = {}): FakeTables {
  const tables = emptyTables();
  tables.videos.push(videoRow({ status: 'READY', ...video }));
  tables.jobs.push(importJob(VIDEO, { type: 'link', link: LINK }));
  tables.clips.push(
    clipRow({
      id: CLIP,
      videoId: VIDEO,
      document: createClipDocument({ videoId: VIDEO, fromMs: 60_000, toMs: 90_000, ratio: '9:16' }),
    }),
  );
  return tables;
}

let jobCount = 0;
function setup(tables = seed()) {
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
      }) => ({
        id: params.id,
        organizationId: params.orgId,
        kind: params.kind,
        priority: 'normal',
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
      const row = jobRow({ ...(job as unknown as Partial<ClipJob>), status: 'QUEUED' });
      tables.jobs.push(row);
      return row;
    }),
    find: jest.fn(
      async (_org: string, jobId: string) => tables.jobs.find((job) => job.id === jobId) ?? null,
    ),
  };
  const limits = {
    assertEnabled: jest.fn(async () => undefined),
    bestExportHeight: jest.fn(async () => 1080),
  };
  const playback = {
    address: jest.fn(async (key: string) => ({
      url: `https://signed/${key}`,
      expiresAt: '2026-11-18T18:00:00.000Z',
    })),
  };
  const redis = new RedisService({ get: () => undefined } as unknown as ConfigService);
  const service = new ClipItemService(
    jobs as unknown as ClipJobsService,
    jobsRepository as unknown as ClipJobsRepository,
    new ClipVideosRepository(),
    limits as unknown as ClipLimitsGuard,
    playback as unknown as ClipPlaybackService,
    redis,
  );
  return { service, tables, jobs, jobsRepository };
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

describe('ClipItemService.create with whole: true (Edit Whole Video)', () => {
  it('makes one clip over the whole video, named after it, with its sharp range', async () => {
    const { service, tables } = setup();
    const answer = await service.create(TEST_ORG, TEST_USER, { videoId: VIDEO, whole: true });

    expect(answer.clip).toMatchObject({
      title: 'A ten minute stream',
      durationMs: 10 * 60_000,
      ratio: '9:16',
      status: 'DRAFT',
      state: 'draft',
      revision: 1,
    });
    expect(answer.clip.document?.segments).toEqual([
      expect.objectContaining({ sourceIn: 0, sourceOut: 10 * 60_000 }),
    ]);
    expect(answer.job).toMatchObject({ kind: 'SEGMENT' });
    const segment = tables.jobs.find((job) => job.kind === 'SEGMENT');
    expect(segment?.input).toMatchObject({ fromMs: 0, toMs: 10 * 60_000, maxHeight: 1080 });
  });

  it('refuses a video over 30 minutes with clip_too_long and its sentence', async () => {
    const { service, tables } = setup(seed({ durationMs: 31 * 60_000 }));
    const answer = await refusal(
      service.create(TEST_ORG, TEST_USER, { videoId: VIDEO, whole: true }),
    );
    expect(answer).toEqual({
      status: 422,
      body: {
        code: 'clip_too_long',
        message: 'Edit Whole Video works for videos up to 30 minutes. Mark a range to make a clip.',
      },
    });
    expect(tables.clips).toHaveLength(1);
  });

  it('takes a video of exactly 30 minutes', async () => {
    const { service } = setup(seed({ durationMs: 30 * 60_000 }));
    const answer = await service.create(TEST_ORG, TEST_USER, { videoId: VIDEO, whole: true });
    expect(answer.clip.durationMs).toBe(30 * 60_000);
  });

  it("answers 404 for another workspace's video", async () => {
    const { service } = setup();
    const answer = await refusal(
      service.create(OTHER_ORG, TEST_USER, { videoId: VIDEO, whole: true }),
    );
    expect(answer).toMatchObject({ status: 404, body: { code: 'video_not_found' } });
  });

  it('takes exactly one of a range or whole', () => {
    expect(createClipSchema.safeParse({ videoId: VIDEO, whole: true }).success).toBe(true);
    expect(createClipSchema.safeParse({ videoId: VIDEO, fromMs: 0, toMs: 5_000 }).success).toBe(
      true,
    );
    expect(
      createClipSchema.safeParse({ videoId: VIDEO, whole: true, fromMs: 0, toMs: 5_000 }).success,
    ).toBe(false);
    expect(createClipSchema.safeParse({ videoId: VIDEO, whole: false }).success).toBe(false);
    expect(createClipSchema.safeParse({ videoId: VIDEO }).success).toBe(false);
  });
});

describe('ClipItemService.get', () => {
  it("answers the video's pictures and sound with the clip's state, and never a key", async () => {
    const tables = seed();
    tables.assets.push(
      assetRow({
        id: 'p',
        kind: 'PROXY',
        key: 'k/proxy',
        meta: { width: 1280, height: 720, fps: 30 },
      }),
      assetRow({
        id: 'f',
        kind: 'FILMSTRIP',
        key: 'k/film0',
        meta: {
          tileWidth: 160,
          tileHeight: 90,
          columns: 10,
          rows: 10,
          intervalMs: 2_000,
          count: 50,
          sheets: 1,
          sheet: 0,
        },
      }),
      assetRow({
        id: 'w',
        kind: 'WAVEFORM',
        key: 'k/wave',
        meta: { perSecond: 20, count: 12_000 },
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
    tables.posts.push({
      id: 'post',
      organizationId: TEST_ORG,
      group: 'g',
      state: 'QUEUE',
      deletedAt: null,
    });
    const { service } = setup(tables);

    const detail = await service.get(TEST_ORG, CLIP);
    expect(detail.clip.state).toBe('scheduled');
    expect(detail.playback?.url).toBe('https://signed/k/proxy');
    expect(detail.proxy).toEqual({ width: 1280, height: 720, fps: 30 });
    expect(detail.filmstrip).toMatchObject({ sheets: ['https://signed/k/film0'] });
    expect(detail.waveform).toMatchObject({
      url: 'https://signed/k/wave',
      meta: { perSecond: 20, count: 12_000 },
    });
    expect(detail.sharp).toBe('gone');
    expect(detail.held).toBeNull();
    expect(JSON.stringify(detail)).not.toContain('"k/');
  });

  it('answers the sharp stretch held around the clip, covering or not', async () => {
    const covering = seed();
    covering.assets.push(
      assetRow({
        id: 's',
        kind: 'SEGMENT',
        key: 'k/seg',
        meta: { fromMs: 50_000, toMs: 100_000, height: 1080, fps: 30 },
      }),
    );
    const ready = await setup(covering).service.get(TEST_ORG, CLIP);
    expect(ready.sharp).toBe('ready');
    expect(ready.held).toEqual({ fromMs: 50_000, toMs: 100_000 });

    // Trimmed past the handles: the old stretch is still what is held.
    const short = seed();
    short.assets.push(
      assetRow({
        id: 's',
        kind: 'SEGMENT',
        key: 'k/seg',
        meta: { fromMs: 70_000, toMs: 100_000, height: 1080, fps: 30 },
      }),
    );
    const partly = await setup(short).service.get(TEST_ORG, CLIP);
    expect(partly.sharp).toBe('gone');
    expect(partly.held).toEqual({ fromMs: 70_000, toMs: 100_000 });
  });

  it("answers 404 for another workspace's clip and for a word", async () => {
    const { service } = setup();
    expect(await refusal(service.get(OTHER_ORG, CLIP))).toMatchObject({ status: 404 });
    expect(await refusal(service.get(TEST_ORG, 'layouts'))).toMatchObject({ status: 404 });
  });
});

describe('ClipItemService.moreVideo', () => {
  const RANGE = { fromMs: 30_000, toMs: 120_000 };

  it('starts a SEGMENT job for the range widened by the handles', async () => {
    const { service, tables, jobs } = setup();
    const answer = await service.moreVideo(TEST_ORG, TEST_USER, CLIP, RANGE);
    expect(answer.sharp).toBe('fetching');
    expect(answer.job).toMatchObject({ kind: 'SEGMENT', clipId: CLIP });
    const job = tables.jobs.find((row) => row.kind === 'SEGMENT');
    expect(job?.input).toMatchObject({ fromMs: 0, toMs: 120_000 + HANDLE_MS, clipId: CLIP });
    expect(jobs.start).toHaveBeenCalledTimes(1);
  });

  it('starts nothing when a stored sharp range already covers it', async () => {
    const tables = seed();
    tables.assets.push(
      assetRow({
        id: 's',
        kind: 'SEGMENT',
        key: 'k/seg',
        meta: { fromMs: 0, toMs: 200_000, height: 1080, fps: 30 },
      }),
    );
    const { service, jobs } = setup(tables);
    expect(await service.moreVideo(TEST_ORG, TEST_USER, CLIP, RANGE)).toEqual({
      job: null,
      sharp: 'ready',
    });
    expect(jobs.build).not.toHaveBeenCalled();
  });

  it('answers the open job that already covers it instead of starting another', async () => {
    const { service, jobs } = setup();
    const first = await service.moreVideo(TEST_ORG, TEST_USER, CLIP, RANGE);
    const again = await service.moreVideo(TEST_ORG, TEST_USER, CLIP, {
      fromMs: 40_000,
      toMs: 100_000,
    });
    expect(again).toEqual({
      job: expect.objectContaining({ id: first.job?.id }),
      sharp: 'fetching',
    });
    expect(jobs.start).toHaveBeenCalledTimes(1);
  });

  it('starts one job per clip in 10 seconds: a burst of drags is 429 more_video_throttled', async () => {
    const { service } = setup();
    await service.moreVideo(TEST_ORG, TEST_USER, CLIP, { fromMs: 100_000, toMs: 150_000 });
    const answer = await refusal(
      service.moreVideo(TEST_ORG, TEST_USER, CLIP, { fromMs: 400_000, toMs: 500_000 }),
    );
    expect(answer).toEqual({
      status: 429,
      body: {
        code: 'more_video_throttled',
        message: 'We are already getting more of the video. Try again in a few seconds.',
      },
    });
  });

  it('cuts an upload from its kept original, so the export reads it sharp', async () => {
    const tables = seed({ platform: 'UPLOAD', kind: 'UPLOAD', canonicalUrl: null });
    tables.jobs.length = 0;
    tables.jobs.push(importJob(VIDEO, { type: 'upload', originalKey: 'org/originals/v.mp4' }));
    const { service, jobs } = setup(tables);
    const answer = await service.moreVideo(TEST_ORG, TEST_USER, CLIP, RANGE);
    expect(answer.sharp).toBe('fetching');
    const job = tables.jobs.find((row) => row.kind === 'SEGMENT');
    expect(job?.input).toMatchObject({
      origin: { type: 'upload', originalKey: 'org/originals/v.mp4' },
      fromMs: 0,
      toMs: 120_000 + HANDLE_MS,
    });
    expect(jobs.start).toHaveBeenCalledTimes(1);
  });

  it('answers gone when the platform copy is no longer online', async () => {
    const { service, jobs } = setup(seed({ hdAvailable: false }));
    expect(await service.moreVideo(TEST_ORG, TEST_USER, CLIP, RANGE)).toEqual({
      job: null,
      sharp: 'gone',
    });
    expect(jobs.build).not.toHaveBeenCalled();
  });

  it('refuses a range past the end of the video, or over an hour', async () => {
    const { service } = setup();
    expect(
      await refusal(service.moreVideo(TEST_ORG, TEST_USER, CLIP, { fromMs: 0, toMs: 11 * 60_000 })),
    ).toMatchObject({ status: 422, body: { code: 'clip_range_invalid' } });
    const long = setup(seed({ durationMs: 3 * 60 * 60_000 }));
    expect(
      await refusal(
        long.service.moreVideo(TEST_ORG, TEST_USER, CLIP, { fromMs: 0, toMs: 61 * 60_000 }),
      ),
    ).toMatchObject({ status: 422, body: { code: 'clip_range_invalid' } });
  });

  it("answers 404 for another workspace's clip, before anything is checked", async () => {
    const { service, jobs } = setup();
    expect(await refusal(service.moreVideo(OTHER_ORG, TEST_USER, CLIP, RANGE))).toMatchObject({
      status: 404,
    });
    expect(jobs.build).not.toHaveBeenCalled();
  });
});
