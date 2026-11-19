/**
 * `npm run clips:signals:record`: measures the highlight tracks of the two
 * generated samples with the real producers (FFmpeg's `ebur128` and `scdet`,
 * the recorded chat, the talk sample's recorded heat map) and writes them as
 * fixtures the engine's tests read, so "the stream sample's recorded tracks
 * give its known moments" is checked without FFmpeg (Module 16 section 2).
 *
 * Also prints how long each step took, the numbers the Progress notes quote.
 * Needs `npm run clips:samples` first. Nothing is fetched from anywhere.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  encodeSignalsFile,
  replayedTrack,
  SIGNALS_FILE_FORMAT,
  type SignalTrack,
} from '@postgear/video-engine';
import { defaultSamplesDir, type SampleName, samplePlan } from '../src/downloader/samples';
import { extractAnalysisAudio } from '../src/ffmpeg/import';
import { toolPaths } from '../src/run/paths';
import { createRunTool } from '../src/run/runner';
import { produceChat, recordedChatSource } from '../src/signals/chat';
import { produceLoudness } from '../src/signals/loudness';
import { produceScene } from '../src/signals/scene';

const OUT_DIR = path.resolve(__dirname, '..', '..', 'video-engine', 'src', 'signals', 'fixtures');
const TALK_PROBE = path.resolve(__dirname, '..', 'fixtures', 'ytdlp', 'probe-youtube-talk.json');

async function timed<T>(
  label: string,
  times: Record<string, number>,
  run: () => Promise<T>,
): Promise<T> {
  const started = performance.now();
  const out = await run();
  times[label] = Math.round(performance.now() - started);
  return out;
}

async function talkReplayed(durationMs: number): Promise<SignalTrack | null> {
  const probe = JSON.parse(await readFile(TALK_PROBE, 'utf8')) as {
    heatmap?: Array<{ start_time: number; end_time: number; value: number }>;
  };
  const points = (probe.heatmap ?? []).map((point) => ({
    startMs: Math.round(point.start_time * 1000),
    endMs: Math.round(point.end_time * 1000),
    value: point.value,
  }));
  return replayedTrack(points, durationMs);
}

async function record(name: SampleName): Promise<void> {
  const plan = samplePlan();
  const sample = plan[name];
  const durationMs = Math.round(sample.durationSec * 1000);
  const file = path.join(defaultSamplesDir(__dirname), sample.file);
  const runTool = createRunTool(toolPaths(process.env));
  const dir = await mkdtemp(path.join(os.tmpdir(), 'postgear-signals-'));
  const times: Record<string, number> = {};
  try {
    const wav = path.join(dir, 'analysis.wav');
    await timed('analysis audio', times, () =>
      extractAnalysisAudio({ runTool, cwd: dir, input: file, output: wav, durationMs }),
    );
    const tracks: SignalTrack[] = [];
    const loudness = await timed('loudness', times, () =>
      produceLoudness({ runTool, cwd: dir, durationMs, audioFile: wav }),
    );
    if (loudness) tracks.push(loudness);
    const scene = await timed('scenes', times, () =>
      produceScene({ runTool, cwd: dir, durationMs, videoFile: file }),
    );
    if (scene) tracks.push(scene);
    if (name === 'stream') {
      const chat = await timed('chat', times, () =>
        produceChat(recordedChatSource(), {
          platform: 'twitch',
          kind: 'past_stream',
          externalId: '900000001',
          durationMs,
        }),
      );
      if (chat) tracks.push(chat);
    } else {
      const replayed = await talkReplayed(durationMs);
      if (replayed) tracks.push(replayed);
    }

    const moments = name === 'stream' ? plan.stream.loudBursts : plan.talk.toneBursts;
    const fixture = {
      note: `Recorded by npm run clips:signals:record from the generated ${sample.file} (${sample.durationSec} s). The moments are plan.json's. Regenerate after a producer's version changes.`,
      sample: name,
      moments,
      signals: JSON.parse(
        encodeSignalsFile({ format: SIGNALS_FILE_FORMAT, durationMs, tracks }),
      ) as unknown,
    };
    await mkdir(OUT_DIR, { recursive: true });
    const out = path.join(OUT_DIR, `${name}.signals.json`);
    await writeFile(out, `${JSON.stringify(fixture)}\n`);
    process.stdout.write(
      `${sample.file}: ${tracks.map((track) => track.name).join(', ')} -> ${path.relative(process.cwd(), out)}\n`,
    );
    for (const [label, ms] of Object.entries(times)) {
      process.stdout.write(`  ${label}: ${ms} ms\n`);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function main(): Promise<number> {
  for (const name of ['talk', 'stream'] as const) await record(name);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  },
);
