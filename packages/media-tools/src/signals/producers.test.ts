/**
 * The loudness and scene producers: argument builders, the parsers against
 * FFmpeg 9.0.2's real print output (captured from the generated samples,
 * 2026-11-19), the track builders, and one real run over each sample when
 * FFmpeg and the samples are there.
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { sampleIndexAt } from '@postgear/video-engine';
import { defaultSamplesDir, samplePlan } from '../downloader/samples';
import { extractAnalysisAudio } from '../ffmpeg/import';
import { FfmpegError } from '../ffmpeg/run';
import { toolPaths } from '../run/paths';
import { createRunTool } from '../run/runner';
import { type RunTool, ToolError, type ToolPaths } from '../run/types';
import { LOUDNESS_PRINT_FILE, loudnessArgs, loudnessTrackFrom, produceLoudness } from './loudness';
import { parseMetadataPrint } from './metadata';
import { produceScene, SCENE_PRINT_FILE, sceneArgs, sceneBudgetMs, sceneTrackFrom } from './scene';

/** `ebur128` on the talk sample's analysis sound, frames 27 to 31: the window fills at 2.9 s. */
const EBUR128_PRINT = `frame:27   pts:43200   pts_time:2.7
lavfi.r128.S=-120.691
frame:28   pts:44800   pts_time:2.8
lavfi.r128.S=-120.691
frame:29   pts:46400   pts_time:2.9
lavfi.r128.S=-46.976
frame:30   pts:48000   pts_time:3
lavfi.r128.S=-46.972
frame:31   pts:49600   pts_time:3.1
lavfi.r128.S=-46.972
`;

/** `scdet` on the stream sample's keyframes around its cuts at 40 s and 62 s. */
const SCDET_PRINT = `frame:0    pts:0       pts_time:0
lavfi.scd.mafd=0.000
lavfi.scd.score=0.000
frame:19   pts:583680  pts_time:38
lavfi.scd.mafd=1.091
lavfi.scd.score=0.040
frame:20   pts:614400  pts_time:40
lavfi.scd.mafd=25.625
lavfi.scd.score=24.534
lavfi.scd.time=40
frame:30   pts:921600  pts_time:60
lavfi.scd.mafd=0.479
lavfi.scd.score=0.371
frame:31   pts:952320  pts_time:62
lavfi.scd.mafd=31.370
lavfi.scd.score=30.891
lavfi.scd.time=62
`;

describe('parseMetadataPrint', () => {
  it('reads each value at the time of the frame it follows', () => {
    expect(parseMetadataPrint(EBUR128_PRINT, 'lavfi.r128.S')).toEqual([
      { sec: 2.7, value: -120.691 },
      { sec: 2.8, value: -120.691 },
      { sec: 2.9, value: -46.976 },
      { sec: 3, value: -46.972 },
      { sec: 3.1, value: -46.972 },
    ]);
    expect(parseMetadataPrint(SCDET_PRINT, 'lavfi.scd.score')).toEqual([
      { sec: 0, value: 0 },
      { sec: 38, value: 0.04 },
      { sec: 40, value: 24.534 },
      { sec: 60, value: 0.371 },
      { sec: 62, value: 30.891 },
    ]);
  });

  it('skips other keys, values before any frame, and values that are not numbers', () => {
    const text =
      'lavfi.r128.S=-20\nframe:1 pts:1 pts_time:0.1\nlavfi.r128.S=nan\nlavfi.r128.M=-5\r\nlavfi.r128.S=-21.5\r\n';
    expect(parseMetadataPrint(text, 'lavfi.r128.S')).toEqual([{ sec: 0.1, value: -21.5 }]);
  });

  it('reads nothing from an empty or foreign text', () => {
    expect(parseMetadataPrint('', 'lavfi.r128.S')).toEqual([]);
    expect(parseMetadataPrint('Error opening input\n', 'lavfi.r128.S')).toEqual([]);
  });
});

describe('loudness', () => {
  it('builds arguments that write nothing but the print file', () => {
    const args = loudnessArgs('analysis.wav');
    expect(args).toEqual(expect.arrayContaining(['-i', 'analysis.wav', '-vn', '-f', 'null', '-']));
    const filter = args[args.indexOf('-af') + 1];
    expect(filter).toBe(
      `ebur128=metadata=1,ametadata=mode=print:key=lavfi.r128.S:file=${LOUDNESS_PRINT_FILE}`,
    );
    // Argument arrays only: the file name is its own element, never pasted into a shell string.
    expect(args.filter((arg) => arg.includes('analysis.wav'))).toEqual(['analysis.wav']);
  });

  it('leaves the first three seconds as no data and keeps the loudest value per half second', () => {
    const track = loudnessTrackFrom(EBUR128_PRINT, 4_000);
    expect(track.name).toBe('loudness');
    expect(track.unit).toBe('lufs');
    expect(track.values).toHaveLength(8);
    // 0 to 2.5 s: the window was not full, so no data rather than -120 LUFS of "silence".
    expect(track.values.slice(0, 5)).toEqual([null, null, null, null, null]);
    expect(track.values[sampleIndexAt(3_000)]).toBeCloseTo(-46.972, 3);
  });
});

describe('scene', () => {
  it('decodes keyframes only, small, and writes nothing but the print file', () => {
    const args = sceneArgs('proxy.mp4');
    expect(args.slice(args.indexOf('-skip_frame'), args.indexOf('-skip_frame') + 4)).toEqual([
      '-skip_frame',
      'nokey',
      '-i',
      'proxy.mp4',
    ]);
    expect(args[args.indexOf('-vf') + 1]).toBe(
      `scale=320:-2,scdet=threshold=10,metadata=mode=print:file=${SCENE_PRINT_FILE}`,
    );
    expect(args).toEqual(expect.arrayContaining(['-an', '-f', 'null', '-']));
  });

  it('gives a tenth of the video, at least two minutes', () => {
    expect(sceneBudgetMs(60_000)).toBe(120_000);
    expect(sceneBudgetMs(6 * 3_600_000)).toBe(2_160_000);
  });

  it('holds each keyframe score until the next keyframe', () => {
    const track = sceneTrackFrom(SCDET_PRINT, 64_000);
    expect(track.name).toBe('scene');
    expect(track.values[sampleIndexAt(40_000)]).toBeCloseTo(24.534, 3);
    expect(track.values[sampleIndexAt(41_500)]).toBeCloseTo(24.534, 3);
    expect(track.values[sampleIndexAt(50_000)]).toBeCloseTo(24.534, 3);
    expect(track.values[sampleIndexAt(60_000)]).toBeCloseTo(0.371, 3);
    expect(track.values[sampleIndexAt(62_000)]).toBeCloseTo(30.891, 3);
  });

  it('drops the track when the pass runs over its budget, and never swallows a cancel', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'scene-budget-'));
    try {
      const timedOut: RunTool = async () => {
        throw new ToolError({ tool: 'ffmpeg', exitCode: null, timedOut: true });
      };
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      await expect(
        produceScene({ runTool: timedOut, cwd: dir, durationMs: 60_000, videoFile: 'proxy.mp4' }),
      ).resolves.toBeNull();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('clips.signals.scene_over_budget'));
      warn.mockRestore();

      const controller = new AbortController();
      controller.abort();
      const cancelled: RunTool = async () => {
        throw new ToolError({ tool: 'ffmpeg', exitCode: null, timedOut: true, aborted: true });
      };
      await expect(
        produceScene({
          runTool: cancelled,
          cwd: dir,
          durationMs: 60_000,
          videoFile: 'proxy.mp4',
          signal: controller.signal,
        }),
      ).rejects.toBeInstanceOf(FfmpegError);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a video with no sound has no loudness track', async () => {
    const never: RunTool = async () => {
      throw new Error('FFmpeg must not run');
    };
    await expect(
      produceLoudness({ runTool: never, cwd: tmpdir(), durationMs: 60_000, audioFile: null }),
    ).resolves.toBeNull();
  });
});

// ---- Real FFmpeg over the generated samples -----------------------------------------------

function findTool(program: string): boolean {
  if (path.isAbsolute(program)) return existsSync(program);
  const dirs = (process.env.PATH ?? process.env.Path ?? '').split(path.delimiter).filter(Boolean);
  const names = process.platform === 'win32' ? [`${program}.exe`, program] : [program];
  return dirs.some((dir) => names.some((name) => existsSync(path.join(dir, name))));
}

function safeToolPaths(): ToolPaths | null {
  try {
    const paths = toolPaths(process.env);
    return findTool(paths.ffmpeg) ? paths : null;
  } catch {
    return null;
  }
}

const PATHS = safeToolPaths();
const SAMPLES = defaultSamplesDir();
const READY =
  PATHS !== null &&
  existsSync(path.join(SAMPLES, samplePlan().talk.file)) &&
  existsSync(path.join(SAMPLES, samplePlan().stream.file));
const describeWithSamples = READY ? describe : describe.skip;
if (!READY) {
  console.warn(
    'Signal producer runs skipped: FFmpeg or the samples (npm run clips:samples) are missing.',
  );
}

describeWithSamples('the producers on the samples (real FFmpeg)', () => {
  let dir: string;
  let runTool: RunTool;
  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'signals-real-'));
    runTool = createRunTool(PATHS as ToolPaths);
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('hears the talk sample get louder at each tone burst', async () => {
    const plan = samplePlan().talk;
    const durationMs = plan.durationSec * 1000;
    const wav = path.join(dir, 'talk.wav');
    await extractAnalysisAudio({
      runTool,
      cwd: dir,
      input: path.join(SAMPLES, plan.file),
      output: wav,
      durationMs,
    });
    const track = await produceLoudness({ runTool, cwd: dir, durationMs, audioFile: wav });
    expect(track).not.toBeNull();
    const values = track?.values ?? [];
    const quiet = values[sampleIndexAt(15_000)] as number;
    for (const burst of plan.toneBursts) {
      // The short-term window is 3 s: the peak shows within a few seconds of the burst's start.
      const near = values.slice(
        sampleIndexAt(burst.startSec * 1000),
        sampleIndexAt((burst.endSec + 3) * 1000),
      );
      expect(Math.max(...(near as number[]))).toBeGreaterThan(quiet + 3);
    }
  }, 60_000);

  it('sees the stream sample cut at each planned scene', async () => {
    const plan = samplePlan().stream;
    const durationMs = plan.durationSec * 1000;
    const track = await produceScene({
      runTool,
      cwd: dir,
      durationMs,
      videoFile: path.join(SAMPLES, plan.file),
    });
    expect(track).not.toBeNull();
    const values = track?.values ?? [];
    for (const scene of plan.scenes.slice(1)) {
      // Keyframes are 2 s apart: a cut at an odd second shows on the next keyframe.
      const window = values.slice(
        sampleIndexAt(scene.startSec * 1000),
        sampleIndexAt((scene.startSec + 2) * 1000) + 1,
      ) as number[];
      expect(Math.max(...window)).toBeGreaterThan(10);
    }
    // And nowhere else: a calm stretch scores low.
    expect(values[sampleIndexAt(20_000)] as number).toBeLessThan(10);
  }, 120_000);
});
