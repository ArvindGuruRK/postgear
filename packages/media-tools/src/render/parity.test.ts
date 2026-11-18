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
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import {
  type AreaState,
  applyLayout,
  buildRenderPlan,
  type ClipDocument,
  compileFfmpeg,
  copyTextStyle,
  expectedOutputOf,
  FONT_MANIFEST_FILE,
  type FontManifest,
  frameState,
  layoutsFor,
  parseFontManifest,
  type PresetKind,
  type Rect,
  type RenderContext,
  type Segment,
  type TextItem,
  type TextStyleId,
  textGeometry,
  textStylePreset,
  verifyOutput,
} from '@postgear/video-engine';
import { toolPaths } from '../run/paths';
import { createRunTool } from '../run/runner';
import type { RunTool, ToolPaths } from '../run/types';
import { RenderError, renderClip } from './execute';
import { readOutputFacts } from './output-facts';

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
    // The check every export passes before it is stored (Module 15) passes a real one.
    expect(verifyOutput(await readOutputFacts(runTool, result.file), expectedOutputOf(plan))).toEqual([]);

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

/*
 * Layout parity (Module 10): a 1920 by 1080 gradient whose red channel is x
 * and green channel is y (scaled to 0 to 255), through each layout at 1080 by
 * 1920. The centre of every area must show the source colour at the centre
 * of its crop, both read from `frameState`, within 4 levels (the cookbook's
 * 3-level gap is the yuv420p colour round trip). The plan's pixels must sit
 * within 1 px of `frameState`'s fractions. Rounded camera boxes are also read
 * just inside a corner, where the mask is transparent: the layer below shows.
 */
const GRADIENT_W = 1920;
const GRADIENT_H = 1080;
const GRADIENT_MS = 3_500;
const LAYOUT_W = 1080;
const LAYOUT_H = 1920;

interface Rgb {
  r: number;
  g: number;
}

/** The mean red and green of a `(2k+1)` square around a pixel of a packed rgb24 picture. */
function sample(buffer: Uint8Array, width: number, x: number, y: number, k = 2): Rgb {
  let r = 0;
  let g = 0;
  let count = 0;
  for (let dy = -k; dy <= k; dy += 1) {
    for (let dx = -k; dx <= k; dx += 1) {
      const at = ((y + dy) * width + (x + dx)) * 3;
      r += buffer[at] as number;
      g += buffer[at + 1] as number;
      count += 1;
    }
  }
  return { r: r / count, g: g / count };
}

/** The source pixel an output pixel shows through a picture placed at `content` from `crop`. */
function sourcePixelAt(content: Rect, crop: Rect, outX: number, outY: number): [number, number] {
  const u = ((outX + 0.5) / LAYOUT_W - content.x) / content.w;
  const v = ((outY + 0.5) / LAYOUT_H - content.y) / content.h;
  const sx = (crop.x + u * crop.w) * GRADIENT_W - 0.5;
  const sy = (crop.y + v * crop.h) * GRADIENT_H - 0.5;
  return [
    Math.min(GRADIENT_W - 3, Math.max(2, Math.round(sx))),
    Math.min(GRADIENT_H - 3, Math.max(2, Math.round(sy))),
  ];
}

function gradientDocument(kind: PresetKind): ClipDocument {
  return applyLayout(parityDocument([segment('a', 0, 3_000, 1)]), kind, {
    width: GRADIENT_W,
    height: GRADIENT_H,
  });
}

describeWithFfmpeg('layout parity (real FFmpeg)', () => {
  let dir = '';
  let runTool: RunTool;
  let source: Uint8Array;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'clips-layout-parity-'));
    runTool = createRunTool(PATHS as ToolPaths);
    await ffmpeg(runTool, dir, [
      '-f',
      'lavfi',
      '-i',
      `nullsrc=s=${GRADIENT_W}x${GRADIENT_H}:r=30:d=${GRADIENT_MS / 1000},format=rgb24,` +
        `geq=r='X*255/${GRADIENT_W - 1}':g='Y*255/${GRADIENT_H - 1}':b='128'`,
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
      'gradient.mp4',
    ]);
    // The source decoded the same way the render is, so both pass the same colour conversion.
    await ffmpeg(runTool, dir, [
      '-i',
      'gradient.mp4',
      '-frames:v',
      '1',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      'gradient.rgb',
    ]);
    source = new Uint8Array(readFileSync(path.join(dir, 'gradient.rgb')));
  }, 120_000);

  afterAll(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.each(layoutsFor('9:16'))(
    'draws every %s area where frameState says',
    async (kind) => {
      const doc = gradientDocument(kind);
      const ctx = contextFor('gradient.mp4', false);
      ctx.quality = '1080p';
      const facts = { width: GRADIENT_W, height: GRADIENT_H, fps: 30 };
      ctx.assets = {
        sources: {
          src: {
            ...facts,
            file: 'gradient.mp4',
            sourceOffsetMs: 0,
            durationMs: GRADIENT_MS,
            hasAudio: false,
          },
        },
      };
      const plan = buildRenderPlan(doc, ctx);
      expect(plan.output).toMatchObject({ width: LAYOUT_W, height: LAYOUT_H });
      const out = `layout-${kind}.mp4`;
      await renderClip({ runTool, scratchDir: dir, compiled: compileFfmpeg(plan), outFile: out });
      await ffmpeg(runTool, dir, [
        '-ss',
        '1.000',
        '-i',
        out,
        '-frames:v',
        '1',
        '-f',
        'rawvideo',
        '-pix_fmt',
        'rgb24',
        `${kind}.rgb`,
      ]);
      const frame = new Uint8Array(readFileSync(path.join(dir, `${kind}.rgb`)));
      expect(frame.length).toBe(LAYOUT_W * LAYOUT_H * 3);

      const state = frameState(doc, 1_000, { sources: { src: facts } });
      const areas = plan.segments[0]?.picture.areas ?? [];
      expect(areas).toHaveLength(state.areas.length);

      let worst = 0;
      state.areas.forEach((area: AreaState, i) => {
        // The plan's pixels are frameState's fractions, to within a pixel.
        const pixels = areas[i];
        if (!pixels) throw new Error('no plan area');
        expect(Math.abs(pixels.x - area.content.x * LAYOUT_W)).toBeLessThanOrEqual(1);
        expect(Math.abs(pixels.y - area.content.y * LAYOUT_H)).toBeLessThanOrEqual(1);
        expect(Math.abs(pixels.width - area.content.w * LAYOUT_W)).toBeLessThanOrEqual(1);
        expect(Math.abs(pixels.height - area.content.h * LAYOUT_H)).toBeLessThanOrEqual(1);

        // The centre of the area shows the centre of its crop.
        const cx = Math.floor((area.content.x + area.content.w / 2) * LAYOUT_W);
        const cy = Math.floor((area.content.y + area.content.h / 2) * LAYOUT_H);
        const [sx, sy] = sourcePixelAt(area.content, area.visibleCrop, cx, cy);
        const got = sample(frame, LAYOUT_W, cx, cy);
        const want = sample(source, GRADIENT_W, sx, sy);
        worst = Math.max(worst, Math.abs(got.r - want.r), Math.abs(got.g - want.g));
        expect([
          kind,
          area.name,
          Math.abs(got.r - want.r) <= 4,
          Math.abs(got.g - want.g) <= 4,
        ]).toEqual([kind, area.name, true, true]);

        if (area.radius > 0) {
          // Just inside the top left corner the mask is transparent: the layer below shows.
          const kx = pixels.x + 2;
          const ky = pixels.y + 2;
          const corner = sample(frame, LAYOUT_W, kx, ky, 1);
          const own = sample(
            source,
            GRADIENT_W,
            ...sourcePixelAt(area.content, area.visibleCrop, kx, ky),
            1,
          );
          const below = i > 0 && kind === 'gameplay' ? (state.areas[0] as AreaState) : null;
          const [bx, by] = below
            ? sourcePixelAt(below.content, below.visibleCrop, kx, ky)
            : sourcePixelAt(
                { x: 0, y: 0, w: 1, h: 1 },
                state.background.kind === 'blurred'
                  ? state.background.crop
                  : { x: 0, y: 0, w: 1, h: 1 },
                kx,
                ky,
              );
          const under = sample(source, GRADIENT_W, bx, by, 1);
          expect(Math.max(Math.abs(corner.r - own.r), Math.abs(corner.g - own.g))).toBeGreaterThan(
            20,
          );
          // The blurred base is a blurred gradient (still the gradient), so a little looser there.
          expect(
            Math.max(Math.abs(corner.r - under.r), Math.abs(corner.g - under.g)),
          ).toBeLessThanOrEqual(below ? 4 : 8);
        }
      });
      // Logged so the measured gap can be written down beside the tolerance.
      console.info(`layout parity ${kind}: worst centre gap ${worst.toFixed(2)} levels`);
    },
    120_000,
  );

  it('draws a lone rounded area over the canvas colour (a Custom layout)', async () => {
    const doc = gradientDocument('fullscreen');
    const area = doc.layout.areas[0];
    if (!area) throw new Error('no area');
    doc.layout.kind = 'custom';
    doc.canvas.background = '#336699';
    area.frame = { x: 0.1, y: 0.2, w: 0.8, h: 0.45 };
    area.radius = 60;
    const facts = { width: GRADIENT_W, height: GRADIENT_H, fps: 30 };
    const ctx = contextFor('gradient.mp4', false);
    ctx.quality = '1080p';
    ctx.assets = {
      sources: {
        src: {
          ...facts,
          file: 'gradient.mp4',
          sourceOffsetMs: 0,
          durationMs: GRADIENT_MS,
          hasAudio: false,
        },
      },
    };
    const plan = buildRenderPlan(doc, ctx);
    await renderClip({
      runTool,
      scratchDir: dir,
      compiled: compileFfmpeg(plan),
      outFile: 'lone.mp4',
    });
    await ffmpeg(runTool, dir, [
      '-ss',
      '1.000',
      '-i',
      'lone.mp4',
      '-frames:v',
      '1',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      'lone.rgb',
    ]);
    const frame = new Uint8Array(readFileSync(path.join(dir, 'lone.rgb')));
    const pixels = plan.segments[0]?.picture.areas[0];
    if (!pixels) throw new Error('no plan area');
    // Outside the area, and just inside its rounded corner: the canvas colour (0x33, 0x66).
    for (const [x, y] of [
      [20, 20],
      [pixels.x + 3, pixels.y + 3],
    ] as const) {
      const got = sample(frame, LAYOUT_W, x, y, 1);
      expect(Math.abs(got.r - 0x33)).toBeLessThanOrEqual(4);
      expect(Math.abs(got.g - 0x66)).toBeLessThanOrEqual(4);
    }
    const state = frameState(doc, 1_000, { sources: { src: facts } });
    const a = state.areas[0] as AreaState;
    const cx = Math.floor((a.content.x + a.content.w / 2) * LAYOUT_W);
    const cy = Math.floor((a.content.y + a.content.h / 2) * LAYOUT_H);
    const got = sample(frame, LAYOUT_W, cx, cy);
    const want = sample(source, GRADIENT_W, ...sourcePixelAt(a.content, a.visibleCrop, cx, cy));
    expect(Math.abs(got.r - want.r)).toBeLessThanOrEqual(4);
    expect(Math.abs(got.g - want.g)).toBeLessThanOrEqual(4);
  }, 120_000);
});

/**
 * Text parity: libass draws each text where `textGeometry` (which the
 * preview reads too) says, through the twins in the fonts folder. Needs the
 * folder `npm run clips:fonts:build` writes (`CLIPS_FONTS_DIR`, default
 * `<repo>/.cache/clips-fonts`); skipped with a message without it.
 */
const FONTS_FOLDER =
  process.env.CLIPS_FONTS_DIR ??
  path.resolve(__dirname, '..', '..', '..', '..', '.cache', 'clips-fonts');
const FONTS_READY = existsSync(path.join(FONTS_FOLDER, FONT_MANIFEST_FILE));
const describeWithFonts = PATHS && FONTS_READY ? describe : describe.skip;
if (PATHS && !FONTS_READY) {
  console.warn('Text parity tests skipped: run npm run clips:fonts:build first.');
}

/** The bounding box and centre of the pixels `isInk` picks in a packed rgb24 frame. */
interface Ink {
  count: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  cx: number;
  cy: number;
}

type Pick3 = (r: number, g: number, b: number) => boolean;

function inkOf(frame: Uint8Array, isInk: Pick3): Ink {
  let count = 0;
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let y = 0; y < LAYOUT_H; y += 1) {
    for (let x = 0; x < LAYOUT_W; x += 1) {
      const at = (y * LAYOUT_W + x) * 3;
      if (isInk(frame[at] as number, frame[at + 1] as number, frame[at + 2] as number)) {
        count += 1;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return { count, minX, maxX, minY, maxY, cx: (minX + maxX + 1) / 2, cy: (minY + maxY + 1) / 2 };
}

/** The mean row of the ink between two columns. */
function meanRow(frame: Uint8Array, isInk: Pick3, fromX: number, toX: number): number {
  let sum = 0;
  let n = 0;
  for (let y = 0; y < LAYOUT_H; y += 1) {
    for (let x = fromX; x <= toX; x += 1) {
      const at = (y * LAYOUT_W + x) * 3;
      if (isInk(frame[at] as number, frame[at + 1] as number, frame[at + 2] as number)) {
        sum += y;
        n += 1;
      }
    }
  }
  return sum / n;
}

const bright: Pick3 = (r, g, b) => r > 128 && g > 128 && b > 128;
const whiteBox: Pick3 = (r, g, b) => r > 200 && g > 200 && b > 200;

const BASE_STYLE = {
  ...copyTextStyle(textStylePreset('plain').style),
  font: 'Montserrat',
  weight: 800,
  size: 76,
  // No shadow: its ink would widen what is measured.
  shadow: false,
};

/** One text for the parity clip, half a second long at `start`. */
function parityText(
  id: string,
  start: number,
  overrides: Partial<TextItem> & { styleId?: TextStyleId } = {},
): TextItem {
  const { styleId, ...rest } = overrides;
  const style = styleId ? copyTextStyle(textStylePreset(styleId).style) : { ...BASE_STYLE };
  return {
    id,
    type: 'text',
    start,
    duration: 500,
    anchor: 'moment',
    text: 'HELLO PARITY',
    style,
    transform: { x: 0.5, y: 0.3, scale: 1, rotation: 0, opacity: 1 },
    widthPx: 864,
    fadeInMs: 0,
    fadeOutMs: 0,
    ...rest,
  };
}

describeWithFonts('text parity (real FFmpeg and libass)', () => {
  let dir = '';
  let runTool: RunTool;
  let manifest: FontManifest;
  const frames = new Map<number, Uint8Array>();

  /** Six texts, one every half second, on a 3 s black clip. */
  const texts: TextItem[] = [
    parityText('centred', 0),
    parityText('left', 500, { text: 'HI', widthPx: 800, style: { ...BASE_STYLE, align: 'left' } }),
    parityText('turned', 1_000, {
      text: 'HI',
      widthPx: 800,
      style: { ...BASE_STYLE, align: 'left' },
      transform: { x: 0.5, y: 0.3, scale: 1, rotation: 180, opacity: 1 },
    }),
    parityText('tilted', 1_500, {
      text: 'HHHHHHHHHH',
      transform: { x: 0.5, y: 0.5, scale: 1, rotation: 20, opacity: 1 },
    }),
    parityText('boxed', 2_000, {
      styleId: 'on-a-box',
      text: 'ON A BOX',
      transform: { x: 0.5, y: 0.6, scale: 1, rotation: 0, opacity: 1 },
    }),
    parityText('scripts', 2_500, {
      text: 'தமிழ் हिन्दी',
      transform: { x: 0.5, y: 0.5, scale: 1.5, rotation: 0, opacity: 1 },
    }),
  ];
  const frameAt = (text: TextItem) => text.start + 250;

  function textDocument(items: TextItem[] = texts): ClipDocument {
    const doc = applyLayout(parityDocument([segment('seg', 0, 3_000, 1)]), 'fullscreen', {
      width: GRADIENT_W,
      height: GRADIENT_H,
    });
    return { ...doc, tracks: [{ id: 'ov', kind: 'overlay', items }] };
  }

  function textContext(): RenderContext {
    const ctx = contextFor('black.mp4', false);
    ctx.quality = '1080p';
    ctx.assets = {
      sources: {
        src: {
          file: 'black.mp4',
          sourceOffsetMs: 0,
          durationMs: GRADIENT_MS,
          width: GRADIENT_W,
          height: GRADIENT_H,
          fps: 30,
          hasAudio: false,
        },
      },
      fonts: { dir: 'fonts', manifest },
    };
    return ctx;
  }

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'clips-text-parity-'));
    runTool = createRunTool(PATHS as ToolPaths);
    manifest = parseFontManifest(
      JSON.parse(readFileSync(path.join(FONTS_FOLDER, FONT_MANIFEST_FILE), 'utf8')),
    );
    await ffmpeg(runTool, dir, [
      '-f',
      'lavfi',
      '-i',
      `color=c=black:s=${GRADIENT_W}x${GRADIENT_H}:r=30:d=${GRADIENT_MS / 1000}`,
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-pix_fmt',
      'yuv420p',
      'black.mp4',
    ]);
    const plan = buildRenderPlan(textDocument(), textContext());
    // As the worker does: only the twins the plan names go into the scratch fonts folder.
    mkdirSync(path.join(dir, 'fonts'));
    for (const file of plan.fonts.files) {
      copyFileSync(path.join(FONTS_FOLDER, file), path.join(dir, 'fonts', file));
    }
    await renderClip({ runTool, scratchDir: dir, compiled: compileFfmpeg(plan), outFile: 'text.mp4' });
    for (const text of texts) {
      const ms = frameAt(text);
      const name = `text-${ms}.rgb`;
      await ffmpeg(runTool, dir, [
        '-ss',
        (ms / 1000).toFixed(3),
        '-i',
        'text.mp4',
        '-frames:v',
        '1',
        '-f',
        'rawvideo',
        '-pix_fmt',
        'rgb24',
        name,
      ]);
      frames.set(ms, new Uint8Array(readFileSync(path.join(dir, name))));
    }
  }, 180_000);

  afterAll(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  /** The frame showing one text, and that text's box from `textGeometry`. */
  function shown(id: string) {
    const text = texts.find((t) => t.id === id) as TextItem;
    expect(frameState(textDocument(), frameAt(text)).overlays.map((o) => o.id)).toEqual([id]);
    return {
      text,
      frame: frames.get(frameAt(text)) as Uint8Array,
      g: textGeometry(text, { width: LAYOUT_W, height: LAYOUT_H }),
    };
  }

  it('centres a line on the item centre, inside its box', () => {
    const { frame, g, text } = shown('centred');
    const ink = inkOf(frame, bright);
    expect(ink.count).toBeGreaterThan(1_000);
    expect(Math.abs(ink.cx - g.cx)).toBeLessThanOrEqual(3);
    // Capitals sit a little above the line centre: within a tenth of the size.
    expect(Math.abs(ink.cy - g.cy)).toBeLessThanOrEqual(text.style.size * 0.1);
    expect(ink.minX).toBeGreaterThanOrEqual(g.boxLeft);
    expect(ink.maxX).toBeLessThanOrEqual(g.boxLeft + g.boxWidth);
    console.info(
      `text parity centred: ink centre off by ${(ink.cx - g.cx).toFixed(1)}, ${(ink.cy - g.cy).toFixed(1)} px`,
    );
  });

  it('starts a left-aligned text at the box edge, and turns it about the item centre', () => {
    const left = shown('left');
    const ink = inkOf(left.frame, bright);
    // The first letter's side bearing is a few pixels.
    expect(ink.minX - left.g.boxLeft).toBeGreaterThanOrEqual(0);
    expect(ink.minX - left.g.boxLeft).toBeLessThanOrEqual(12);
    const turned = shown('turned');
    const flipped = inkOf(turned.frame, bright);
    // Half a turn about the centre puts the words at the right end of the box, upside down.
    const rightGap = turned.g.boxLeft + turned.g.boxWidth - 1 - flipped.maxX;
    expect(rightGap).toBeGreaterThanOrEqual(-1);
    expect(rightGap).toBeLessThanOrEqual(13);
    expect(Math.abs(flipped.cy - (2 * turned.g.cy - ink.cy))).toBeLessThanOrEqual(3);
  });

  it('turns clockwise: the right end of a bar goes down', () => {
    const { frame, g } = shown('tilted');
    const ink = inkOf(frame, bright);
    const fifth = Math.floor((ink.maxX - ink.minX) / 5);
    const leftY = meanRow(frame, bright, ink.minX, ink.minX + fifth);
    const rightY = meanRow(frame, bright, ink.maxX - fifth, ink.maxX);
    expect(rightY - leftY).toBeGreaterThan(50);
    expect(Math.abs(ink.cx - g.cx)).toBeLessThanOrEqual(3);
    expect(Math.abs(ink.cy - g.cy)).toBeLessThanOrEqual(8);
  });

  it('draws a box about the padding wider than the words', () => {
    const { frame, g } = shown('boxed');
    const box = inkOf(frame, whiteBox);
    expect(box.count).toBeGreaterThan(10_000);
    expect(Math.abs(box.cx - g.cx)).toBeLessThanOrEqual(3);
    // From the box's left edge, along its middle row, to the first dark pixel of the words.
    const y = Math.round(box.cy);
    let x = box.minX;
    while (x < box.maxX && (frame[(y * LAYOUT_W + x) * 3] as number) > 80) x += 1;
    const gap = x - box.minX;
    expect(gap).toBeGreaterThanOrEqual(g.backingPx - 2);
    expect(gap).toBeLessThanOrEqual(g.backingPx + 12);
    console.info(`text parity box: padding ${g.backingPx} px, box edge to words ${gap} px`);
  });

  it('joins a Tamil and a Hindi word through the Noto twins', () => {
    const { frame, g } = shown('scripts');
    const ink = inkOf(frame, bright);
    expect(ink.count).toBeGreaterThan(1_000);
    expect(Math.abs(ink.cx - g.cx)).toBeLessThanOrEqual(6);
  });

  it('fails with font_missing and writes no file when libass falls back to another font', async () => {
    const plan = buildRenderPlan(textDocument([texts[0] as TextItem]), textContext());
    const compiled = compileFfmpeg(plan);
    const main = plan.texts[0]?.main.assName as string;
    // A name no file in the fonts folder carries: libass would quietly draw a system font.
    const broken = {
      ...compiled,
      assFiles: compiled.assFiles.map((file) => ({
        ...file,
        content: file.content.split(main).join('PGF 000000 800'),
      })),
    };
    const error = (await renderClip({
      runTool,
      scratchDir: dir,
      compiled: broken,
      outFile: 'fallback.mp4',
    }).catch((e: unknown) => e)) as RenderError;
    expect(error).toBeInstanceOf(RenderError);
    expect(error.code).toBe('font_missing');
    expect(existsSync(path.join(dir, 'fallback.mp4'))).toBe(false);
    expect(existsSync(path.join(dir, 'fallback.mp4.part'))).toBe(false);
  }, 120_000);
});
