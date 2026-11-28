/**
 * Security sweep, Sprint 13 Module 16: a caption never draws past its box,
 * checked on real pixels. One small render each: a caption with no spaces and
 * a long Tamil word, in the style whose spoken word pops, read back at the
 * pop's peak and once it settles. Every caption pixel must sit inside the
 * caption box's columns (the pure version, for every style and script, is
 * `packages/video-engine/src/render/captions.security.test.ts`).
 *
 * Skipped, with a warning, where FFmpeg or the fonts folder is missing (CI).
 * Locally: FFMPEG_PATH and FFPROBE_PATH at `infra/docker/worker/bin`.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import {
  buildRenderPlan,
  builtInCaptionStyle,
  type CaptionLook,
  type ClipDocument,
  compileFfmpeg,
  CURRENT_SCHEMA_VERSION,
  type Transcript,
} from '@postgear/video-engine';
import { toolPaths } from '../run/paths';
import { createRunTool } from '../run/runner';
import type { RunTool, ToolPaths } from '../run/types';
import { renderClip, writeRenderFiles } from './execute';
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
  console.warn('Caption box tests skipped: FFmpeg or the fonts folder is not here.');
}

const STYLE = 'bold-pop';
const OUT = { width: 720, height: 1280 };
const look = (): CaptionLook => (builtInCaptionStyle(STYLE) as { look: CaptionLook }).look;

/** One word, said from 0.6 s to 2.6 s. */
function spoken(text: string, language: string): Transcript {
  return {
    version: 1,
    language,
    model: 'box',
    source: 'listened',
    covered: [{ fromMs: 0, toMs: 3_000 }],
    words: [{ i: 0, start: 600, end: 2_600, text, sure: 1 }],
    nextIndex: 1,
  };
}

function documentFor(language: string): ClipDocument {
  const chosen = look();
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    canvas: { ratio: '9:16', width: 1080, height: 1920, fps: 30, background: '#000000' },
    sources: [{ id: 'src', videoId: '6f1c2b8e-3d4a-4b5c-9d6e-7f8091a2b3c4' }],
    segments: [{ id: 'seg', source: 'src', sourceIn: 0, sourceOut: 3_000, speed: 1, volume: 1 }],
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
    tracks: [
      {
        id: 'cc',
        kind: 'captions',
        transcriptAssetId: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
        language,
        styleId: STYLE,
        position: { x: 0.5, y: 0.72 },
        sizePx: chosen.sizePx,
        maxWords: chosen.maxWords,
        edits: {},
      },
    ],
    bleeps: [],
  };
}

/** A caption's fill: white words, or the yellow spoken one. The picture is dark blue. */
const isCaption = (r: number, g: number, b: number) =>
  (r > 215 && g > 215 && b > 215) || (r > 200 && g > 180 && b < 110);

describeReal('a caption drawn by FFmpeg stays inside its box', () => {
  let dir: string;
  let runTool: RunTool;
  let fonts: FontsFolder;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'pg-caption-box-'));
    runTool = createRunTool(PATHS as ToolPaths);
    const loaded = await loadFontsFolder(path.resolve(FONTS_DIR as string));
    if (!loaded) throw new Error('The fonts folder could not be read');
    fonts = loaded;
    await runTool(
      'ffmpeg',
      [
        ...['-hide_banner', '-nostdin', '-y', '-loglevel', 'error'],
        ...['-f', 'lavfi', '-i', 'color=c=0x181830:s=270x480:r=30:d=3'],
        ...['-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000'],
        ...['-t', '3', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p'],
        ...['-c:a', 'aac', 'source.mp4'],
      ],
      { cwd: dir, timeoutMs: 120_000 },
    );
  });

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  async function frameAt(file: string, ms: number): Promise<Uint8Array> {
    const out = `${file}-${ms}.rgb`;
    await runTool(
      'ffmpeg',
      [
        ...['-hide_banner', '-nostdin', '-y', '-loglevel', 'error'],
        ...['-ss', (ms / 1000).toFixed(3), '-i', file],
        ...['-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', out],
      ],
      { cwd: dir, timeoutMs: 60_000 },
    );
    const pixels = new Uint8Array(readFileSync(path.join(dir, out)));
    expect(pixels.length).toBe(OUT.width * OUT.height * 3);
    return pixels;
  }

  /** The leftmost and rightmost columns holding a caption pixel, and how many there are. */
  function columns(pixels: Uint8Array): { left: number; right: number; n: number } {
    let left = OUT.width;
    let right = -1;
    let n = 0;
    for (let at = 0; at < pixels.length; at += 3) {
      if (!isCaption(pixels[at] as number, pixels[at + 1] as number, pixels[at + 2] as number)) {
        continue;
      }
      const x = (at / 3) % OUT.width;
      left = Math.min(left, x);
      right = Math.max(right, x);
      n += 1;
    }
    return { left, right, n };
  }

  it.each([
    ['a caption with no spaces', 'en', 'thisisonecaptionwithnospacesatallsonothingcanbreakit'],
    ['a long Tamil word', 'ta', 'நண்பர்களேஇந்தவிளையாட்டுமிகவும்அருமையானதுஇல்லையா'],
  ])('%s', async (_name, language, text) => {
    const plan = buildRenderPlan(documentFor(language), {
      quality: '720p',
      proof: false,
      watermark: false,
      assets: {
        sources: {
          src: {
            file: 'source.mp4',
            sourceOffsetMs: 0,
            durationMs: 3_000,
            width: 270,
            height: 480,
            fps: 30,
            hasAudio: true,
          },
        },
        fonts: { dir: 'fonts', manifest: fonts.manifest },
        captions: { transcript: spoken(text, language), look: look(), wordTimed: true },
      },
    });
    const geometry = plan.captions?.layout.geometry;
    if (!geometry) throw new Error('no captions planned');
    expect(plan.captions?.layout.pages[0]?.scale).toBeLessThan(1);

    const compiled = compileFfmpeg(plan);
    await writeRenderFiles(dir, compiled);
    if (compiled.fonts) {
      expect(await copyFontsInto(fonts, compiled.fonts.files, dir, compiled.fonts.dir)).toEqual([]);
    }
    const file = `${language}.mp4`;
    await renderClip({ runTool, scratchDir: dir, compiled, outFile: file });

    // The box in output pixels, one pixel of give for the scaler's edge.
    const share = OUT.width / 1080;
    const boxLeft = geometry.boxLeft * share - 1;
    const boxRight = (geometry.boxLeft + geometry.boxWidth) * share + 1;
    // 633 ms: the pop's peak (the word pops from 600 ms for 90 ms). 1 500 ms: settled.
    for (const ms of [633, 1_500]) {
      const drawn = columns(await frameAt(file, ms));
      expect(drawn.n).toBeGreaterThan(300);
      expect(drawn.left).toBeGreaterThanOrEqual(boxLeft);
      expect(drawn.right).toBeLessThanOrEqual(boxRight);
    }
  });
});
