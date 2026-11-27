/**
 * Create Montage (Sprint 13, Module 11) against an in-memory database and the
 * real engine: the order and the length (a Fade 0.3 s shorter per join, a
 * title card 2 s longer), the row (origin, first video, `meta.videoIds`,
 * DRAFT, no sharp fetch), every video touched, the shapes (`ratios` when
 * they differ, a chosen shape), the 2 to 15 limits, tenancy (all or
 * nothing), a removed or unready video.
 */
import { HttpException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Clip } from '@postgear/db';
import {
  createClipDocument,
  JOIN_FADE_MS,
  montageParts,
  parseClipDocument,
} from '@postgear/video-engine';
import { RedisService } from '../../redis/redis.service';
import { ClipItemService } from '../clip/clip-item.service';
import type { ClipJobsRepository } from '../jobs/clip-jobs.repository';
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
import { TEST_ORG, TEST_USER, videoRow } from '../testing/rows';
import type { ClipPlaybackService } from '../videos/clip-playback.service';
import { ClipVideosRepository } from '../videos/clip-videos.repository';
import { createMontageSchema } from './clip-montages.schema';
import { ClipMontagesService, montageTitle } from './clip-montages.service';

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

const VIDEO_A = videoRow().id;
const VIDEO_B = '99999999-9999-4999-8999-00000000000b';
const CLIP_A = '55555555-5555-4555-8555-00000000000a';
const CLIP_B = '55555555-5555-4555-8555-00000000000b';
const CLIP_C = '55555555-5555-4555-8555-00000000000c';
const OTHER_ORG = 'seed-second-org';

function seed(): FakeTables {
  const tables = emptyTables();
  tables.videos.push(
    videoRow({ id: VIDEO_A, status: 'READY', title: 'Stream A' }),
    videoRow({ id: VIDEO_B, status: 'READY', title: 'Stream B', externalId: '900000002' }),
  );
  tables.clips.push(
    clipRow({
      id: CLIP_A,
      videoId: VIDEO_A,
      title: 'The Opening',
      document: createClipDocument({
        videoId: VIDEO_A,
        fromMs: 60_000,
        toMs: 90_000,
        ratio: '9:16',
      }),
    }),
    clipRow({
      id: CLIP_B,
      videoId: VIDEO_B,
      title: 'The Big Play',
      document: createClipDocument({
        videoId: VIDEO_B,
        fromMs: 10_000,
        toMs: 40_000,
        ratio: '9:16',
      }),
    }),
    clipRow({
      id: CLIP_C,
      videoId: VIDEO_A,
      title: 'Wide Shot',
      document: createClipDocument({
        videoId: VIDEO_A,
        fromMs: 200_000,
        toMs: 220_000,
        ratio: '16:9',
      }),
    }),
  );
  return tables;
}

function setup(tables = seed()) {
  mockDb = fakeClipDb(tables);
  const jobs = { start: jest.fn(async () => true) };
  const jobsRepository = { create: jest.fn() };
  const limits = { assertEnabled: jest.fn(async () => undefined) };
  const retention = { touchVideo: jest.fn(async () => true) };
  const items = new ClipItemService(
    jobs as unknown as ClipJobsService,
    jobsRepository as unknown as ClipJobsRepository,
    new ClipVideosRepository(),
    limits as unknown as ClipLimitsGuard,
    { address: jest.fn() } as unknown as ClipPlaybackService,
    new RedisService({ get: () => undefined } as unknown as ConfigService),
    retention as unknown as ClipRetentionService,
  );
  const service = new ClipMontagesService(
    items,
    limits as unknown as ClipLimitsGuard,
    retention as unknown as ClipRetentionService,
  );
  return { service, tables, jobs, jobsRepository, retention, limits };
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

function created(outcome: Awaited<ReturnType<ClipMontagesService['create']>>) {
  if (outcome.kind !== 'created') throw new Error(`expected a montage, got ${outcome.kind}`);
  return outcome.clip;
}

function newRow(tables: FakeTables): Clip {
  const row = tables.clips.find((clip) => clip.origin === 'MONTAGE');
  if (!row) throw new Error('no montage row');
  return row;
}

describe('ClipMontagesService.create', () => {
  it('stitches the clips in the order asked into a DRAFT montage of the first video', async () => {
    const { service, tables, jobsRepository, jobs } = setup();

    const clip = created(
      await service.create(TEST_ORG, TEST_USER, {
        clipIds: [CLIP_B, CLIP_A],
        transition: 'cut',
      }),
    );

    expect(clip).toMatchObject({
      origin: 'MONTAGE',
      videoId: VIDEO_B,
      status: 'DRAFT',
      state: 'draft',
      title: 'Montage Of 2 Clips',
      ratio: '9:16',
      durationMs: 60_000,
      revision: 1,
      meta: { videoIds: [VIDEO_A] },
    });
    const row = newRow(tables);
    expect(row.meta).toEqual({ videoIds: [VIDEO_A] });
    expect(row.createdById).toBe(TEST_USER);
    const doc = parseClipDocument(row.document);
    expect(montageParts(doc).map((part) => [part.clipId, part.title])).toEqual([
      [CLIP_B, 'The Big Play'],
      [CLIP_A, 'The Opening'],
    ]);
    expect(doc.sources.map((source) => source.videoId)).toEqual([VIDEO_B, VIDEO_A]);
    // A snapshot made from what the clips already hold: nothing is fetched for it.
    expect(jobsRepository.create).not.toHaveBeenCalled();
    expect(jobs.start).not.toHaveBeenCalled();
    // The originals are untouched.
    expect(tables.clips.filter((c) => c.origin !== 'MONTAGE').map((c) => c.revision)).toEqual([
      1, 1, 1,
    ]);
  });

  it('is 0.3 s shorter per Fade join and 2 s longer with a title card, named after the card', async () => {
    const { service } = setup();
    const fade = created(
      await service.create(TEST_ORG, TEST_USER, {
        clipIds: [CLIP_A, CLIP_B],
        transition: 'fade',
      }),
    );
    expect(fade.durationMs).toBe(60_000 - JOIN_FADE_MS);
    expect(fade.document?.joins).toHaveLength(1);

    const titled = created(
      await service.create(TEST_ORG, TEST_USER, {
        clipIds: [CLIP_A, CLIP_B],
        transition: 'fade',
        titleCard: 'Best Of The Week',
      }),
    );
    expect(titled.title).toBe('Best Of The Week');
    expect(titled.durationMs).toBe(60_000 - JOIN_FADE_MS + 2_000);
    expect(titled.document?.cards?.opening?.text).toBe('Best Of The Week');
  });

  it('counts each of its videos as used (Module 19)', async () => {
    const { service, retention } = setup();
    await service.create(TEST_ORG, TEST_USER, { clipIds: [CLIP_A, CLIP_B], transition: 'cut' });
    const touched = retention.touchVideo.mock.calls.map((call) => (call as unknown[])[1]);
    expect(new Set(touched)).toEqual(new Set([VIDEO_A, VIDEO_B]));
  });

  it('keeps two clips of one video as one video in meta (none besides the first)', async () => {
    const tables = seed();
    const third = tables.clips[2] as Clip;
    third.document = createClipDocument({
      videoId: VIDEO_A,
      fromMs: 200_000,
      toMs: 220_000,
      ratio: '9:16',
    }) as unknown as Clip['document'];
    third.ratio = '9:16';
    const { service } = setup(tables);
    const clip = created(
      await service.create(TEST_ORG, TEST_USER, { clipIds: [CLIP_A, CLIP_C], transition: 'cut' }),
    );
    expect(clip).toMatchObject({ videoId: VIDEO_A, durationMs: 50_000 });
    expect(clip.meta).toBeNull();
    expect(newRow(tables).meta).toEqual({ videoIds: [] });
  });

  it('answers the shapes found when they differ and no shape was chosen, writing nothing', async () => {
    const { service, tables } = setup();
    const outcome = await service.create(TEST_ORG, TEST_USER, {
      clipIds: [CLIP_A, CLIP_C],
      transition: 'cut',
    });
    expect(outcome).toEqual({ kind: 'shapes_differ', ratios: ['9:16', '16:9'] });
    expect(tables.clips).toHaveLength(3);

    const chosen = created(
      await service.create(TEST_ORG, TEST_USER, {
        clipIds: [CLIP_A, CLIP_C],
        ratio: '16:9',
        transition: 'cut',
      }),
    );
    expect(chosen.ratio).toBe('16:9');
    expect(chosen.document?.canvas.ratio).toBe('16:9');
  });

  it('takes 2 to 15 clips, with the engine sentences, before reading any', async () => {
    const { service } = setup();
    expect(
      await refusal(service.create(TEST_ORG, TEST_USER, { clipIds: [CLIP_A], transition: 'cut' })),
    ).toEqual({
      status: 422,
      body: { code: 'montage_too_few', message: 'Pick at least 2 clips for a montage.' },
    });
    const sixteen = Array.from(
      { length: 16 },
      (_, i) => `55555555-5555-4555-8555-${String(i).padStart(12, '0')}`,
    );
    expect(
      await refusal(service.create(TEST_ORG, TEST_USER, { clipIds: sixteen, transition: 'cut' })),
    ).toEqual({
      status: 422,
      body: { code: 'montage_too_many', message: 'A montage holds up to 15 clips.' },
    });
    expect(mockDb.clip.findMany).not.toHaveBeenCalled();
  });

  it("refuses the lot with 404 when any clip is another workspace's, unknown or marked removed", async () => {
    const tables = seed();
    (tables.clips[1] as Clip).organizationId = OTHER_ORG;
    const { service } = setup(tables);
    expect(
      await refusal(
        service.create(TEST_ORG, TEST_USER, { clipIds: [CLIP_A, CLIP_B], transition: 'cut' }),
      ),
    ).toMatchObject({ status: 404, body: { code: 'clip_not_found' } });
    expect(tables.clips).toHaveLength(3);

    const removed = seed();
    (removed.clips[1] as Clip).removedAt = new Date();
    expect(
      await refusal(
        setup(removed).service.create(TEST_ORG, TEST_USER, {
          clipIds: [CLIP_A, CLIP_B],
          transition: 'cut',
        }),
      ),
    ).toMatchObject({ status: 404 });
    expect(removed.clips).toHaveLength(3);
  });

  it('refuses a removed video with montage_video_removed and an unready one with video_not_ready', async () => {
    const tables = seed();
    const videoB = tables.videos[1];
    if (!videoB) throw new Error('no video');
    videoB.deletedAt = new Date();
    videoB.status = 'REMOVED';
    expect(
      await refusal(
        setup(tables).service.create(TEST_ORG, TEST_USER, {
          clipIds: [CLIP_A, CLIP_B],
          transition: 'cut',
        }),
      ),
    ).toEqual({
      status: 422,
      body: {
        code: 'montage_video_removed',
        message: 'One of the videos in this montage was removed.',
      },
    });

    const importing = seed();
    (importing.videos[1] as { status: string }).status = 'IMPORTING';
    expect(
      await refusal(
        setup(importing).service.create(TEST_ORG, TEST_USER, {
          clipIds: [CLIP_A, CLIP_B],
          transition: 'cut',
        }),
      ),
    ).toMatchObject({ status: 409, body: { code: 'video_not_ready' } });
  });

  it('counts every video of a montage it is made from', async () => {
    const { service, tables } = setup();
    const first = created(
      await service.create(TEST_ORG, TEST_USER, { clipIds: [CLIP_A, CLIP_B], transition: 'cut' }),
    );
    // Stitched again after a clip of video A only: still both videos.
    const again = created(
      await service.create(TEST_ORG, TEST_USER, {
        clipIds: [CLIP_A, first.id],
        transition: 'cut',
      }),
    );
    expect(again.videoId).toBe(VIDEO_A);
    expect(tables.clips.find((clip) => clip.id === again.id)?.meta).toEqual({
      videoIds: [VIDEO_B],
    });
  });
});

describe('the montage body', () => {
  it('takes ids each once, a known shape, a transition and a plain title line', () => {
    expect(
      createMontageSchema.safeParse({ clipIds: [CLIP_A, CLIP_A], transition: 'cut' }).success,
    ).toBe(false);
    expect(
      createMontageSchema.safeParse({ clipIds: [CLIP_A, CLIP_B], transition: 'wipe' }).success,
    ).toBe(false);
    expect(
      createMontageSchema.safeParse({ clipIds: [CLIP_A, CLIP_B], ratio: '3:2', transition: 'cut' })
        .success,
    ).toBe(false);
    expect(
      createMontageSchema.safeParse({ clipIds: [CLIP_A, CLIP_B], transition: 'cut', extra: 1 })
        .success,
    ).toBe(false);
    const cleaned = createMontageSchema.parse({
      clipIds: [CLIP_A, CLIP_B],
      transition: 'fade',
      titleCard: '  Best\u0007 of   the week  ',
    });
    expect(cleaned.titleCard).toBe('Best of the week');
    expect(
      createMontageSchema.parse({ clipIds: [CLIP_A], transition: 'cut', titleCard: '   ' })
        .titleCard,
    ).toBeNull();
    expect(
      createMontageSchema.safeParse({
        clipIds: [CLIP_A, CLIP_B],
        transition: 'cut',
        titleCard: 'x'.repeat(81),
      }).success,
    ).toBe(false);
  });

  it('names a montage after its card, or after its size', () => {
    expect(montageTitle(null, 3)).toBe('Montage Of 3 Clips');
    expect(montageTitle('Highlights', 3)).toBe('Highlights');
  });
});
