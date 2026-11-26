/**
 * Moving crop parity (Sprint 13, Module 08): the export draws a crop that
 * moves where `frameState` says it is, through the real FFmpeg.
 *
 * The source is a 2560 by 1280 picture whose every column has its own grey
 * (a fixed pseudo-random pattern, the same down the column), and the clip
 * is 9:16 at 720p, so the crop is 720 by 1280 and is drawn without any
 * scaling: each output row is a stretch of the source row, and its place
 * is found by matching (the smallest mean difference over a search around
 * the expected place). A brightness ramp cannot be used: moving a ramp is
 * the same as brightening it, which the encoder codes as a level shift, a
 * few pixels off on a fast pan. Checked:
 *
 * - **480 keys.** A random camera path of 480 keys compiles to one `sendcmd`
 *   file and every output frame's crop is within 2 px of `frameState`.
 * - **A jump.** Two keys a millisecond apart, between two source frames: the
 *   crop switches at the frame `frameState` switches at (within one frame)
 *   and no frame is drawn part of the way.
 * - **A speed change.** Two segments, 2x then 0.5x, read from a file that
 *   starts a second into the video: stills (`-ss <t> -frames:v 1`) early
 *   and late in each match `frameState`.
 * - **Never a flat chain.** A `crop` whose `x` is a flat sum of 98 clipped
 *   ramps is refused by FFmpeg (research 09 section 9), which is why the
 *   compiler never writes one; 60 terms still pass.
 *
 * Everything is generated, never downloaded. Needs `ffmpeg` and `ffprobe`
 * (FFmpeg 9.0.2) on the PATH or in `FFMPEG_PATH`/`FFPROBE_PATH`; skipped
 * with a message otherwise.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import {
  buildRenderPlan,
  type ClipDocument,
  type CropKeyframe,
  compileFfmpeg,
  frameState,
  type RenderContext,
  type RenderPlan,
} from '@postgear/video-engine';
import { toolPaths } from '../run/paths';
import { createRunTool } from '../run/runner';
import type { RunTool, ToolPaths } from '../run/types';
import { renderClip } from './execute';

const SOURCE_W = 2560;
const SOURCE_H = 1280;
const SOURCE_FPS = 15;
const SOURCE_SECONDS = 24;
/** The crop: a 9:16 window of the 2:1 source, 720 by 1280, the 720p output's own size. */
const W = 720 / SOURCE_W;
const CROP_W = 720;
/** Rows read from the middle of each picture (averaged, to wash out the encoder's noise). */
const ROWS = 16;
/** How far around the expected place the match looks. */
const SEARCH = 40;
/** A random level in 0 to 1 for knot `k` (the shader hash `fract(sin(k x 12.9898) x 43758.5453)`). */
const hash = (k: string) => `(sin(${k}*12.9898)*43758.5453-floor(sin(${k}*12.9898)*43758.5453))`;
/** The texture's luma at column X: straight lines between random levels 16 columns apart. */
const TEXTURE = `16+219*(${hash('floor(X/16)')}*(1-(X/16-floor(X/16)))+${hash('(floor(X/16)+1)')}*(X/16-floor(X/16)))`;

function findTool(program: string): boolean {
  if (path.isAbsolute(program)) return existsSync(program);
  const dirs = (process.env.PATH ?? process.env.Path ?? '').split(path.delimiter).filter(Boolean);
  const names = process.platform === 'win32' ? [`${program}.exe`, program] : [program];
  return dirs.some((dir) => names.some((name) => existsSync(path.join(dir, name))));
}

function safeToolPaths(): ToolPaths | null {
  try {
    const paths = toolPaths(process.env);
    return findTool(paths.ffmpeg) && findTool(paths.ffprobe) ? paths : null;
  } catch {
    return null;
  }
}

const PATHS = safeToolPaths();
const describeWithFfmpeg = PATHS ? describe : describe.skip;
if (!PATHS) {
  console.warn('Moving crop parity tests skipped: ffmpeg and ffprobe are not on the PATH.');
}

const at = (ms: number, x: number): CropKeyframe => ({ at: ms, rect: { x, y: 0, w: W, h: 1 } });

function documentOf(
  segments: Array<{ id: string; from: number; to: number; speed?: number }>,
  crop: CropKeyframe[],
): ClipDocument {
  return {
    schemaVersion: 2,
    bleeps: [],
    canvas: { ratio: '9:16', width: 1080, height: 1920, fps: 30, background: '#000000' },
    sources: [{ id: 'src', videoId: '6f1c2b8e-3d4a-4b5c-9d6e-7f8091a2b3c4' }],
    segments: segments.map((s) => ({
      id: s.id,
      source: 'src',
      sourceIn: s.from,
      sourceOut: s.to,
      speed: (s.speed ?? 1) as ClipDocument['segments'][number]['speed'],
      volume: 1,
    })),
    layout: {
      kind: 'fullscreen',
      areas: [{ id: 'main', name: 'Video', frame: { x: 0, y: 0, w: 1, h: 1 }, crop, fit: 'cover' }],
    },
    zooms: [],
    looks: { colour: 'none', strength: 0, vignette: 0 },
    fades: { inMs: 0, outMs: 0 },
    tracks: [],
  };
}

/**
 * 720 by 1280 at the export's own CRF (the proof spec's CRF 28 blurs the
 * ramp by a few pixels on a fast pan); the file may start later in the video.
 */
function context(sourceOffsetMs = 0): RenderContext {
  return {
    quality: '720p',
    proof: false,
    watermark: false,
    assets: {
      sources: {
        src: {
          file: 'texture.mp4',
          sourceOffsetMs,
          durationMs: SOURCE_SECONDS * 1000,
          width: SOURCE_W,
          height: SOURCE_H,
          fps: SOURCE_FPS,
          hasAudio: false,
        },
      },
    },
  };
}

/** Where `frameState` puts the crop's left edge at an output moment, in whole source pixels. */
function expectedX(doc: ClipDocument, outputMs: number): number {
  const state = frameState(doc, outputMs, {
    sources: { src: { width: SOURCE_W, height: SOURCE_H, fps: SOURCE_FPS } },
  });
  const x = (state.areas[0]?.visibleCrop.x ?? 0) * SOURCE_W;
  return Math.min(SOURCE_W - CROP_W, Math.max(0, Math.round(x)));
}

/** A random camera path: `count` keys about a frame apart, up to about 450 px a second. */
function cameraPath(count: number, fromMs: number): CropKeyframe[] {
  let state = 12345;
  const random = () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
  let x = (1 - W) / 2;
  return Array.from({ length: count }, (_, i) => {
    x = Math.min(1 - W, Math.max(0, x + (random() - 0.5) * 0.016));
    return at(fromMs + i * 33 + (i % 3), x);
  });
}

describeWithFfmpeg('moving crop parity', () => {
  let dir: string;
  let runTool: RunTool;
  /** The source's own row (each column's grey). */
  let sourceRow: Float64Array;

  async function ffmpeg(args: string[]): Promise<void> {
    await runTool('ffmpeg', ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error', ...args], {
      cwd: dir,
      timeoutMs: 120_000,
    });
  }

  /** The middle rows of every frame of `file` (or of one frame at `seconds`), one mean per column. */
  async function rows(file: string, width: number, height: number, seconds?: number) {
    const out = `${file}.${seconds ?? 'all'}.y`;
    await ffmpeg([
      ...(seconds === undefined ? [] : ['-ss', seconds.toFixed(4)]),
      '-i',
      file,
      ...(seconds === undefined ? [] : ['-frames:v', '1']),
      '-vf',
      `crop=${width}:${ROWS}:0:${height / 2 - ROWS / 2},extractplanes=y`,
      '-f',
      'rawvideo',
      '-pix_fmt',
      'gray',
      out,
    ]);
    const bytes = readFileSync(path.join(dir, out));
    const size = width * ROWS;
    const frames: Float64Array[] = [];
    for (let f = 0; f + size <= bytes.length; f += size) {
      const row = new Float64Array(width);
      for (let r = 0; r < ROWS; r += 1) {
        for (let x = 0; x < width; x += 1)
          row[x] = (row[x] as number) + (bytes[f + r * width + x] as number) / ROWS;
      }
      frames.push(row);
    }
    return frames;
  }

  /** Where in the source row an output row was cut from: the best match near `expected`. */
  function locate(row: Float64Array, expected: number, search = SEARCH): number {
    let best = -1;
    let bestError = Number.POSITIVE_INFINITY;
    const from = Math.max(0, expected - search);
    const to = Math.min(SOURCE_W - CROP_W, expected + search);
    for (let x = from; x <= to; x += 1) {
      let error = 0;
      // No `Math.abs` in this loop: inside Jest's sandbox it is about thirty times slower.
      for (let j = 0; j < CROP_W; j += 1) {
        const d = (row[j] as number) - (sourceRow[x + j] as number);
        error += d < 0 ? -d : d;
      }
      if (error < bestError) {
        bestError = error;
        best = x;
      }
    }
    return best;
  }

  async function render(doc: ClipDocument, name: string, ctx = context()) {
    const plan: RenderPlan = buildRenderPlan(doc, ctx);
    const compiled = compileFfmpeg(plan);
    await renderClip({ runTool, scratchDir: dir, compiled, outFile: `${name}.mp4` });
    return { plan, compiled };
  }

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'pg-reframe-parity-'));
    runTool = createRunTool(PATHS as ToolPaths);
    // One picture, repeated: a smooth random grey along x (a new random level every 16 columns,
    // straight lines between them; no repeat anywhere), the same down each column. Smooth, so
    // the encoder spends little on it; random, so a row matches one place only.
    await ffmpeg([
      '-f',
      'lavfi',
      '-i',
      `color=c=black:s=${SOURCE_W}x${SOURCE_H}:r=${SOURCE_FPS}:d=0.1,format=yuv420p,` +
        `geq=lum='${TEXTURE}':cb=128:cr=128,loop=loop=-1:size=1:start=0,` +
        `setpts=N/(${SOURCE_FPS}*TB)`,
      '-t',
      String(SOURCE_SECONDS),
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-qp',
      '0',
      '-g',
      String(SOURCE_FPS),
      '-pix_fmt',
      'yuv420p',
      'texture.mp4',
    ]);
    const [row] = await rows('texture.mp4', SOURCE_W, SOURCE_H, 0);
    sourceRow = row as Float64Array;
  }, 120_000);

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('draws a 480 key camera path within 2 px of frameState on every frame', async () => {
    const doc = documentOf([{ id: 'a', from: 2_000, to: 18_000 }], cameraPath(480, 2_000));
    const { plan, compiled } = await render(doc, 'path');
    expect(compiled.commandFiles).toHaveLength(1);
    expect(compiled.commandFiles[0]?.content.trim().split('\n')).toHaveLength(480);
    const { width, height, fps } = plan.output;
    expect(width).toBe(CROP_W);
    const frames = await rows('path.mp4', width, height);
    expect(frames).toHaveLength(Math.round((plan.output.durationMs * fps) / 1000));
    let worst = 0;
    let travel = 0;
    const first = expectedX(doc, 0);
    frames.forEach((row, n) => {
      const expected = expectedX(doc, (n * 1000) / fps);
      worst = Math.max(worst, Math.abs(locate(row, expected) - expected));
      travel = Math.max(travel, Math.abs(expected - first));
    });
    console.info(`moving crop parity: 480 keys, ${frames.length} frames, worst ${worst} px`);
    // The path really travels, and the export follows it.
    expect(travel).toBeGreaterThan(100);
    expect(worst).toBeLessThanOrEqual(2);
  }, 120_000);

  it('makes a jump between two source frames land within one frame, and none part of the way', async () => {
    // Source frames at 15 fps fall at 6000 and 6066.7 ms; the jump is at 6033 to 6034 ms.
    const doc = documentOf(
      [{ id: 'a', from: 4_000, to: 8_000 }],
      [at(4_000, 0.1), at(6_033, 0.1), at(6_034, 0.6)],
    );
    const { plan } = await render(doc, 'jump');
    const { width, height, fps } = plan.output;
    const before = Math.round(0.1 * SOURCE_W);
    const after = Math.round(0.6 * SOURCE_W);
    // Each frame matched over the whole picture: a frame part of the way would show up.
    const drawn = (await rows('jump.mp4', width, height)).map((row) => locate(row, 0, SOURCE_W));
    for (const x of drawn) {
      expect(Math.min(Math.abs(x - before), Math.abs(x - after))).toBeLessThanOrEqual(2);
    }
    const switchedAt = drawn.findIndex((x) => Math.abs(x - after) <= 2);
    const expectedSwitch = drawn.findIndex((_, n) => expectedX(doc, (n * 1000) / fps) === after);
    expect(expectedSwitch).toBeGreaterThan(0);
    expect(Math.abs(switchedAt - expectedSwitch)).toBeLessThanOrEqual(1);
  }, 120_000);

  it('keeps the crop right early and late through a speed change (stills against frameState)', async () => {
    // 2x then 0.5x from one run of a file that starts a second into the video: a pan, a turn, a pan.
    const doc = documentOf(
      [
        { id: 'fast', from: 3_000, to: 9_000, speed: 2 },
        { id: 'slow', from: 9_000, to: 12_000, speed: 0.5 },
      ],
      [at(3_500, 0.05), at(8_000, 0.6), at(10_000, 0.3), at(11_800, 0.66)],
    );
    const { plan, compiled } = await render(doc, 'speed', context(1_000));
    expect(compiled.commandFiles.map((f) => f.name)).toEqual(['crop-s0-a0.txt', 'crop-s1-a0.txt']);
    const { width, height, fps } = plan.output;
    // Early and late in each part: 2x covers 0 to 3 s of the clip, 0.5x 3 to 9 s.
    for (const n of [6, 80, 100, 250]) {
      // Just before the frame's own time, so the seek keeps frame n itself.
      const [row] = await rows('speed.mp4', width, height, (n - 0.25) / fps);
      const expected = expectedX(doc, (n * 1000) / fps);
      expect(Math.abs(locate(row as Float64Array, expected) - expected)).toBeLessThanOrEqual(2);
    }
  }, 120_000);

  it('documents why the compiler never writes a flat chain: FFmpeg refuses 98 terms, takes 60', async () => {
    const chain = (terms: number) =>
      [
        '0',
        ...Array.from(
          { length: terms },
          (_, k) => `10*clip((t-${(k * 0.002).toFixed(3)})/0.002,0,1)`,
        ),
      ].join('+');
    const run = (terms: number) =>
      ffmpeg([
        '-f',
        'lavfi',
        '-i',
        `color=c=gray:s=${SOURCE_W}x${SOURCE_H}:r=${SOURCE_FPS}:d=0.2`,
        '-vf',
        `crop=w=${CROP_W}:h=${SOURCE_H}:x='${chain(terms)}':y=0:exact=1`,
        '-f',
        'null',
        '-',
      ]);
    await expect(run(60)).resolves.toBeUndefined();
    await expect(run(98)).rejects.toThrow();
  }, 120_000);
});
