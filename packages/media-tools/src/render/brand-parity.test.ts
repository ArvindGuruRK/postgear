/**
 * The brand kit through the real FFmpeg (Sprint 13, Module 10).
 *
 * A 1080p 30 fps clip (green) with the kit applied by the engine: a logo in
 * its corner, a 720p 25 fps intro (red, another video, another size and
 * rate, its own cover layout) and a closing card (the kit's colour, its logo
 * and a line). Checked:
 *
 * - the export lasts the plan's exact length (ffprobe, within one frame),
 *   and passes `verifyOutput` (size, rate, codec, key frames): the intro of
 *   another size and rate joins with no size error;
 * - stills at `-ss`: the intro's red at its time, the clip's green after it,
 *   the card's colour inside the card, its white logo in the middle and its
 *   yellow line below the logo; the clip's logo in the top right corner.
 *
 * Everything is generated with lavfi sources in a temp folder, never
 * downloaded. Needs `ffmpeg` and `ffprobe` (FFMPEG_PATH / FFPROBE_PATH) and
 * the fonts folder (the card's line is text); skipped with a message
 * otherwise.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import {
  applyBrandKit,
  brandSourceId,
  buildRenderPlan,
  type ClipBrandKit,
  type ClipDocument,
  compileFfmpeg,
  expectedOutputOf,
  verifyOutput,
} from '@postgear/video-engine';
import { toolPaths } from '../run/paths';
import { createRunTool } from '../run/runner';
import type { RunTool, ToolPaths } from '../run/types';
import { renderClip } from './execute';
import { copyFontsInto, defaultFontsDir, type FontsFolder, loadFontsFolder } from './fonts-folder';
import { readOutputFacts } from './output-facts';

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
  console.warn('Brand parity tests skipped: FFmpeg or the fonts folder is not here.');
}

const VIDEO_ID = '6f1c2b8e-3d4a-4b5c-9d6e-7f8091a2b3c4';
const INTRO_ID = '3d4e5f60-7182-493a-9c4d-5e6f708192a3';
const LOGO_ID = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const KIT: ClipBrandKit = {
  id: '1b2c3d4e-5f60-4718-9a2b-3c4d5e6f7081',
  name: 'Parity',
  logo: { assetId: LOGO_ID, width: 128, height: 128 },
  logoPosition: 'top-right',
  captionStyleId: null,
  intro: { videoId: INTRO_ID, durationMs: 2_000, width: 1280, height: 720 },
  outro: { kind: 'card', text: 'Thanks For Watching', background: '#203080', colour: '#FFD43B' },
};

/** A 1080 by 1920 Vertical Fullscreen clip of source 2 to 8 s. */
function clipDocument(): ClipDocument {
  return {
    schemaVersion: 2,
    canvas: { ratio: '9:16', width: 1080, height: 1920, fps: 30, background: '#000000' },
    sources: [{ id: 'src', videoId: VIDEO_ID }],
    segments: [
      { id: 'body', source: 'src', sourceIn: 2_000, sourceOut: 8_000, speed: 1, volume: 1 },
    ],
    layout: {
      kind: 'fullscreen',
      areas: [
        {
          id: 'area',
          name: 'Video',
          frame: { x: 0, y: 0, w: 1, h: 1 },
          crop: [{ at: 0, rect: { x: (1 - 0.31640625) / 2, y: 0, w: 0.31640625, h: 1 } }],
          fit: 'cover',
        },
      ],
    },
    zooms: [],
    looks: { colour: 'none', strength: 0, vignette: 0 },
    fades: { inMs: 0, outMs: 0 },
    tracks: [],
    bleeps: [],
  };
}

describeReal('the brand kit drawn by FFmpeg', () => {
  let dir: string;
  let runTool: RunTool;
  let fonts: FontsFolder;

  async function ffmpeg(args: string[]): Promise<void> {
    await runTool('ffmpeg', ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error', ...args], {
      cwd: dir,
      timeoutMs: 300_000,
    });
  }

  /** The mean RGB of a `w` by `h` box at (`x`, `y`) of the frame at `seconds`. */
  async function colourAt(
    seconds: number,
    box: { x: number; y: number; w: number; h: number },
    name: string,
  ): Promise<[number, number, number]> {
    await ffmpeg([
      '-ss',
      seconds.toFixed(3),
      '-i',
      'brand.mp4',
      '-frames:v',
      '1',
      '-vf',
      `crop=${box.w}:${box.h}:${box.x}:${box.y},scale=1:1:flags=area`,
      '-pix_fmt',
      'rgb24',
      '-f',
      'rawvideo',
      name,
    ]);
    const bytes = readFileSync(path.join(dir, name));
    return [bytes[0] ?? 0, bytes[1] ?? 0, bytes[2] ?? 0];
  }

  /** The brightest yellow-ish pixel count in a box of the frame at `seconds`. */
  async function yellowPixels(
    seconds: number,
    box: { x: number; y: number; w: number; h: number },
  ): Promise<number> {
    await ffmpeg([
      '-ss',
      seconds.toFixed(3),
      '-i',
      'brand.mp4',
      '-frames:v',
      '1',
      '-vf',
      `crop=${box.w}:${box.h}:${box.x}:${box.y}`,
      '-pix_fmt',
      'rgb24',
      '-f',
      'rawvideo',
      'band.rgb',
    ]);
    const bytes = readFileSync(path.join(dir, 'band.rgb'));
    let count = 0;
    for (let p = 0; p + 2 < bytes.length; p += 3) {
      const r = bytes[p] ?? 0;
      const g = bytes[p + 1] ?? 0;
      const b = bytes[p + 2] ?? 0;
      if (r > 200 && g > 170 && b < 120) count += 1;
    }
    return count;
  }

  const near = (seen: number[], want: number[], slack = 24) =>
    seen.every((value, k) => Math.abs(value - (want[k] ?? 0)) <= slack);

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'pg-brand-parity-'));
    runTool = createRunTool(PATHS as ToolPaths);
    const loaded = await loadFontsFolder(path.resolve(FONTS_DIR as string));
    if (!loaded) throw new Error('The fonts folder could not be read');
    fonts = loaded;
    const video = (colour: string, size: string, fps: number, seconds: number, file: string) =>
      ffmpeg([
        '-f',
        'lavfi',
        '-i',
        `color=c=${colour}:s=${size}:r=${fps}:d=${seconds}`,
        '-f',
        'lavfi',
        '-t',
        String(seconds),
        '-i',
        'sine=frequency=440:sample_rate=48000',
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-pix_fmt',
        'yuv420p',
        '-g',
        String(fps),
        '-c:a',
        'aac',
        '-ac',
        '2',
        '-t',
        String(seconds),
        file,
      ]);
    // The clip's video: green, 1080p 30 fps. The intro: red, 720p 25 fps.
    await video('0x00C000', '1920x1080', 30, 10, 'source.mp4');
    await video('0xD00000', '1280x720', 25, 2, 'intro.mp4');
    // The logo: a white square with an opaque picture.
    await ffmpeg([
      '-f',
      'lavfi',
      '-i',
      'color=c=white:s=128x128:d=0.04',
      '-frames:v',
      '1',
      '-pix_fmt',
      'rgba',
      'logo.png',
    ]);
  }, 300_000);

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('renders the intro, the clip with its logo and the closing card, to the exact length', async () => {
    const doc = applyBrandKit(clipDocument(), KIT);
    const plan = buildRenderPlan(doc, {
      quality: '1080p',
      proof: false,
      watermark: false,
      assets: {
        sources: {
          src: {
            file: 'source.mp4',
            sourceOffsetMs: 0,
            durationMs: 10_000,
            width: 1920,
            height: 1080,
            fps: 30,
            hasAudio: true,
          },
          [brandSourceId(INTRO_ID)]: {
            file: 'intro.mp4',
            sourceOffsetMs: 0,
            durationMs: 2_000,
            width: 1280,
            height: 720,
            fps: 25,
            hasAudio: true,
          },
        },
        stickers: {
          [`asset:${LOGO_ID}`]: {
            file: 'logo.png',
            animated: false,
            width: 128,
            height: 128,
            fps: null,
            frames: null,
          },
        },
        fonts: { dir: 'fonts', manifest: fonts.manifest },
      },
    });
    // 2 s intro, 6 s clip, 2 s card.
    expect(plan.output.durationMs).toBe(10_000);
    expect(plan.cards?.bodyMs).toBe(8_000);
    const compiled = compileFfmpeg(plan);
    expect(compiled.fonts).not.toBeNull();
    expect(
      await copyFontsInto(fonts, compiled.fonts?.files ?? [], dir, compiled.fonts?.dir ?? 'fonts'),
    ).toEqual([]);
    const result = await renderClip({ runTool, scratchDir: dir, compiled, outFile: 'brand.mp4' });

    // The exact length, and a file `verifyOutput` passes (no size or rate error from the intro).
    const facts = await readOutputFacts(runTool, result.file);
    expect(verifyOutput(facts, expectedOutputOf(plan))).toEqual([]);
    expect(Math.abs((facts.durationMs ?? 0) - 10_000)).toBeLessThanOrEqual(1000 / 30);
    const probe = await runTool(
      'ffprobe',
      [
        '-v',
        'error',
        '-select_streams',
        'a:0',
        '-show_entries',
        'stream=duration',
        '-of',
        'csv=p=0',
        'brand.mp4',
      ],
      { cwd: dir, timeoutMs: 60_000 },
    );
    expect(Math.abs(Number(probe.stdout.trim()) - 10)).toBeLessThan(1 / 30 + 0.025);

    const middle = { x: 500, y: 300, w: 80, h: 80 };
    // The intro (red), then the clip (green), then the card (its blue).
    expect(near(await colourAt(1.0, middle, 'intro.rgb'), [208, 0, 0], 40)).toBe(true);
    expect(near(await colourAt(5.0, middle, 'clip.rgb'), [0, 192, 0], 40)).toBe(true);
    const cardColour = await colourAt(9.0, { x: 40, y: 40, w: 80, h: 80 }, 'card.rgb');
    expect(near(cardColour, [0x20, 0x30, 0x80])).toBe(true);
    // Not the card yet just before it: still the clip.
    expect(near(await colourAt(7.8, middle, 'late.rgb'), [0, 192, 0], 40)).toBe(true);

    // The card's logo, white, in the middle of the logo box; its line, yellow, below the logo.
    const card = plan.cards?.closing;
    const logo = card?.logo as NonNullable<NonNullable<typeof card>['logo']>;
    const logoCentre = {
      x: logo.x + logo.width / 2 - 20,
      y: logo.y + logo.height / 2 - 20,
      w: 40,
      h: 40,
    };
    expect(near(await colourAt(9.0, logoCentre, 'card-logo.rgb'), [255, 255, 255], 20)).toBe(true);
    const lineY = Math.round(card?.text?.geometry.cy ?? 0);
    expect(await yellowPixels(9.0, { x: 0, y: lineY - 40, w: 1080, h: 80 })).toBeGreaterThan(500);
    // No line during the clip.
    expect(await yellowPixels(5.0, { x: 0, y: lineY - 40, w: 1080, h: 80 })).toBe(0);

    // The clip's logo sticker in the top right corner, white, over the intro and the clip.
    const sticker = plan.stickers[0] as NonNullable<(typeof plan.stickers)[0]>;
    const stickerCentre = {
      x: sticker.x + sticker.width / 2 - 10,
      y: sticker.y + sticker.height / 2 - 10,
      w: 20,
      h: 20,
    };
    expect(sticker.x + sticker.width).toBeLessThan(1080);
    expect(near(await colourAt(1.0, stickerCentre, 'logo-intro.rgb'), [255, 255, 255], 20)).toBe(
      true,
    );
    expect(near(await colourAt(5.0, stickerCentre, 'logo-clip.rgb'), [255, 255, 255], 20)).toBe(
      true,
    );
  }, 600_000);
});
