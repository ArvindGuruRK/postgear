/**
 * `npm run clips:regression`: the saved set of Sprint 12 clips (Sprint 13,
 * Module 01), exported again and compared.
 *
 * Five version 1 clip documents live as JSON in
 * `packages/video-engine/fixtures/v1-clips/`, with `records.json` beside
 * them: each export's length, size and five small frames. Between them they
 * use every Sprint 12 feature that shapes a picture or a sound: each kind of
 * layout, text, a sticker, the Follow Badge, a zoom, two speeds, a look, a
 * vignette, fades and a sound.
 *
 *   npm run clips:regression            export every clip and compare with records.json
 *   npm run clips:regression -- --record   export and write records.json (and the documents)
 *
 * "Add, never rename": a version 1 document must open, play and export the
 * same as before, whatever Sprint 13 adds. Module 16 runs the check at
 * close-out; run it after any change to the document, the compiler or the
 * executor.
 *
 * Nothing is downloaded: the source video, the sticker and the sound are made
 * with FFmpeg's own test sources in a scratch folder. A frame is compared as
 * a 32 by 18 grey picture with a small tolerance, so a different FFmpeg build
 * or encoder thread count does not fail the check, but a moved crop, a
 * missing text or a wrong speed does. Needs the fonts folder (the text clip).
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  applyLayout,
  buildRenderPlan,
  type ClipDocument,
  clipDocumentSchema,
  compileFfmpeg,
  copyTextStyle,
  outputDuration,
  type RenderAssets,
  soundRefKey,
  stickerRefKey,
  textStylePreset,
  upgrade,
} from '@postgear/video-engine';
import { renderClip, writeRenderFiles } from '../src/render/execute';
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

const VIDEO_ID = '6f1c2b8e-3d4a-4b5c-9d6e-7f8091a2b3c4';
const STICKER_ID = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const SOUND_ID = '1b2c3d4e-5f60-4b7c-9d8e-0f1a2b3c4d5e';
const SOURCE_SECONDS = 24;
const SOURCE = { width: 1920, height: 1080, fps: 30 } as const;
const FRAME = { width: 32, height: 18 } as const;
/** Where in each export the five frames are taken, as shares of its length. */
const FRAME_SHARES = [0.1, 0.3, 0.5, 0.7, 0.9] as const;
/** A frame may differ by this many grey levels on average before the check fails. */
const FRAME_TOLERANCE = 6;
/** A length may differ by this many milliseconds (one frame at 30 fps, rounded up). */
const LENGTH_TOLERANCE_MS = 40;

interface FrameRecord {
  atMs: number;
  /** The 32 by 18 grey picture, as hex (576 bytes). */
  grey: string;
  sha256: string;
}

interface ClipRecord {
  name: string;
  what: string;
  quality: '720p' | '1080p';
  durationMs: number;
  bytes: number;
  width: number;
  height: number;
  fps: number;
  frames: FrameRecord[];
}

interface Records {
  version: 1;
  note: string;
  recordedWith: string;
  clips: ClipRecord[];
}

function base(ratio: '9:16' | '1:1', segments: ClipDocument['segments']): ClipDocument {
  const canvas =
    ratio === '9:16'
      ? { ratio, width: 1080, height: 1920, fps: 30 as const, background: '#000000' }
      : { ratio, width: 1080, height: 1080, fps: 30 as const, background: '#101018' };
  const cropWidth = ratio === '9:16' ? 0.31640625 : 0.5625;
  return {
    schemaVersion: 1,
    canvas,
    sources: [{ id: 'src', videoId: VIDEO_ID }],
    segments,
    layout: {
      kind: 'fullscreen',
      areas: [
        {
          id: 'main',
          name: 'Video',
          frame: { x: 0, y: 0, w: 1, h: 1 },
          crop: [{ at: 0, rect: { x: (1 - cropWidth) / 2, y: 0, w: cropWidth, h: 1 } }],
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

const segment = (
  id: string,
  sourceIn: number,
  sourceOut: number,
  speed: 0.25 | 0.5 | 1 | 1.5 | 2 | 4 = 1,
) => ({ id, source: 'src', sourceIn, sourceOut, speed, volume: 1 });

/** The five clips, built once by `--record` and kept as JSON from then on. */
function fixtureDocuments(): Array<{ name: string; what: string; doc: ClipDocument }> {
  const fullscreenText: ClipDocument = {
    ...base('9:16', [segment('seg_a', 2_000, 10_000)]),
    fades: { inMs: 400, outMs: 600 },
    tracks: [
      {
        id: 'trk_text',
        kind: 'overlay',
        items: [
          {
            id: 'txt_title',
            type: 'text',
            start: 500,
            duration: 5_000,
            anchor: 'moment',
            text: 'A Version One Clip',
            style: copyTextStyle(textStylePreset('bold-outline').style),
            transform: { x: 0.5, y: 0.22, scale: 1, rotation: 0, opacity: 1 },
            widthPx: 864,
            fadeInMs: 200,
            fadeOutMs: 200,
          },
          {
            id: 'txt_label',
            type: 'text',
            start: 0,
            duration: 8_000,
            anchor: 'clip',
            text: 'On A Box',
            style: copyTextStyle(textStylePreset('on-a-box').style),
            transform: { x: 0.5, y: 0.86, scale: 1, rotation: -4, opacity: 0.9 },
            widthPx: 600,
            fadeInMs: 0,
            fadeOutMs: 0,
          },
        ],
      },
    ],
  };

  const blurredZoom: ClipDocument = {
    ...applyLayout(base('9:16', [segment('seg_a', 4_000, 12_000)]), 'blurred', SOURCE),
    zooms: [
      {
        id: 'zm_1',
        source: 'src',
        from: 6_000,
        to: 9_000,
        scale: 1.8,
        focus: { x: 0.35, y: 0.4 },
        ease: 400,
      },
    ],
    looks: { colour: 'vintage', strength: 0.8, vignette: 0.5 },
  };

  const splitSpeeds: ClipDocument = applyLayout(
    base('9:16', [
      segment('seg_fast', 2_000, 10_000, 2),
      segment('seg_slow', 12_000, 14_000, 0.5),
    ]),
    'split',
    SOURCE,
  );

  const gameplayStickers: ClipDocument = {
    ...applyLayout(base('9:16', [segment('seg_a', 8_000, 16_000)]), 'gameplay', SOURCE),
    tracks: [
      {
        id: 'trk_over',
        kind: 'overlay',
        items: [
          {
            id: 'stk_own',
            type: 'sticker',
            start: 1_000,
            duration: 4_000,
            anchor: 'moment',
            ref: { asset: STICKER_ID },
            transform: { x: 0.25, y: 0.3, scale: 1.2, rotation: 15, opacity: 1 },
            flipX: true,
            widthPx: 270,
            heightPx: 270,
            loop: true,
          },
          {
            id: 'stk_badge',
            type: 'sticker',
            start: 0,
            duration: 8_000,
            anchor: 'clip',
            ref: { badge: 'twitch', name: 'simstreamer' },
            transform: { x: 0.5, y: 0.82, scale: 1, rotation: 0, opacity: 1 },
            flipX: false,
            widthPx: 420,
            heightPx: 140,
            loop: true,
          },
        ],
      },
    ],
  };

  const squareSound: ClipDocument = {
    ...base('1:1', [segment('seg_a', 1_000, 5_000), segment('seg_b', 15_000, 19_000)]),
    looks: { colour: 'black_white', strength: 1, vignette: 0 },
    tracks: [
      {
        id: 'trk_sound',
        kind: 'audio',
        items: [
          {
            id: 'snd_fx',
            type: 'sfx',
            start: 2_000,
            duration: 2_000,
            anchor: 'clip',
            ref: { asset: SOUND_ID },
            offsetMs: 0,
            volume: 0.8,
            fadeInMs: 100,
            fadeOutMs: 400,
            duck: false,
          },
        ],
      },
    ],
  };

  return [
    {
      name: 'fullscreen-text',
      what: 'Vertical, Fullscreen, two texts (outline, box, turned), fade in and out',
      doc: fullscreenText,
    },
    {
      name: 'blurred-zoom',
      what: 'Vertical, Blurred, a zoom with ease, the Vintage look, a vignette',
      doc: blurredZoom,
    },
    {
      name: 'split-speeds',
      what: 'Vertical, Split, two parts at 2x and 0.5x',
      doc: splitSpeeds,
    },
    {
      name: 'gameplay-stickers',
      what: 'Vertical, Gameplay, an uploaded sticker (flipped, turned) and a Follow Badge',
      doc: gameplayStickers,
    },
    {
      name: 'square-sound',
      what: 'Square, Fullscreen, two parts, Black And White, a sound effect with fades',
      doc: squareSound,
    },
  ];
}

function fixturesDir(): string {
  return path.resolve(__dirname, '..', '..', 'video-engine', 'fixtures', 'v1-clips');
}

async function makeInputs(runTool: RunTool, dir: string): Promise<void> {
  const run = (args: string[]) =>
    runTool('ffmpeg', ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error', ...args], {
      cwd: dir,
      timeoutMs: 10 * 60_000,
    });
  await run([
    '-f',
    'lavfi',
    '-i',
    `testsrc2=s=${SOURCE.width}x${SOURCE.height}:r=${SOURCE.fps}:d=${SOURCE_SECONDS}`,
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=440:sample_rate=48000:duration=${SOURCE_SECONDS}`,
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
    '-ac',
    '2',
    '-movflags',
    '+faststart',
    'source.mp4',
  ]);
  await run([
    '-f',
    'lavfi',
    '-i',
    'color=c=0xffd400:s=512x512,format=rgba,drawbox=x=96:y=96:w=320:h=320:color=0x1a1a2e:t=fill',
    '-frames:v',
    '1',
    'sticker.png',
  ]);
  await run([
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=880:sample_rate=48000:duration=3',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-ac',
    '2',
    'sound.m4a',
  ]);
}

function assetsFor(fonts: FontsFolder): RenderAssets {
  const stickerKey = stickerRefKey({ asset: STICKER_ID });
  return {
    sources: {
      src: {
        file: 'source.mp4',
        sourceOffsetMs: 0,
        durationMs: SOURCE_SECONDS * 1000,
        width: SOURCE.width,
        height: SOURCE.height,
        fps: SOURCE.fps,
        hasAudio: true,
      },
    },
    fonts: { dir: 'fonts', manifest: fonts.manifest },
    stickers: stickerKey
      ? {
          [stickerKey]: {
            file: 'sticker.png',
            animated: false,
            width: 512,
            height: 512,
            fps: null,
            frames: null,
          },
        }
      : null,
    sounds: { [soundRefKey({ asset: SOUND_ID })]: { file: 'sound.m4a', durationMs: 3_000 } },
  };
}

async function probe(
  runTool: RunTool,
  dir: string,
  file: string,
): Promise<{ durationMs: number; width: number; height: number; fps: number }> {
  const result = await runTool(
    'ffprobe',
    [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'format=duration:stream=width,height,r_frame_rate',
      '-print_format',
      'json',
      '--',
      file,
    ],
    { cwd: dir, timeoutMs: 30_000 },
  );
  const parsed = JSON.parse(result.stdout) as {
    format: { duration: string };
    streams: Array<{ width: number; height: number; r_frame_rate: string }>;
  };
  const stream = parsed.streams[0];
  if (!stream) throw new Error(`${file} has no picture`);
  const [num, den] = stream.r_frame_rate.split('/').map(Number);
  return {
    durationMs: Math.round(Number(parsed.format.duration) * 1000),
    width: stream.width,
    height: stream.height,
    fps: Math.round(((num ?? 0) / (den || 1)) * 1000) / 1000,
  };
}

async function frameAt(
  runTool: RunTool,
  dir: string,
  file: string,
  atMs: number,
  out: string,
): Promise<FrameRecord> {
  await runTool(
    'ffmpeg',
    [
      '-hide_banner',
      '-nostdin',
      '-y',
      '-loglevel',
      'error',
      '-ss',
      (atMs / 1000).toFixed(3),
      '-i',
      file,
      '-frames:v',
      '1',
      '-vf',
      `scale=${FRAME.width}:${FRAME.height}:flags=area,format=gray`,
      '-f',
      'rawvideo',
      out,
    ],
    { cwd: dir, timeoutMs: 60_000 },
  );
  const bytes = await readFile(path.join(dir, out));
  if (bytes.length !== FRAME.width * FRAME.height) {
    throw new Error(`The frame at ${atMs} ms of ${file} could not be read`);
  }
  return {
    atMs,
    grey: bytes.toString('hex'),
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

async function exportOne(
  runTool: RunTool,
  dir: string,
  fonts: FontsFolder,
  name: string,
  what: string,
  doc: ClipDocument,
): Promise<ClipRecord> {
  const quality = '720p' as const;
  const plan = buildRenderPlan(doc, {
    quality,
    proof: false,
    watermark: false,
    assets: assetsFor(fonts),
  });
  const compiled = compileFfmpeg(plan);
  await writeRenderFiles(dir, compiled);
  if (compiled.fonts) {
    const missing = await copyFontsInto(fonts, compiled.fonts.files, dir, compiled.fonts.dir);
    if (missing.length > 0) {
      throw new Error(`The fonts folder lacks ${missing.join(', ')}: run npm run clips:fonts:build`);
    }
  }
  const outFile = `${name}.mp4`;
  const rendered = await renderClip({ runTool, scratchDir: dir, compiled, outFile });
  const facts = await probe(runTool, dir, outFile);
  const frames: FrameRecord[] = [];
  for (const [index, share] of FRAME_SHARES.entries()) {
    const atMs = Math.round(facts.durationMs * share);
    frames.push(await frameAt(runTool, dir, outFile, atMs, `${name}-frame-${index}.gray`));
  }
  return { name, what, quality, bytes: rendered.bytes, ...facts, frames };
}

/** The mean difference between two grey frames, in levels (0 to 255). */
function frameDistance(a: string, b: string): number {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  if (left.length !== right.length || left.length === 0) return 255;
  let sum = 0;
  for (let i = 0; i < left.length; i += 1) sum += Math.abs((left[i] ?? 0) - (right[i] ?? 0));
  return sum / left.length;
}

function compare(recorded: ClipRecord, now: ClipRecord): string[] {
  const problems: string[] = [];
  if (Math.abs(recorded.durationMs - now.durationMs) > LENGTH_TOLERANCE_MS) {
    problems.push(`length ${now.durationMs} ms, was ${recorded.durationMs} ms`);
  }
  if (recorded.width !== now.width || recorded.height !== now.height) {
    problems.push(`size ${now.width}x${now.height}, was ${recorded.width}x${recorded.height}`);
  }
  if (recorded.fps !== now.fps) problems.push(`${now.fps} fps, was ${recorded.fps} fps`);
  recorded.frames.forEach((frame, index) => {
    const other = now.frames[index];
    const distance = other ? frameDistance(frame.grey, other.grey) : 255;
    if (distance > FRAME_TOLERANCE) {
      problems.push(`the frame at ${frame.atMs} ms differs by ${distance.toFixed(1)} levels`);
    }
  });
  return problems;
}

async function exists(file: string): Promise<boolean> {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

async function main(argv: readonly string[]): Promise<number> {
  const record = argv.includes('--record');
  const dir = fixturesDir();
  const recordsFile = path.join(dir, 'records.json');
  const runTool = createRunTool(toolPaths(process.env));
  const fontsDir = process.env.CLIPS_FONTS_DIR?.trim() || defaultFontsDir();
  const fonts = fontsDir ? await loadFontsFolder(path.resolve(fontsDir)) : null;
  if (!fonts) {
    throw new Error('The regression set needs the fonts folder: run npm run clips:fonts:build');
  }

  if (record) {
    await mkdir(dir, { recursive: true });
    for (const { name, doc } of fixtureDocuments()) {
      const file = path.join(dir, `${name}.json`);
      // A document already saved is the fixture: it is never rewritten, only its record is.
      if (await exists(file)) continue;
      clipDocumentSchema.parse(doc);
      await writeFile(file, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
    }
  }

  const listed = fixtureDocuments().map(({ name, what }) => ({ name, what }));
  const root = process.env.CLIPS_SCRATCH_DIR?.trim() || os.tmpdir();
  const results: ClipRecord[] = [];
  let version = 'unknown';
  await withScratch(root, `regression-${Date.now()}`, async (scratch) => {
    const first = await runTool('ffmpeg', ['-hide_banner', '-version'], {
      cwd: scratch,
      timeoutMs: 30_000,
    });
    version = first.stdout.split(/\r?\n/)[0] ?? 'unknown';
    await makeInputs(runTool, scratch);
    for (const { name, what } of listed) {
      const raw = JSON.parse(await readFile(path.join(dir, `${name}.json`), 'utf8')) as unknown;
      // Exactly what the app does on open: upgrade, then parse.
      const doc = clipDocumentSchema.parse(upgrade(raw));
      process.stdout.write(`Exporting ${name} (${outputDuration(doc) / 1000} s)...\n`);
      results.push(await exportOne(runTool, scratch, fonts, name, what, doc));
    }
  });

  if (record) {
    const records: Records = {
      version: 1,
      note: 'Written by npm run clips:regression -- --record. The exports of the version 1 clips in this folder at 720p: length, size and five 32 by 18 grey frames each. npm run clips:regression exports them again and compares.',
      recordedWith: version,
      clips: results,
    };
    await writeFile(recordsFile, `${JSON.stringify(records, null, 2)}\n`, 'utf8');
    process.stdout.write(`Recorded ${results.length} clips in ${recordsFile}\n`);
    return 0;
  }

  const records = JSON.parse(await readFile(recordsFile, 'utf8')) as Records;
  let failed = 0;
  for (const now of results) {
    const recorded = records.clips.find((clip) => clip.name === now.name);
    const problems = recorded ? compare(recorded, now) : ['no record: run with --record'];
    if (problems.length > 0) failed += 1;
    process.stdout.write(
      `${problems.length === 0 ? '[OK]  ' : '[FAIL]'} ${now.name}: ${
        problems.length === 0
          ? `${now.durationMs} ms, ${now.width}x${now.height}`
          : problems.join('; ')
      }\n`,
    );
  }
  process.stdout.write(
    failed === 0
      ? `Every version 1 clip exports as recorded (${version}).\n`
      : `${failed} of ${results.length} clips export differently from the record.\n`,
  );
  return failed === 0 ? 0 : 1;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(
      `The regression set could not run: ${error instanceof Error ? error.message : 'unknown error'}\n`,
    );
    process.exitCode = 1;
  },
);
