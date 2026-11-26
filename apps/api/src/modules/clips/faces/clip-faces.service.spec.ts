/**
 * Faces in a clip's stretch (Sprint 13, Module 07) against an in-memory
 * database: a covering face file is reused with no job, a covering job is
 * joined, otherwise one free FACES job starts; the read answers a short
 * address; tenancy; the service off; and no charge anywhere. Module 08: the
 * ready read carries the scene cuts and the speech stretches of the face
 * file's range (ranges only), and answers empty ones when it cannot read them.
 */
import { Readable } from 'node:stream';
import { gzipSync } from 'node:zlib';
import { HttpException, NotFoundException } from '@nestjs/common';
import type { Clip, ClipAsset } from '@postgear/db';
import type { PrivateStorage } from '@postgear/storage';
import {
  createClipDocument,
  encodeSignalsFile,
  HANDLE_MS,
  SIGNALS_FILE_FORMAT,
  type Transcript,
} from '@postgear/video-engine';
import type { EntitlementResolver } from '../../entitlements/entitlement-resolver';
import type { UsageService } from '../../entitlements/usage.service';
import type { SchedulingService } from '../../scheduling/scheduling.service';
import type { ClipItemService } from '../clip/clip-item.service';
import { ClipJobsRepository } from '../jobs/clip-jobs.repository';
import { ClipJobsService } from '../jobs/clip-jobs.service';
import type { ClipLimitsGuard } from '../limits/clip-limits.guard';
import type { MediaServiceProbe } from '../status/media-service.probe';
import type { ClipTranscriptStore } from '../transcripts/clip-transcript-store';
import type { ClipTranscriptsService } from '../transcripts/clip-transcripts.service';
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
import { facesReadQuerySchema } from './clip-faces.controller';
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

const SIGNALS_KEY = `clips/${TEST_ORG}/${VIDEO}/signals-${'e'.repeat(32)}.json.gz`;
const TRANSCRIPT_KEY = `clips/${TEST_ORG}/${VIDEO}/transcript-${'f'.repeat(32)}.json.gz`;

/** A scene track (two a second over the 600 s video) with cuts at 10 s, 70 s (held a second) and 80 s. */
function signalsBytes(durationMs = 600_000): Buffer {
  const values: Array<number | null> = new Array(1200).fill(0);
  values[20] = 30;
  values[140] = 45;
  values[141] = 45;
  values[160] = 12;
  return gzipSync(
    Buffer.from(
      encodeSignalsFile({
        format: SIGNALS_FILE_FORMAT,
        durationMs,
        tracks: [
          { name: 'scene', version: 1, sampleRateHz: 2, startSec: 0, unit: 'scene_score', values },
        ],
      }),
      'utf8',
    ),
  );
}

function signalsAsset() {
  return assetRow({
    id: '99999999-9999-4999-8999-999999999999',
    organizationId: TEST_ORG,
    videoId: VIDEO,
    kind: 'SIGNALS',
    key: SIGNALS_KEY,
    meta: { durationMs: 600_000, tracks: [{ name: 'scene', version: 1 }] },
  } as Partial<ClipAsset>);
}

function heard(covered = [{ fromMs: 0, toMs: 600_000 }]): Transcript {
  const word = (i: number, start: number, end: number) => ({
    i,
    start,
    end,
    text: 'secret',
    sure: 0.9,
  });
  return {
    version: 1,
    language: 'en',
    model: 'simulated',
    source: 'listened',
    covered,
    words: [word(0, 61_000, 61_500), word(1, 61_700, 62_000), word(2, 75_000, 76_000)],
    nextIndex: 3,
  } as unknown as Transcript;
}

let idCount = 0;
function setup(
  options: {
    tables?: FakeTables;
    service?: 'ok' | 'off';
    transcript?: Transcript | null;
    source?: 'listened' | 'supplied';
    signals?: Buffer | null;
  } = {},
) {
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
    getStream: jest.fn(async (key: string) => {
      const bytes = key === SIGNALS_KEY ? (options.signals ?? null) : null;
      return bytes ? { body: Readable.from([bytes]), totalBytes: bytes.length } : null;
    }),
  };
  const transcript = options.transcript ?? null;
  const transcripts = {
    transcriptRow: jest.fn(async (orgId: string) =>
      transcript && orgId === TEST_ORG
        ? {
            id: 'tr-1',
            key: TRANSCRIPT_KEY,
            meta: { source: options.source ?? 'listened', fixes: [] },
          }
        : null,
    ),
  };
  const transcriptStore = {
    read: jest.fn(async (key: string) => (key === TRANSCRIPT_KEY ? transcript : null)),
  };
  const service = new ClipFacesService(
    items as unknown as ClipItemService,
    new ClipVideosRepository(),
    jobs,
    jobsRepository,
    { assertEnabled: jest.fn(async () => undefined) } as unknown as ClipLimitsGuard,
    { state: jest.fn(async () => options.service ?? 'ok') } as unknown as MediaServiceProbe,
    storage as unknown as PrivateStorage,
    transcripts as unknown as ClipTranscriptsService,
    transcriptStore as unknown as ClipTranscriptStore,
  );
  return { service, tables, scheduling, storage, usage, transcripts };
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
      assetId: '77777777-7777-4777-8777-777777777777',
      url: expect.stringContaining(FACES_KEY),
      meta: { fromMs: 0, toMs: 120_000, sampleFps: 5, found: 120, producer: 'simulation' },
      // No SIGNALS file and no transcript: no cuts, and speech never listened to.
      sceneCutsMs: [],
      speech: null,
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

  it('Module 08: the scene cuts and the speech stretches inside the face file range', async () => {
    const tables = seed((t) => t.assets.push(faceAsset(30_000, 120_000), signalsAsset()));
    const { service, transcripts } = setup({
      tables,
      signals: signalsBytes(),
      transcript: heard(),
    });
    const outcome = await service.read(TEST_ORG, CLIP, { follow: true });
    expect(outcome).toMatchObject({
      status: 'ready',
      // 10 s is before the range; the cut held over two samples is one cut.
      sceneCutsMs: [70_000, 80_000],
      // 200 ms apart: one stretch; ranges only.
      speech: [
        { from: 61_000, to: 62_000 },
        { from: 75_000, to: 76_000 },
      ],
    });
    expect(JSON.stringify(outcome)).not.toContain('secret');
    // The video's own spoken transcript, never a translation.
    expect(transcripts.transcriptRow).toHaveBeenCalledWith(TEST_ORG, VIDEO, 'auto');
  });

  it('Module 08: speech is null where the range was never listened to, [] where nobody spoke', async () => {
    const tables = seed((t) => t.assets.push(faceAsset(30_000, 120_000)));
    const elsewhere = setup({ tables, transcript: heard([{ fromMs: 0, toMs: 30_000 }]) });
    expect(await elsewhere.service.read(TEST_ORG, CLIP, { follow: true })).toMatchObject({
      speech: null,
    });
    const quiet = setup({
      tables,
      transcript: { ...heard(), words: [] } as Transcript,
    });
    expect(await quiet.service.read(TEST_ORG, CLIP, { follow: true })).toMatchObject({
      speech: [],
    });
    // A file the person supplied covers the whole range, as it does for the words.
    const supplied = setup({
      tables,
      source: 'supplied',
      transcript: heard([]),
    });
    expect(
      (await supplied.service.read(TEST_ORG, CLIP, { follow: true })) as { speech: unknown },
    ).toMatchObject({
      speech: [
        { from: 61_000, to: 62_000 },
        { from: 75_000, to: 76_000 },
      ],
    });
  });

  it('Module 08: a SIGNALS file that does not read, or of another length, gives no cuts', async () => {
    const tables = seed((t) => t.assets.push(faceAsset(30_000, 120_000), signalsAsset()));
    const broken = setup({ tables, signals: Buffer.from('not gzip') });
    expect(await broken.service.read(TEST_ORG, CLIP, { follow: true })).toMatchObject({
      status: 'ready',
      sceneCutsMs: [],
    });
    const stale = setup({ tables, signals: signalsBytes(300_000) });
    expect(await stale.service.read(TEST_ORG, CLIP, { follow: true })).toMatchObject({
      sceneCutsMs: [],
    });
  });

  it('Module 08: without follow (Detect Camera) reads neither the SIGNALS file nor the transcript', async () => {
    const tables = seed((t) => t.assets.push(faceAsset(30_000, 120_000), signalsAsset()));
    const { service, transcripts, storage } = setup({
      tables,
      signals: signalsBytes(),
      transcript: heard(),
    });
    expect(await service.read(TEST_ORG, CLIP)).toMatchObject({
      status: 'ready',
      sceneCutsMs: [],
      speech: null,
    });
    expect(transcripts.transcriptRow).not.toHaveBeenCalled();
    // The SIGNALS file is never fetched.
    expect(storage.getStream).not.toHaveBeenCalled();
  });

  it('Module 08: the query takes follow=1 or 0 and nothing else', () => {
    expect(facesReadQuerySchema.parse({ follow: '1' })).toEqual({ follow: '1' });
    expect(facesReadQuerySchema.parse({})).toEqual({});
    expect(facesReadQuerySchema.safeParse({ follow: 'yes' }).success).toBe(false);
    expect(facesReadQuerySchema.safeParse({ other: '1' }).success).toBe(false);
  });

  it("never signs another workspace's file", async () => {
    const tables = seed((t) => t.assets.push(faceAsset(0, 120_000)));
    const { service, storage } = setup({ tables });
    expect((await refusal(service.read(OTHER_ORG, CLIP))).status).toBe(404);
    expect(storage.signedUrl).not.toHaveBeenCalled();
  });
});
