/**
 * Cuts parity (Sprint 13, Module 04): a clip cut many times by the cleanup
 * tools exports to exactly the frames and length the plan says, and its
 * sound never clicks at a cut.
 *
 * - **Frame-exact.** Twenty cuts made through the engine's own
 *   `removeSourceRanges` (which rounds every cut point to a frame): the
 *   export holds exactly the plan's frames and its length.
 * - **No click.** The source sound is one 300 Hz tone. Cut at arbitrary
 *   points, the joins land on different phases of the wave; an unfaded join
 *   jumps by up to twice the tone's height in one sample. With the 15 ms
 *   fades the largest sample-to-sample step stays near the tone's own
 *   largest step (research 09 sections 6 and 11).
 * - **Many parts.** A clip at `MAX_SEGMENTS` parts, each its own run with its
 *   own seeked input, renders through `-/filter_complex`.
 *
 * Everything is generated (a grey picture and a tone), never downloaded.
 * Needs `ffmpeg` and `ffprobe` (FFmpeg 9.0.2) on the PATH or in
 * `FFMPEG_PATH`/`FFPROBE_PATH`; skipped with a message otherwise.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import {
  buildRenderPlan,
  type ClipDocument,
  compileFfmpeg,
  MAX_SEGMENTS,
  type MsRange,
  outputDuration,
  type RenderContext,
  removeSourceRanges,
} from '@postgear/video-engine';
import { toolPaths } from '../run/paths';
import { createRunTool } from '../run/runner';
import type { RunTool, ToolPaths } from '../run/types';
import { renderClip } from './execute';

const RATE = 48_000;
const FPS = 30;
const TONE_HZ = 300;
const TONE_AMP = 0.25;
const SOURCE_SECONDS = 400;

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
  console.warn('Cuts parity tests skipped: ffmpeg and ffprobe are not on the PATH.');
}

/** One part playing the source from `fromMs` to `toMs`, on a small 9:16 canvas. */
function documentOf(fromMs: number, toMs: number): ClipDocument {
  return {
    schemaVersion: 2,
    bleeps: [],
    canvas: { ratio: '9:16', width: 1080, height: 1920, fps: FPS, background: '#000000' },
    sources: [{ id: 'src', videoId: '6f1c2b8e-3d4a-4b5c-9d6e-7f8091a2b3c4' }],
    segments: [
      { id: 'seg', source: 'src', sourceIn: fromMs, sourceOut: toMs, speed: 1, volume: 1 },
    ],
    layout: {
      kind: 'fullscreen',
      areas: [
        {
          id: 'main',
          name: 'Video',
          frame: { x: 0, y: 0, w: 1, h: 1 },
          crop: [{ at: 0, rect: { x: 0.25, y: 0, w: 0.28125, h: 1 } }],
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

/** `count` cuts of uneven length spread over `[fromMs, toMs)`, at points no frame grid lines up with. */
function unevenCuts(fromMs: number, toMs: number, count: number): MsRange[] {
  const step = (toMs - fromMs) / (count + 1);
  return Array.from({ length: count }, (_, k) => {
    const start = Math.round(fromMs + step * (k + 1) + ((k * 137) % 97));
    return { fromMs: start, toMs: start + 300 + ((k * 211) % 900) + 7 };
  });
}

function cut(doc: ClipDocument, cuts: MsRange[]): ClipDocument {
  const result = removeSourceRanges(doc, 'src', cuts);
  if (!result.ok) throw new Error(`The cuts were refused: ${result.code}`);
  return result.doc;
}

describeWithFfmpeg('cuts parity', () => {
  let dir: string;
  let runTool: RunTool;

  async function ffmpeg(args: string[]): Promise<void> {
    await runTool('ffmpeg', ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error', ...args], {
      cwd: dir,
      timeoutMs: 300_000,
    });
  }

  function context(): RenderContext {
    return {
      quality: '720p',
      proof: true,
      watermark: false,
      assets: {
        sources: {
          src: {
            file: 'tone.mp4',
            sourceOffsetMs: 0,
            durationMs: SOURCE_SECONDS * 1000,
            width: 256,
            height: 128,
            fps: FPS,
            hasAudio: true,
          },
        },
      },
    };
  }

  /**
   * Renders a document; answers the plan, the decoded left channel and the
   * counted frames. `unfaded` takes the cut fades out of the graph (the
   * control that shows the click test can see a click).
   */
  async function render(doc: ClipDocument, name: string, unfaded = false) {
    const plan = buildRenderPlan(doc, context());
    const faded = compileFfmpeg(plan);
    const compiled = unfaded
      ? {
          ...faded,
          filterComplexScript: faded.filterComplexScript.replace(
            /,afade=t=(?:in|out):st=[0-9.]+:d=[0-9.]+/g,
            '',
          ),
        }
      : faded;
    await renderClip({ runTool, scratchDir: dir, compiled, outFile: `${name}.mp4` });
    const probe = await runTool(
      'ffprobe',
      [
        '-v',
        'error',
        '-count_frames',
        '-select_streams',
        'v:0',
        '-show_entries',
        'stream=nb_read_frames:format=duration',
        '-of',
        'json',
        `${name}.mp4`,
      ],
      { cwd: dir, timeoutMs: 120_000 },
    );
    const facts = JSON.parse(probe.stdout) as {
      streams: Array<{ nb_read_frames: string }>;
      format: { duration: string };
    };
    await ffmpeg([
      '-i',
      `${name}.mp4`,
      '-map',
      '0:a:0',
      '-af',
      'pan=mono|c0=c0',
      '-ar',
      String(RATE),
      '-f',
      'f32le',
      `${name}.f32`,
    ]);
    const bytes = readFileSync(path.join(dir, `${name}.f32`));
    const samples = new Float32Array(
      bytes.buffer,
      bytes.byteOffset,
      Math.floor(bytes.byteLength / 4),
    );
    return {
      plan,
      compiled,
      frames: Number(facts.streams[0]?.nb_read_frames),
      seconds: Number(facts.format.duration),
      samples,
    };
  }

  /** The largest step between two samples, past the first and last 50 ms (the encoder's priming). */
  function largestStep(samples: Float32Array): number {
    const edge = Math.round(0.05 * RATE);
    let largest = 0;
    for (let k = edge + 1; k < samples.length - edge; k += 1) {
      largest = Math.max(largest, Math.abs((samples[k] ?? 0) - (samples[k - 1] ?? 0)));
    }
    return largest;
  }

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'pg-cuts-parity-'));
    runTool = createRunTool(PATHS as ToolPaths);
    const wave = `${TONE_AMP}*sin(2*PI*${TONE_HZ}*t)`;
    await ffmpeg([
      '-f',
      'lavfi',
      '-i',
      `color=gray:s=256x128:r=${FPS}:d=${SOURCE_SECONDS}`,
      '-f',
      'lavfi',
      '-t',
      String(SOURCE_SECONDS),
      '-i',
      `aevalsrc=${wave}|${wave}:s=${RATE}:c=stereo`,
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-g',
      String(FPS),
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'pcm_s16le',
      '-t',
      String(SOURCE_SECONDS),
      'tone.mov',
    ]);
    await ffmpeg(['-i', 'tone.mov', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', 'tone.mp4']);
  }, 300_000);

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('exports twenty cuts to exactly the frames and length the plan says', async () => {
    const doc = cut(documentOf(5_000, 65_000), unevenCuts(5_000, 65_000, 20));
    expect(doc.segments).toHaveLength(21);
    const { plan, frames, seconds } = await render(doc, 'twenty');
    expect(plan.output.durationMs).toBe(outputDuration(doc));
    // Every cut point is on a frame, so the parts add up to whole frames.
    expect(frames).toBe(Math.round((plan.output.durationMs * FPS) / 1000));
    expect(Math.abs(seconds - plan.output.durationMs / 1000)).toBeLessThan(1 / FPS);
  }, 300_000);

  it('has no click at any cut', async () => {
    const doc = cut(documentOf(5_000, 65_000), unevenCuts(5_000, 65_000, 20));
    const { samples } = await render(doc, 'clicks');
    // A sine's largest step between samples: 2 pi f A / rate (about 0.0098 here).
    const own = (2 * Math.PI * TONE_HZ * TONE_AMP) / RATE;
    const largest = largestStep(samples);
    expect(largest).toBeLessThan(own * 2);
    // The control: the same cuts without their fades click (an unfaded join steps up to 2A).
    const control = await render(doc, 'clicks-unfaded', true);
    expect(control.compiled.filterComplexScript).not.toContain('afade');
    expect(largestStep(control.samples)).toBeGreaterThan(own * 5);
  }, 300_000);

  it(`renders a clip at the most parts a clip holds (${MAX_SEGMENTS}), each its own seeked input`, async () => {
    const lengthMs = MAX_SEGMENTS * 2_000;
    const doc = cut(
      documentOf(1_000, 1_000 + lengthMs),
      unevenCuts(1_000, 1_000 + lengthMs, MAX_SEGMENTS - 1),
    );
    expect(doc.segments).toHaveLength(MAX_SEGMENTS);
    const { plan, compiled, frames } = await render(doc, 'many');
    expect(compiled.inputs).toHaveLength(MAX_SEGMENTS);
    expect(new Set(compiled.inputs.map((input) => input.seekMs)).size).toBe(MAX_SEGMENTS);
    expect(frames).toBe(Math.round((plan.output.durationMs * FPS) / 1000));
  }, 600_000);
});
