/**
 * Sound parity (Module 14, cookbook section 8): what FFmpeg really mixes for
 * a compiled plan matches what `frameState` and `soundGainAt` say plays.
 *
 * Every sound is generated, never downloaded: pure tones of known amplitude
 * (`aevalsrc`, the same on both channels), so a level can be predicted
 * exactly. Tones of different pitch add by power, so the level of a window
 * where several play is the square root of the sum of their squares. The
 * exported sound is decoded back to raw samples (left channel, 48 kHz) and
 * measured in windows.
 *
 * Needs `ffmpeg` and `ffprobe` (FFmpeg 9.0.2) on the PATH or in
 * `FFMPEG_PATH`/`FFPROBE_PATH`; skipped with a message otherwise.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import {
  type AudioItem,
  buildRenderPlan,
  type ClipDocument,
  compileFfmpeg,
  compileMeasure,
  decideLoudness,
  frameState,
  type RenderContext,
  type Segment,
  soundGainAt,
} from '@postgear/video-engine';
import { toolPaths } from '../run/paths';
import { createRunTool } from '../run/runner';
import type { RunTool, ToolPaths } from '../run/types';
import { renderClip } from './execute';
import { measureFileLoudness, measureLoudness } from './loudness';

const RATE = 48_000;
const LIBRARY_ID = '33333333-3333-4333-8333-333333333333';
const ASSET_ID = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

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
  console.warn('Sound parity tests skipped: ffmpeg and ffprobe are not on the PATH.');
}

/** A tone on both channels: `amp` x sin(2 pi f t). */
function tone(freq: number, amp: number): string {
  const wave = `${amp}*sin(2*PI*${freq}*t)`;
  return `aevalsrc=${wave}|${wave}:s=${RATE}:c=stereo`;
}

function segment(id: string, sourceIn: number, sourceOut: number, speed: Segment['speed'] = 1, volume = 1): Segment {
  return { id, source: 'src', sourceIn, sourceOut, speed, volume };
}

function documentOf(segments: Segment[], sounds: AudioItem[] = [], fades = { inMs: 0, outMs: 0 }): ClipDocument {
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
          crop: [{ at: 0, rect: { x: 0.25, y: 0, w: 0.28125, h: 1 } }],
          fit: 'cover',
        },
      ],
    },
    zooms: [],
    looks: { colour: 'none', strength: 0, vignette: 0 },
    fades,
    tracks: sounds.length > 0 ? [{ id: 'au', kind: 'audio', items: sounds }] : [],
  };
}

function sound(id: string, overrides: Partial<AudioItem>): AudioItem {
  return {
    id,
    type: 'sfx',
    start: 0,
    duration: 1_000,
    anchor: 'moment',
    ref: { library: 'sound', id: LIBRARY_ID },
    offsetMs: 0,
    volume: 1,
    fadeInMs: 0,
    fadeOutMs: 0,
    duck: false,
    ...overrides,
  };
}

/** Root mean square of `samples` between two times in seconds. */
function rms(samples: Float32Array, fromS: number, toS: number): number {
  const from = Math.round(fromS * RATE);
  const to = Math.round(toS * RATE);
  let sum = 0;
  for (let k = from; k < to; k += 1) {
    const value = samples[k] ?? 0;
    sum += value * value;
  }
  return Math.sqrt(sum / Math.max(1, to - from));
}

const db = (ratio: number) => 20 * Math.log10(ratio);
/** The level of tones played together: they add by power. */
const sineRms = (...amps: number[]) => Math.sqrt(amps.reduce((sum, a) => sum + (a * a) / 2, 0));

describeWithFfmpeg('sound parity', () => {
  let dir: string;
  let runTool: RunTool;

  async function ffmpeg(args: string[]): Promise<void> {
    await runTool('ffmpeg', ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error', ...args], {
      cwd: dir,
      timeoutMs: 120_000,
    });
  }

  /** A 256 by 128 grey video of `seconds` with the given sound (or none). */
  async function video(name: string, seconds: number, audio: string | null): Promise<void> {
    const args = ['-f', 'lavfi', '-i', `color=gray:s=256x128:r=30:d=${seconds}`];
    if (audio) args.push('-f', 'lavfi', '-t', String(seconds), '-i', audio);
    args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p');
    if (audio) args.push('-c:a', 'aac', '-b:a', '192k', '-ar', String(RATE));
    args.push('-t', String(seconds), name);
    await ffmpeg(args);
  }

  /** A sound file the way the library stores one: AAC `.m4a`, 48 kHz stereo. */
  async function soundFile(name: string, seconds: number, source: string): Promise<void> {
    await ffmpeg(['-f', 'lavfi', '-t', String(seconds), '-i', source, '-c:a', 'aac', '-b:a', '192k', '-ar', String(RATE), name]);
  }

  function context(sourceFile: string, sounds: Record<string, { file: string; durationMs: number }>, hasAudio = true): RenderContext {
    return {
      quality: '720p',
      proof: true,
      watermark: false,
      assets: {
        sources: {
          src: { file: sourceFile, sourceOffsetMs: 0, durationMs: 12_000, width: 256, height: 128, fps: 30, hasAudio },
        },
        sounds,
      },
    };
  }

  /** Renders a document and decodes its left channel. */
  async function render(
    doc: ClipDocument,
    ctx: RenderContext,
    name: string,
    loudness = false,
  ): Promise<{ samples: Float32Array; final: Awaited<ReturnType<typeof measureFileLoudness>>; decision: ReturnType<typeof decideLoudness> | null }> {
    const plan = buildRenderPlan(doc, ctx);
    let decision: ReturnType<typeof decideLoudness> | null = null;
    if (loudness) {
      const measure = compileMeasure(plan);
      decision = decideLoudness(measure ? await measureLoudness({ runTool, scratchDir: dir, compiled: measure }) : null);
    }
    await renderClip({ runTool, scratchDir: dir, compiled: compileFfmpeg(plan, { loudness: decision }), outFile: `${name}.mp4` });
    const final = loudness ? await measureFileLoudness({ runTool, scratchDir: dir, file: `${name}.mp4` }) : null;
    await ffmpeg(['-i', `${name}.mp4`, '-map', '0:a:0', '-af', 'pan=mono|c0=c0', '-ar', String(RATE), '-f', 'f32le', `${name}.f32`]);
    const bytes = readFileSync(path.join(dir, `${name}.f32`));
    const samples = new Float32Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 4));
    return { samples, final, decision };
  }

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'pg-sound-parity-'));
    runTool = createRunTool(PATHS as ToolPaths);
    await video('voice.mp4', 12, tone(440, 0.25));
    await video('silent.mp4', 12, null);
    await video('loud.mp4', 12, tone(440, 0.7));
    await video('quiet.mp4', 12, tone(440, 0.02));
    await soundFile('music.m4a', 1, tone(220, 0.2));
    await soundFile('effect.m4a', 1, tone(880, 0.3));
    await soundFile('loudmusic.m4a', 4, tone(330, 0.7));
  }, 120_000);

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('mixes the voice, a looping bed and an effect at the levels set, within half a dB', async () => {
    const doc = documentOf(
      [segment('a', 0, 10_000)],
      [
        sound('bed', { type: 'music', anchor: 'clip', start: 2_000, duration: 8_000, ref: { asset: ASSET_ID }, volume: 0.5 }),
        sound('fx', { start: 6_000, duration: 1_000 }),
      ],
    );
    const ctx = context('voice.mp4', {
      [`asset:${ASSET_ID}`]: { file: 'music.m4a', durationMs: 1_000 },
      [`library:${LIBRARY_ID}`]: { file: 'effect.m4a', durationMs: 1_000 },
    });
    const { samples } = await render(doc, ctx, 'mix');
    expect(samples.length / RATE).toBeCloseTo(10, 1);
    const windows: Array<[number, number, number]> = [
      // Voice only; voice and music; all three; music again after the effect.
      [0.5, 1.5, sineRms(0.25)],
      [3.0, 4.0, sineRms(0.25, 0.1)],
      [6.2, 6.8, sineRms(0.25, 0.1, 0.3)],
      [8.0, 9.0, sineRms(0.25, 0.1)],
    ];
    for (const [from, to, expected] of windows) {
      expect(Math.abs(db(rms(samples, from, to) / expected))).toBeLessThan(0.5);
    }
    // frameState agrees on what plays at 6.5 s.
    const state = frameState(doc, 6_500);
    expect(state.sounds.map((s) => [s.id, s.gain])).toEqual([
      ['bed', 0.5],
      ['fx', 1],
    ]);
  }, 120_000);

  it('starts a sound at 3.0 s within a frame, and fades it as soundGainAt draws', async () => {
    const fx = sound('fx', { start: 3_000, duration: 2_000, fadeInMs: 1_000, ref: { asset: ASSET_ID } });
    const doc = documentOf([segment('a', 0, 6_000)], [fx]);
    const ctx = context('silent.mp4', { [`asset:${ASSET_ID}`]: { file: 'loudmusic.m4a', durationMs: 4_000 } }, false);
    const { samples } = await render(doc, ctx, 'onset');
    const first = samples.findIndex((value) => Math.abs(value) > 0.001);
    expect(Math.abs(first / RATE - 3)).toBeLessThan(1 / 30);
    // Half way through the fade in the gain is 0.5; at its end, 1.
    for (const at of [3.5, 4.5]) {
      const gain = soundGainAt(fx, (at - 3) * 1_000);
      const level = rms(samples, at - 0.02, at + 0.02);
      expect(Math.abs(db(level / sineRms(0.7 * gain)))).toBeLessThan(1);
    }
  }, 120_000);

  it('loops music with no gap and stops an effect at its file end', async () => {
    const doc = documentOf(
      [segment('a', 0, 6_000)],
      [
        sound('bed', { type: 'music', anchor: 'clip', start: 0, duration: 4_000, ref: { asset: ASSET_ID }, offsetMs: 500 }),
        // A 1 s effect on a 2 s item: silent after its file ends.
        sound('fx', { start: 4_500, duration: 1_400 }),
      ],
    );
    const ctx = context('silent.mp4', {
      [`asset:${ASSET_ID}`]: { file: 'music.m4a', durationMs: 1_000 },
      [`library:${LIBRARY_ID}`]: { file: 'effect.m4a', durationMs: 1_000 },
    }, false);
    const { samples } = await render(doc, ctx, 'loop');
    let quietest = Number.POSITIVE_INFINITY;
    for (let at = 0.05; at < 3.95; at += 0.005) {
      quietest = Math.min(quietest, rms(samples, at, at + 0.005));
    }
    expect(db(quietest / sineRms(0.2))).toBeGreaterThan(-6);
    expect(rms(samples, 5.6, 5.9)).toBeLessThan(0.001);
  }, 120_000);

  it('keeps the pitch at 2x and 0.5x', async () => {
    const doc = documentOf([segment('a', 0, 4_000, 2), segment('b', 6_000, 8_000, 0.5)]);
    const { samples } = await render(doc, context('voice.mp4', {}), 'pitch');
    /** Upward zero crossings a second, in a window: a pure tone's frequency. */
    const freq = (from: number, to: number) => {
      let crossings = 0;
      for (let k = Math.round(from * RATE) + 1; k < Math.round(to * RATE); k += 1) {
        if ((samples[k - 1] ?? 0) < 0 && (samples[k] ?? 0) >= 0) crossings += 1;
      }
      return crossings / (to - from);
    };
    expect(Math.abs(freq(0.3, 1.7) - 440)).toBeLessThan(5);
    expect(Math.abs(freq(2.5, 5.5) - 440)).toBeLessThan(5);
  }, 120_000);

  it('turns a loud clip down to about -14 LUFS without clipping', async () => {
    const doc = documentOf(
      [segment('a', 0, 8_000)],
      [sound('bed', { type: 'music', anchor: 'clip', start: 0, duration: 8_000, ref: { asset: ASSET_ID } })],
    );
    const ctx = context('loud.mp4', { [`asset:${ASSET_ID}`]: { file: 'loudmusic.m4a', durationMs: 4_000 } });
    const { samples, final, decision } = await render(doc, ctx, 'loud', true);
    expect(decision?.apply).toBe(true);
    expect(decision?.measured?.inputI).toBeGreaterThan(-8);
    expect(final?.inputI).toBeGreaterThan(-15);
    expect(final?.inputI).toBeLessThan(-13);
    expect(final?.inputTp).toBeLessThanOrEqual(-1);
    let peak = 0;
    for (const value of samples) peak = Math.max(peak, Math.abs(value));
    expect(peak).toBeLessThan(0.95);
  }, 180_000);

  it('brings a quiet clip up to about -14 LUFS', async () => {
    const doc = documentOf([segment('a', 0, 8_000)]);
    const { final, decision } = await render(doc, context('quiet.mp4', {}), 'quiet', true);
    expect(decision?.apply).toBe(true);
    expect(decision?.measured?.inputI).toBeLessThan(-30);
    expect(final?.inputI).toBeGreaterThan(-15.5);
    expect(final?.inputI).toBeLessThan(-12.5);
  }, 180_000);

  it('skips both passes for a clip with no sound at all', async () => {
    const doc = documentOf([segment('a', 0, 3_000, 1, 0)]);
    const plan = buildRenderPlan(doc, context('voice.mp4', {}));
    expect(compileMeasure(plan)).toBeNull();
    expect(decideLoudness(null).apply).toBe(false);
  });
});
