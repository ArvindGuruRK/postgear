/**
 * `npm run clips:captions:stills -- --out <folder>`: one still per caption
 * style, drawn by the real export path (Sprint 13, Module 03).
 *
 * Renders a short clip with captions through the compiler and FFmpeg for
 * every built-in style, in English, Tamil and Hindi, and saves a frame taken
 * while a word is being said. It is the look check for the ASS writer: the
 * spoken word's mark, the outline or box, the line breaks, and that Tamil and
 * Hindi letters join (a dotted circle in a frame means a style change landed
 * inside a letter cluster). Nothing is downloaded: the picture is one of
 * FFmpeg's own test sources. Needs the fonts folder.
 *
 *   --out <folder>     where the stills go (default: a `caption-stills` folder where it was started)
 *   --at <ms>          the clip moment of the still (default 1300)
 *   --quality 720p     the export quality rendered
 */
import { copyFile, mkdir } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  buildRenderPlan,
  CAPTION_STYLES,
  type CaptionsTrack,
  type ClipDocument,
  compileFfmpeg,
  CURRENT_SCHEMA_VERSION,
  type ExportQuality,
  isExportQuality,
  type Transcript,
  TRANSCRIPT_VERSION,
} from '@postgear/video-engine';
import { renderClip, writeRenderFiles } from '../src/render/execute';
import { copyFontsInto, defaultFontsDir, loadFontsFolder } from '../src/render/fonts-folder';
import { toolPaths } from '../src/run/paths';
import { createRunTool } from '../src/run/runner';
import { withScratch } from '../src/run/scratch';

const VIDEO_ID = '6f1c2b8e-3d4a-4b5c-9d6e-7f8091a2b3c4';
const TRANSCRIPT_ID = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const STARTED_IN = process.env.INIT_CWD ?? process.cwd();
const CLIP_SECONDS = 4;

const LINES: Record<string, { language: string; words: string[] }> = {
  english: { language: 'en', words: ['So', 'today', 'we', 'cleared', 'the', 'whole', 'gap!'] },
  tamil: { language: 'ta', words: ['நண்பர்களே,', 'இந்த', 'விளையாட்டு', 'மிகவும்', 'அருமை.'] },
  hindi: { language: 'hi', words: ['नमस्ते', 'दोस्तों,', 'यह', 'खेल', 'शानदार', 'है।'] },
};

function transcriptOf(language: string, words: string[]): Transcript {
  const step = 480;
  return {
    version: TRANSCRIPT_VERSION,
    language,
    model: 'stills',
    source: 'listened',
    covered: [{ fromMs: 0, toMs: CLIP_SECONDS * 1000 }],
    words: words.map((text, i) => ({
      i,
      start: 400 + i * step,
      end: 400 + i * step + 400,
      text,
      sure: 0.95,
    })),
    nextIndex: words.length,
  };
}

function documentWith(track: CaptionsTrack): ClipDocument {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    canvas: { ratio: '9:16', width: 1080, height: 1920, fps: 30, background: '#000000' },
    sources: [{ id: 'src', videoId: VIDEO_ID }],
    segments: [
      { id: 'seg', source: 'src', sourceIn: 0, sourceOut: CLIP_SECONDS * 1000, speed: 1, volume: 1 },
    ],
    layout: {
      kind: 'fullscreen',
      areas: [
        {
          id: 'main',
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
    tracks: [track],
    bleeps: [],
  };
}

async function main(argv: readonly string[]): Promise<number> {
  const value = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const outDir = path.resolve(STARTED_IN, value('--out') ?? 'caption-stills');
  const atMs = Number(value('--at') ?? '1300');
  const quality = (value('--quality') ?? '720p') as ExportQuality;
  if (!isExportQuality(quality)) throw new Error(`Unknown quality ${quality}`);
  if (!Number.isFinite(atMs) || atMs < 0 || atMs >= CLIP_SECONDS * 1000) {
    throw new Error('--at must be a moment inside the four second clip');
  }

  const runTool = createRunTool(toolPaths(process.env));
  const fontsDir = process.env.CLIPS_FONTS_DIR?.trim() || defaultFontsDir();
  const fonts = fontsDir ? await loadFontsFolder(path.resolve(fontsDir)) : null;
  if (!fonts) throw new Error('The stills need the fonts folder: run npm run clips:fonts:build');
  await mkdir(outDir, { recursive: true });

  const root = process.env.CLIPS_SCRATCH_DIR?.trim() || os.tmpdir();
  await withScratch(root, `caption-stills-${Date.now()}`, async (dir) => {
    const ffmpeg = (args: string[]) =>
      runTool('ffmpeg', ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error', ...args], {
        cwd: dir,
        timeoutMs: 5 * 60_000,
      });
    await ffmpeg([
      '-f',
      'lavfi',
      '-i',
      `testsrc2=s=1920x1080:r=30:d=${CLIP_SECONDS + 1}`,
      '-f',
      'lavfi',
      '-i',
      `sine=frequency=330:sample_rate=48000:duration=${CLIP_SECONDS + 1}`,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '20',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-ac',
      '2',
      'source.mp4',
    ]);

    for (const style of CAPTION_STYLES) {
      for (const [name, line] of Object.entries(LINES)) {
        const track: CaptionsTrack = {
          id: 'cc',
          kind: 'captions',
          transcriptAssetId: TRANSCRIPT_ID,
          language: line.language,
          styleId: style.id,
          position: { x: 0.5, y: 0.72 },
          sizePx: style.look.sizePx,
          maxWords: style.look.maxWords,
          edits: {},
        };
        const plan = buildRenderPlan(documentWith(track), {
          quality,
          proof: false,
          watermark: false,
          assets: {
            sources: {
              src: {
                file: 'source.mp4',
                sourceOffsetMs: 0,
                durationMs: (CLIP_SECONDS + 1) * 1000,
                width: 1920,
                height: 1080,
                fps: 30,
                hasAudio: true,
              },
            },
            fonts: { dir: 'fonts', manifest: fonts.manifest },
            captions: {
              transcript: transcriptOf(line.language, line.words),
              look: style.look,
              wordTimed: true,
            },
          },
        });
        const compiled = compileFfmpeg(plan);
        await writeRenderFiles(dir, compiled);
        if (compiled.fonts) {
          const missing = await copyFontsInto(fonts, compiled.fonts.files, dir, compiled.fonts.dir);
          if (missing.length > 0) throw new Error(`The fonts folder lacks ${missing.join(', ')}`);
        }
        const stem = `${style.id}-${name}`;
        await renderClip({ runTool, scratchDir: dir, compiled, outFile: `${stem}.mp4` });
        await ffmpeg([
          '-ss',
          (atMs / 1000).toFixed(3),
          '-i',
          `${stem}.mp4`,
          '-frames:v',
          '1',
          `${stem}.png`,
        ]);
        await copyFile(path.join(dir, `${stem}.png`), path.join(outDir, `${stem}.png`));
        if (name === 'english' && style.id === CAPTION_STYLES[0]?.id) {
          await copyFile(path.join(dir, 'captions.ass'), path.join(outDir, `${stem}.ass`));
        }
        process.stdout.write(`  ${stem}.png\n`);
      }
    }
  });
  process.stdout.write(`Stills are in ${outDir}\n`);
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(
      `The caption stills could not be made: ${error instanceof Error ? error.message : 'unknown error'}\n`,
    );
    process.exitCode = 1;
  },
);
