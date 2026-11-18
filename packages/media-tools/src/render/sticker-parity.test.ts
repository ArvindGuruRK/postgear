/**
 * Sticker parity (Module 12): FFmpeg's overlays put each picture sticker
 * where `frameState` says, turned the right way, see-through where they
 * should be, and on the frame `stickerFrameAt` (which the preview uses too)
 * picks. The Follow Badge's pill and disc, drawn by libass from `\an7`
 * drawings, sit where `badgeLayout` (which the preview draws) puts them.
 *
 * The pictures are made here, never fetched: a red and green two tone (to
 * read a turn back), a four-colour cycle and a three-colour strip that plays
 * once, on a plain grey clip. Needs `ffmpeg` and `ffprobe` (FFmpeg 9.0.2);
 * the badge also needs the fonts folder (`npm run clips:fonts:build`).
 * Skipped with a message without them.
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import {
  applyLayout,
  badgeLayout,
  buildRenderPlan,
  type ClipDocument,
  compileFfmpeg,
  FONT_MANIFEST_FILE,
  frameState,
  parseFontManifest,
  type RenderContext,
  type RenderStickerAsset,
  type StickerItem,
  stickerFrameAt,
} from '@postgear/video-engine';
import { toolPaths } from '../run/paths';
import { createRunTool } from '../run/runner';
import type { RunTool, ToolPaths } from '../run/types';
import { probeSticker } from '../stickers/normalise';
import { renderClip } from './execute';

const W = 1080;
const H = 1920;
const SOURCE_W = 1920;
const SOURCE_H = 1080;
const GREY = 0x60;

function findTool(program: string): boolean {
  if (path.isAbsolute(program)) return existsSync(program);
  const dirs = (process.env.PATH ?? process.env.Path ?? '').split(path.delimiter).filter(Boolean);
  const names = process.platform === 'win32' ? [`${program}.exe`, program] : [program];
  return dirs.some((folder) => names.some((name) => existsSync(path.join(folder, name))));
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
if (!PATHS) console.warn('Sticker parity tests skipped: ffmpeg and ffprobe are not on the PATH.');

const FONTS_FOLDER =
  process.env.CLIPS_FONTS_DIR ??
  path.resolve(__dirname, '..', '..', '..', '..', '.cache', 'clips-fonts');
const FONTS_READY = existsSync(path.join(FONTS_FOLDER, FONT_MANIFEST_FILE));
const describeWithFonts = PATHS && FONTS_READY ? describe : describe.skip;
if (PATHS && !FONTS_READY)
  console.warn('Follow Badge parity skipped: run npm run clips:fonts:build first.');

async function ffmpeg(runTool: RunTool, cwd: string, args: string[]): Promise<void> {
  await runTool('ffmpeg', ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error', ...args], {
    cwd,
    timeoutMs: 120_000,
  });
}

/** A grey 1920 by 1080 video, `seconds` long. */
async function makeGrey(runTool: RunTool, cwd: string, seconds: number): Promise<void> {
  await ffmpeg(runTool, cwd, [
    '-f',
    'lavfi',
    '-i',
    `color=c=0x606060:s=${SOURCE_W}x${SOURCE_H}:r=30:d=${seconds}`,
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-pix_fmt',
    'yuv420p',
    'grey.mp4',
  ]);
}

/** Decodes the output frames numbered `numbers` (frame n is at n / 30 s) as packed rgb24. */
async function framesAt(
  runTool: RunTool,
  cwd: string,
  file: string,
  numbers: number[],
): Promise<Map<number, Uint8Array>> {
  const name = `${file}.frames.rgb`;
  await ffmpeg(runTool, cwd, [
    '-i',
    file,
    '-vf',
    `select='${numbers.map((n) => `eq(n,${n})`).join('+')}'`,
    '-fps_mode',
    'passthrough',
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgb24',
    name,
  ]);
  const all = new Uint8Array(readFileSync(path.join(cwd, name)));
  const size = W * H * 3;
  expect(all.length).toBe(size * numbers.length);
  const sorted = [...numbers].sort((a, b) => a - b);
  return new Map(sorted.map((n, k) => [n, all.subarray(k * size, (k + 1) * size)]));
}

function greyContext(
  seconds: number,
  stickers: Record<string, RenderStickerAsset> = {},
): RenderContext {
  return {
    quality: '1080p',
    proof: false,
    watermark: false,
    assets: {
      sources: {
        src: {
          file: 'grey.mp4',
          sourceOffsetMs: 0,
          durationMs: seconds * 1000,
          width: SOURCE_W,
          height: SOURCE_H,
          fps: 30,
          hasAudio: false,
        },
      },
      stickers,
    },
  };
}

/** A Vertical Fullscreen clip of the grey video, `ms` long, with `items` on one track. */
function greyDocument(ms: number, items: StickerItem[]): ClipDocument {
  const base: ClipDocument = {
    schemaVersion: 1,
    canvas: { ratio: '9:16', width: W, height: H, fps: 30, background: '#000000' },
    sources: [{ id: 'src', videoId: '6f1c2b8e-3d4a-4b5c-9d6e-7f8091a2b3c4' }],
    segments: [{ id: 'seg', source: 'src', sourceIn: 0, sourceOut: ms, speed: 1, volume: 1 }],
    layout: { kind: 'fullscreen', areas: [] },
    zooms: [],
    looks: { colour: 'none', strength: 0, vignette: 0 },
    fades: { inMs: 0, outMs: 0 },
    tracks: [],
  };
  const doc = applyLayout(base, 'fullscreen', { width: SOURCE_W, height: SOURCE_H });
  return { ...doc, tracks: [{ id: 'ov', kind: 'overlay', items }] };
}

const IDS = {
  twoTone: '0f6a8f3e-1c1d-4e2a-9b3c-000000000001',
  cycle: '0f6a8f3e-1c1d-4e2a-9b3c-000000000002',
  once: '0f6a8f3e-1c1d-4e2a-9b3c-000000000003',
} as const;

function pictureSticker(
  id: string,
  asset: string,
  start: number,
  duration: number,
  overrides: Partial<StickerItem> = {},
): StickerItem {
  return {
    id,
    type: 'sticker',
    start,
    duration,
    anchor: 'moment',
    ref: { asset },
    transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1 },
    flipX: false,
    widthPx: 200,
    heightPx: 200,
    loop: true,
    ...overrides,
  };
}

type Colour = 'red' | 'green' | 'blue' | 'white' | 'grey' | 'other';

/** The colour a sampled pixel shows. */
function colourOf(pixel: { r: number; g: number; b: number }): Colour {
  const { r, g, b } = pixel;
  const near = (value: number, want: number) => Math.abs(value - want) <= 12;
  if (near(r, GREY) && near(g, GREY) && near(b, GREY)) return 'grey';
  if (r > 220 && g > 220 && b > 220) return 'white';
  if (r > 200 && g < 60 && b < 60) return 'red';
  if (g > 200 && r < 60 && b < 60) return 'green';
  if (b > 200 && r < 60 && g < 60) return 'blue';
  return 'other';
}

/** The mean colour of a `(2k+1)` square around a pixel. */
function sampleRgb(frame: Uint8Array, x: number, y: number, k = 2) {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let dy = -k; dy <= k; dy += 1) {
    for (let dx = -k; dx <= k; dx += 1) {
      const at = ((y + dy) * W + (x + dx)) * 3;
      r += frame[at] as number;
      g += frame[at + 1] as number;
      b += frame[at + 2] as number;
      n += 1;
    }
  }
  return { r: r / n, g: g / n, b: b / n };
}

type Pick3 = (r: number, g: number, b: number) => boolean;

/** The count, bounding box and centre of the pixels `isInk` picks. */
function inkOf(frame: Uint8Array, isInk: Pick3) {
  let count = 0;
  let sumX = 0;
  let sumY = 0;
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const at = (y * W + x) * 3;
      if (isInk(frame[at] as number, frame[at + 1] as number, frame[at + 2] as number)) {
        count += 1;
        sumX += x;
        sumY += y;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return {
    count,
    minX,
    maxX,
    minY,
    maxY,
    /** The centre of the bounding box and the mean of the pixels, in continuous pixels. */
    cx: (minX + maxX + 1) / 2,
    cy: (minY + maxY + 1) / 2,
    meanX: sumX / count + 0.5,
    meanY: sumY / count + 0.5,
  };
}

const msOf = (n: number) => (n * 1000) / 30;

describeWithFfmpeg('sticker parity (real FFmpeg)', () => {
  let dir = '';
  let runTool: RunTool;
  let frames = new Map<number, Uint8Array>();
  const CYCLE: Colour[] = ['red', 'green', 'blue', 'white'];
  const ONCE: Colour[] = ['red', 'green', 'blue'];
  const ASSETS: Record<string, RenderStickerAsset> = {
    [`asset:${IDS.twoTone}`]: {
      file: 'two-tone.png',
      animated: false,
      width: 200,
      height: 100,
      fps: null,
      frames: null,
    },
    [`asset:${IDS.cycle}`]: {
      file: 'cycle.apng',
      animated: true,
      width: 64,
      height: 64,
      fps: 10,
      frames: 4,
    },
    [`asset:${IDS.once}`]: {
      file: 'once.apng',
      animated: true,
      width: 64,
      height: 64,
      fps: 10,
      frames: 3,
    },
  };

  const items: StickerItem[] = [
    // 0 to 0.5 s: the two tone, 400 by 200, turned 30 degrees, high on the clip.
    pictureSticker('turned', IDS.twoTone, 0, 500, {
      widthPx: 400,
      transform: { x: 0.5, y: 0.25, scale: 1, rotation: 30, opacity: 1 },
    }),
    // 0.5 to 1 s: the two tone flipped, at half opacity, in the middle.
    pictureSticker('faded', IDS.twoTone, 500, 500, {
      widthPx: 400,
      flipX: true,
      transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 0.5 },
    }),
    // 1 to 2 s: a 10 fps four-colour cycle, looping, low on the clip.
    pictureSticker('cycle', IDS.cycle, 1_000, 1_000, {
      transform: { x: 0.5, y: 0.75, scale: 1, rotation: 0, opacity: 1 },
    }),
    // 2 to 3 s: a 10 fps three-colour strip that plays once and holds its last frame.
    pictureSticker('once', IDS.once, 2_000, 1_000, {
      loop: false,
      transform: { x: 0.5, y: 0.75, scale: 1, rotation: 0, opacity: 1 },
    }),
  ];
  const doc = greyDocument(3_000, items);

  /** Inside each window, plus frame 16, just after the first. Every one is mid-frame for the 10 fps pictures. */
  const NUMBERS = [3, 14, 16, 22, 32, 41, 50, 65, 80, 89];

  const overlayAt = (n: number, id: string) => {
    const overlay = frameState(doc, msOf(n)).overlays.find((o) => o.id === id);
    if (!overlay) throw new Error(`${id} is not on screen at frame ${n}`);
    return overlay;
  };

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'clips-sticker-parity-'));
    runTool = createRunTool(PATHS as ToolPaths);
    await makeGrey(runTool, dir, 3.5);
    const solid = (colour: string, size: string) => `color=c=${colour}:s=${size}:r=10:d=0.1`;
    await ffmpeg(runTool, dir, [
      '-filter_complex',
      `${solid('red', '100x100')}[a];${solid('0x00FF00', '100x100')}[b];[a][b]hstack,format=rgba`,
      '-frames:v',
      '1',
      'two-tone.png',
    ]);
    await ffmpeg(runTool, dir, [
      '-filter_complex',
      `${solid('red', '64x64')}[a];${solid('0x00FF00', '64x64')}[b];` +
        `${solid('blue', '64x64')}[c];${solid('white', '64x64')}[d];` +
        '[a][b][c][d]concat=n=4:v=1:a=0,format=rgba,settb=1/10,setpts=N',
      '-r',
      '10',
      '-plays',
      '0',
      '-f',
      'apng',
      'cycle.apng',
    ]);
    await ffmpeg(runTool, dir, [
      '-filter_complex',
      `${solid('red', '64x64')}[a];${solid('0x00FF00', '64x64')}[b];` +
        `${solid('blue', '64x64')}[c];[a][b][c]concat=n=3:v=1:a=0,format=rgba,settb=1/10,setpts=N`,
      '-r',
      '10',
      '-plays',
      '0',
      '-f',
      'apng',
      'once.apng',
    ]);
    // The worker's facts come from probeSticker, so the made files are read the same way.
    expect(await probeSticker(runTool, 'cycle.apng', { cwd: dir })).toMatchObject({
      animated: true,
      frames: 4,
      fps: 10,
    });
    expect(await probeSticker(runTool, 'once.apng', { cwd: dir })).toMatchObject({
      animated: true,
      frames: 3,
      fps: 10,
    });

    const plan = buildRenderPlan(doc, greyContext(3.5, ASSETS));
    expect(plan.stickers.map((s) => s.id)).toEqual(['turned', 'faded', 'cycle', 'once']);
    await renderClip({
      runTool,
      scratchDir: dir,
      compiled: compileFfmpeg(plan),
      outFile: 'stickers.mp4',
    });
    frames = await framesAt(runTool, dir, 'stickers.mp4', NUMBERS);
  }, 180_000);

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('puts a turned still where frameState says, turned clockwise, with see-through corners', () => {
    const frame = frames.get(14) as Uint8Array;
    const state = overlayAt(14, 'turned');
    const red = inkOf(frame, (r, g) => r > 180 && g < 80);
    const green = inkOf(frame, (r, g) => g > 180 && r < 80);
    expect(red.count).toBeGreaterThan(30_000);
    expect(green.count).toBeGreaterThan(30_000);
    // The two halves are the same size, so the picture's centre is halfway between theirs.
    const cx = (red.meanX + green.meanX) / 2;
    const cy = (red.meanY + green.meanY) / 2;
    expect(Math.abs(cx - state.centre.x * W)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(cy - state.centre.y * H)).toBeLessThanOrEqual(1.5);
    // Red is the left half: the line from red to green is the picture's own x axis.
    const angle = (Math.atan2(green.meanY - red.meanY, green.meanX - red.meanX) * 180) / Math.PI;
    expect(Math.abs(angle - state.rotationDeg)).toBeLessThanOrEqual(1);
    // The box is the diagonal's size; its corners stay the clip's grey.
    const box = buildRenderPlan(doc, greyContext(3.5, ASSETS)).stickers[0];
    if (!box) throw new Error('no planned sticker');
    expect(box.boxWidth).toBeGreaterThan(box.width);
    expect(colourOf(sampleRgb(frame, box.x + 4, box.y + 4))).toBe('grey');
    expect(colourOf(sampleRgb(frame, box.x + box.boxWidth - 5, box.y + box.boxHeight - 5))).toBe(
      'grey',
    );
    console.info(
      `sticker parity turned: centre off by ${(cx - state.centre.x * W).toFixed(2)}, ` +
        `${(cy - state.centre.y * H).toFixed(2)} px, turn off by ${(angle - state.rotationDeg).toFixed(2)} degrees`,
    );
  });

  it('shows a still from the first frame of its window, and not after it', () => {
    const y = Math.round(0.25 * H);
    expect(colourOf(sampleRgb(frames.get(3) as Uint8Array, 540 - 60, y))).not.toBe('grey');
    const after = frames.get(16) as Uint8Array;
    expect(colourOf(sampleRgb(after, 540 - 60, y))).toBe('grey');
    expect(colourOf(sampleRgb(after, 540 + 60, y))).toBe('grey');
  });

  it('flips a sticker and blends it at half opacity over the clip', () => {
    const frame = frames.get(22) as Uint8Array;
    const state = overlayAt(22, 'faded');
    expect(state).toMatchObject({ flipX: true, opacity: 0.5 });
    const cx = Math.round(state.centre.x * W);
    const cy = Math.round(state.centre.y * H);
    const half = (value: number) => (value + GREY) / 2;
    // Flipped: green is on the left now, red on the right.
    const left = sampleRgb(frame, cx - 100, cy);
    const right = sampleRgb(frame, cx + 100, cy);
    expect(Math.abs(left.g - half(255))).toBeLessThanOrEqual(6);
    expect(Math.abs(left.r - half(0))).toBeLessThanOrEqual(6);
    expect(Math.abs(right.r - half(255))).toBeLessThanOrEqual(6);
    expect(Math.abs(right.g - half(0))).toBeLessThanOrEqual(6);
  });

  it('steps a looping moving sticker on the frame stickerFrameAt picks, through the wrap', () => {
    for (const n of [32, 41, 50]) {
      const state = overlayAt(n, 'cycle');
      const want = CYCLE[stickerFrameAt(state.localMs, { fps: 10, frames: 4 }, true)];
      const got = colourOf(sampleRgb(frames.get(n) as Uint8Array, 540, Math.round(0.75 * H)));
      expect({ n, colour: got }).toEqual({ n, colour: want });
    }
    // Frame 50 is past one full cycle (400 ms), so the wrap was checked.
    expect(overlayAt(50, 'cycle').localMs).toBeGreaterThan(400);
  });

  it('holds the last frame of a sticker that plays once until its window closes', () => {
    for (const n of [65, 80, 89]) {
      const state = overlayAt(n, 'once');
      const want = ONCE[stickerFrameAt(state.localMs, { fps: 10, frames: 3 }, false)];
      const got = colourOf(sampleRgb(frames.get(n) as Uint8Array, 540, Math.round(0.75 * H)));
      expect({ n, colour: got }).toEqual({ n, colour: want });
    }
    expect(ONCE[stickerFrameAt(overlayAt(89, 'once').localMs, { fps: 10, frames: 3 }, false)]).toBe(
      'blue',
    );
  });
});

describeWithFonts('Follow Badge parity (real FFmpeg and libass)', () => {
  let dir = '';
  let runTool: RunTool;
  let frames = new Map<number, Uint8Array>();
  const badge = (id: string, start: number, rotation: number): StickerItem =>
    pictureSticker(id, IDS.twoTone, start, 500, {
      ref: { badge: 'twitch', name: 'simstreamer' },
      widthPx: 560,
      heightPx: 140,
      transform: { x: 0.5, y: 0.5, scale: 1, rotation, opacity: 1 },
    });
  const items = [badge('upright', 0, 0), badge('turned', 500, 90)];
  const doc = greyDocument(3_000, items);

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'clips-badge-parity-'));
    runTool = createRunTool(PATHS as ToolPaths);
    const manifest = parseFontManifest(
      JSON.parse(readFileSync(path.join(FONTS_FOLDER, FONT_MANIFEST_FILE), 'utf8')),
    );
    await makeGrey(runTool, dir, 3.5);
    const ctx = greyContext(3.5);
    ctx.assets.fonts = { dir: 'fonts', manifest };
    const plan = buildRenderPlan(doc, ctx);
    expect(plan.shapes).toHaveLength(6);
    mkdirSync(path.join(dir, 'fonts'));
    for (const file of plan.fonts.files) {
      copyFileSync(path.join(FONTS_FOLDER, file), path.join(dir, 'fonts', file));
    }
    await renderClip({
      runTool,
      scratchDir: dir,
      compiled: compileFfmpeg(plan),
      outFile: 'badge.mp4',
    });
    frames = await framesAt(runTool, dir, 'badge.mp4', [7, 22]);
  }, 180_000);

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  const pillInk: Pick3 = (r, g, b) => r < 45 && g < 45 && b < 45;
  const discInk: Pick3 = (r, g, b) => r > 110 && r < 180 && g < 110 && b > 200;

  it.each([
    ['upright', 7],
    ['turned', 22],
  ] as const)('draws the %s pill and disc where badgeLayout puts them', (id, n) => {
    const frame = frames.get(n) as Uint8Array;
    const item = items.find((i) => i.id === id) as StickerItem;
    const [pill, disc] = badgeLayout(item, { width: W, height: H }).shapes;
    if (!pill || !disc) throw new Error('no badge shapes');
    const upright = item.transform.rotation === 0;

    const dark = inkOf(frame, pillInk);
    expect(Math.abs(dark.cx - pill.cx)).toBeLessThanOrEqual(2);
    expect(Math.abs(dark.cy - pill.cy)).toBeLessThanOrEqual(2);
    const across = dark.maxX - dark.minX + 1;
    const down = dark.maxY - dark.minY + 1;
    expect(Math.abs(across - (upright ? pill.width : pill.height))).toBeLessThanOrEqual(3);
    expect(Math.abs(down - (upright ? pill.height : pill.width))).toBeLessThanOrEqual(3);

    const purple = inkOf(frame, discInk);
    expect(purple.count).toBeGreaterThan(5_000);
    expect(Math.abs(purple.cx - disc.cx)).toBeLessThanOrEqual(2);
    expect(Math.abs(purple.cy - disc.cy)).toBeLessThanOrEqual(2);
    expect(Math.abs(purple.maxX - purple.minX + 1 - disc.width)).toBeLessThanOrEqual(3);
    console.info(
      `badge parity ${id}: pill off by ${(dark.cx - pill.cx).toFixed(1)}, ${(dark.cy - pill.cy).toFixed(1)} px; ` +
        `disc off by ${(purple.cx - disc.cx).toFixed(1)}, ${(purple.cy - disc.cy).toFixed(1)} px`,
    );
  });
});
