/**
 * The link import, retry and cancel against fakes: an in-memory video
 * table, a serializable transaction that runs one at a time (as Postgres
 * would order two conflicting ones), a ledger that counts charges and
 * reversals, and a probe that answers a fixed link. No database, no network.
 */

import { randomUUID } from 'node:crypto';
import { ConflictException, HttpException } from '@nestjs/common';
import type { ClipJob, ClipVideo } from '@postgear/db';
import type { PrivateStorage } from '@postgear/storage';
import type { LinkInfo } from '@postgear/video-engine';
import type { UsageService } from '../../entitlements/usage.service';
import type { ClipJobsRepository, NewClipJob } from '../jobs/clip-jobs.repository';
import type { ClipJobsService } from '../jobs/clip-jobs.service';
import type { ClipLimitsGuard } from '../limits/clip-limits.guard';
import type { ClipLinkProber } from '../links/clip-links.types';
import type { ClipRetentionService } from '../retention/clip-retention.service';
import { jobRow, TEST_ORG, TEST_USER, videoRow } from '../testing/rows';
import type { ClipPlaybackService } from './clip-playback.service';
import { type ClipSampleLink, SIMULATION_SAMPLE_LINK, sampleLinkFor } from './clip-sample';
import type { ClipVideosRepository } from './clip-videos.repository';
import { importVideoSchema } from './clip-videos.schema';
import {
  ClipVideosService,
  decodeSizeCursor,
  encodeSizeCursor,
  replayedOf,
} from './clip-videos.service';

/** One transaction at a time, in arrival order: a lost race reads the winner's rows. */
let txChain: Promise<unknown> = Promise.resolve();
let txFails: Error | null = null;
const tx = {
  clipVideo: {
    create: jest.fn(async ({ data }: { data: Partial<ClipVideo> }) => {
      if (txFails) throw txFails;
      const row = videoRow({ ...data });
      store.videos.push(row);
      return row;
    }),
    updateMany: jest.fn(
      async ({ where, data }: { where: Partial<ClipVideo>; data: Partial<ClipVideo> }) => {
        const row = store.videos.find(
          (video) => video.id === where.id && video.status === where.status,
        );
        if (!row) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
    ),
  },
};
jest.mock('../clips.tx', () => ({
  serializable: (work: (client: unknown) => Promise<unknown>) => {
    const run = txChain.then(() => work(tx));
    txChain = run.catch(() => undefined);
    return run;
  },
}));

const store: { videos: ClipVideo[]; jobs: ClipJob[] } = { videos: [], jobs: [] };

const INFO: LinkInfo = {
  platform: 'twitch',
  kind: 'past_stream',
  externalId: '900000001',
  canonicalUrl: 'https://www.twitch.tv/videos/900000001',
  title: 'A ten minute stream',
  channelName: 'Acme',
  durationMs: 10 * 60_000,
  live: false,
  thumbnailUrl: null,
  formats: [],
};

let sizes: Array<{ id: string; bytes: number }> = [];

function build(options: { sampleUrl?: string | null } = {}) {
  const charges: string[] = [];
  const reversals: string[] = [];

  const repository = {
    findLiveByLink: jest.fn(
      async (_org: string, platform: string, externalId: string) =>
        store.videos.find(
          (video) =>
            video.platform === platform &&
            video.externalId === externalId &&
            video.deletedAt === null,
        ) ?? null,
    ),
    findLive: jest.fn(
      async (_org: string, id: string) =>
        store.videos.find((video) => video.id === id && video.deletedAt === null) ?? null,
    ),
    findCard: jest.fn(async () => null),
    // Module 19: biggest first.
    listIdsBySize: jest.fn(
      async (
        _org: string,
        params: { cursor: { bytes: number; id: string } | null; take: number },
      ) =>
        [...sizes]
          .sort((a, b) => b.bytes - a.bytes || (a.id < b.id ? 1 : -1))
          .filter(
            (one) =>
              !params.cursor ||
              one.bytes < params.cursor.bytes ||
              (one.bytes === params.cursor.bytes && one.id < params.cursor.id),
          )
          .slice(0, params.take),
    ),
    cardsByIds: jest.fn(async (_org: string, ids: string[]) =>
      ids.map((id) => ({
        ...(store.videos.find((video) => video.id === id) ?? {}),
        id,
        assets: [],
        jobs: [],
        _count: { clips: 0 },
      })),
    ),
    countLive: jest.fn(async () => sizes.length),
    latestImport: jest.fn(
      async (_org: string, videoId: string) =>
        [...store.jobs].reverse().find((job) => job.videoId === videoId) ?? null,
    ),
  };
  const jobs = {
    newJobId: jest.fn(() => randomUUID()),
    build: jest.fn(
      async (params: {
        id: string;
        orgId: string;
        kind: string;
        videoId: string;
        input: unknown;
      }) => ({
        id: params.id,
        organizationId: params.orgId,
        kind: params.kind,
        priority: 'normal',
        input: params.input,
        videoId: params.videoId,
        clipId: null,
        highlightRunId: null,
        createdById: TEST_USER,
        expiresAt: null,
      }),
    ),
    start: jest.fn(async () => true),
    cancel: jest.fn(async (_org: string, jobId: string) => ({ id: jobId, status: 'CANCELLED' })),
  };
  const jobsRepository = {
    create: jest.fn(async (job: NewClipJob) => {
      const row = jobRow({ ...(job as unknown as Partial<ClipJob>) });
      store.jobs.push(row);
      return row;
    }),
    find: jest.fn(
      async (_org: string, id: string) => store.jobs.find((job) => job.id === id) ?? null,
    ),
    openForVideo: jest.fn(async (_org: string, videoId: string) =>
      store.jobs.filter(
        (job) => job.videoId === videoId && (job.status === 'QUEUED' || job.status === 'RUNNING'),
      ),
    ),
    removeCancelledVideo: jest.fn(async () => true),
  };
  const limits = {
    checkLinkImport: jest.fn(async () => undefined),
    assertEnabled: jest.fn(async () => undefined),
    assertLength: jest.fn(async () => undefined),
    assertStorage: jest.fn(async () => undefined),
    importLimits: jest.fn(async () => ({
      maxVideoMs: 3_600_000,
      storageBytes: 5e9,
      retentionDays: 14,
    })),
    chargeImport: jest.fn(async (_org: string, jobId: string) => {
      charges.push(jobId);
      return { entryId: `entry-${jobId}`, duplicate: false };
    }),
  };
  const usage = {
    reverseAllFor: jest.fn(async (_org: string, jobId: string) => {
      const charged = charges.includes(jobId);
      if (charged) reversals.push(jobId);
      return charged ? 1 : 0;
    }),
  };
  const playback = { address: jest.fn(async () => null) };
  const prober = {
    probe: jest.fn(async (_org: string, url: string) =>
      url === SIMULATION_SAMPLE_LINK
        ? {
            link: {
              platform: 'youtube',
              kind: 'video',
              externalId: 'simtalk0001',
              canonicalUrl: SIMULATION_SAMPLE_LINK,
            },
            info: {
              ...INFO,
              platform: 'youtube',
              kind: 'video',
              externalId: 'simtalk0001',
              canonicalUrl: SIMULATION_SAMPLE_LINK,
              title: 'A three minute talk',
              durationMs: 3 * 60_000,
            },
            existingVideoId: null,
          }
        : {
            link: {
              platform: 'twitch',
              kind: 'past_stream',
              externalId: '900000001',
              canonicalUrl: 'https://www.twitch.tv/videos/900000001',
            },
            info: INFO,
            existingVideoId: null,
          },
    ),
  };
  const storage = { deletePrefix: jest.fn(async () => undefined) };
  const retention = {
    touchVideo: jest.fn(async () => false),
    removeVideo: jest.fn(async () => null),
  };

  const service = new ClipVideosService(
    repository as unknown as ClipVideosRepository,
    jobs as unknown as ClipJobsService,
    jobsRepository as unknown as ClipJobsRepository,
    limits as unknown as ClipLimitsGuard,
    usage as unknown as UsageService,
    playback as unknown as ClipPlaybackService,
    prober as unknown as ClipLinkProber,
    storage as unknown as PrivateStorage,
    {
      url: options.sampleUrl === undefined ? SIMULATION_SAMPLE_LINK : options.sampleUrl,
    } as ClipSampleLink,
    retention as unknown as ClipRetentionService,
  );
  return { service, charges, reversals, jobs, jobsRepository, limits, storage, prober, retention };
}

const BODY = { url: 'https://www.twitch.tv/videos/900000001', rightsConfirmed: true };

beforeEach(() => {
  sizes = [];
  store.videos = [];
  store.jobs = [];
  txFails = null;
  txChain = Promise.resolve();
  jest.clearAllMocks();
});

describe('ClipVideosService.importLink', () => {
  it('refuses without the rights tick, before any charge', async () => {
    const { service, charges } = build();
    const error = await service.importLink(TEST_ORG, TEST_USER, { url: BODY.url }).catch((e) => e);
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(422);
    expect((error as HttpException).getResponse()).toEqual(
      expect.objectContaining({ code: 'rights_required' }),
    );
    expect(charges).toEqual([]);
  });

  it('charges once for the same link pasted twice: the second answers the existing video', async () => {
    const { service, charges, jobs } = build();
    const first = await service.importLink(TEST_ORG, TEST_USER, BODY);
    const second = await service.importLink(TEST_ORG, TEST_USER, BODY);

    expect(first.existing).toBe(false);
    expect(second.existing).toBe(true);
    expect(second.video.id).toBe(first.video.id);
    expect(charges).toHaveLength(1);
    expect(store.videos).toHaveLength(1);
    expect(jobs.start).toHaveBeenCalledTimes(1);
  });

  it('records the rights tick on the video', async () => {
    const { service } = build();
    await service.importLink(TEST_ORG, TEST_USER, BODY);
    expect(store.videos[0]).toEqual(
      expect.objectContaining({ rightsConfirmedById: TEST_USER, rightsTextVersion: 1 }),
    );
  });

  it('makes one video when two pastes race, and gives the loser its charge back', async () => {
    const { service, charges, reversals } = build();
    const [a, b] = await Promise.all([
      service.importLink(TEST_ORG, TEST_USER, BODY),
      service.importLink(TEST_ORG, TEST_USER, BODY),
    ]);

    expect(store.videos).toHaveLength(1);
    expect(store.jobs).toHaveLength(1);
    expect([a.existing, b.existing].sort()).toEqual([false, true]);
    expect(charges).toHaveLength(2);
    expect(reversals).toHaveLength(1);
    expect(reversals[0]).not.toBe(store.jobs[0]?.id);
  });

  it('reverses the charge when the rows cannot be written', async () => {
    const { service, charges, reversals } = build();
    txFails = new Error('database went away');
    await expect(service.importLink(TEST_ORG, TEST_USER, BODY)).rejects.toThrow(
      'database went away',
    );
    expect(charges).toHaveLength(1);
    expect(reversals).toEqual(charges);
  });

  it('charges nothing when a limit refuses', async () => {
    const { service, charges, limits } = build();
    limits.checkLinkImport.mockRejectedValueOnce(new HttpException('refused', 402));
    await expect(service.importLink(TEST_ORG, TEST_USER, BODY)).rejects.toBeInstanceOf(
      HttpException,
    );
    expect(charges).toEqual([]);
    expect(store.videos).toEqual([]);
  });
});

describe('ClipVideosService.retry and cancel', () => {
  function failedVideo(): ClipVideo {
    const video = videoRow({ status: 'FAILED', error: { code: 'import_failed', message: 'x' } });
    store.videos.push(video);
    store.jobs.push(
      jobRow({
        status: 'FAILED',
        videoId: video.id,
        input: {
          videoId: video.id,
          origin: {
            type: 'link',
            link: {
              platform: 'twitch',
              kind: 'past_stream',
              externalId: '900000001',
              canonicalUrl: 'https://www.twitch.tv/videos/900000001',
            },
          },
          limits: { maxVideoMs: 1, storageBytes: 1, retentionDays: 1 },
          expectedBytes: null,
        },
      }),
    );
    return video;
  }

  it('tries a failed video again with a new job and a new charge', async () => {
    const { service, charges } = build();
    const video = failedVideo();
    const answer = await service.retry(TEST_ORG, TEST_USER, video.id);

    expect(answer.video.status).toBe('IMPORTING');
    expect(answer.job.id).not.toBe(store.jobs[0]?.id);
    expect(charges).toEqual([answer.job.id]);
  });

  it('refuses to retry a video that did not fail (409)', async () => {
    const { service, charges } = build();
    const video = videoRow({ status: 'READY' });
    store.videos.push(video);
    await expect(service.retry(TEST_ORG, TEST_USER, video.id)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(charges).toEqual([]);
  });

  it('gives the charge back when a second retry loses the race', async () => {
    const { service, charges, reversals } = build();
    const video = failedVideo();
    const [first, second] = await Promise.allSettled([
      service.retry(TEST_ORG, TEST_USER, video.id),
      service.retry(TEST_ORG, TEST_USER, video.id),
    ]);
    const outcomes = [first.status, second.status].sort();
    expect(outcomes).toEqual(['fulfilled', 'rejected']);
    expect(charges).toHaveLength(2);
    expect(reversals).toHaveLength(1);
  });

  it('refuses to cancel a video that is not coming in (409)', async () => {
    const { service } = build();
    const video = videoRow({ status: 'READY' });
    store.videos.push(video);
    const error = await service.cancel(TEST_ORG, video.id).catch((e) => e);
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toEqual(
      expect.objectContaining({ code: 'video_not_importing' }),
    );
  });

  it('cancels an importing video through its open import job', async () => {
    const { service, jobs } = build();
    const video = videoRow({ status: 'IMPORTING' });
    store.videos.push(video);
    store.jobs.push(jobRow({ videoId: video.id, status: 'RUNNING' }));
    const answer = await service.cancel(TEST_ORG, video.id);
    expect(jobs.cancel).toHaveBeenCalledWith(TEST_ORG, store.jobs[0]?.id);
    expect(answer.message).toBeTruthy();
  });

  it('removes an importing video with no job left as a cancel would', async () => {
    const { service, jobsRepository, storage } = build();
    const video = videoRow({ status: 'IMPORTING' });
    store.videos.push(video);
    const answer = await service.cancel(TEST_ORG, video.id);
    expect(answer.job).toBeNull();
    expect(jobsRepository.removeCancelledVideo).toHaveBeenCalled();
    expect(storage.deletePrefix).toHaveBeenCalled();
  });

  it('answers 404 for an id that is not a UUID', async () => {
    const { service } = build();
    await expect(service.cancel(TEST_ORG, 'not-a-uuid')).rejects.toMatchObject({ status: 404 });
  });
});

describe('Try A Sample (Module 06)', () => {
  it('imports the simulation talk sample with no link and no tick, and charges like any import', async () => {
    const { service, charges, prober, limits } = build();
    const answer = await service.importLink(TEST_ORG, TEST_USER, { sample: true });

    expect(prober.probe).toHaveBeenCalledWith(TEST_ORG, SIMULATION_SAMPLE_LINK);
    expect(answer.existing).toBe(false);
    expect(answer.message).toBeUndefined();
    expect(limits.checkLinkImport).toHaveBeenCalledWith(TEST_ORG, 3 * 60_000, expect.any(Number));
    expect(charges).toHaveLength(1);
    expect(store.videos[0]).toEqual(
      expect.objectContaining({
        platform: 'YOUTUBE',
        externalId: 'simtalk0001',
        // Nobody ticked the box, so no rights record is claimed.
        rightsConfirmedAt: null,
        rightsConfirmedById: null,
      }),
    );
  });

  it('answers existing with its sentence the second time, charging once', async () => {
    const { service, charges } = build();
    await service.importLink(TEST_ORG, TEST_USER, { sample: true });
    const again = await service.importLink(TEST_ORG, TEST_USER, { sample: true });
    expect(again).toMatchObject({ existing: true, message: 'You already have the sample video.' });
    expect(charges).toHaveLength(1);
    // A pasted link that already exists keeps its old answer, with no sentence.
    await service.importLink(TEST_ORG, TEST_USER, BODY);
    const pasted = await service.importLink(TEST_ORG, TEST_USER, BODY);
    expect(pasted.message).toBeUndefined();
  });

  it('still applies every limit: a refusal charges nothing', async () => {
    const { service, charges, limits } = build();
    limits.checkLinkImport.mockRejectedValueOnce(new HttpException('refused', 402));
    await expect(service.importLink(TEST_ORG, TEST_USER, { sample: true })).rejects.toMatchObject({
      status: 402,
    });
    expect(charges).toEqual([]);
  });

  it('answers 404 sample_unavailable when this deployment has no sample, before any probe', async () => {
    const { service, prober } = build({ sampleUrl: null });
    const error = await service.importLink(TEST_ORG, TEST_USER, { sample: true }).catch((e) => e);
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(404);
    expect((error as HttpException).getResponse()).toEqual({
      message: 'There is no sample video to try here. Paste a link or upload a file instead.',
      code: 'sample_unavailable',
    });
    expect(prober.probe).not.toHaveBeenCalled();
  });

  it('takes exactly one of url or sample', () => {
    expect(importVideoSchema.safeParse({ sample: true }).success).toBe(true);
    expect(importVideoSchema.safeParse({ url: BODY.url, rightsConfirmed: true }).success).toBe(
      true,
    );
    expect(importVideoSchema.safeParse({ url: BODY.url, sample: true }).success).toBe(false);
    expect(importVideoSchema.safeParse({ sample: false }).success).toBe(false);
    expect(importVideoSchema.safeParse({ sample: true, rightsConfirmed: true }).success).toBe(
      false,
    );
    expect(importVideoSchema.safeParse({}).success).toBe(false);
  });

  it('picks the link: simulation talk, the configured link, or none', () => {
    const all = ['youtube', 'twitch', 'kick'] as const;
    expect(sampleLinkFor({ simulation: true, configured: undefined, platforms: all })).toBe(
      SIMULATION_SAMPLE_LINK,
    );
    expect(
      sampleLinkFor({
        simulation: false,
        configured: 'https://www.twitch.tv/videos/900000001',
        platforms: all,
      }),
    ).toBe('https://www.twitch.tv/videos/900000001');
    expect(sampleLinkFor({ simulation: false, configured: undefined, platforms: all })).toBeNull();
    // A sample on a platform switched off is no sample, so the button is never offered to fail.
    expect(
      sampleLinkFor({ simulation: true, configured: undefined, platforms: ['twitch', 'kick'] }),
    ).toBeNull();
  });
});

describe('replayedOf (Module 16)', () => {
  it("carries YouTube's heat map into the import, cleaned, and nothing when there is none", () => {
    expect(replayedOf(undefined)).toEqual({});
    expect(replayedOf([])).toEqual({});
    expect(
      replayedOf([
        { startMs: 0, endMs: 30_000.4, value: 0.2 },
        { startMs: 30_000, endMs: 36_000, value: 1.4 },
        { startMs: 36_000, endMs: 36_000, value: 0.5 },
      ]),
    ).toEqual({
      replayed: [
        { startMs: 0, endMs: 30_000, value: 0.2 },
        { startMs: 30_000, endMs: 36_000, value: 1 },
      ],
    });
  });
});

describe('See What Uses Space: sort by size (Module 19)', () => {
  const id = (n: number) => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;

  it('lists the biggest first with each size, 24 a page, and pages on (bytes, id)', async () => {
    sizes = Array.from({ length: 30 }, (_, i) => ({ id: id(i + 1), bytes: (i + 1) * 1_000_000 }));
    store.videos = sizes.map((one) => videoRow({ id: one.id }));
    const { service } = build();

    const first = await service.list(TEST_ORG, { sort: 'size' });
    expect(first.videos).toHaveLength(24);
    expect(first.videos[0]).toMatchObject({ video: { id: id(30) }, storedBytes: 30_000_000 });
    expect(first.videos[23]).toMatchObject({ storedBytes: 7_000_000 });
    expect(first.total).toBe(30);
    expect(first.nextCursor).not.toBeNull();

    const second = await service.list(TEST_ORG, {
      sort: 'size',
      cursor: first.nextCursor ?? undefined,
    });
    expect(second.videos.map((card) => card.storedBytes)).toEqual([
      6_000_000, 5_000_000, 4_000_000, 3_000_000, 2_000_000, 1_000_000,
    ]);
    expect(second.nextCursor).toBeNull();
  });

  it('reads the size cursor back, and refuses a date cursor or garbage as the first page', () => {
    const cursor = encodeSizeCursor({ bytes: 42, id: id(1) });
    expect(decodeSizeCursor(cursor)).toEqual({ bytes: 42, id: id(1) });
    expect(
      decodeSizeCursor(Buffer.from(`2026-11-19T00:00:00.000Z|${id(1)}`).toString('base64url')),
    ).toBeNull();
    expect(decodeSizeCursor('not-a-cursor')).toBeNull();
  });
});
