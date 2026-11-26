/**
 * Effects parity (Module 13): what FFmpeg draws for zooms, looks, the
 * vignette, fades and extreme speeds matches `frameState` and the look maths
 * the editor draws with.
 *
 * Every source is generated, never downloaded:
 * - zoom: a 1080 by 1920 black picture with six white discs; the disc
 *   centres in a zoomed frame are where `F + (p - F) x z` puts them;
 * - looks: a flat 96,144,192 picture, run through every look and the
 *   vignette;
 * - speed: a picture whose brightness is 4 x (frame number mod 64), with a
 *   1 kHz beep at 1 s and at 2 s of the video.
 *
 * Needs `ffmpeg` and `ffprobe` (FFmpeg 9.0.2) on the PATH or in
 * `FFMPEG_PATH`/`FFPROBE_PATH`; skipped with a message otherwise.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import {
  applyLook,
  buildRenderPlan,
  type ClipDocument,
  compileFfmpeg,
  frameState,
  LOOK_COLOURS,
  type LookColour,
  lookMatrix,
  type RenderContext,
  type Segment,
  type StickerItem,
  stickerRefKey,
  vignetteFactor,
  type Zoom,
} from '@postgear/video-engine';
import { toolPaths } from '../run/paths';
import { createRunTool } from '../run/runner';
import type { RunTool, ToolPaths } from '../run/types';
import { renderClip } from './execute';

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
  console.warn('effects parity skipped: ffmpeg and ffprobe were not found');
}

async function ffmpeg(runTool: RunTool, cwd: string, args: string[]): Promise<void> {
  await runTool('ffmpeg', ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error', ...args], {
    cwd,
    timeoutMs: 120_000,
  });
}

/** The frames `ks` of a render, decoded to `pixFmt` and concatenated. */
async function framesOf(
  runTool: RunTool,
  cwd: string,
  file: string,
  ks: number[],
  pixFmt: 'gray' | 'rgb24',
  out: string,
): Promise<Uint8Array> {
  const pick = ks.map((k) => `eq(n,${k})`).join('+');
  await ffmpeg(runTool, cwd, [
    '-i',
    file,
    '-vf',
    `select='${pick}'`,
    '-fps_mode',
    'passthrough',
    '-f',
    'rawvideo',
    '-pix_fmt',
    pixFmt,
    out,
  ]);
  return new Uint8Array(readFileSync(path.join(cwd, out)));
}

function baseDocument(
  segments: Segment[],
  extra: Partial<Pick<ClipDocument, 'zooms' | 'looks' | 'fades' | 'tracks'>> = {},
): ClipDocument {
  return {
    schemaVersion: 2,
    bleeps: [],
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
          crop: [{ at: 0, rect: { x: 0, y: 0, w: 1, h: 1 } }],
          fit: 'cover',
        },
      ],
    },
    zooms: [],
    looks: { colour: 'none', strength: 0, vignette: 0 },
    fades: { inMs: 0, outMs: 0 },
    tracks: [],
    ...extra,
  };
}

function segment(id: string, sourceIn: number, sourceOut: number, speed: Segment['speed'] = 1): Segment {
  return { id, source: 'src', sourceIn, sourceOut, speed, volume: 1 };
}

function contextFor(
  file: string,
  facts: { width: number; height: number; durationMs: number; hasAudio: boolean },
  options: Partial<RenderContext> = {},
): RenderContext {
  return {
    quality: '1080p',
    proof: false,
    watermark: false,
    assets: {
      sources: {
        src: { file, sourceOffsetMs: 0, fps: 30, ...facts },
      },
    },
    ...options,
  };
}

const DISCS: Array<[number, number]> = [
  [300, 600],
  [700, 700],
  [432, 864],
  [350, 1200],
  [650, 1300],
  [540, 960],
];
const DISC_R = 24;
const W = 1080;
const H = 1920;

/** The brightness-weighted centre of what is near `(x, y)` in a grey frame. */
function centroid(frame: Uint8Array, x: number, y: number, half: number): [number, number] {
  let sx = 0;
  let sy = 0;
  let sw = 0;
  for (let j = Math.max(0, Math.floor(y - half)); j <= Math.min(H - 1, Math.ceil(y + half)); j += 1) {
    for (let i = Math.max(0, Math.floor(x - half)); i <= Math.min(W - 1, Math.ceil(x + half)); i += 1) {
      const w = Math.max(0, (frame[j * W + i] as number) - 40);
      sx += w * i;
      sy += w * j;
      sw += w;
    }
  }
  return sw > 0 ? [sx / sw, sy / sw] : [Number.NaN, Number.NaN];
}

describeWithFfmpeg('effects parity (real FFmpeg)', () => {
  let dir = '';
  let runTool: RunTool;
  /** The flat source decoded the way a render is: the colour every look starts from. */
  let flat: [number, number, number] = [0, 0, 0];

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'clips-effects-parity-'));
    runTool = createRunTool(PATHS as ToolPaths);
    const lossless = ['-c:v', 'libx264', '-preset', 'ultrafast', '-qp', '0', '-pix_fmt', 'yuv420p', '-g', '30'];
    const discs = DISCS.map(([x, y]) => `lt(hypot(X-${x},Y-${y}),${DISC_R})`).join('+');
    await ffmpeg(runTool, dir, [
      '-f',
      'lavfi',
      '-i',
      `nullsrc=s=${W}x${H}:r=30:d=4,format=gray,geq=lum='min(255,255*(${discs}))'`,
      ...lossless,
      'discs.mp4',
    ]);
    await ffmpeg(runTool, dir, [
      '-f',
      'lavfi',
      '-i',
      'color=c=0x6090C0:s=360x640:r=30:d=3.5',
      ...lossless,
      'flat.mp4',
    ]);
    await ffmpeg(runTool, dir, [
      '-f',
      'lavfi',
      '-i',
      'nullsrc=s=144x256:r=30:d=4,format=gray,geq=lum=mod(N\\,64)*4',
      '-f',
      'lavfi',
      '-i',
      "aevalsrc=exprs='sin(2*PI*1000*t)*(between(t,1,1.4)+between(t,2,2.1))':s=48000:d=4",
      ...lossless,
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      'beeps.mp4',
    ]);
    await ffmpeg(runTool, dir, [
      '-f',
      'lavfi',
      '-i',
      'color=c=0xE02020:s=64x64,format=rgba',
      '-frames:v',
      '1',
      'sticker.png',
    ]);
    const decoded = await framesOf(runTool, dir, 'flat.mp4', [0], 'rgb24', 'flat.rgb');
    const at = (320 * 360 + 180) * 3;
    flat = [decoded[at] as number, decoded[at + 1] as number, decoded[at + 2] as number];
  }, 120_000);

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('puts every disc where the zoom says, easing in and out and snapping', async () => {
    const zooms: Zoom[] = [
      { id: 'za', source: 'src', from: 1_000, to: 2_600, scale: 2, focus: { x: 0.4, y: 0.45 }, ease: 300 },
      { id: 'zb', source: 'src', from: 3_000, to: 3_600, scale: 1.5, focus: { x: 0.6, y: 0.5 }, ease: 0 },
    ];
    const doc = baseDocument([segment('a', 0, 4_000)], { zooms });
    const ctx = contextFor('discs.mp4', { width: W, height: H, durationMs: 4_000, hasAudio: false });
    const plan = buildRenderPlan(doc, ctx);
    expect(plan.output).toMatchObject({ width: W, height: H });
    await renderClip({ runTool, scratchDir: dir, compiled: compileFfmpeg(plan), outFile: 'zoom.mp4' });

    // The ease's start, inside it, the hold, the way out, the end and the frame after; then the Snap zoom.
    const ks = [30, 33, 35, 45, 75, 77, 78, 79, 89, 90, 107, 108];
    const frames = await framesOf(runTool, dir, 'zoom.mp4', ks, 'gray', 'zoom.gray');
    expect(frames.length).toBe(ks.length * W * H);

    let worst = 0;
    ks.forEach((k, f) => {
      const frame = frames.subarray(f * W * H, (f + 1) * W * H);
      const { zoom } = frameState(doc, (k * 1000) / 30);
      const fx = zoom.focus.x * W;
      const fy = zoom.focus.y * H;
      for (const [x, y] of DISCS) {
        const want: [number, number] = [fx + (x - fx) * zoom.scale, fy + (y - fy) * zoom.scale];
        const got = centroid(frame, want[0], want[1], DISC_R * zoom.scale + 10);
        const gap = Math.hypot(got[0] - want[0], got[1] - want[1]);
        worst = Math.max(worst, gap);
        expect([k, x, y, gap <= 1]).toEqual([k, x, y, true]);
      }
    });
    console.info(`zoom parity: worst disc gap ${worst.toFixed(2)} px over ${ks.length} frames`);
  }, 180_000);

  async function lookRender(
    name: string,
    looks: ClipDocument['looks'],
  ): Promise<{ frame: Uint8Array; width: number; height: number }> {
    // A clip lasts at least 3 s.
    const doc = baseDocument([segment('a', 0, 3_000)], { looks });
    const ctx = contextFor(
      'flat.mp4',
      { width: 360, height: 640, durationMs: 3_500, hasAudio: false },
      { proof: true },
    );
    const plan = buildRenderPlan(doc, ctx);
    await renderClip({ runTool, scratchDir: dir, compiled: compileFfmpeg(plan), outFile: `${name}.mp4` });
    const frame = await framesOf(runTool, dir, `${name}.mp4`, [15], 'rgb24', `${name}.rgb`);
    return { frame, width: plan.output.width, height: plan.output.height };
  }

  function meanAt(frame: Uint8Array, width: number, x: number, y: number, k = 2): [number, number, number] {
    const sum = [0, 0, 0];
    let count = 0;
    for (let dy = -k; dy <= k; dy += 1) {
      for (let dx = -k; dx <= k; dx += 1) {
        const at = ((y + dy) * width + (x + dx)) * 3;
        for (let c = 0; c < 3; c += 1) sum[c] = (sum[c] as number) + (frame[at + c] as number);
        count += 1;
      }
    }
    return sum.map((v) => v / count) as [number, number, number];
  }

  it('draws every look as the editor computes it, to within the video rounding', async () => {
    let worst = 0;
    for (const colour of LOOK_COLOURS as readonly LookColour[]) {
      const looks = { colour, strength: 1, vignette: 0 };
      const { frame, width, height } = await lookRender(`look-${colour}`, looks);
      const got = meanAt(frame, width, width / 2, height / 2);
      const want = applyLook(lookMatrix(looks), flat);
      const gap = Math.max(...got.map((v, i) => Math.abs(v - (want[i] as number))));
      worst = Math.max(worst, gap);
      expect([colour, gap <= 5]).toEqual([colour, true]);
      if (colour === 'black_white') {
        for (const v of got) expect(Math.abs(v - 135)).toBeLessThanOrEqual(3);
      }
      if (colour === 'sepia') {
        [184, 164, 128].forEach((v, i) => {
          expect(Math.abs((got[i] as number) - v)).toBeLessThanOrEqual(4);
        });
      }
    }
    console.info(`look parity: worst gap ${worst.toFixed(2)} levels over ${LOOK_COLOURS.length} looks`);

    // Half strength sits halfway between the picture and the full look.
    const half = await lookRender('look-sepia-half', { colour: 'sepia', strength: 0.5, vignette: 0 });
    const got = meanAt(half.frame, half.width, half.width / 2, half.height / 2);
    const full = applyLook(lookMatrix({ colour: 'sepia', strength: 1 }), flat);
    got.forEach((v, i) => {
      expect(Math.abs(v - ((flat[i] as number) + (full[i] as number)) / 2)).toBeLessThanOrEqual(4);
    });
  }, 240_000);

  it('darkens the edges by the vignette curve and leaves the centre alone', async () => {
    const { frame, width, height } = await lookRender('vignette', {
      colour: 'none',
      strength: 0,
      vignette: 1,
    });
    const half = Math.hypot(width / 2, height / 2);
    let worst = 0;
    for (const [x, y] of [
      [width / 2, height / 2],
      [3, height / 2],
      [width / 2, 3],
      [3, 3],
      [width - 4, height - 4],
      [90, 160],
    ] as Array<[number, number]>) {
      const got = meanAt(frame, width, x, y, 1);
      const factor = vignetteFactor(1, Math.hypot(x - width / 2, y - height / 2) / half);
      const gap = Math.max(...got.map((v, i) => Math.abs(v - (flat[i] as number) * factor)));
      worst = Math.max(worst, gap);
      expect([x, y, gap <= 4]).toEqual([x, y, true]);
    }
    console.info(`vignette parity: worst gap ${worst.toFixed(2)} levels`);
  }, 120_000);

  it('fades everything, the stickers too, in and out', async () => {
    const sticker: StickerItem = {
      id: 'st',
      type: 'sticker',
      start: 0,
      duration: 3_000,
      anchor: 'moment',
      ref: { asset: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d' },
      transform: { x: 0.5, y: 0.25, scale: 1, rotation: 0, opacity: 1 },
      flipX: false,
      widthPx: 270,
      heightPx: 270,
      loop: true,
    };
    const doc = baseDocument([segment('a', 0, 3_000)], {
      fades: { inMs: 1_000, outMs: 1_000 },
      tracks: [{ id: 'ov', kind: 'overlay', items: [sticker] }],
    });
    const ctx = contextFor(
      'flat.mp4',
      { width: 360, height: 640, durationMs: 3_500, hasAudio: false },
      {
        proof: true,
        assets: {
          sources: {
            src: { file: 'flat.mp4', sourceOffsetMs: 0, fps: 30, width: 360, height: 640, durationMs: 3_500, hasAudio: false },
          },
          stickers: {
            [stickerRefKey(sticker.ref) as string]: {
              file: 'sticker.png',
              animated: false,
              width: 64,
              height: 64,
              fps: null,
              frames: null,
            },
          },
        },
      },
    );
    const plan = buildRenderPlan(doc, ctx);
    const { width, height } = plan.output;
    await renderClip({ runTool, scratchDir: dir, compiled: compileFfmpeg(plan), outFile: 'fades.mp4' });
    const ks = [0, 15, 45, 89];
    const frames = await framesOf(runTool, dir, 'fades.mp4', ks, 'rgb24', 'fades.rgb');
    const size = width * height * 3;
    const at = (f: number, x: number, y: number) => meanAt(frames.subarray(f * size, (f + 1) * size), width, x, y);
    const stickerAt: [number, number] = [width / 2, height / 4];
    const backgroundAt: [number, number] = [width / 2, (height * 3) / 4];
    const full = { sticker: at(2, ...stickerAt), background: at(2, ...backgroundAt) };
    expect(full.sticker[0]).toBeGreaterThan(180);

    for (const [f, k] of ks.entries()) {
      const opacity = frameState(doc, (k * 1000) / 30).fadeOpacity;
      for (const [where, colour] of [
        [stickerAt, full.sticker],
        [backgroundAt, full.background],
      ] as Array<[[number, number], [number, number, number]]>) {
        const got = at(f, ...where);
        const gap = Math.max(...got.map((v, i) => Math.abs(v - (colour[i] as number) * opacity)));
        expect([k, where, gap <= 14]).toEqual([k, where, true]);
      }
    }
  }, 120_000);

  it('plays 0.25x and 4x parts for the right number of frames, beeps where the clip says', async () => {
    // Source 0.5 to 1.5 s at 0.25x (4 s), then 1.5 to 3.5 s at 4x (0.5 s).
    const doc = baseDocument([segment('slow', 500, 1_500, 0.25), segment('fast', 1_500, 3_500, 4)]);
    const ctx = contextFor(
      'beeps.mp4',
      { width: 144, height: 256, durationMs: 4_000, hasAudio: true },
      { proof: true },
    );
    const plan = buildRenderPlan(doc, ctx);
    expect(plan.output.durationMs).toBe(4_500);
    await renderClip({ runTool, scratchDir: dir, compiled: compileFfmpeg(plan), outFile: 'speed.mp4' });

    // Every frame's centre, decoded to grey: the source frame it shows.
    const { width, height } = plan.output;
    await ffmpeg(runTool, dir, [
      '-i',
      'speed.mp4',
      '-vf',
      `crop=8:8:${width / 2 - 4}:${height / 2 - 4}`,
      '-f',
      'rawvideo',
      '-pix_fmt',
      'gray',
      'speed.gray',
    ]);
    const strip = new Uint8Array(readFileSync(path.join(dir, 'speed.gray')));
    const frames = strip.length / 64;
    expect(frames).toBe(135);
    const sources = { src: { width: 144, height: 256, fps: 30 } };
    let worstFrame = 0;
    for (let n = 0; n < frames; n += 1) {
      let sum = 0;
      for (let i = 0; i < 64; i += 1) sum += strip[n * 64 + i] as number;
      const measured = Math.round(sum / 64 / 4) % 64;
      const expected = (frameState(doc, (n * 1000) / 30, { sources }).segment.sourceFrame as number) % 64;
      const gap = Math.abs(measured - expected);
      worstFrame = Math.max(worstFrame, Math.min(gap, 64 - gap));
    }
    expect(worstFrame).toBeLessThanOrEqual(1);

    // The sound, as 5 ms loudness steps: each beep starts where the time map puts it.
    await ffmpeg(runTool, dir, ['-i', 'speed.mp4', '-vn', '-ac', '1', '-ar', '48000', '-f', 's16le', 'speed.pcm']);
    const pcm = readFileSync(path.join(dir, 'speed.pcm'));
    const samples = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 2));
    const step = 240;
    const loud: number[] = [];
    for (let i = 0; i + step <= samples.length; i += step) {
      let sum = 0;
      for (let j = i; j < i + step; j += 1) sum += (samples[j] as number) ** 2;
      loud.push(Math.sqrt(sum / step));
    }
    const peak = Math.max(...loud);
    const onsets: number[] = [];
    loud.forEach((v, i) => {
      const starts = v > peak * 0.2 && (i === 0 || (loud[i - 1] as number) <= peak * 0.2);
      // A stretched beep wobbles in loudness: a dip shorter than 150 ms is the same beep.
      if (starts && !(onsets.length > 0 && i * 5 - (onsets.at(-1) as number) < 150)) onsets.push(i * 5);
    });
    // Measured on 9.0.2 (2026-11-19): 1895 and 4115 ms. `atempo` stretches by overlapping
    // windows, so at 0.25x (two 0.5 stages) a beep's start shows up to about 105 ms early;
    // at 4x it is 10 ms early. The tolerances are 120 ms and two output frames.
    console.info(`speed parity: beeps at ${onsets.join(', ')} ms, frames ${frames}, worst frame ${worstFrame}`);
    expect(onsets).toHaveLength(2);
    expect(Math.abs((onsets[0] as number) - 2_000)).toBeLessThanOrEqual(120);
    expect(Math.abs((onsets[1] as number) - 4_125)).toBeLessThanOrEqual(67);
  }, 180_000);
});
