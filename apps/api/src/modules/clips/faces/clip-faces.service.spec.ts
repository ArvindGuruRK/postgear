/**
 * Faces in a clip's stretch (Sprint 13, Module 07) against an in-memory
 * database: a covering face file is reused with no job, a covering job is
 * joined, otherwise one free FACES job starts; the read answers a short
 * address; tenancy; the service off; and no charge anywhere.
 */
import { HttpException, NotFoundException } from '@nestjs/common';
import type { Clip, ClipAsset } from '@postgear/db';
import type { PrivateStorage } from '@postgear/storage';
import { createClipDocument, HANDLE_MS } from '@postgear/video-engine';
import type { EntitlementResolver } from '../../entitlements/entitlement-resolver';
import type { UsageService } from '../../entitlements/usage.service';
import type { SchedulingService } from '../../scheduling/scheduling.service';
import type { ClipItemService } from '../clip/clip-item.service';
import { ClipJobsRepository } from '../jobs/clip-jobs.repository';
import { ClipJobsService } from '../jobs/clip-jobs.service';
import type { ClipLimitsGuard } from '../limits/clip-limits.guard';
import type { MediaServiceProbe } from '../status/media-service.probe';
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
import { ClipFacesService, FACES_URL_SECONDS } from './clip-faces.service';

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
const OTHER_ORG = 'seed-second-org';
const CLIP = '55555555-5555-4555-8555-555555555555';
const SECOND_CLIP = '55555555-5555-4555-8555-000000000002';
const FACES_KEY = `clips/${TEST_ORG}/${VIDEO}/faces-${'d'.repeat(32)}.json.gz`;
/** The clip plays 60 to 90 s: its stretch is that, widened by the handles. */
const STRETCH = { fromMs: 60_000 - HANDLE_MS, toMs: 90_000 + HANDLE_MS };

function clip(id: string, fromMs: number, toMs: number): Clip {
  return clipRow({
    id,
    videoId: VIDEO,
    document: createClipDocument({ videoId: VIDEO, fromMs, toMs, ratio: '9:16' }),
  });
}

function faceAsset(fromMs: number, toMs: number, id = '77777777-7777-4777-8777-777777777777') {
  return assetRow({
    id,
    organizationId: TEST_ORG,
    videoId: VIDEO,
    kind: 'FACE_TRACKS',
    key: FACES_KEY,
    meta: { fromMs, toMs, sampleFps: 5, found: 120, producer: 'simulation' },
  } as Partial<ClipAsset>);
}

function seed(extra: (tables: FakeTables) => void = () => undefined): FakeTables {
  const tables = emptyTables();
  tables.videos.push(videoRow({ status: 'READY', durationMs: 600_000 }));
  tables.clips.push(clip(CLIP, 60_000, 90_000), clip(SECOND_CLIP, 62_000, 88_000));
  extra(tables);
  return tables;
}

let idCount = 0;
function setup(options: { tables?: FakeTables; service?: 'ok' | 'off' } = {}) {
  const tables = options.tables ?? seed();
  mockDb = fakeClipDb(tables);
  const jobsRepository = new ClipJobsRepository();
  const scheduling = { startClipJob: jest.fn(async () => true) };
  const usage = { consume: jest.fn(), reverseAllFor: jest.fn(async () => 0) };
  const jobs = new ClipJobsService(
    jobsRepository,
    scheduling as unknown as SchedulingService,
    { get: jest.fn(async () => 'normal') } as unknown as EntitlementResolver,
    usage as unknown as UsageService,
    { deletePrefix: jest.fn() } as never,
  );
  jest.spyOn(jobs, 'newJobId').mockImplementation(() => {
    idCount += 1;
    return `88888888-8888-4888-8888-${String(idCount).padStart(12, '0')}`;
  });
  const items = {
    requireClip: jest.fn(async (orgId: string, clipId: string) => {
      const found = tables.clips.find((row) => row.id === clipId && row.organizationId === orgId);
      if (!found) throw new NotFoundException({ code: 'clip_not_found' });
      return found;
    }),
  };
  const storage = {
    signedUrl: jest.fn(async (key: string) => `http://localhost:3001/clips/files/${key}?sig=x`),
  };
  const service = new ClipFacesService(
    items as unknown as ClipItemService,
    new ClipVideosRepository(),
    jobs,
    jobsRepository,
    { assertEnabled: jest.fn(async () => undefined) } as unknown as ClipLimitsGuard,
    { state: jest.fn(async () => options.service ?? 'ok') } as unknown as MediaServiceProbe,
    storage as unknown as PrivateStorage,
  );
  return { service, tables, scheduling, storage, usage };
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

describe('ClipFacesService.ensure', () => {
  it('starts one free FACES job for the clip stretch, widened by the handles', async () => {
    const { service, tables, scheduling, usage } = setup();
    const outcome = await service.ensure(TEST_ORG, TEST_USER, CLIP);
    expect(outcome).toMatchObject({ status: 'running', joined: false });
    expect(tables.jobs).toHaveLength(1);
    expect(tables.jobs[0]).toMatchObject({ kind: 'FACES', videoId: VIDEO, clipId: CLIP });
    expect(tables.jobs[0]?.input).toEqual({ videoId: VIDEO, clipId: CLIP, ...STRETCH });
    expect(scheduling.startClipJob).toHaveBeenCalledTimes(1);
    expect(usage.consume).not.toHaveBeenCalled();
  });

  it('reuses a face file that covers the stretch: no job', async () => {
    const tables = seed((t) => t.assets.push(faceAsset(0, 120_000)));
    const { service, scheduling } = setup({ tables });
    expect(await service.ensure(TEST_ORG, TEST_USER, CLIP)).toEqual({
      status: 'ready',
      reused: true,
    });
    expect(tables.jobs).toHaveLength(0);
    expect(scheduling.startClipJob).not.toHaveBeenCalled();
  });

  it('a second clip of the same stretch joins the running job instead of starting another', async () => {
    const { service, tables, scheduling } = setup();
    await service.ensure(TEST_ORG, TEST_USER, CLIP);
    const second = await service.ensure(TEST_ORG, TEST_USER, SECOND_CLIP);
    expect(second).toMatchObject({ status: 'running', joined: true });
    expect(tables.jobs).toHaveLength(1);
    expect(scheduling.startClipJob).toHaveBeenCalledTimes(1);
  });

  it('a face file that covers only part of the stretch does not count', async () => {
    const tables = seed((t) => t.assets.push(faceAsset(70_000, 120_000)));
    const { service } = setup({ tables });
    expect((await service.ensure(TEST_ORG, TEST_USER, CLIP)).status).toBe('running');
  });

  it('answers 503 faces_off when the media service is off', async () => {
    const { service, tables } = setup({ service: 'off' });
    const refused = await refusal(service.ensure(TEST_ORG, TEST_USER, CLIP));
    expect(refused.status).toBe(503);
    expect(refused.body).toMatchObject({ code: 'faces_off' });
    expect(tables.jobs).toHaveLength(0);
  });

  it("another workspace's clip is a plain 404", async () => {
    const { service, tables } = setup();
    expect((await refusal(service.ensure(OTHER_ORG, TEST_USER, CLIP))).status).toBe(404);
    expect(tables.jobs).toHaveLength(0);
  });
});

describe('ClipFacesService.read', () => {
  it('answers a ten minute address and the meta of the covering file', async () => {
    const tables = seed((t) => t.assets.push(faceAsset(0, 120_000)));
    const { service, storage } = setup({ tables });
    const outcome = await service.read(TEST_ORG, CLIP);
    expect(outcome).toEqual({
      status: 'ready',
      url: expect.stringContaining(FACES_KEY),
      meta: { fromMs: 0, toMs: 120_000, sampleFps: 5, found: 120, producer: 'simulation' },
    });
    expect(storage.signedUrl).toHaveBeenCalledWith(FACES_KEY, {
      expiresInSeconds: FACES_URL_SECONDS,
    });
  });

  it('answers running while a covering job is open, and none otherwise', async () => {
    const { service, tables } = setup();
    expect(await service.read(TEST_ORG, CLIP)).toEqual({ status: 'none' });
    tables.jobs.push(
      jobRow({
        kind: 'FACES',
        status: 'RUNNING',
        videoId: VIDEO,
        clipId: CLIP,
        input: { videoId: VIDEO, clipId: CLIP, fromMs: 0, toMs: 200_000 },
      }),
    );
    expect((await service.read(TEST_ORG, CLIP)).status).toBe('running');
  });

  it("never signs another workspace's file", async () => {
    const tables = seed((t) => t.assets.push(faceAsset(0, 120_000)));
    const { service, storage } = setup({ tables });
    expect((await refusal(service.read(OTHER_ORG, CLIP))).status).toBe(404);
    expect(storage.signedUrl).not.toHaveBeenCalled();
  });
});
