/**
 * One real import, end to end, under simulation: the YouTube simulation link
 * answers from the fixture downloader with the generated 3 minute "talk"
 * sample, and every FFmpeg step runs for real. The rows and the private
 * space are in memory. Skipped (with a note) when FFmpeg or the samples are
 * missing (`npm run clips:samples` makes them).
 */
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import {
  createFixtureDownloader,
  createRunTool,
  createSimulatedDriveFiles,
  defaultSamplesDir,
  sampleFileName,
  toolPaths,
} from '@postgear/media-tools';
import type { PrivateStorage } from '@postgear/storage';
import { type ImportInput, isLinkRefusal, recogniseLink } from '@postgear/video-engine';
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
import { runImport } from './import.steps';
import { mediaImportTools } from './import.tools';

jest.setTimeout(300_000);

function findTool(program: string): boolean {
  if (path.isAbsolute(program)) return existsSync(program);
  const dirs = (process.env.PATH ?? process.env.Path ?? '').split(path.delimiter).filter(Boolean);
  const names = process.platform === 'win32' ? [`${program}.exe`, program] : [program];
  return dirs.some((dir) => names.some((name) => existsSync(path.join(dir, name))));
}

const paths = (() => {
  try {
    const found = toolPaths(process.env);
    return findTool(found.ffmpeg) && findTool(found.ffprobe) ? found : null;
  } catch {
    return null;
  }
})();
const samplesDir = defaultSamplesDir();
const ready = paths !== null && existsSync(path.join(samplesDir, sampleFileName('talk')));
const describeReal = ready ? describe : describe.skip;
if (!ready) {
  console.warn(
    'Real import test skipped: FFmpeg or the sample videos are missing (npm run clips:samples).',
  );
}

describeReal('a real simulated import of the 3 minute sample', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'clip-import-real-'));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('stores every file with the right facts', async () => {
    const link = recogniseLink('https://www.youtube.com/watch?v=simtalk0001');
    if (isLinkRefusal(link)) throw new Error('the simulation link was not recognised');
    const input: ImportInput = {
      videoId: VIDEO_ID,
      origin: { type: 'link', link },
      limits: { maxVideoMs: 4 * 60 * 60_000, storageBytes: 5 * 1024 ** 3, retentionDays: 30 },
      expectedBytes: null,
    };
    const runTool = createRunTool(paths as NonNullable<typeof paths>);
    const rows = new FakeRows();
    rows.jobs.set(JOB_ID, jobRow({ input }));
    rows.videos.set(VIDEO_ID, videoRow());
    const storage = new FakePrivateStorage();
    const { progress } = fakeProgress();

    const outcome = await runImport({
      jobId: JOB_ID,
      organizationId: ORG,
      input,
      video: videoRow(),
      dir,
      signal: new AbortController().signal,
      tools: { ...mediaImportTools(runTool), freeDisk: async () => undefined },
      downloader: createFixtureDownloader({ samplesDir, runTool, stepDelayMs: 0 }),
      drive: createSimulatedDriveFiles({ samplesDir }),
      openToken: (sealed) => sealed,
      privateStorage: storage as unknown as PrivateStorage,
      internal: { chargeImport: jest.fn() },
      rows,
      progress,
      heartbeat: () => undefined,
      now: () => new Date(),
    });

    expect(outcome.stored).toBe(true);
    expect(Math.abs(outcome.durationMs - 180_000)).toBeLessThan(1_000);
    const kinds = rows.assets.map((asset) => asset.kind).sort();
    expect(kinds).toEqual(['ANALYSIS_AUDIO', 'FILMSTRIP', 'POSTER', 'PROXY', 'WAVEFORM']);
    for (const asset of rows.assets) {
      expect(storage.objects.get(asset.key)?.length).toBe(asset.bytes);
      expect(asset.bytes).toBeGreaterThan(0);
    }
    const proxy = rows.assets.find((asset) => asset.kind === 'PROXY');
    expect(proxy?.meta).toMatchObject({ height: expect.any(Number), fps: expect.any(Number) });
    const proxyMeta = (proxy?.meta ?? { width: 0, height: 0 }) as { width: number; height: number };
    expect(Math.min(proxyMeta.width, proxyMeta.height)).toBeLessThanOrEqual(720);
    const waveform = rows.assets.find((asset) => asset.kind === 'WAVEFORM');
    const peaks = JSON.parse(
      storage.objects.get(waveform?.key ?? '')?.toString() ?? '[]',
    ) as number[];
    expect(Math.abs(peaks.length - 180 * 20)).toBeLessThanOrEqual(2);
    expect(rows.videos.get(VIDEO_ID)?.status).toBe('READY');
  });
});
