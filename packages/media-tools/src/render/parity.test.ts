/**
 * Render parity: what FFmpeg really draws for a compiled plan matches what
 * `frameState` says is on screen (research 09, section 12).
 *
 * The source is generated, never downloaded, and describes itself: a 256 by
 * 128 grey picture whose top half has brightness equal to x (so the crop's
 * position can be read back from one pixel) and whose bottom half has
 * brightness 4 x (frame number mod 64) (so the source frame shown can be read
 * back). The clip has three segments, at 1x, 2x and 0.5x, from two separate
 * stretches of the video, so it also checks that input seeking (`-ss` before
 * `-i`, then `trim`) lands on the frame the plan expects.
 *
 * Needs `ffmpeg` and `ffprobe` (FFmpeg 9.0.2) on the PATH or in
 * `FFMPEG_PATH`/`FFPROBE_PATH`; skipped with a message otherwise. Every later
 * render feature adds a case here.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import {
  buildRenderPlan,
  type ClipDocument,
  compileFfmpeg,
  frameState,
  type RenderContext,
  type Segment,
} from '@postgear/video-engine';
import { toolPaths } from '../run/paths';
import { createRunTool } from '../run/runner';
import type { RunTool, ToolPaths } from '../run/types';
import { renderClip } from './execute';

const SOURCE_W = 256;
const SOURCE_H = 128;
const SOURCE_FPS = 30;
const SOURCE_MS = 8_000;

/** Whether a program can be found: an absolute setting that exists, or a name on PATH. */
function findTool(program: string): boolean {
  if (path.isAbsolute(program)) {
    return existsSync(program);
  }
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
  console.warn('Render parity tests skipped: ffmpeg and ffprobe are not on the PATH.');
}

function segment(
  id: string,
  sourceIn: number,
  sourceOut: number,
  speed: Segment['speed'],
): Segment {
  return { id, source: 'src', sourceIn, sourceOut, speed, volume: 1 };
}

/** A Vertical Fullscreen clip with a 9:16 crop at x = 96 px of the 256 px source (72 px wide). */
function parityDocument(segments: Segment[]): ClipDocument {
  return {
    schemaVersion: 1,
    canvas: { ratio: '9:16', width: 1080, height: 1920, fps: 30, background: '#000000' },
    sources: [{ id: 'src', videoId: '6f1c2b8e-3d4a-4b5c-9d6e-7f8091a2b3c4' }],
    segments,
    layout: {
      kind: 'fullscreen',
      areas: [
        {
          id: 'main',
          name: 'Video',
          frame: { x: 0, y: 0, w: 1, h: 1 },
          crop: [{ at: 0, rect: { x: 96 / SOURCE_W, y: 0, w: 72 / SOURCE_W, h: 1 } }],
          fit: 'cover',
        },
      ],
    },
    zooms: [],
    looks: { colour: 'none', strength: 0, vignette: 0 },
    fades: { inMs: 0, outMs: 0 },
    tracks: [],
  };
}

interface Probe {
  streams: Array<Record<string, string | number | undefined>>;
  format: { duration?: string };
}

async function ffprobe(runTool: RunTool, cwd: string, file: string): Promise<Probe> {
  const result = await runTool(
    'ffprobe',
    ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file],
    { cwd, timeoutMs: 30_000 },
  );
  return JSON.parse(result.stdout) as Probe;
}

async function ffmpeg(runTool: RunTool, cwd: string, args: string[]): Promise<void> {
  await runTool('ffmpeg', ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error', ...args], {
    cwd,
    timeoutMs: 120_000,
  });
}

/** Makes the self-describing source, with or without sound, losslessly coded. */
async function makeSource(
  runTool: RunTool,
  cwd: string,
  name: string,
  withSound: boolean,
): Promise<void> {
  const picture =
    `nullsrc=s=${SOURCE_W}x${SOURCE_H}:r=${SOURCE_FPS}:d=${SOURCE_MS / 1000},format=gray,` +
    `geq=lum='if(lt(Y,${SOURCE_H / 2}),X,mod(N,64)*4)'`;
  const args = ['-f', 'lavfi', '-i', picture];
  if (withSound) {
    args.push(
      '-f',
      'lavfi',
      '-i',
      `sine=frequency=440:sample_rate=48000:duration=${SOURCE_MS / 1000}`,
    );
  }
  args.push(
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-qp',
    '0',
    '-pix_fmt',
    'yuv420p',
    '-g',
    '30',
  );
  if (withSound) {
    args.push('-c:a', 'aac', '-b:a', '128k');
  }
  args.push('-movflags', '+faststart', name);
  await ffmpeg(runTool, cwd, args);
}

/**
 * Where a decoded brightness lies along the source's top row, in continuous
 * pixels (pixel i covers [i, i + 1)). Matching against the source decoded the
 * same way cancels the TV-range round trip of the grey values.
 */
function positionOf(value: number, row: Uint8Array): number {
  for (let i = 0; i + 1 < row.length; i += 1) {
    const a = row[i] as number;
    const b = row[i + 1] as number;
    if (value >= a && value <= b && b > a) {
      return i + 0.5 + (value - a) / (b - a);
    }
  }
  return Number.NaN;
}

function contextFor(file: string, hasAudio: boolean): RenderContext {
  return {
    quality: '720p',
    proof: false,
    watermark: false,
    assets: {
      sources: {
        src: {
          file,
          sourceOffsetMs: 0,
          durationMs: SOURCE_MS,
          width: SOURCE_W,
          height: SOURCE_H,
          fps: SOURCE_FPS,
          hasAudio,
        },
      },
    },
  };
}

describeWithFfmpeg('render parity (real FFmpeg)', () => {
  let dir = '';
  let runTool: RunTool;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'clips-parity-'));
    runTool = createRunTool(PATHS as ToolPaths);
    await makeSource(runTool, dir, 'source.mp4', true);
    await makeSource(runTool, dir, 'silent.mp4', false);
  }, 120_000);

  afterAll(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('draws the crop and the source frame frameState predicts, through seeks and speeds', async () => {
    // 2 s at 1x and 1 s at 2x from one stretch, then 1 s at 0.5x from a later one: 4.5 s.
    const doc = parityDocument([
      segment('a', 2_000, 4_000, 1),
      segment('b', 4_000, 5_000, 2),
      segment('c', 6_000, 7_000, 0.5),
    ]);
    const plan = buildRenderPlan(doc, contextFor('source.mp4', true));
    expect(plan.inputs.map((i) => i.seekMs)).toEqual([1_000, 5_000]);
    const compiled = compileFfmpeg(plan);
    expect(compiled.durationMs).toBe(4_500);

    const result = await renderClip({ runTool, scratchDir: dir, compiled, outFile: 'render.mp4' });
    expect(path.basename(result.file)).toBe('render.mp4');
    expect(existsSync(path.join(dir, 'render.mp4.part'))).toBe(false);

    // The file: H.264 High, yuv420p, 720 by 1280 at 30 fps, AAC 48 kHz stereo, as long as the plan.
    const probe = await ffprobe(runTool, dir, 'render.mp4');
    const video = probe.streams.find((s) => s.codec_type === 'video');
    const audio = probe.streams.find((s) => s.codec_type === 'audio');
    expect(video).toMatchObject({
      codec_name: 'h264',
      profile: 'High',
      pix_fmt: 'yuv420p',
      width: 720,
      height: 1280,
      r_frame_rate: '30/1',
    });
    expect(audio).toMatchObject({ codec_name: 'aac', sample_rate: '48000', channels: 2 });
    const frameSeconds = 1 / plan.output.fps;
    expect(Math.abs(Number(video?.duration) - 4.5)).toBeLessThanOrEqual(frameSeconds);
    expect(Math.abs(Number(audio?.duration) - 4.5)).toBeLessThanOrEqual(frameSeconds);

    // The source's top row and a thin centre strip of every output frame, decoded to grey.
    await ffmpeg(runTool, dir, [
      '-i',
      'source.mp4',
      '-frames:v',
      '1',
      '-vf',
      `crop=${SOURCE_W}:2:0:${SOURCE_H / 4}`,
      '-f',
      'rawvideo',
      '-pix_fmt',
      'gray',
      'row.gray',
    ]);
    await ffmpeg(runTool, dir, [
      '-i',
      'render.mp4',
      '-vf',
      'crop=8:1280:356:0',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'gray',
      'strip.gray',
    ]);
    const row = new Uint8Array(readFileSync(path.join(dir, 'row.gray'))).subarray(0, SOURCE_W);
    const strip = new Uint8Array(readFileSync(path.join(dir, 'strip.gray')));
    const frameBytes = 8 * 1280;
    const frames = strip.length / frameBytes;

    // Frame count: the plan's length at the output rate.
    expect(frames).toBe(Math.round((plan.output.durationMs * plan.output.fps) / 1000));

    const sources = { src: { width: SOURCE_W, height: SOURCE_H, fps: SOURCE_FPS } };
    let worstCrop = 0;
    let worstFrame = 0;
    let exactFrames = 0;
    for (let n = 0; n < frames; n += 1) {
      const base = n * frameBytes;
      // Top half (output rows 200 to 559): columns 359 and 360 of the output are strip columns 3 and 4.
      let top = 0;
      for (let y = 200; y < 560; y += 1) {
        top += ((strip[base + y * 8 + 3] as number) + (strip[base + y * 8 + 4] as number)) / 2;
      }
      top /= 360;
      // Bottom half (output rows 800 to 1199): the frame code, uniform across the strip.
      let bottom = 0;
      for (let y = 800; y < 1200; y += 1) {
        for (let x = 0; x < 8; x += 1) {
          bottom += strip[base + y * 8 + x] as number;
        }
      }
      bottom /= 400 * 8;

      // Output frame n is at exactly n / fps seconds.
      const state = frameState(doc, (n * 1000) / plan.output.fps, { sources });
      const area = state.areas[0];
      if (!area) throw new Error('no area');
      const expectedCentre = (area.visibleCrop.x + area.visibleCrop.w / 2) * SOURCE_W;
      const measuredCentre = positionOf(top, row);
      worstCrop = Math.max(worstCrop, Math.abs(measuredCentre - expectedCentre));

      const expectedFrame = (state.segment.sourceFrame as number) % 64;
      const measuredFrame = Math.round(bottom / 4) % 64;
      const gap = Math.abs(measuredFrame - expectedFrame);
      const off = Math.min(gap, 64 - gap);
      worstFrame = Math.max(worstFrame, off);
      if (off === 0) {
        exactFrames += 1;
      }
    }
    // Measured on FFmpeg 9.0.2 (2026-11-18): crop centre within 0.5 px, every source frame exact.
    // The documented tolerance is one pixel and one source frame.
    expect(worstCrop).toBeLessThanOrEqual(1);
    expect(worstFrame).toBeLessThanOrEqual(1);
    expect(exactFrames).toBe(frames);
  }, 120_000);

  it('makes silence of the full length for a video with no sound', async () => {
    const doc = parityDocument([segment('a', 500, 3_500, 1)]);
    const compiled = compileFfmpeg(buildRenderPlan(doc, contextFor('silent.mp4', false)));
    await renderClip({ runTool, scratchDir: dir, compiled, outFile: 'silent-render.mp4' });
    const probe = await ffprobe(runTool, dir, 'silent-render.mp4');
    const audio = probe.streams.find((s) => s.codec_type === 'audio');
    const video = probe.streams.find((s) => s.codec_type === 'video');
    expect(audio).toMatchObject({ codec_name: 'aac', sample_rate: '48000', channels: 2 });
    expect(Math.abs(Number(audio?.duration) - 3)).toBeLessThanOrEqual(1 / 30);
    expect(Math.abs(Number(video?.duration) - 3)).toBeLessThanOrEqual(1 / 30);
    expect(statSync(path.join(dir, 'silent-render.mp4')).size).toBeGreaterThan(0);
  }, 120_000);
});
