/**
 * The Node half of a faces job (Sprint 13, Module 07), against the fake rows
 * and storage: the Python input, the file kept as the video's FACE_TRACKS
 * asset with the job's DONE, a stretch with no face, and what a closed job,
 * a wrong key or a file carrying more than boxes leaves behind (nothing).
 */
import { mkdtemp, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { gzipSync } from 'node:zlib';
import type { MediaPyDetectFacesOutput } from '@postgear/media-contract';
import { readFaceTracksAssetMeta } from '@postgear/video-engine';
import { ClipStepError } from '../failures';
import { facesFileKey } from '../keys';
import {
  FakePrivateStorage,
  FakeRows,
  fakeProgress,
  JOB_ID,
  jobRow,
  ORG,
  VIDEO_ID,
  videoRow,
} from '../testing/fakes';
import { FACES_FAIL_MARKER, type FacesRun, finishFaces, prepareFaces } from './faces.run';

const PROXY_KEY = `clips/${ORG}/${VIDEO_ID}/proxy-${'b'.repeat(32)}.mp4`;
const NOW = new Date('2026-11-26T10:00:00Z');
const KEY = facesFileKey(ORG, VIDEO_ID, JOB_ID);

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'pg-faces-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function setup(title = 'A Ten Minute Stream') {
  const rows = new FakeRows();
  const storage = new FakePrivateStorage();
  rows.videos.set(VIDEO_ID, videoRow({ status: 'READY', title }));
  rows.links.set(VIDEO_ID, {
    platform: 'twitch',
    kind: 'past_stream',
    externalId: '900000001',
    width: 1280,
    height: 720,
  });
  rows.assets.push({
    id: 'proxy-1',
    kind: 'PROXY',
    key: PROXY_KEY,
    bytes: 10,
    videoId: VIDEO_ID,
    clipId: null,
    meta: {},
    createdAt: NOW,
  });
  const input = { videoId: VIDEO_ID, clipId: null, fromMs: 55_000, toMs: 127_000 };
  rows.jobs.set(JOB_ID, jobRow({ kind: 'FACES', videoId: VIDEO_ID, input }));
  const run: FacesRun = {
    jobId: JOB_ID,
    organizationId: ORG,
    input,
    rows,
    privateStorage: storage as unknown as FacesRun['privateStorage'],
    progress: fakeProgress().progress,
    simulated: true,
    now: () => NOW,
  };
  return { rows, storage, run };
}

function putFile(storage: FakePrivateStorage, body: unknown, found = 2): MediaPyDetectFacesOutput {
  storage.objects.set(KEY, gzipSync(Buffer.from(JSON.stringify(body))));
  return { facesKey: KEY, sampled: 2, found, producer: 'simulation' };
}

const corner = { x: 0.875, y: 0.782, w: 0.06, h: 0.106, score: 0.9 };
const FILE = {
  version: 1,
  sampleFps: 5,
  frames: [
    { t: 55_000, boxes: [corner] },
    { t: 55_200, boxes: [corner] },
  ],
};

describe('prepareFaces', () => {
  it('builds the Python input from the light copy, the stretch and the sample', async () => {
    const { run } = setup();
    const payload = await prepareFaces(run);
    expect(payload).toEqual({
      version: 1,
      jobId: JOB_ID,
      orgId: ORG,
      videoId: VIDEO_ID,
      proxyKey: PROXY_KEY,
      durationMs: expect.any(Number),
      ranges: [{ fromMs: 55_000, toMs: 127_000 }],
      sampleFps: 5,
      maxWidth: 640,
      simulation: { sample: 'stream', force: null },
    });
  });

  it('reads the forcing switch from the title, and sends no hint for a real run', async () => {
    const forced = setup(`A Stream ${FACES_FAIL_MARKER}`);
    expect((await prepareFaces(forced.run)).simulation?.force).toBe('fail');
    const real = setup();
    expect((await prepareFaces({ ...real.run, simulated: false })).simulation).toBeNull();
  });

  it('a video with no light copy fails for good', async () => {
    const { rows, run } = setup();
    rows.assets = rows.assets.filter((row) => row.kind !== 'PROXY');
    await expect(prepareFaces(run)).rejects.toMatchObject({ code: 'faces_failed' });
  });
});

describe('finishFaces', () => {
  it('keeps the file where it is as the video FACE_TRACKS asset, with the job DONE', async () => {
    const { rows, storage, run } = setup();
    expect(await finishFaces(run, putFile(storage, FILE), dir)).toBe(true);
    const asset = rows.assets.find((row) => row.kind === 'FACE_TRACKS');
    expect(asset).toMatchObject({ id: JOB_ID, key: KEY, videoId: VIDEO_ID, clipId: null });
    expect(readFaceTracksAssetMeta(asset?.meta)).toEqual({
      fromMs: 55_000,
      toMs: 127_000,
      sampleFps: 5,
      found: 2,
      producer: 'simulation',
    });
    expect(rows.jobs.get(JOB_ID)?.status).toBe('DONE');
    expect(rows.faced.get(JOB_ID)).toEqual({ assetId: JOB_ID, found: 2, sampled: 2 });
    expect(storage.deleted).toEqual([]);
  });

  it('a stretch with no face is DONE with found 0, and the file is kept for the next press', async () => {
    const { rows, storage, run } = setup();
    const empty = { ...FILE, frames: FILE.frames.map((f) => ({ ...f, boxes: [] })) };
    expect(await finishFaces(run, putFile(storage, empty, 0), dir)).toBe(true);
    expect(rows.faced.get(JOB_ID)).toEqual({ assetId: JOB_ID, found: 0, sampled: 2 });
    expect(rows.assets.some((row) => row.kind === 'FACE_TRACKS')).toBe(true);
  });

  it('refuses a key it did not make', async () => {
    const { storage, run } = setup();
    const answer = putFile(storage, FILE);
    const other = KEY.replace(/[0-9a-f]{32}/, 'c'.repeat(32));
    await expect(finishFaces(run, { ...answer, facesKey: other }, dir)).rejects.toBeInstanceOf(
      ClipStepError,
    );
  });

  it('a file carrying more than boxes and times is refused and removed', async () => {
    const { rows, storage, run } = setup();
    const landmarks = {
      ...FILE,
      frames: [{ t: 55_000, boxes: [{ ...corner, keypoints: [[0.9, 0.8]] }] }],
    };
    await expect(finishFaces(run, putFile(storage, landmarks), dir)).rejects.toMatchObject({
      code: 'faces_failed',
    });
    expect(storage.deleted).toEqual([KEY]);
    expect(rows.assets.some((row) => row.kind === 'FACE_TRACKS')).toBe(false);
  });

  it('a job closed meanwhile keeps nothing', async () => {
    const { rows, storage, run } = setup();
    const job = rows.jobs.get(JOB_ID);
    if (job) job.status = 'CANCELLED';
    expect(await finishFaces(run, putFile(storage, FILE), dir)).toBe(false);
    expect(storage.deleted).toEqual([KEY]);
    expect(rows.assets.some((row) => row.kind === 'FACE_TRACKS')).toBe(false);
  });
});
