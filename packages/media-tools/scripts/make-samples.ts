/**
 * `npm run clips:samples`: makes the two sample videos the simulation
 * fetches from, using only FFmpeg's own test sources (nothing is
 * downloaded, so there is no licence question), and writes `facts.json`
 * beside them: what was measured plus every planned moment, so Module 16's
 * highlights on the stream sample are predictable.
 *
 * - talk.mp4: 3 minutes, a test pattern with a centred counter, a quiet bed
 *   tone and a few short tone bursts.
 * - stream.mp4: 10 minutes, hard scene flips and loud bursts at the times in
 *   `fixtures/samples/plan.json`, with the same centred counter.
 *
 * Existing files are kept; `--force` makes them again. FFmpeg and ffprobe
 * are started only through the runner (`FFMPEG_PATH`, `FFPROBE_PATH`).
 */
import { copyFile, mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { z } from 'zod';
import {
  defaultSamplesDir,
  type SampleName,
  type SamplePlan,
  sampleChat,
  samplePlan,
} from '../src/downloader/samples';
import { toolPaths } from '../src/run/paths';
import { createRunTool } from '../src/run/runner';
import { type RunTool, ToolError } from '../src/run/types';

/** The counter font, copied into the samples folder so the graph names it without a path. */
const FONT_FILE = 'counter-font.ttf';
const ENCODE_TIMEOUT_MS = 30 * 60 * 1000;
const PROBE_TIMEOUT_MS = 30 * 1000;
const SAMPLE_RATE = 48_000;

/** A TTF FFmpeg's drawtext can read (a WOFF crashes it). The first one found is used. */
function fontCandidates(repoRoot: string): string[] {
  return [
    path.join(
      repoRoot,
      'node_modules',
      'next',
      'dist',
      'compiled',
      '@vercel',
      'og',
      'Geist-Regular.ttf',
    ),
    'C:\\Windows\\Fonts\\arial.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/dejavu/DejaVuSans.ttf',
    '/System/Library/Fonts/Supplemental/Arial.ttf',
    '/Library/Fonts/Arial.ttf',
  ];
}

async function exists(file: string): Promise<boolean> {
  try {
    return (await stat(file)).size > 0;
  } catch {
    return false;
  }
}

async function copyFont(samplesDir: string): Promise<void> {
  const target = path.join(samplesDir, FONT_FILE);
  if (await exists(target)) {
    return;
  }
  const repoRoot = path.resolve(samplesDir, '..', '..', '..');
  for (const candidate of fontCandidates(repoRoot)) {
    if (await exists(candidate)) {
      await copyFile(candidate, target);
      return;
    }
  }
  throw new Error(
    `No TTF font found for the counter. Copy any .ttf file to ${target} and run this again.`,
  );
}

/**
 * The centred counter (h:mm:ss.mmm of the sample), drawn last so every scene
 * has it. Sized from the picture's height so every digit stays inside a
 * centred 9:16 crop (`height x 9/16` wide; the dark box may touch its edges):
 * the compare check reads it through every layout. At 96 px fixed it lost its
 * milliseconds to the crop on the 720p samples.
 */
function counter(height: number): string {
  const fontSize = Math.round(height * 0.075);
  return [
    `drawtext=fontfile=${FONT_FILE}`,
    "text='%{pts\\:hms}'",
    `fontsize=${fontSize}`,
    'fontcolor=white',
    'box=1',
    'boxcolor=black@0.65',
    `boxborderw=${Math.round(fontSize / 4)}`,
    'x=(w-text_w)/2',
    'y=(h-text_h)/2',
  ].join(':');
}

/** `between(t,a,b)` summed over spans that never overlap: 1 inside one, 0 outside. */
function gate(spans: ReadonlyArray<{ startSec: number; endSec: number }>): string {
  if (spans.length === 0) {
    return '0';
  }
  return spans.map((span) => `between(t,${span.startSec},${span.endSec})`).join('+');
}

function talkGraph(plan: SamplePlan['talk']): string {
  const size = `${plan.width}x${plan.height}`;
  return [
    `testsrc2=size=${size}:rate=${plan.fps}:duration=${plan.durationSec},format=yuv420p,setsar=1,${counter(plan.height)}[v]`,
    `sine=frequency=${plan.bedToneHz}:sample_rate=${SAMPLE_RATE}:duration=${plan.durationSec},volume=0.08[bed]`,
    `sine=frequency=${plan.burstToneHz}:sample_rate=${SAMPLE_RATE}:duration=${plan.durationSec},volume='0.6*(${gate(plan.toneBursts)})':eval=frame[burst]`,
    `[bed][burst]amix=inputs=2:normalize=0,aformat=sample_rates=${SAMPLE_RATE}:channel_layouts=stereo[a]`,
  ].join(';\n');
}

function sceneSource(
  source: SamplePlan['stream']['scenes'][number]['source'],
  plan: SamplePlan['stream'],
  durationSec: number,
  index: number,
): string {
  const size = `${plan.width}x${plan.height}`;
  const tail = 'format=yuv420p,setsar=1';
  if (source === 'life') {
    const small = `${Math.round(plan.width / 4)}x${Math.round(plan.height / 4)}`;
    return `life=size=${small}:rate=${plan.fps}:seed=${1000 + index}:ratio=0.12:mold=10:life_color=0x40c0ff:death_color=0x101028,trim=duration=${durationSec},setpts=PTS-STARTPTS,scale=${plan.width}:${plan.height}:flags=neighbor,${tail}`;
  }
  return `${source}=size=${size}:rate=${plan.fps}:duration=${durationSec},${tail}`;
}

function streamGraph(plan: SamplePlan['stream']): string {
  const scenes = [...plan.scenes].sort((a, b) => a.startSec - b.startSec);
  const lines: string[] = [];
  scenes.forEach((scene, index) => {
    const next = scenes[index + 1]?.startSec ?? plan.durationSec;
    lines.push(`${sceneSource(scene.source, plan, next - scene.startSec, index)}[s${index}]`);
  });
  const inputs = scenes.map((_, index) => `[s${index}]`).join('');
  lines.push(`${inputs}concat=n=${scenes.length}:v=1:a=0,${counter(plan.height)}[v]`);
  lines.push(
    `sine=frequency=${plan.bedToneHz}:sample_rate=${SAMPLE_RATE}:duration=${plan.durationSec},volume=0.1[bed]`,
  );
  lines.push(
    `anoisesrc=color=pink:seed=42:sample_rate=${SAMPLE_RATE}:duration=${plan.durationSec}:amplitude=0.9,volume='${gate(plan.loudBursts)}':eval=frame[noise]`,
  );
  lines.push(
    `[bed][noise]amix=inputs=2:normalize=0,aformat=sample_rates=${SAMPLE_RATE}:channel_layouts=stereo[a]`,
  );
  return lines.join(';\n');
}

function encodeArgs(
  graphFile: string,
  outFile: string,
  durationSec: number,
  fps: number,
): string[] {
  return [
    '-hide_banner',
    '-nostdin',
    '-y',
    '-nostats',
    '-progress',
    'pipe:1',
    '-loglevel',
    'error',
    '-/filter_complex',
    graphFile,
    '-map',
    '[v]',
    '-map',
    '[a]',
    '-t',
    String(durationSec),
    '-c:v',
    'libx264',
    '-profile:v',
    'high',
    '-preset',
    'veryfast',
    '-crf',
    '23',
    '-pix_fmt',
    'yuv420p',
    '-g',
    String(fps * 2),
    '-keyint_min',
    String(fps * 2),
    '-sc_threshold',
    '0',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-ar',
    String(SAMPLE_RATE),
    '-ac',
    '2',
    '-movflags',
    '+faststart',
    '-f',
    'mp4',
    outFile,
  ];
}

async function makeSample(
  runTool: RunTool,
  samplesDir: string,
  name: SampleName,
  plan: SamplePlan,
): Promise<void> {
  const spec = plan[name];
  const graphFile = `${name}.graph.txt`;
  const partFile = `${spec.file}.part`;
  const graph = name === 'talk' ? talkGraph(plan.talk) : streamGraph(plan.stream);
  await writeFile(path.join(samplesDir, graphFile), `${graph}\n`, 'utf8');
  const totalUs = spec.durationSec * 1_000_000;
  let shown = -1;
  try {
    await runTool('ffmpeg', encodeArgs(graphFile, partFile, spec.durationSec, spec.fps), {
      cwd: samplesDir,
      timeoutMs: ENCODE_TIMEOUT_MS,
      onStdoutLine: (line) => {
        const match = /^out_time_us=(\d+)$/.exec(line.trim());
        if (!match) {
          return;
        }
        const percent = Math.min(99, Math.floor((Number(match[1]) / totalUs) * 100));
        if (percent >= shown + 10) {
          shown = percent - (percent % 10);
          process.stdout.write(`  ${name}: ${shown}%\n`);
        }
      },
    });
    await rename(path.join(samplesDir, partFile), path.join(samplesDir, spec.file));
  } finally {
    await rm(path.join(samplesDir, partFile), { force: true });
    await rm(path.join(samplesDir, graphFile), { force: true });
  }
}

const probeSchema = z.object({
  format: z.object({ duration: z.string(), size: z.string() }),
  streams: z.array(
    z.object({
      codec_type: z.string(),
      codec_name: z.string().optional(),
      profile: z.string().optional(),
      width: z.number().optional(),
      height: z.number().optional(),
      r_frame_rate: z.string().optional(),
      pix_fmt: z.string().optional(),
      sample_rate: z.string().optional(),
      channels: z.number().optional(),
    }),
  ),
});

/** What ffprobe measured on one sample. */
interface MeasuredSample {
  file: string;
  bytes: number;
  durationMs: number;
  video: {
    codec: string;
    profile: string | null;
    width: number;
    height: number;
    fps: number;
    pixelFormat: string;
  };
  audio: { codec: string; sampleRate: number; channels: number };
}

function frameRate(value: string | undefined): number {
  const [num, den] = (value ?? '0/1').split('/').map(Number);
  if (!num || !den) {
    return 0;
  }
  return Math.round((num / den) * 1000) / 1000;
}

async function measure(
  runTool: RunTool,
  samplesDir: string,
  file: string,
): Promise<MeasuredSample> {
  const result = await runTool(
    'ffprobe',
    [
      '-v',
      'error',
      '-print_format',
      'json',
      '-show_entries',
      'format=duration,size:stream=codec_type,codec_name,profile,width,height,r_frame_rate,pix_fmt,sample_rate,channels',
      '--',
      file,
    ],
    { cwd: samplesDir, timeoutMs: PROBE_TIMEOUT_MS },
  );
  const probe = probeSchema.parse(JSON.parse(result.stdout));
  const video = probe.streams.find((stream) => stream.codec_type === 'video');
  const audio = probe.streams.find((stream) => stream.codec_type === 'audio');
  if (!video || !audio) {
    throw new Error(`${file} is missing its video or audio stream. Run this again with --force.`);
  }
  return {
    file,
    bytes: Number(probe.format.size),
    durationMs: Math.round(Number(probe.format.duration) * 1000),
    video: {
      codec: video.codec_name ?? 'unknown',
      profile: video.profile ?? null,
      width: video.width ?? 0,
      height: video.height ?? 0,
      fps: frameRate(video.r_frame_rate),
      pixelFormat: video.pix_fmt ?? 'unknown',
    },
    audio: {
      codec: audio.codec_name ?? 'unknown',
      sampleRate: Number(audio.sample_rate ?? 0),
      channels: audio.channels ?? 0,
    },
  };
}

async function writeFacts(runTool: RunTool, samplesDir: string, plan: SamplePlan): Promise<void> {
  const chat = sampleChat();
  const talk = await measure(runTool, samplesDir, plan.talk.file);
  const stream = await measure(runTool, samplesDir, plan.stream.file);
  const facts = {
    version: plan.version,
    note: 'Written by npm run clips:samples. Measured values come from ffprobe; every moment is in seconds of the sample.',
    talk: {
      ...talk,
      toneBursts: plan.talk.toneBursts,
    },
    stream: {
      ...stream,
      sceneCuts: plan.stream.scenes.map((scene) => scene.startSec).filter((sec) => sec > 0),
      scenes: plan.stream.scenes,
      loudBursts: plan.stream.loudBursts,
      chat: {
        fixture: plan.stream.chat.fixture,
        messageCount: chat.messageCount,
        lagSec: plan.stream.chat.lagSec,
        bursts: plan.stream.loudBursts.map((burst) => ({
          startSec: burst.startSec + plan.stream.chat.lagSec,
          endSec: burst.startSec + plan.stream.chat.lagSec + plan.stream.chat.burstLengthSec,
        })),
      },
    },
  };
  await writeFile(
    path.join(samplesDir, 'facts.json'),
    `${JSON.stringify(facts, null, 2)}\n`,
    'utf8',
  );
}

async function main(argv: readonly string[]): Promise<number> {
  const force = argv.includes('--force');
  const plan = samplePlan();
  const samplesDir = defaultSamplesDir(__dirname);
  await mkdir(samplesDir, { recursive: true });
  await copyFont(samplesDir);
  const runTool = createRunTool(toolPaths(process.env));
  for (const name of ['talk', 'stream'] as const) {
    const file = path.join(samplesDir, plan[name].file);
    if (!force && (await exists(file))) {
      process.stdout.write(`${plan[name].file} is already there (use --force to make it again).\n`);
      continue;
    }
    process.stdout.write(`Making ${plan[name].file} (${plan[name].durationSec} s)...\n`);
    await makeSample(runTool, samplesDir, name, plan);
  }
  await writeFacts(runTool, samplesDir, plan);
  process.stdout.write(`Samples and facts.json are in ${samplesDir}\n`);
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    const detail =
      error instanceof ToolError
        ? `${error.tool} failed${error.timedOut ? ' (timed out)' : ''}.\n${error.stderrTail}`
        : error instanceof Error
          ? error.message
          : 'unknown error';
    process.stderr.write(`The samples could not be made: ${detail}\n`);
    process.exitCode = 1;
  },
);
