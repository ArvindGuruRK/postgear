import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { DownloaderError, gunzipSignalsFile, ProbeError } from '@postgear/media-tools';
import type { PrivateStorage } from '@postgear/storage';
import type { ImportInput } from '@postgear/video-engine';
import { ClipStepError } from '../failures';
import { allImportKeys, importKeys } from '../keys';
import {
  FakePrivateStorage,
  FakeRows,
  fakeDownloader,
  fakeImportTools,
  fakeProgress,
  JOB_ID,
  jobRow,
  ORG,
  sampleFacts,
  VIDEO_ID,
  videoRow,
} from '../testing/fakes';
import { type ImportRun, proxyHeightFor, runImport } from './import.steps';

jest.mock('@postgear/db', () => ({ prisma: {} }));

const LIMITS = { maxVideoMs: 4 * 60 * 60_000, storageBytes: 10_000_000, retentionDays: 30 };
const ORIGINAL_KEY = `clips/${ORG}/${VIDEO_ID}/original-0123456789abcdef0123456789abcdef.mov`;

const linkInput: ImportInput = {
  videoId: VIDEO_ID,
  origin: {
    type: 'link',
    link: {
      platform: 'youtube',
      kind: 'video',
      externalId: 'simtalk0001',
      canonicalUrl: 'https://www.youtube.com/watch?v=simtalk0001',
    },
  },
  limits: LIMITS,
  expectedBytes: null,
};

const uploadInput: ImportInput = {
  videoId: VIDEO_ID,
  origin: { type: 'upload', originalKey: ORIGINAL_KEY },
  limits: LIMITS,
  expectedBytes: null,
};

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'clip-import-test-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function setup(
  input: ImportInput,
  options: { probeError?: Error; facts?: ReturnType<typeof sampleFacts>; fetchError?: Error } = {},
) {
  const rows = new FakeRows();
  rows.jobs.set(JOB_ID, jobRow({ input }));
  rows.videos.set(VIDEO_ID, videoRow());
  const storage = new FakePrivateStorage();
  const { tools, calls } = fakeImportTools({
    facts: options.facts,
    probeError: options.probeError,
  });
  const downloader = fakeDownloader({ fail: options.fetchError });
  const { progress, reports } = fakeProgress();
  const controller = new AbortController();
  const chargeImport = jest.fn(async () => ({ charged: true as const, units: 3_000 }));
  const run: ImportRun = {
    jobId: JOB_ID,
    organizationId: ORG,
    input,
    video: videoRow(),
    dir,
    signal: controller.signal,
    tools,
    downloader,
    privateStorage: storage as unknown as PrivateStorage,
    internal: { chargeImport },
    rows,
    progress,
    heartbeat: () => undefined,
    now: () => new Date('2026-11-18T12:00:00Z'),
  };
  return { run, rows, storage, calls, downloader, reports, controller, chargeImport };
}

describe('proxyHeightFor', () => {
  it('is 720 up to two hours (and when unknown), 480 above', () => {
    expect(proxyHeightFor(2 * 60 * 60_000)).toBe(720);
    expect(proxyHeightFor(2 * 60 * 60_000 + 1)).toBe(480);
    expect(proxyHeightFor(null)).toBe(720);
  });
});

describe('runImport', () => {
  it('a link: fetch, inspect, normalise, derive, store, then one finishing transaction', async () => {
    const { run, rows, storage, calls, downloader, reports } = setup(linkInput);

    const outcome = await runImport(run);

    expect(outcome).toEqual({ stored: true, assets: 5, durationMs: 180_000 });
    expect(calls).toEqual(['free-disk', 'probe', 'normalise', 'derive', 'waveform', 'poster']);
    expect(downloader.proxyCalls[0]).toMatchObject({
      maxHeight: 720,
      maxDurationMs: LIMITS.maxVideoMs,
    });

    expect([...storage.objects.keys()].sort()).toEqual(
      rows.assets.map((asset) => asset.key).sort(),
    );
    expect(rows.assets.map((asset) => asset.kind).sort()).toEqual(
      ['ANALYSIS_AUDIO', 'FILMSTRIP', 'POSTER', 'PROXY', 'WAVEFORM'].sort(),
    );
    // The waveform is stored as JSON the web can read directly.
    const waveform = rows.assets.find((asset) => asset.kind === 'WAVEFORM');
    expect(storage.objects.get(waveform?.key ?? '')?.toString()).toBe('[1,2,3]');
    expect(rows.assets.find((asset) => asset.kind === 'FILMSTRIP')?.meta).toMatchObject({
      sheet: 0,
      sheets: 1,
    });

    expect(rows.jobs.get(JOB_ID)?.status).toBe('DONE');
    expect(rows.videos.get(VIDEO_ID)?.status).toBe('READY');
    expect(rows.notifications).toEqual([
      expect.objectContaining({
        type: 'clip_video_ready',
        title: 'Your video is ready',
        content: 'Sample Talk',
      }),
    ]);
    expect(rows.facts).toEqual([
      expect.objectContaining({ durationMs: 180_000, width: 1920, height: 1080 }),
    ]);

    // Stages in order, numbers within their spans and never backwards within a stage.
    const fetching = reports.filter((r) => r.stage === 'fetching').map((r) => r.progress);
    const preparing = reports.filter((r) => r.stage === 'preparing').map((r) => r.progress);
    expect(reports.findIndex((r) => r.stage === 'preparing')).toBeGreaterThan(
      reports.map((r) => r.stage).lastIndexOf('fetching'),
    );
    expect(Math.max(...fetching)).toBeLessThanOrEqual(70);
    expect(Math.min(...preparing)).toBeGreaterThanOrEqual(72);
    expect(preparing).toEqual([...preparing].sort((a, b) => a - b));
  });

  it('a YouTube heat map from the probe is stored as the first signals file of the video', async () => {
    const { run, rows, storage } = setup({
      ...linkInput,
      replayed: [
        { startMs: 0, endMs: 60_000, value: 0.1 },
        { startMs: 60_000, endMs: 120_000, value: 1 },
        { startMs: 120_000, endMs: 180_000, value: 0.2 },
      ],
    });

    const outcome = await runImport(run);
    expect(outcome.assets).toBe(6);
    const signals = rows.assets.find((asset) => asset.kind === 'SIGNALS');
    expect(signals?.key).toBe(importKeys.signals(ORG, VIDEO_ID, JOB_ID));
    expect(signals?.meta).toEqual({
      durationMs: 180_000,
      tracks: [{ name: 'replayed', version: 1 }],
    });
    const file = await gunzipSignalsFile(storage.objects.get(signals?.key ?? '') as Buffer);
    expect(file.tracks.map((track) => track.name)).toEqual(['replayed']);
    const values = file.tracks[0]?.values ?? [];
    expect(Math.max(...values.map((value) => value ?? 0))).toBe(1);
  });

  it('no heat map, no signals file', async () => {
    const { run, rows } = setup(linkInput);
    await runImport(run);
    expect(rows.assets.some((asset) => asset.kind === 'SIGNALS')).toBe(false);
  });

  it('an upload: reads the ORIGINAL, charges its minutes once the length is known', async () => {
    const { run, storage, chargeImport, rows } = setup(uploadInput);
    storage.objects.set(ORIGINAL_KEY, Buffer.alloc(5_000, 7));
    rows.assets.push({
      id: 'orig',
      kind: 'ORIGINAL',
      key: ORIGINAL_KEY,
      bytes: 5_000,
      videoId: VIDEO_ID,
      clipId: null,
      meta: null,
      createdAt: new Date(),
    });

    const outcome = await runImport(run);

    expect(outcome.stored).toBe(true);
    expect(chargeImport).toHaveBeenCalledWith(JOB_ID, { organizationId: ORG, durationMs: 180_000 });
    expect(storage.objects.has(ORIGINAL_KEY)).toBe(true);
  });

  it('an upload refused by the minutes meter fails with its code and stores nothing', async () => {
    const { run, storage, chargeImport, calls } = setup(uploadInput);
    storage.objects.set(ORIGINAL_KEY, Buffer.alloc(10, 7));
    chargeImport.mockRejectedValueOnce(
      new ClipStepError('clips_minutes_used', { retryable: false }),
    );

    await expect(runImport(run)).rejects.toMatchObject({ code: 'clips_minutes_used' });
    expect(calls).not.toContain('normalise');
    expect([...storage.objects.keys()]).toEqual([ORIGINAL_KEY]);
  });

  it('refuses a video longer than the plan allows before any FFmpeg work', async () => {
    const { run, calls, storage } = setup(linkInput, {
      facts: sampleFacts({ durationMs: LIMITS.maxVideoMs + 1 }),
    });
    await expect(runImport(run)).rejects.toMatchObject({ code: 'clips_video_too_long' });
    expect(calls).toEqual(['free-disk', 'probe']);
    expect(storage.objects.size).toBe(0);
  });

  it('an uploaded file ffprobe cannot read is upload_not_video; a fetched one is our fault', async () => {
    const upload = setup(uploadInput, { probeError: new ProbeError('upload_not_video') });
    upload.storage.objects.set(ORIGINAL_KEY, Buffer.from('not a video'));
    await expect(runImport(upload.run)).rejects.toBeInstanceOf(ProbeError);

    const link = setup(linkInput, { probeError: new ProbeError('upload_not_video') });
    await expect(runImport(link.run)).rejects.toMatchObject({
      code: 'tool_failed',
      retryable: true,
    });
  });

  it('a fetch past the space left is clips_storage_full', async () => {
    const { run } = setup(linkInput, { fetchError: new DownloaderError('too_big') });
    await expect(runImport(run)).rejects.toMatchObject({ code: 'clips_storage_full' });
  });

  it('rechecks the space before storing: the loser of a race stores nothing', async () => {
    const { run, rows, storage, calls } = setup(linkInput);
    // Room for the download, but another import filled the space meanwhile.
    const original = rows.storageUsedBytes.bind(rows);
    let call = 0;
    rows.storageUsedBytes = async () => (++call === 1 ? original() : LIMITS.storageBytes - 10);

    await expect(runImport(run)).rejects.toMatchObject({ code: 'clips_storage_full' });
    expect(calls).toContain('poster');
    expect(storage.objects.size).toBe(0);
    expect(rows.jobs.get(JOB_ID)?.status).toBe('RUNNING');
  });

  it('a storage failure halfway deletes what this attempt stored', async () => {
    const { run, storage, rows } = setup(linkInput);
    storage.failPutAt = 3;

    await expect(runImport(run)).rejects.toThrow('storage unavailable');
    expect(storage.objects.size).toBe(0);
    expect(storage.deleted).toHaveLength(2);
    expect(rows.assets).toHaveLength(0);
    expect(rows.notifications).toHaveLength(0);
  });

  it('a cancel while storing stops, and leaves nothing behind', async () => {
    const { run, storage, controller, rows } = setup(linkInput);
    storage.onPut = () => controller.abort();

    await expect(runImport(run)).rejects.toMatchObject({ code: 'cancelled' });
    expect(storage.objects.size).toBe(0);
    expect(rows.jobs.get(JOB_ID)?.status).toBe('RUNNING');
  });

  it('a job closed meanwhile keeps nothing and answers stored false', async () => {
    const { run, storage, rows } = setup(linkInput);
    storage.onPut = () => {
      const job = rows.jobs.get(JOB_ID);
      if (job) job.status = 'CANCELLED';
    };

    const outcome = await runImport(run);
    expect(outcome.stored).toBe(false);
    expect(storage.objects.size).toBe(0);
    expect(rows.notifications).toHaveLength(0);
  });

  it('a silent video gets an empty waveform and no analysis sound', async () => {
    const { run, rows, calls } = setup(linkInput, { facts: sampleFacts({ hasAudio: false }) });
    await runImport(run);
    expect(calls).toContain('empty-waveform');
    expect(rows.assets.map((asset) => asset.kind)).not.toContain('ANALYSIS_AUDIO');
    expect(rows.assets.find((asset) => asset.kind === 'WAVEFORM')?.meta).toEqual({
      perSecond: 20,
      count: 0,
    });
  });

  it('stores only under keys the failure bookkeeping knows how to find', async () => {
    const { run, storage } = setup(linkInput);
    await runImport(run);
    const known = new Set(allImportKeys(ORG, VIDEO_ID, JOB_ID));
    for (const key of storage.objects.keys()) expect(known.has(key)).toBe(true);
  });
});
