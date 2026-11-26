/**
 * `npm run clips:benchmark`: how fast this machine renders a clip.
 *
 * Renders the same generated 20 second clip (a 1920 by 1080, 30 fps
 * `testsrc2` picture with a tone) through the real compiler at 720p30,
 * 1080p30, 1080p60 and the Preview Export shape, once per layout. The
 * layouts are the real Vertical presets (`applyLayout`): by default
 * Fullscreen, Blurred (a small copy, blurred, scaled back up, with the
 * picture overlaid), Gameplay (the game plus a rounded camera box: the looped
 * mask and `alphamerge`) and Screen Share (the blurred base, a screen band
 * and a rounded camera), the ones that decide the worker's size; `--layouts
 * all` adds Split, Three and Four. For each it prints the render time per
 * second of clip, "x realtime" (seconds of clip made per wall second, the
 * cookbook's figure), FFmpeg's peak memory and the CPU count. The plan limits
 * and the production worker size are read from this table, so paste it into
 * the Progress notes with the host it ran on.
 *
 * Nothing is downloaded: the source is made with `lavfi`. Options:
 *   --seconds 20                      clip length
 *   --qualities 720p,1080p,1080p60,proof
 *   --layouts fullscreen,blurred,gameplay,screen_share   (or `all`)
 *   --keep <folder>                   keep each render there as <layout>-<quality>.mp4
 *                                     (for `clips:stills`); relative to where it was started
 *   --text heavy                      put the text-heavy overlay on every clip: a four
 *                                     line paragraph with an outline, a shadowed title
 *                                     and a boxed label, the slowest thing libass draws
 *                                     (needs `npm run clips:fonts:build`)
 */

import { copyFile, mkdir } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  applyLayout,
  buildRenderPlan,
  type ClipDocument,
  compileFfmpeg,
  copyTextStyle,
  type ExportQuality,
  ffmpegArgsFor,
  isExportQuality,
  layoutsFor,
  type PresetKind,
  type TextItem,
  textStylePreset,
} from '@postgear/video-engine';
import { writeRenderFiles } from '../src/render/execute';
import {
  copyFontsInto,
  defaultFontsDir,
  type FontsFolder,
  loadFontsFolder,
} from '../src/render/fonts-folder';
import { toolPaths } from '../src/run/paths';
import { createRunTool } from '../src/run/runner';
import { withScratch } from '../src/run/scratch';
import type { RunTool } from '../src/run/types';

type Layout = PresetKind;
type Shape = ExportQuality | 'proof';

const VERTICAL_LAYOUTS: readonly Layout[] = layoutsFor('9:16');
const DEFAULT_LAYOUTS = 'fullscreen,blurred,gameplay,screen_share';
const STARTED_IN = process.env.INIT_CWD ?? process.cwd();

interface Options {
  seconds: number;
  shapes: Shape[];
  layouts: Layout[];
  keepDir: string | null;
  text: boolean;
}

interface Row {
  /** The layout, with ` + text` when the text-heavy overlay was on. */
  layout: string;
  shape: Shape;
  size: string;
  wallSeconds: number;
  peakMb: number | null;
}

const SOURCE_PREROLL_MS = 2_000;

function readOptions(argv: readonly string[]): Options {
  const value = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const seconds = Number(value('--seconds') ?? '20');
  if (!Number.isInteger(seconds) || seconds < 3 || seconds > 600) {
    throw new Error('--seconds must be a whole number from 3 to 600');
  }
  const shapes = (value('--qualities') ?? '720p,1080p,1080p60,proof')
    .split(',')
    .map((s) => s.trim());
  for (const shape of shapes) {
    if (shape !== 'proof' && !isExportQuality(shape)) {
      throw new Error(`Unknown quality ${shape}`);
    }
  }
  const layoutArg = value('--layouts') ?? DEFAULT_LAYOUTS;
  const layouts =
    layoutArg.trim() === 'all' ? [...VERTICAL_LAYOUTS] : layoutArg.split(',').map((s) => s.trim());
  for (const layout of layouts) {
    if (!(VERTICAL_LAYOUTS as readonly string[]).includes(layout)) {
      throw new Error(`Unknown layout ${layout}; expected one of ${VERTICAL_LAYOUTS.join(', ')}`);
    }
  }
  const keep = value('--keep');
  const text = value('--text') ?? 'none';
  if (text !== 'none' && text !== 'heavy') {
    throw new Error('--text must be none or heavy');
  }
  return {
    text: text === 'heavy',
    seconds,
    shapes: shapes as Shape[],
    layouts: layouts as Layout[],
    keepDir: keep ? path.resolve(STARTED_IN, keep) : null,
  };
}

/** The text-heavy overlay: a four-line outlined paragraph, a shadowed title and a boxed label, all clip long. */
function heavyText(seconds: number): TextItem[] {
  const item = (
    id: string,
    styleId: 'bold-outline' | 'plain' | 'on-a-box',
    text: string,
    y: number,
  ): TextItem => ({
    id,
    type: 'text',
    start: 0,
    duration: seconds * 1000,
    anchor: 'clip',
    text,
    style: copyTextStyle(textStylePreset(styleId).style),
    transform: { x: 0.5, y, scale: 1, rotation: 0, opacity: 1 },
    widthPx: 900,
    fadeInMs: 0,
    fadeOutMs: 0,
  });
  return [
    item(
      'txt_paragraph',
      'bold-outline',
      'This is the longest kind of text a clip carries: four full lines of words, each one with its own outline, wrapped inside the box',
      0.62,
    ),
    item('txt_title', 'plain', 'A Title With A Shadow', 0.14),
    item('txt_label', 'on-a-box', 'On A Box', 0.88),
  ];
}

/** The benchmark clip: one segment, Vertical, with the real preset of `layout` for a 16:9 video. */
function benchmarkDocument(layout: Layout, seconds: number, text: boolean): ClipDocument {
  const base: ClipDocument = {
    schemaVersion: 2,
    bleeps: [],
    canvas: { ratio: '9:16', width: 1080, height: 1920, fps: 30, background: '#000000' },
    sources: [{ id: 'src', videoId: '6f1c2b8e-3d4a-4b5c-9d6e-7f8091a2b3c4' }],
    segments: [
      {
        id: 'seg',
        source: 'src',
        sourceIn: SOURCE_PREROLL_MS,
        sourceOut: SOURCE_PREROLL_MS + seconds * 1000,
        speed: 1,
        volume: 1,
      },
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
    tracks: [],
  };
  const laidOut = applyLayout(base, layout, { width: 1920, height: 1080 });
  return text
    ? { ...laidOut, tracks: [{ id: 'trk_text', kind: 'overlay', items: heavyText(seconds) }] }
    : laidOut;
}

async function makeSource(runTool: RunTool, dir: string, seconds: number): Promise<number> {
  const totalSeconds = seconds + (2 * SOURCE_PREROLL_MS) / 1000;
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
      `testsrc2=s=1920x1080:r=30:d=${totalSeconds}`,
      '-f',
      'lavfi',
      '-i',
      `sine=frequency=440:sample_rate=48000:duration=${totalSeconds}`,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '18',
      '-pix_fmt',
      'yuv420p',
      '-g',
      '60',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-movflags',
      '+faststart',
      'source.mp4',
    ],
    { cwd: dir, timeoutMs: 10 * 60_000 },
  );
  return totalSeconds * 1000;
}

/** One render with FFmpeg's own `-benchmark` report, read from stderr for the peak memory. */
async function renderOnce(
  runTool: RunTool,
  dir: string,
  layout: Layout,
  shape: Shape,
  seconds: number,
  sourceMs: number,
  fonts: FontsFolder | null,
): Promise<Row> {
  const plan = buildRenderPlan(benchmarkDocument(layout, seconds, fonts !== null), {
    quality: shape === 'proof' ? '1080p' : shape,
    proof: shape === 'proof',
    watermark: false,
    assets: {
      sources: {
        src: {
          file: 'source.mp4',
          sourceOffsetMs: 0,
          durationMs: sourceMs,
          width: 1920,
          height: 1080,
          fps: 30,
          hasAudio: true,
        },
      },
      fonts: fonts ? { dir: 'fonts', manifest: fonts.manifest } : null,
    },
  });
  const compiled = compileFfmpeg(plan);
  await writeRenderFiles(dir, compiled);
  if (fonts && compiled.fonts) {
    const missing = await copyFontsInto(fonts, compiled.fonts.files, dir, compiled.fonts.dir);
    if (missing.length > 0) {
      throw new Error(
        `The fonts folder lacks ${missing.join(', ')}: run npm run clips:fonts:build`,
      );
    }
  }

  // The production arguments, with the log level raised so `-benchmark` prints its memory line.
  const args = ffmpegArgsFor(compiled, 'bench.mp4');
  const level = args.indexOf('-loglevel');
  if (level >= 0) {
    args[level + 1] = 'info';
  }
  args.unshift('-benchmark');

  let peakKb: number | null = null;
  const result = await runTool('ffmpeg', args, {
    cwd: dir,
    timeoutMs: 60 * 60_000,
    onStderrLine: (line) => {
      const match = /bench:\s*maxrss=(\d+)\s*KiB/i.exec(line);
      if (match) {
        peakKb = Number(match[1]);
      }
    },
  });
  if (result.exitCode !== 0) {
    throw new Error(`FFmpeg exited with ${result.exitCode}`);
  }
  return {
    layout: fonts ? `${layout} + text` : layout,
    shape,
    size: `${plan.output.width}x${plan.output.height} @ ${plan.output.fps}`,
    wallSeconds: result.durationMs / 1000,
    peakMb: peakKb === null ? null : Math.round(peakKb / 1024),
  };
}

function formatTable(rows: readonly Row[], seconds: number): string[] {
  const lines = [
    '| Layout | Quality | Output | Render seconds | Seconds per clip second | x realtime | Peak memory |',
    '|---|---|---|---|---|---|---|',
  ];
  for (const row of rows) {
    const perSecond = row.wallSeconds / seconds;
    const realtime = seconds / row.wallSeconds;
    lines.push(
      `| ${row.layout} | ${row.shape} | ${row.size} | ${row.wallSeconds.toFixed(1)} | ` +
        `${perSecond.toFixed(2)} | ${realtime.toFixed(2)}x | ${row.peakMb === null ? 'n/a' : `${row.peakMb} MB`} |`,
    );
  }
  return lines;
}

async function ffmpegVersion(runTool: RunTool, cwd: string): Promise<string> {
  const result = await runTool('ffmpeg', ['-hide_banner', '-version'], { cwd, timeoutMs: 30_000 });
  return result.stdout.split(/\r?\n/)[0] ?? 'unknown';
}

async function main(): Promise<number> {
  const options = readOptions(process.argv.slice(2));
  const runTool = createRunTool(toolPaths(process.env));
  const root = process.env.CLIPS_SCRATCH_DIR?.trim() || os.tmpdir();
  const cpus = os.cpus();
  let fonts: FontsFolder | null = null;
  if (options.text) {
    const fontsDir = process.env.CLIPS_FONTS_DIR?.trim() || defaultFontsDir();
    fonts = fontsDir ? await loadFontsFolder(path.resolve(STARTED_IN, fontsDir)) : null;
    if (!fonts) {
      throw new Error('--text heavy needs the fonts folder: run npm run clips:fonts:build');
    }
  }

  await withScratch(path.resolve(root), `benchmark-${Date.now()}`, async (dir) => {
    const version = await ffmpegVersion(runTool, dir);
    process.stdout.write(`Making a ${options.seconds} second test source...\n`);
    const sourceMs = await makeSource(runTool, dir, options.seconds);

    const rows: Row[] = [];
    for (const layout of options.layouts) {
      for (const shape of options.shapes) {
        process.stdout.write(`Rendering ${layout} at ${shape}...\n`);
        rows.push(await renderOnce(runTool, dir, layout, shape, options.seconds, sourceMs, fonts));
        if (options.keepDir) {
          await mkdir(options.keepDir, { recursive: true });
          await copyFile(
            path.join(dir, 'bench.mp4'),
            path.join(options.keepDir, `${layout}-${shape}.mp4`),
          );
        }
      }
    }

    process.stdout.write('\n');
    process.stdout.write(`${version}\n`);
    process.stdout.write(
      `CPU: ${cpus[0]?.model.trim() ?? 'unknown'}, ${cpus.length} logical cores; ` +
        `${Math.round(os.totalmem() / 1024 ** 3)} GB memory; ${os.platform()} ${os.release()}\n`,
    );
    process.stdout.write(
      `Clip: ${options.seconds} s, generated 1920x1080 30 fps source, veryfast (proof: ultrafast)${options.text ? ', with the text-heavy overlay' : ''}\n\n`,
    );
    for (const line of formatTable(rows, options.seconds)) {
      process.stdout.write(`${line}\n`);
    }
  });
  return 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(
      `The benchmark could not run: ${error instanceof Error ? error.message : 'unknown error'}\n`,
    );
    process.exitCode = 1;
  },
);
