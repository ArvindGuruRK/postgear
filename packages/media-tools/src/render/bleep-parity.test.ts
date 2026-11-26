/**
 * Bleeps and the hook clip through the real FFmpeg (Sprint 13, Module 09).
 *
 * The source sound is one 300 Hz tone (the "voice"), so the 1 kHz bleep and
 * the voice can be told apart in short windows: each 5 ms window is measured
 * at both frequencies (a Hann-windowed single-frequency transform). The
 * sound is read straight from the export graph as 32-bit samples (the gate
 * is sample accurate; AAC's own smear is not what is tested here), except
 * in the hook test, which reads the real MP4 export. Checked:
 *
 * - **On time.** Bleeps at 1.000 to 1.500 and 4.000 to 4.050 with a mute at
 *   2.250 to 2.600, in one graph: in every 5 ms window inside a range the
 *   voice is gone (after the 5 ms ramp) and the tone is there for the bleep
 *   ones only; every window outside (past the ramp) has the voice and no
 *   tone, so each edge is where it was asked within 5 ms.
 * - **No click.** Around every edge the largest step between two samples
 *   is no bigger than the voice's and the tone's own largest steps; the
 *   control (the ramps taken out) steps far above it.
 * - **Output time.** A clip of two parts, the second at 2x: a bleep in the
 *   fast part sounds at its output time, at half its length.
 * - **300 bleeps** (`MAX_BLEEPS`) parse and run, each one on time.
 * - **The hook clip.** The picture's brightness is the source time (`geq`),
 *   so stills at known output times show the hook's source moments first,
 *   then the main part's from its start; a bleep inside the hook stretch
 *   sounds in both plays; the export is exactly as long as the plan says.
 *
 * Everything is generated, never downloaded. Needs `ffmpeg` and `ffprobe`
 * (FFmpeg 9.0.2) on the PATH or in `FFMPEG_PATH`/`FFPROBE_PATH`; skipped
 * with a message otherwise.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import {
  type Bleep,
  buildRenderPlan,
  type ClipDocument,
  type CompiledFfmpeg,
  compileFfmpeg,
  ffmpegArgsFor,
  MAX_BLEEPS,
  type RenderContext,
  type Segment,
} from '@postgear/video-engine';
import { toolPaths } from '../run/paths';
import { createRunTool } from '../run/runner';
import type { RunTool, ToolPaths } from '../run/types';
import { renderClip, writeRenderFiles } from './execute';

const RATE = 48_000;
const FPS = 30;
const VOICE_HZ = 300;
const VOICE_AMP = 0.25;
const TONE_HZ = 1_000;
const TONE_AMP = 0.35;
const SOURCE_SECONDS = 24;
/** The source picture's luma is `16 + LUMA_PER_SECOND x t`, so a still tells its source time. */
const LUMA_PER_SECOND = 9;
/** 5 ms at 48 kHz. */
const WINDOW = 240;

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
  console.warn('Bleep parity tests skipped: ffmpeg and ffprobe are not on the PATH.');
}

function part(
  id: string,
  sourceIn: number,
  sourceOut: number,
  speed: Segment['speed'] = 1,
): Segment {
  return { id, source: 'src', sourceIn, sourceOut, speed, volume: 1 };
}

function bleep(id: string, from: number, to: number, mode: Bleep['mode'] = 'bleep'): Bleep {
  return { id, source: 'src', from, to, mode };
}

function documentOf(segments: Segment[], bleeps: Bleep[]): ClipDocument {
  return {
    schemaVersion: 2,
    bleeps,
    canvas: { ratio: '9:16', width: 1080, height: 1920, fps: FPS, background: '#000000' },
    sources: [{ id: 'src', videoId: '6f1c2b8e-3d4a-4b5c-9d6e-7f8091a2b3c4' }],
    segments,
    layout: {
      kind: 'fullscreen',
      areas: [
        {
          id: 'area',
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

/** The amplitude of `hz` in `count` samples from `start` (Hann window). */
function amplitude(samples: Float32Array, start: number, count: number, hz: number): number {
  let re = 0;
  let im = 0;
  let weights = 0;
  for (let k = 0; k < count; k += 1) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * (k + 0.5)) / count);
    const x = (samples[start + k] ?? 0) * w;
    const phase = (2 * Math.PI * hz * (start + k)) / RATE;
    re += x * Math.cos(phase);
    im += x * Math.sin(phase);
    weights += w;
  }
  return (2 * Math.hypot(re, im)) / weights;
}

/** The largest step between two samples in `[fromMs, toMs)`. */
function largestStep(samples: Float32Array, fromMs: number, toMs: number): number {
  const a = Math.max(1, Math.round((fromMs * RATE) / 1000));
  const b = Math.min(samples.length, Math.round((toMs * RATE) / 1000));
  let largest = 0;
  for (let k = a; k < b; k += 1) {
    largest = Math.max(largest, Math.abs((samples[k] ?? 0) - (samples[k - 1] ?? 0)));
  }
  return largest;
}

const VOICE_STEP = (2 * Math.PI * VOICE_HZ * VOICE_AMP) / RATE;
const TONE_STEP = (2 * Math.PI * TONE_HZ * TONE_AMP) / RATE;

interface Expected {
  fromMs: number;
  toMs: number;
  mode: 'bleep' | 'mute';
}

/**
 * Every 5 ms window of `[fromMs, toMs)` against the ranges: inside a range
 * (past the ramp) no voice, a tone for bleeps only; outside (past the ramp)
 * the voice and no tone. Answers the windows that failed, as text.
 */
function windowFailures(
  samples: Float32Array,
  ranges: readonly Expected[],
  fromMs: number,
  toMs: number,
): string[] {
  const failures: string[] = [];
  for (let w = fromMs; w + 5 <= toMs; w += 5) {
    const start = Math.round((w * RATE) / 1000);
    const voice = amplitude(samples, start, WINDOW, VOICE_HZ);
    const tone = amplitude(samples, start, WINDOW, TONE_HZ);
    const range = ranges.find((r) => w + 5 > r.fromMs && w < r.toMs + 5);
    if (!range) {
      if (voice < 0.85 * VOICE_AMP || tone > 0.03) failures.push(`${w} outside: ${voice} ${tone}`);
      continue;
    }
    const inside = w >= range.fromMs && w + 5 <= range.toMs;
    if (inside && range.mode === 'bleep' && tone < 0.85 * TONE_AMP) {
      failures.push(`${w} no tone: ${tone}`);
    }
    if (range.mode === 'mute' && tone > 0.03) failures.push(`${w} tone in a mute: ${tone}`);
    if (w >= range.fromMs + 5 && w + 5 <= range.toMs && voice > 0.03) {
      failures.push(`${w} voice in a range: ${voice}`);
    }
    if (w >= range.toMs && w + 5 <= range.toMs + 5 && tone > 0.03) {
      failures.push(`${w} tone after the end: ${tone}`);
    }
  }
  return failures;
}

describeWithFfmpeg('bleep parity', () => {
  let dir: string;
  let runTool: RunTool;

  async function ffmpeg(args: string[]): Promise<string> {
    const result = await runTool(
      'ffmpeg',
      ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error', ...args],
      { cwd: dir, timeoutMs: 300_000 },
    );
    return result.stdout;
  }

  /** The proof spec for the sound tests; the hook test's stills need the 720p export's finer luma. */
  function context(proof = true): RenderContext {
    return {
      quality: '720p',
      proof,
      watermark: false,
      assets: {
        sources: {
          src: {
            file: 'source.mp4',
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

  function readFloats(name: string): Float32Array {
    const bytes = readFileSync(path.join(dir, name));
    return new Float32Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 4));
  }

  /** Splits interleaved stereo into its two channels. */
  function channels(interleaved: Float32Array): [Float32Array, Float32Array] {
    const n = Math.floor(interleaved.length / 2);
    const left = new Float32Array(n);
    const right = new Float32Array(n);
    for (let k = 0; k < n; k += 1) {
      left[k] = interleaved[2 * k] ?? 0;
      right[k] = interleaved[2 * k + 1] ?? 0;
    }
    return [left, right];
  }

  /**
   * The export graph's sound as 32-bit stereo samples, before any encoder:
   * the picture goes to `nullsink`. `edit` may change the graph (the control).
   */
  async function graphSound(
    doc: ClipDocument,
    name: string,
    edit: (graph: string) => string = (graph) => graph,
  ) {
    const plan = buildRenderPlan(doc, context());
    const compiled = compileFfmpeg(plan);
    const sound: CompiledFfmpeg = {
      ...compiled,
      filterComplexScript: `${edit(compiled.filterComplexScript).trimEnd()};\n[vout]nullsink\n`,
      outputArgs: ['-map', '[aout]', '-c:a', 'pcm_f32le', '-f', 'f32le'],
    };
    await writeRenderFiles(dir, sound);
    await runTool('ffmpeg', ffmpegArgsFor(sound, `${name}.f32`), { cwd: dir, timeoutMs: 300_000 });
    return { plan, compiled, samples: channels(readFloats(`${name}.f32`)) };
  }

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'pg-bleep-parity-'));
    runTool = createRunTool(PATHS as ToolPaths);
    const wave = `${VOICE_AMP}*sin(2*PI*${VOICE_HZ}*t)`;
    await ffmpeg([
      '-f',
      'lavfi',
      '-i',
      `nullsrc=s=256x128:r=${FPS}:d=${SOURCE_SECONDS},geq=lum='16+${LUMA_PER_SECOND}*T':cb=128:cr=128`,
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
      '-qp',
      '0',
      '-g',
      String(FPS),
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '256k',
      '-t',
      String(SOURCE_SECONDS),
      'source.mp4',
    ]);
  }, 300_000);

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('mutes and bleeps several ranges on time in one graph, with no click', async () => {
    const ranges: Expected[] = [
      { fromMs: 1_000, toMs: 1_500, mode: 'bleep' },
      // Off the 5 ms grid and off the voice's zero crossings, so a hard edge would click.
      { fromMs: 2_251, toMs: 2_601, mode: 'mute' },
      { fromMs: 4_000, toMs: 4_050, mode: 'bleep' },
    ];
    const doc = documentOf(
      [part('p', 0, 6_000)],
      ranges.map((r, k) => bleep(`b${k}`, r.fromMs, r.toMs, r.mode)),
    );
    const { compiled, samples } = await graphSound(doc, 'three');
    expect(compiled.filterComplexScript).toContain('aevalsrc=');
    for (const channel of samples) {
      expect(channel.length).toBe(6 * RATE);
      expect(windowFailures(channel, ranges, 100, 5_900)).toEqual([]);
    }
    const [left] = samples;
    for (const range of ranges) {
      const tone = range.mode === 'bleep' ? TONE_STEP : 0;
      for (const edge of [range.fromMs, range.toMs]) {
        expect(largestStep(left, edge - 10, edge + 15)).toBeLessThan((VOICE_STEP + tone) * 1.15);
      }
    }
    // The control: the same ranges without their ramps click at the mute's edges.
    const hard = await graphSound(doc, 'three-hard', (graph) =>
      graph.replaceAll('/0.005', '/0.000001').replaceAll('+0.005-t', '-t'),
    );
    expect(largestStep(hard.samples[0], 2_241, 2_266)).toBeGreaterThan(VOICE_STEP * 5);
  }, 120_000);

  it('bleeps in output time on a clip of two parts, the second at 2x', async () => {
    // Part one plays 0 to 3 s; part two plays source 6 to 10 s at 2x, out at 3 to 5 s.
    const doc = documentOf(
      [part('slow', 0, 3_000), part('fast', 6_000, 10_000, 2)],
      [bleep('one', 1_000, 1_300), bleep('two', 8_000, 8_400)],
    );
    const { plan, samples } = await graphSound(doc, 'speed');
    expect(plan.bleeps.map((b) => [b.fromMs, b.toMs])).toEqual([
      [1_000, 1_300],
      [4_000, 4_200],
    ]);
    const expected: Expected[] = [
      { fromMs: 1_000, toMs: 1_300, mode: 'bleep' },
      { fromMs: 4_000, toMs: 4_200, mode: 'bleep' },
    ];
    const [left] = samples;
    expect(left.length).toBe(5 * RATE);
    // Away from the join at 3 s (its 15 ms fades) and the speed change's first moments.
    expect(windowFailures(left, expected, 100, 2_900)).toEqual([]);
    expect(windowFailures(left, expected, 3_200, 4_900)).toEqual([]);
  }, 120_000);

  it(`parses and runs ${MAX_BLEEPS} bleeps, each on time`, async () => {
    const bleeps = Array.from({ length: MAX_BLEEPS }, (_, k) =>
      bleep(`b${k}`, 100 + 50 * k, 130 + 50 * k, k % 3 === 2 ? 'mute' : 'bleep'),
    );
    const doc = documentOf([part('p', 0, 15_200)], bleeps);
    const { plan, samples } = await graphSound(doc, 'many');
    expect(plan.bleeps).toHaveLength(MAX_BLEEPS);
    const [left] = samples;
    expect(left.length).toBe(Math.round(15.2 * RATE));
    for (const k of [0, 1, 2, 149, 150, 151, 297, 298, 299]) {
      const from = 100 + 50 * k;
      const mode = k % 3 === 2 ? 'mute' : 'bleep';
      const inside = amplitude(left, Math.round(((from + 10) * RATE) / 1000), WINDOW, TONE_HZ);
      const voice = amplitude(left, Math.round(((from + 10) * RATE) / 1000), WINDOW, VOICE_HZ);
      const gap = amplitude(left, Math.round(((from + 40) * RATE) / 1000), WINDOW, VOICE_HZ);
      expect(voice).toBeLessThan(0.03);
      if (mode === 'bleep') expect(inside).toBeGreaterThan(0.85 * TONE_AMP);
      else expect(inside).toBeLessThan(0.03);
      expect(gap).toBeGreaterThan(0.85 * VOICE_AMP);
    }
  }, 180_000);

  it('plays the hook first, then the clip from its start, with its bleeps in both', async () => {
    // Hook: source 10 to 13 s; main part: source 5 to 20 s, which holds the hook again.
    const doc = documentOf(
      [{ ...part('hook', 10_000, 13_000), role: 'hook' }, part('body', 5_000, 20_000)],
      [bleep('word', 11_000, 11_300)],
    );
    const plan = buildRenderPlan(doc, context(false));
    expect(plan.output.durationMs).toBe(18_000);
    expect(plan.bleeps.map((b) => [b.fromMs, b.toMs])).toEqual([
      [1_000, 1_300],
      [9_000, 9_300],
    ]);
    const compiled = compileFfmpeg(plan);
    await renderClip({ runTool, scratchDir: dir, compiled, outFile: 'hook.mp4' });

    const probe = await runTool(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', 'hook.mp4'],
      { cwd: dir, timeoutMs: 60_000 },
    );
    expect(Math.abs(Number(probe.stdout.trim()) - 18)).toBeLessThan(1 / FPS);

    // Stills: the mean of the luma plane of an 8 by 8 copy of chosen frames, read raw (no range change).
    async function lumas(file: string, frames: number[], name: string): Promise<number[]> {
      const select = frames.map((n) => `eq(n,${n})`).join('+');
      await ffmpeg([
        '-i',
        file,
        '-vf',
        `select='${select}',scale=8:8,format=yuv420p`,
        '-fps_mode',
        'passthrough',
        '-f',
        'rawvideo',
        name,
      ]);
      const bytes = readFileSync(path.join(dir, name));
      // 64 luma bytes, then 16 and 16 chroma bytes, a frame.
      return frames.map((_, k) => {
        let sum = 0;
        for (let p = 0; p < 64; p += 1) sum += bytes[k * 96 + p] ?? 0;
        return sum / 64;
      });
    }
    // The source's own stills at 2 s and 20 s calibrate luma to time.
    const [low, high] = await lumas('source.mp4', [2 * FPS, 20 * FPS], 'source.gray');
    const secondsOf = (luma: number) =>
      2 + ((luma - (low as number)) * 18) / ((high as number) - (low as number));

    const fps = plan.output.fps;
    const stills: Array<[number, number]> = [
      [1.0, 11.0], // the hook
      [2.5, 12.5],
      [3.5, 5.5], // the main part from its start
      [8.0, 10.0], // the hook's stretch again, in its place
      [13.0, 15.0],
    ];
    const seen = await lumas(
      'hook.mp4',
      stills.map(([out]) => Math.round(out * fps)),
      'hook.gray',
    );
    // Each still's source time to the nearest half second (the luma reads to about 0.1 s).
    const measured = seen.map((luma) => Math.round(secondsOf(luma) * 2) / 2);
    expect(measured).toEqual(stills.map(([, source]) => source));

    // The sound of the real export (AAC): the bleep in the hook and again in the main part.
    await ffmpeg([
      '-i',
      'hook.mp4',
      '-map',
      '0:a:0',
      '-af',
      'pan=mono|c0=c0',
      '-ar',
      String(RATE),
      '-f',
      'f32le',
      'hook.f32',
    ]);
    const sound = readFloats('hook.f32');
    const at = (ms: number, hz: number) =>
      amplitude(sound, Math.round((ms * RATE) / 1000), 960, hz);
    for (const from of [1_000, 9_000]) {
      expect(at(from + 100, TONE_HZ)).toBeGreaterThan(0.8 * TONE_AMP);
      expect(at(from + 100, VOICE_HZ)).toBeLessThan(0.05);
      expect(at(from - 200, VOICE_HZ)).toBeGreaterThan(0.8 * VOICE_AMP);
      expect(at(from - 200, TONE_HZ)).toBeLessThan(0.05);
    }
  }, 180_000);
});
