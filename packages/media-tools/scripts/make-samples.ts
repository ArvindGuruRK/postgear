/**
 * `npm run clips:samples`: makes the sample videos the simulation fetches
 * from, using only FFmpeg's own test sources (nothing is downloaded, so
 * there is no licence question), and writes `facts.json` beside them: what
 * was measured plus every planned moment, so Module 16's highlights on the
 * stream sample are predictable.
 *
 * - talk.mp4: 3 minutes, a test pattern with a centred counter, a quiet bed
 *   tone and a few short tone bursts.
 * - stream.mp4: 10 minutes, hard scene flips and loud bursts at the times in
 *   `fixtures/samples/plan.json`, with the same centred counter.
 * - two-speakers.mp4 (Sprint 13): 4 minutes, two face-like markers side by
 *   side taking turns. The one "speaking" opens its mouth, wears a white ring
 *   and plays its own tone, at the turns in the plan, with silences between
 *   some turns. Nothing in it is a real person.
 * - verideck.mp4 (Sprint 13, an own sample): a real video the developer
 *   supplies, made into the same kind of file as the others (H.264, a key
 *   frame every two seconds, AAC 48 kHz stereo) so a cut lands where it was
 *   asked. Read from the plan's `sources`, or the file `CLIPS_OWN_SAMPLE`
 *   names. Skipped with one line when the file is not there; never committed.
 *
 * Existing files are kept; `--force` makes them again. FFmpeg and ffprobe
 * are started only through the runner (`FFMPEG_PATH`, `FFPROBE_PATH`).
 */
import { copyFile, mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { z } from 'zod';
import {
  defaultSamplesDir,
  GENERATED_SAMPLES,
  type GeneratedSampleName,
  OWN_SAMPLES,
  type OwnSampleName,
  type SamplePlan,
  sampleChat,
  samplePlan,
  sampleSpec,
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

/**
 * Two face-like markers: a coloured head with two eyes and a mouth. While a
 * speaker's turn runs, its mouth is open and a white ring is drawn round the
 * head, so the "speaker" is visible in any frame and the recorded face boxes
 * (the heads) are true by construction.
 */
function twoSpeakersGraph(plan: SamplePlan['twoSpeakers']): string {
  const { width: w, height: h } = plan;
  const px = (fraction: number, of: number): number => Math.round(fraction * of);
  const boxes: string[] = [];
  for (const speaker of plan.speakers) {
    const turns = plan.turns.filter((turn) => turn.speaker === speaker.id);
    const speaking = gate(turns);
    const fw = px(speaker.faceWidth, w);
    const fh = px(speaker.faceHeight, h);
    const x = px(speaker.centreX, w) - Math.round(fw / 2);
    const y = px(speaker.centreY, h) - Math.round(fh / 2);
    const eye = Math.round(fw * 0.14);
    const eyeY = y + Math.round(fh * 0.3);
    const mouthW = Math.round(fw * 0.44);
    const mouthX = x + Math.round((fw - mouthW) / 2);
    const mouthY = y + Math.round(fh * 0.68);
    const ring = Math.round(fw * 0.06);
    boxes.push(
      `drawbox=x=${x - ring}:y=${y - ring}:w=${fw + ring * 2}:h=${fh + ring * 2}:color=white:t=fill:enable='${speaking}'`,
      `drawbox=x=${x}:y=${y}:w=${fw}:h=${fh}:color=${speaker.colour}:t=fill`,
      `drawbox=x=${x + Math.round(fw * 0.22)}:y=${eyeY}:w=${eye}:h=${eye}:color=0x14141f:t=fill`,
      `drawbox=x=${x + Math.round(fw * 0.64)}:y=${eyeY}:w=${eye}:h=${eye}:color=0x14141f:t=fill`,
      `drawbox=x=${mouthX}:y=${mouthY}:w=${mouthW}:h=${Math.round(fh * 0.03)}:color=0x14141f:t=fill`,
      `drawbox=x=${mouthX}:y=${mouthY}:w=${mouthW}:h=${Math.round(fh * 0.13)}:color=0x14141f:t=fill:enable='${speaking}'`,
    );
  }
  // The counter sits low and centred, between the two heads, so it never covers a face.
  const fontSize = Math.round(h * 0.05);
  const clock = [
    `drawtext=fontfile=${FONT_FILE}`,
    "text='%{pts\\:hms}'",
    `fontsize=${fontSize}`,
    'fontcolor=white',
    'box=1',
    'boxcolor=black@0.65',
    `boxborderw=${Math.round(fontSize / 4)}`,
    'x=(w-text_w)/2',
    `y=h-text_h-${Math.round(h * 0.06)}`,
  ].join(':');
  const lines = [
    `color=c=0x1f2033:size=${w}x${h}:rate=${plan.fps}:duration=${plan.durationSec},format=yuv420p,setsar=1,${boxes.join(',')},${clock}[v]`,
    `sine=frequency=${plan.bedToneHz}:sample_rate=${SAMPLE_RATE}:duration=${plan.durationSec},volume=0.004[bed]`,
  ];
  const mix = ['[bed]'];
  plan.speakers.forEach((speaker, index) => {
    const turns = plan.turns.filter((turn) => turn.speaker === speaker.id);
    // A slow wobble on the tone so it reads as "talking", not a test beep.
    lines.push(
      `sine=frequency=${speaker.toneHz}:sample_rate=${SAMPLE_RATE}:duration=${plan.durationSec},tremolo=f=5:d=0.7,volume='0.5*(${gate(turns)})':eval=frame[voice${index}]`,
    );
    mix.push(`[voice${index}]`);
  });
  lines.push(
    `${mix.join('')}amix=inputs=${mix.length}:normalize=0,aformat=sample_rates=${SAMPLE_RATE}:channel_layouts=stereo[a]`,
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

function graphFor(name: GeneratedSampleName, plan: SamplePlan): { graph: string; fps: number } {
  switch (name) {
    case 'talk':
      return { graph: talkGraph(plan.talk), fps: plan.talk.fps };
    case 'stream':
      return { graph: streamGraph(plan.stream), fps: plan.stream.fps };
    case 'two-speakers':
      return { graph: twoSpeakersGraph(plan.twoSpeakers), fps: plan.twoSpeakers.fps };
  }
}

async function makeSample(
  runTool: RunTool,
  samplesDir: string,
  name: GeneratedSampleName,
  plan: SamplePlan,
): Promise<void> {
  const spec = { ...sampleSpec(name), fps: graphFor(name, plan).fps };
  const graphFile = `${name}.graph.txt`;
  const partFile = `${spec.file}.part`;
  const { graph } = graphFor(name, plan);
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

/** Where a developer's own sample is read from: its variable first, then the plan's paths. */
async function findOwnSource(
  name: OwnSampleName,
  plan: SamplePlan,
  repoRoot: string,
): Promise<string | null> {
  const spec = plan.own[name];
  const fromEnv = process.env[spec.envVar]?.trim();
  const candidates = [
    ...(fromEnv ? [path.resolve(repoRoot, fromEnv)] : []),
    ...spec.sources.map((source) => path.resolve(repoRoot, source)),
  ];
  for (const candidate of candidates) {
    if (await exists(candidate)) return candidate;
  }
  return null;
}

/**
 * Makes a developer's own video the same kind of file as the generated
 * samples: H.264 High, yuv420p, a key frame every two seconds, AAC 48 kHz
 * stereo, the index first. Its size and frame rate are kept. A video with no
 * sound gets a silent track, so every sample has both streams.
 */
async function makeOwnSample(
  runTool: RunTool,
  samplesDir: string,
  name: OwnSampleName,
  plan: SamplePlan,
  source: string,
): Promise<void> {
  const spec = plan.own[name];
  const inFile = `${name}.source${path.extname(source).toLowerCase() || '.mp4'}`;
  const partFile = `${spec.file}.part`;
  // Copied in first, so FFmpeg only ever reads a name inside the samples folder.
  await copyFile(source, path.join(samplesDir, inFile));
  try {
    await runTool(
      'ffmpeg',
      [
        '-hide_banner',
        '-nostdin',
        '-y',
        '-loglevel',
        'error',
        '-protocol_whitelist',
        'file',
        '-i',
        inFile,
        '-f',
        'lavfi',
        '-t',
        String(spec.durationSec),
        '-i',
        `anullsrc=channel_layout=stereo:sample_rate=${SAMPLE_RATE}`,
        '-map',
        '0:v:0',
        '-map',
        '0:a:0?',
        '-map',
        '1:a:0',
        '-t',
        String(spec.durationSec),
        '-vf',
        'format=yuv420p,setsar=1',
        '-c:v',
        'libx264',
        '-profile:v',
        'high',
        '-preset',
        'veryfast',
        '-crf',
        '20',
        '-force_key_frames',
        'expr:gte(t,n_forced*2)',
        '-sc_threshold',
        '0',
        '-c:a',
        'aac',
        '-b:a',
        '160k',
        '-ar',
        String(SAMPLE_RATE),
        '-ac',
        '2',
        '-movflags',
        '+faststart',
        '-f',
        'mp4',
        partFile,
      ],
      { cwd: samplesDir, timeoutMs: ENCODE_TIMEOUT_MS },
    );
    await keepFirstSound(runTool, samplesDir, partFile, spec.file);
  } finally {
    await rm(path.join(samplesDir, partFile), { force: true });
    await rm(path.join(samplesDir, inFile), { force: true });
  }
}

/**
 * The encode above maps the video's own sound when it has one and a silent
 * track always; this keeps only the first sound stream (the video's own, or
 * the silence when it had none), copied, so the sample has exactly one.
 */
async function keepFirstSound(
  runTool: RunTool,
  samplesDir: string,
  inFile: string,
  outFile: string,
): Promise<void> {
  const finalPart = `${outFile}.final.part`;
  try {
    await runTool(
      'ffmpeg',
      [
        '-hide_banner',
        '-nostdin',
        '-y',
        '-loglevel',
        'error',
        '-protocol_whitelist',
        'file',
        '-f',
        'mp4',
        '-i',
        inFile,
        '-map',
        '0:v:0',
        '-map',
        '0:a:0',
        '-c',
        'copy',
        '-movflags',
        '+faststart',
        '-f',
        'mp4',
        finalPart,
      ],
      { cwd: samplesDir, timeoutMs: ENCODE_TIMEOUT_MS },
    );
    await rename(path.join(samplesDir, finalPart), path.join(samplesDir, outFile));
  } finally {
    await rm(path.join(samplesDir, finalPart), { force: true });
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
  const twoSpeakers = await measure(runTool, samplesDir, plan.twoSpeakers.file);
  const own: Record<string, unknown> = {};
  for (const name of OWN_SAMPLES) {
    const file = plan.own[name].file;
    own[name] = (await exists(path.join(samplesDir, file)))
      ? { ...(await measure(runTool, samplesDir, file)), title: plan.own[name].title }
      : null;
  }
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
    twoSpeakers: {
      ...twoSpeakers,
      // The head of each marker, as a box in fractions of the picture: the truth for face tests.
      speakers: plan.twoSpeakers.speakers.map((speaker) => ({
        id: speaker.id,
        name: speaker.name,
        toneHz: speaker.toneHz,
        face: {
          x: speaker.centreX - speaker.faceWidth / 2,
          y: speaker.centreY - speaker.faceHeight / 2,
          w: speaker.faceWidth,
          h: speaker.faceHeight,
        },
      })),
      turns: plan.twoSpeakers.turns,
    },
    // Real videos a developer supplied (null when the file was not there).
    own,
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
  for (const name of GENERATED_SAMPLES) {
    const spec = sampleSpec(name);
    const file = path.join(samplesDir, spec.file);
    if (!force && (await exists(file))) {
      process.stdout.write(`${spec.file} is already there (use --force to make it again).\n`);
      continue;
    }
    process.stdout.write(`Making ${spec.file} (${spec.durationSec} s)...\n`);
    await makeSample(runTool, samplesDir, name, plan);
  }
  const repoRoot = path.resolve(samplesDir, '..', '..', '..');
  for (const name of OWN_SAMPLES) {
    const spec = plan.own[name];
    const file = path.join(samplesDir, spec.file);
    if (!force && (await exists(file))) {
      process.stdout.write(`${spec.file} is already there (use --force to make it again).\n`);
      continue;
    }
    const source = await findOwnSource(name, plan, repoRoot);
    if (!source) {
      process.stdout.write(
        `${spec.file} was skipped: put your video at ${spec.sources[0]} (or name it in ${spec.envVar}) to add it.\n`,
      );
      continue;
    }
    process.stdout.write(`Making ${spec.file} from your own video (${spec.durationSec} s)...\n`);
    await makeOwnSample(runTool, samplesDir, name, plan, source);
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
