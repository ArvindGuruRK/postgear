/**
 * Download in any format (Module 18) against fakes: a downloader that writes
 * a small file, tools that stand in for ffprobe and the MP3 conversion, the
 * in-memory rows and private space. Pinned: the video and audio paths store
 * one file with the right name and expiry; a failure keeps nothing and gives
 * both charges back once, with the platform's reason or our one sentence; a
 * cancel does the same; Save To Media copies, posters and finishes, and a
 * failure gives the button back.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { DownloaderError } from '@postgear/media-tools';
import { CLIP_SHORT_LIVED_MS } from '@postgear/scheduling';
import { type DownloadInput, downloadOutputSchema } from '@postgear/video-engine';
import { cancelJob, failJob, type OutcomeDeps } from '../job-outcomes';
import { exportMediaKeys } from '../keys';
import {
  FakePrivateStorage,
  FakeRows,
  fakeDownloader,
  fakeProgress,
  JOB_ID,
  jobRow,
  ORG,
  sampleFacts,
} from '../testing/fakes';
import { type DownloadTools, downloadFailureCode, runDownload } from './download.run';
import { runSaveDownload, saveDownloadFailed } from './save-download.run';

const NOW = new Date('2026-11-19T10:00:00Z');

function input(overrides: Partial<DownloadInput> = {}): DownloadInput {
  return {
    link: {
      platform: 'youtube',
      kind: 'video',
      externalId: 'simtalk0001',
      canonicalUrl: 'https://www.youtube.com/watch?v=simtalk0001',
    },
    formatId: 'h720',
    label: '720p',
    audioOnly: false,
    title: 'A Talk: "On Plans" / 2027',
    durationMs: 180_000,
    expectedBytes: null,
    maxBytes: 5_000_000,
    rights: { byUserId: 'user-1', at: '2026-11-19T09:59:00.000Z', textVersion: '1' },
    ...overrides,
  };
}

function tools(options: { codec?: string } = {}) {
  const calls: string[] = [];
  const downloadTools: DownloadTools = {
    async probeVideo() {
      calls.push('probe-video');
      return sampleFacts({ width: 1280, height: 720, fps: 30, durationMs: 180_000 });
    },
    async probeSound() {
      calls.push('probe-sound');
      return {
        format: 'mp3',
        codec: options.codec ?? 'mp3',
        durationMs: 179_990,
        sampleRate: 44_100,
        channels: 2,
      };
    },
    async toMp3(opts) {
      calls.push('mp3');
      opts.onProgress(50);
      await writeFile(opts.output, Buffer.alloc(1_500, 3));
    },
  };
  return { downloadTools, calls };
}

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'clip-download-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function setup(
  jobInput: DownloadInput,
  downloaderOptions: Parameters<typeof fakeDownloader>[0] = {},
) {
  const rows = new FakeRows();
  const job = jobRow({ kind: 'DOWNLOAD', videoId: null, input: jobInput });
  rows.jobs.set(job.id, job);
  const privateStorage = new FakePrivateStorage();
  const downloader = fakeDownloader(downloaderOptions);
  const { progress, reports } = fakeProgress();
  return { rows, job, privateStorage, downloader, progress, reports };
}

describe('runDownload', () => {
  it('stores an MP4 named after the video, kept 24 hours, as a DOWNLOAD asset of no video', async () => {
    const { rows, job, privateStorage, downloader, progress, reports } = setup(input());
    const { downloadTools, calls } = tools();
    const outcome = await runDownload({
      job,
      input: input(),
      dir,
      signal: new AbortController().signal,
      downloader,
      tools: downloadTools,
      privateStorage,
      rows,
      progress,
      heartbeat: () => undefined,
      now: () => NOW,
    });

    expect(outcome).toEqual({ finished: true });
    expect(downloader.formatCalls).toEqual([
      expect.objectContaining({ formatId: 'h720', maxBytes: 5_000_000 }),
    ]);
    expect(calls).toEqual(['probe-video']);
    const key = `clips/${ORG}/downloads/${JOB_ID}/file.mp4`;
    expect([...privateStorage.objects.keys()]).toEqual([key]);
    expect(rows.jobs.get(JOB_ID)?.status).toBe('DONE');

    const saved = rows.downloads.get(JOB_ID);
    expect(saved?.expiresAt).toEqual(new Date(NOW.getTime() + CLIP_SHORT_LIVED_MS));
    const output = downloadOutputSchema.parse(saved?.output);
    expect(output).toEqual({
      assetId: JOB_ID,
      key,
      bytes: 3_000,
      ext: 'mp4',
      fileName: 'A Talk On Plans 2027.mp4',
      durationMs: 180_000,
      width: 1280,
      height: 720,
      fps: 30,
    });
    expect(rows.assets).toEqual([
      expect.objectContaining({ id: JOB_ID, kind: 'DOWNLOAD', key, videoId: null, bytes: 3_000 }),
    ]);
    // 50% of the fetch is 42.5% of the bar; the finish reaches 95 before DONE.
    expect(reports.map((report) => report.progress)).toEqual([0, 43, 85, 95]);
  });

  it('turns Audio Only into an MP3 that reads as MP3', async () => {
    const audio = input({ formatId: 'audio', label: 'Audio Only', audioOnly: true });
    const { rows, job, privateStorage, downloader, progress } = setup(audio);
    const { downloadTools, calls } = tools();
    await runDownload({
      job,
      input: audio,
      dir,
      signal: new AbortController().signal,
      downloader,
      tools: downloadTools,
      privateStorage,
      rows,
      progress,
      heartbeat: () => undefined,
      now: () => NOW,
    });

    expect((downloader.formatCalls[0] as { outFile: string }).outFile).toMatch(/fetched\.m4a$/);
    expect(calls).toEqual(['mp3', 'probe-sound']);
    expect([...privateStorage.objects.keys()]).toEqual([
      `clips/${ORG}/downloads/${JOB_ID}/file.mp3`,
    ]);
    const output = downloadOutputSchema.parse(rows.downloads.get(JOB_ID)?.output);
    expect(output).toMatchObject({
      ext: 'mp3',
      bytes: 1_500,
      fileName: 'A Talk On Plans 2027.mp3',
      width: null,
      height: null,
      fps: null,
      durationMs: 179_990,
    });
  });

  it('refuses a conversion that does not read as MP3, and stores nothing', async () => {
    const audio = input({ formatId: 'audio', label: 'Audio Only', audioOnly: true });
    const { rows, job, privateStorage, downloader, progress } = setup(audio);
    await expect(
      runDownload({
        job,
        input: audio,
        dir,
        signal: new AbortController().signal,
        downloader,
        tools: tools({ codec: 'aac' }).downloadTools,
        privateStorage,
        rows,
        progress,
        heartbeat: () => undefined,
        now: () => NOW,
      }),
    ).rejects.toMatchObject({ code: 'download_failed', retryable: false });
    expect(privateStorage.objects.size).toBe(0);
    expect(rows.jobs.get(JOB_ID)?.status).toBe('RUNNING');
  });

  it('names a fetch past the space left as too big, never retried', async () => {
    const { rows, job, privateStorage, progress } = setup(input());
    await expect(
      runDownload({
        job,
        input: input(),
        dir,
        signal: new AbortController().signal,
        downloader: fakeDownloader({ fail: new DownloaderError('too_big') }),
        tools: tools().downloadTools,
        privateStorage,
        rows,
        progress,
        heartbeat: () => undefined,
        now: () => NOW,
      }),
    ).rejects.toMatchObject({ code: 'download_too_big', retryable: false });
  });

  it('removes the stored file when the job was closed meanwhile', async () => {
    const { rows, job, privateStorage, downloader, progress } = setup(input());
    privateStorage.onPut = () => {
      const row = rows.jobs.get(JOB_ID);
      if (row) row.status = 'CANCELLED';
    };
    const outcome = await runDownload({
      job,
      input: input(),
      dir,
      signal: new AbortController().signal,
      downloader,
      tools: tools().downloadTools,
      privateStorage,
      rows,
      progress,
      heartbeat: () => undefined,
      now: () => NOW,
    });
    expect(outcome).toEqual({ finished: false });
    expect(privateStorage.objects.size).toBe(0);
    expect(rows.assets).toHaveLength(0);
  });
});

describe('a download that ends badly', () => {
  function outcomeSetup() {
    const rows = new FakeRows();
    rows.jobs.set(JOB_ID, jobRow({ kind: 'DOWNLOAD', videoId: null, input: input() }));
    const privateStorage = new FakePrivateStorage();
    privateStorage.objects.set(`clips/${ORG}/downloads/${JOB_ID}/file.mp4`, Buffer.alloc(10));
    const reverseCharges = jest.fn(async () => ({ reversed: 2 }));
    const deps: OutcomeDeps = {
      rows,
      privateStorage,
      storage: { delete: async () => undefined },
      internal: { reverseCharges },
      now: () => NOW,
    };
    return { rows, privateStorage, reverseCharges, deps };
  }

  it('fails with one sentence, keeps nothing, and gives both charges back once', async () => {
    const { rows, privateStorage, reverseCharges, deps } = outcomeSetup();
    expect(await failJob(deps, { jobId: JOB_ID, organizationId: ORG, code: 'tool_failed' })).toBe(
      true,
    );
    expect(privateStorage.objects.size).toBe(0);
    expect(privateStorage.deleted).toEqual([`clips/${ORG}/downloads/${JOB_ID}/`]);
    expect(rows.jobs.get(JOB_ID)?.status).toBe('FAILED');
    expect(rows.closed[0]?.error).toEqual({
      code: 'download_failed',
      message: 'We could not prepare this file. Try again.',
    });
    expect(reverseCharges).toHaveBeenCalledTimes(1);
    expect(reverseCharges).toHaveBeenCalledWith(JOB_ID, { organizationId: ORG });
  });

  it("keeps the platform's own reason", async () => {
    const { rows, deps } = outcomeSetup();
    await failJob(deps, { jobId: JOB_ID, organizationId: ORG, code: 'format_gone' });
    expect(rows.closed[0]?.error).toEqual({
      code: 'format_gone',
      message: 'This quality is no longer offered for this video. Pick another.',
    });
  });

  it('a cancel removes the folder and gives both charges back', async () => {
    const { rows, privateStorage, reverseCharges, deps } = outcomeSetup();
    expect(await cancelJob(deps, { jobId: JOB_ID, organizationId: ORG })).toBe(true);
    expect(rows.jobs.get(JOB_ID)?.status).toBe('CANCELLED');
    expect(privateStorage.objects.size).toBe(0);
    expect(reverseCharges).toHaveBeenCalledTimes(1);
  });

  it('never touches a finished download', async () => {
    const { rows, privateStorage, reverseCharges, deps } = outcomeSetup();
    const job = rows.jobs.get(JOB_ID);
    if (job) job.status = 'DONE';
    expect(await cancelJob(deps, { jobId: JOB_ID, organizationId: ORG })).toBe(false);
    expect(privateStorage.objects.size).toBe(1);
    expect(reverseCharges).not.toHaveBeenCalled();
  });

  it('maps codes to the sentence a person reads', () => {
    expect(downloadFailureCode('too_big')).toBe('download_too_big');
    expect(downloadFailureCode('clips_storage_full')).toBe('download_too_big');
    expect(downloadFailureCode('link_private')).toBe('link_private');
    expect(downloadFailureCode('platform_resting')).toBe('platform_resting');
    expect(downloadFailureCode('ffmpeg_failed')).toBe('download_failed');
  });
});

describe('Save To Media', () => {
  const OUTPUT = {
    assetId: JOB_ID,
    key: `clips/${ORG}/downloads/${JOB_ID}/file.mp4`,
    bytes: 3_000,
    ext: 'mp4' as const,
    fileName: 'Talk.mp4',
    durationMs: 180_000,
    width: 1280,
    height: 720,
    fps: 30,
    media: { status: 'saving' as const, mediaId: null },
  };
  const row = {
    id: JOB_ID,
    organizationId: ORG,
    status: 'DONE' as const,
    output: OUTPUT,
    createdAt: new Date('2026-11-19T09:00:00Z'),
  };

  it('copies the file and a poster to the media space and asks the API for the Media row', async () => {
    const privateStorage = new FakePrivateStorage();
    privateStorage.objects.set(OUTPUT.key, Buffer.alloc(3_000, 1));
    const put: string[] = [];
    const finishSaveDownload = jest.fn(async () => ({ mediaId: 'media-1' }));
    const answer = await runSaveDownload({
      row,
      output: OUTPUT,
      dir,
      signal: new AbortController().signal,
      privateStorage,
      storage: { put: async (key) => void put.push(key), delete: async () => undefined },
      internal: { finishSaveDownload },
      poster: async (opts) => {
        await writeFile(opts.output, Buffer.alloc(100, 4));
        return { file: opts.output, bytes: 100 };
      },
      heartbeat: () => undefined,
    });
    const keys = exportMediaKeys(JOB_ID, row.createdAt);
    expect(answer).toEqual({ mediaId: 'media-1' });
    expect(put).toEqual([keys.video, keys.poster]);
    expect(finishSaveDownload).toHaveBeenCalledWith(JOB_ID, {
      organizationId: ORG,
      key: keys.video,
      bytes: 3_000,
      posterKey: keys.poster,
      durationMs: 180_000,
      width: 1280,
      height: 720,
      fps: 30,
    });
  });

  it('stops for good when the prepared file is gone', async () => {
    await expect(
      runSaveDownload({
        row,
        output: OUTPUT,
        dir,
        signal: new AbortController().signal,
        privateStorage: new FakePrivateStorage(),
        storage: { put: async () => undefined, delete: async () => undefined },
        internal: { finishSaveDownload: jest.fn() },
        poster: jest.fn(),
        heartbeat: () => undefined,
      }),
    ).rejects.toMatchObject({ code: 'media_save_failed', retryable: false });
  });

  it('a failure removes the public files no Media row uses and gives the button back', async () => {
    const rows = new FakeRows();
    rows.jobs.set(
      JOB_ID,
      jobRow({ kind: 'DOWNLOAD', status: 'DONE', videoId: null, createdAt: row.createdAt }),
    );
    rows.downloads.set(JOB_ID, { output: OUTPUT, expiresAt: null });
    const deleted: string[] = [];
    await saveDownloadFailed(
      { rows, storage: { delete: async (key) => void deleted.push(key) } },
      { organizationId: ORG, jobId: JOB_ID },
    );
    const keys = exportMediaKeys(JOB_ID, row.createdAt);
    expect(deleted).toEqual([keys.video, keys.poster]);
    expect(rows.downloads.get(JOB_ID)?.output).toMatchObject({
      media: { status: 'failed', mediaId: null },
    });
  });
});
