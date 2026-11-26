/**
 * Captions through the real FFmpeg (Sprint 13, Module 03): what the ASS
 * writer says is what libass draws.
 *
 * A flat dark picture with captions is rendered through the compiler and the
 * executor, and single frames are read back as pixels:
 * - the spoken word has the mark colour while it is said, and no caption is
 *   on screen before the first page or after the last;
 * - Karaoke shows said words in the fill colour and waiting words in white;
 * - the same clip at the Preview Export size and at 720p puts the captions at
 *   the same relative place (one ASS file, scaled by libass);
 * - a Tamil and a Hindi page render with the bundled fonts and no fallback;
 * - a frame rendered twice is the same picture;
 * - a face libass picked outside the plan fails the render with `font_missing`.
 *
 * Skipped, with a warning, where FFmpeg or the fonts folder is missing (CI).
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import {
  buildRenderPlan,
  builtInCaptionStyle,
  type CaptionLook,
  type CaptionsTrack,
  type ClipDocument,
  compileFfmpeg,
  CURRENT_SCHEMA_VERSION,
  type Transcript,
} from '@postgear/video-engine';
import { toolPaths } from '../run/paths';
import { createRunTool } from '../run/runner';
import type { RunTool, ToolPaths } from '../run/types';
import { RenderError, renderClip, writeRenderFiles } from './execute';
import { copyFontsInto, defaultFontsDir, type FontsFolder, loadFontsFolder } from './fonts-folder';

jest.setTimeout(600_000);

function findTool(program: string): boolean {
  if (path.isAbsolute(program)) return existsSync(program);
  const dirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  return dirs.some((dir) => existsSync(path.join(dir, program)));
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
const FONTS_DIR = process.env.CLIPS_FONTS_DIR?.trim() || defaultFontsDir();
const HAS_FONTS = Boolean(FONTS_DIR && existsSync(path.join(FONTS_DIR, 'manifest.json')));
const describeReal = PATHS && HAS_FONTS ? describe : describe.skip;
if (!PATHS || !HAS_FONTS) {
  console.warn('Caption parity tests skipped: FFmpeg or the fonts folder is not here.');
}

const CLIP_MS = 4_000;
const look = (id: string): CaptionLook => (builtInCaptionStyle(id) as { look: CaptionLook }).look;

/** Words 480 ms apart from 0.6 s: word k is said from 600 + 480k. */
function transcript(texts: string[], language = 'en'): Transcript {
  return {
    version: 1,
    language,
    model: 'parity',
    source: 'listened',
    covered: [{ fromMs: 0, toMs: CLIP_MS }],
    words: texts.map((text, i) => ({
      i,
      start: 600 + i * 480,
      end: 600 + i * 480 + 400,
      text,
      sure: 1,
    })),
    nextIndex: texts.length,
  };
}

function documentWith(styleId: string, language: string): ClipDocument {
  const chosen = look(styleId);
  const track: CaptionsTrack = {
    id: 'cc',
    kind: 'captions',
    transcriptAssetId: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
    language,
    styleId,
    position: { x: 0.5, y: 0.72 },
    sizePx: chosen.sizePx,
    maxWords: chosen.maxWords,
    edits: {},
  };
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    canvas: { ratio: '9:16', width: 1080, height: 1920, fps: 30, background: '#000000' },
    sources: [{ id: 'src', videoId: '6f1c2b8e-3d4a-4b5c-9d6e-7f8091a2b3c4' }],
    segments: [{ id: 'seg', source: 'src', sourceIn: 0, sourceOut: CLIP_MS, speed: 1, volume: 1 }],
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
    tracks: [track],
    bleeps: [],
  };
}

interface Frame {
  width: number;
  height: number;
  /** RGB24. */
  pixels: Uint8Array;
}

type Pick = (r: number, g: number, b: number) => boolean;
const isYellow: Pick = (r, g, b) => r > 200 && g > 180 && b < 110;
const isWhite: Pick = (r, g, b) => r > 215 && g > 215 && b > 215;
const isGreen: Pick = (r, g, b) => g > 170 && r < 120 && b > 90 && b < 200;

function count(frame: Frame, pick: Pick): number {
  let found = 0;
  for (let at = 0; at < frame.pixels.length; at += 3) {
    if (pick(frame.pixels[at] as number, frame.pixels[at + 1] as number, frame.pixels[at + 2] as number)) {
      found += 1;
    }
  }
  return found;
}

/** The centre of the picked pixels, as shares of the frame. */
function centre(frame: Frame, pick: Pick): { x: number; y: number; n: number } {
  let sumX = 0;
  let sumY = 0;
  let n = 0;
  for (let y = 0; y < frame.height; y += 1) {
    for (let x = 0; x < frame.width; x += 1) {
      const at = (y * frame.width + x) * 3;
      if (pick(frame.pixels[at] as number, frame.pixels[at + 1] as number, frame.pixels[at + 2] as number)) {
        sumX += x;
        sumY += y;
        n += 1;
      }
    }
  }
  return { x: n ? sumX / n / frame.width : 0, y: n ? sumY / n / frame.height : 0, n };
}

describeReal('captions drawn by FFmpeg', () => {
  let dir: string;
  let runTool: RunTool;
  let fonts: FontsFolder;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'pg-caption-parity-'));
    runTool = createRunTool(PATHS as ToolPaths);
    const loaded = await loadFontsFolder(path.resolve(FONTS_DIR as string));
    if (!loaded) throw new Error('The fonts folder could not be read');
    fonts = loaded;
    // A flat dark picture, so every bright or coloured pixel is a caption.
    await runTool(
      'ffmpeg',
      [
        '-hide_banner',
        '-nostdin',
        '-y',
        '-loglevel',
        'error',
        '-f',
        'lavfi',
        '-i',
        'color=c=0x181830:s=270x480:r=30:d=5',
        '-f',
        'lavfi',
        '-i',
        'anullsrc=channel_layout=stereo:sample_rate=48000',
        '-t',
        '5',
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        'source.mp4',
      ],
      { cwd: dir, timeoutMs: 120_000 },
    );
  });

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  async function compileClip(
    styleId: string,
    spoken: Transcript,
    options: { proof?: boolean } = {},
  ) {
    const plan = buildRenderPlan(documentWith(styleId, spoken.language), {
      quality: '720p',
      proof: options.proof ?? false,
      watermark: false,
      assets: {
        sources: {
          src: {
            file: 'source.mp4',
            sourceOffsetMs: 0,
            durationMs: 5_000,
            width: 270,
            height: 480,
            fps: 30,
            hasAudio: true,
          },
        },
        fonts: { dir: 'fonts', manifest: fonts.manifest },
        captions: { transcript: spoken, look: look(styleId), wordTimed: true },
      },
    });
    const compiled = compileFfmpeg(plan);
    await writeRenderFiles(dir, compiled);
    if (compiled.fonts) {
      expect(await copyFontsInto(fonts, compiled.fonts.files, dir, compiled.fonts.dir)).toEqual([]);
    }
    return { plan, compiled };
  }

  async function renderTo(name: string, styleId: string, spoken: Transcript, proof = false) {
    const { plan, compiled } = await compileClip(styleId, spoken, { proof });
    await renderClip({ runTool, scratchDir: dir, compiled, outFile: name });
    return plan;
  }

  async function frameAt(file: string, ms: number, width: number, height: number): Promise<Frame> {
    const out = `${file}-${ms}.rgb`;
    await runTool(
      'ffmpeg',
      [
        '-hide_banner',
        '-nostdin',
        '-y',
        '-loglevel',
        'error',
        '-ss',
        (ms / 1000).toFixed(3),
        '-i',
        file,
        '-frames:v',
        '1',
        '-pix_fmt',
        'rgb24',
        '-f',
        'rawvideo',
        out,
      ],
      { cwd: dir, timeoutMs: 60_000 },
    );
    const pixels = new Uint8Array(readFileSync(path.join(dir, out)));
    expect(pixels.length).toBe(width * height * 3);
    return { width, height, pixels };
  }

  it('marks the spoken word in the mark colour while it is said, and shows nothing outside the pages', async () => {
    await renderTo('bold.mp4', 'bold-pop', transcript(['So', 'today', 'we']));
    const before = await frameAt('bold.mp4', 200, 720, 1280);
    const during = await frameAt('bold.mp4', 1_300, 720, 1280);
    const after = await frameAt('bold.mp4', 3_600, 720, 1280);

    expect(count(before, isWhite) + count(before, isYellow)).toBe(0);
    expect(count(after, isWhite) + count(after, isYellow)).toBe(0);
    // "TODAY" in yellow, "SO" and "WE" in white.
    expect(count(during, isYellow)).toBeGreaterThan(2_000);
    expect(count(during, isWhite)).toBeGreaterThan(1_500);
    // The block is centred across, in the lower third.
    const where = centre(during, (r, g, b) => isWhite(r, g, b) || isYellow(r, g, b));
    expect(where.x).toBeGreaterThan(0.46);
    expect(where.x).toBeLessThan(0.54);
    expect(where.y).toBeGreaterThan(0.69);
    expect(where.y).toBeLessThan(0.75);
  });

  it('moves the mark from word to word: the yellow moves right across the page', async () => {
    const first = await frameAt('bold.mp4', 750, 720, 1280);
    const second = await frameAt('bold.mp4', 1_250, 720, 1280);
    const third = await frameAt('bold.mp4', 1_750, 720, 1280);
    const xs = [first, second, third].map((frame) => centre(frame, isYellow).x);
    expect(xs[0] as number).toBeLessThan(xs[1] as number);
    expect(xs[1] as number).toBeLessThan(xs[2] as number);
  });

  it('Karaoke fills said words and leaves waiting words white', async () => {
    await renderTo('karaoke.mp4', 'karaoke', transcript(['So', 'today', 'we', 'cleared']));
    const early = await frameAt('karaoke.mp4', 700, 720, 1280);
    const late = await frameAt('karaoke.mp4', 2_300, 720, 1280);
    expect(count(early, isWhite)).toBeGreaterThan(count(early, isGreen));
    expect(count(late, isGreen)).toBeGreaterThan(count(early, isGreen) * 2);
    expect(count(late, isWhite)).toBeLessThan(count(early, isWhite) / 2);
  });

  it('draws at the same relative place at the Preview Export size and at 720p', async () => {
    const spoken = transcript(['So', 'today', 'we']);
    await renderTo('big.mp4', 'clean', spoken);
    const plan = await renderTo('small.mp4', 'clean', spoken, true);
    const big = centre(await frameAt('big.mp4', 1_300, 720, 1280), isWhite);
    const small = centre(
      await frameAt('small.mp4', 1_300, plan.output.width, plan.output.height),
      isWhite,
    );
    expect(plan.output.width).toBeLessThan(720);
    expect(small.n).toBeGreaterThan(50);
    expect(Math.abs(big.x - small.x)).toBeLessThan(0.02);
    expect(Math.abs(big.y - small.y)).toBeLessThan(0.02);
  });

  it.each([
    ['Tamil', 'ta', ['நண்பர்களே,', 'இந்த', 'விளையாட்டு']],
    ['Hindi', 'hi', ['नमस्ते', 'दोस्तों,', 'यह']],
  ])('renders a %s page with the bundled font and no fallback', async (_name, language, texts) => {
    // `renderClip` fails with font_missing if libass picks any face outside the plan.
    const plan = await renderTo(`${language}.mp4`, 'bold-pop', transcript(texts, language));
    expect(plan.captions?.layout.mark).toBe('none');
    const frame = await frameAt(`${language}.mp4`, 1_000, 720, 1280);
    expect(count(frame, isWhite)).toBeGreaterThan(1_500);
    // A page-level highlight: nothing is in the mark colour.
    expect(count(frame, isYellow)).toBe(0);
  });

  it('renders the same frame twice', async () => {
    const spoken = transcript(['So', 'today', 'we']);
    await renderTo('once.mp4', 'boxed', spoken);
    await renderTo('twice.mp4', 'boxed', spoken);
    const once = await frameAt('once.mp4', 1_300, 720, 1280);
    const twice = await frameAt('twice.mp4', 1_300, 720, 1280);
    expect(Buffer.from(once.pixels).equals(Buffer.from(twice.pixels))).toBe(true);
  });

  it('fails with font_missing when libass picks a face the plan did not name', async () => {
    const { compiled } = await compileClip('bold-pop', transcript(['So', 'today', 'we']));
    const tampered = {
      ...compiled,
      fonts: compiled.fonts ? { ...compiled.fonts, psNames: ['PGF-not-a-font-400'] } : null,
    };
    await expect(
      renderClip({ runTool, scratchDir: dir, compiled: tampered, outFile: 'wrong.mp4' }),
    ).rejects.toMatchObject({ code: 'font_missing' });
    expect(RenderError).toBeDefined();
  });
});
