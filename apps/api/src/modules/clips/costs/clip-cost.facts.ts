/**
 * A finished job's cost facts (Sprint 13, Module 15 section 3), worked out
 * from its row and the few things `ClipCostService` reads beside it. Pure:
 * no database, no clock, so every kind is pinned by a test.
 *
 * Input and output are read loosely (a field at a time, never a strict
 * parse), so an old row whose shape has since grown still gets a cost.
 *
 * | Kind | Video seconds | Provider | Units |
 * |---|---|---|---|
 * | IMPORT | its length | `ffmpeg` | processor, first month of its files |
 * | SEGMENT | the range fetched | `ffmpeg` | processor, first month of the sharp copy |
 * | HIGHLIGHTS | the setup's stretch, else the video | the AI engine when it read or looked, else `ffmpeg` | processor (less the time it waited on its own listening job); tokens when it read, pictures when the vision check looked (estimated) |
 * | RENDER | the clip's length | `ffmpeg` | processor; storage (a month, a Preview Export a day) |
 * | DOWNLOAD | the video's length | `ffmpeg` | processor; one day of the file |
 * | TRANSCRIBE | seconds listened | the listener the output names | a hosted listener: audio seconds; our box: processor; `simulation`: priced as our box at research 07's speed (estimated) |
 * | FACES, SPEECH | the stretch, the voice's length | `media-service` | processor |
 * | TRANSLATE | the stretch | the AI engine | tokens (estimated) |
 * | AUTO_EDIT | the range | `api` | none of its own (its listening is a TRANSCRIBE job) |
 * | EMOTE | the stretch | `ffmpeg` | processor; one day of the files |
 */
import {
  type ClipJobKind,
  type ClipJobStatus,
  outputDuration,
  renderInputSchema,
} from '@postgear/video-engine';
import {
  BYTES_PER_GB,
  CLIP_ESTIMATES,
  CLIP_PRICES_DATE,
  type ClipCostFacts,
  type ClipCostUnits,
  isHostedListener,
  STORAGE_MONTHS,
  vcpusFor,
} from './clip-prices';

/** The row fields the facts read. */
export interface CostJob {
  kind: ClipJobKind;
  status: ClipJobStatus;
  stage: string | null;
  input: unknown;
  output: unknown;
  startedAt: Date | null;
  finishedAt: Date | null;
}

/** A Find Clips run with a setup, as the service read it. */
export interface CostRun {
  /** The stretch the setup read, clamped to the video. */
  readMs: number;
  /** Look For Action ran with the vision check on. */
  vision: boolean;
  /** Seconds this job spent waiting on its own listening job (that job has its own cost). */
  listenOverlapSeconds: number;
}

export interface CostContext {
  /** The AI engine's name (`openai:gpt-4.1-mini`, `simulation`), or null when none is set up. */
  aiModel: string | null;
  /** The video's length, for a job whose own row does not say. */
  videoDurationMs: number | null;
  /** Bytes the job kept, when the service read them from its asset rows (IMPORT, SEGMENT). */
  storedBytes: number | null;
  /** Set for a HIGHLIGHTS job whose run had a setup. */
  run: CostRun | null;
}

/** Stages of a Find Clips run at or after the reading. */
const READ_STAGES = new Set(['reading', 'watching', 'scoring']);
const LOOK_STAGES = new Set(['watching', 'scoring']);

type Loose = Record<string, unknown>;

function record(value: unknown): Loose | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Loose) : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** `toMs - fromMs` of an object that has both, in seconds, else 0. */
function spanSeconds(value: Loose | null, from = 'fromMs', to = 'toMs'): number {
  const start = num(value?.[from]);
  const end = num(value?.[to]);
  return start !== null && end !== null && end > start ? (end - start) / 1000 : 0;
}

/** Three decimals, never negative. */
function seconds(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.round(value * 1000) / 1000 : 0;
}

function ranSecondsOf(job: CostJob): number {
  if (!job.startedAt || !job.finishedAt) return 0;
  return seconds((job.finishedAt.getTime() - job.startedAt.getTime()) / 1000);
}

/** GB times months, rounded to a millionth. */
function gbMonths(bytes: number | null, months: number): number | undefined {
  if (bytes === null || !Number.isFinite(bytes) || bytes <= 0) return undefined;
  return Math.round((bytes / BYTES_PER_GB) * months * 1e6) / 1e6;
}

function processor(kind: ClipJobKind, provider: string, ranSeconds: number): number {
  return seconds(ranSeconds * vcpusFor(kind, provider));
}

function renderSeconds(job: CostJob, output: Loose | null): number {
  const fromOutput = num(output?.durationMs);
  if (fromOutput !== null) return seconds(fromOutput / 1000);
  const parsed = renderInputSchema.safeParse(job.input);
  if (!parsed.success) return 0;
  try {
    return seconds(outputDuration(parsed.data.document) / 1000);
  } catch {
    return 0;
  }
}

function emoteBytes(output: Loose | null): number | null {
  if (!output) return null;
  let total = 0;
  const files = Array.isArray(output.files) ? output.files : [];
  for (const file of files) {
    const row = record(file);
    if (row?.fits !== false) total += num(row?.bytes) ?? 0;
  }
  total += num(record(output.zip)?.bytes) ?? 0;
  return total > 0 ? total : null;
}

/** Tokens for reading `readSeconds` of transcript: research 07's per-hour figures, every pass. */
export function readTokens(readSeconds: number): { tokensIn: number; tokensOut: number } {
  const hours = readSeconds / 3600;
  const passes = CLIP_ESTIMATES.readPasses.value;
  return {
    tokensIn: Math.round(hours * CLIP_ESTIMATES.readTokensInPerHour.value * passes),
    tokensOut: Math.round(hours * CLIP_ESTIMATES.readTokensOutPerHour.value * passes),
  };
}

/** Tokens for translating `spanSeconds` of captions: the transcript in, as much out. */
export function translateTokens(spanSecondsValue: number): { tokensIn: number; tokensOut: number } {
  const tokens = Math.round(
    (spanSecondsValue / 3600) * CLIP_ESTIMATES.transcriptTokensPerHour.value,
  );
  return { tokensIn: tokens, tokensOut: tokens };
}

/** The facts `estimate` prices and `ClipJob.cost` keeps. */
export function costFacts(job: CostJob, context: CostContext): ClipCostFacts {
  const input = record(job.input);
  const output = record(job.output);
  const done = job.status === 'DONE';
  const ranSeconds = ranSecondsOf(job);
  const engine = context.aiModel ?? 'unknown';
  const units: ClipCostUnits = {};
  let videoSeconds = 0;
  let provider = 'ffmpeg';
  let estimated = false;

  switch (job.kind) {
    case 'IMPORT': {
      const ms = num(output?.durationMs) ?? context.videoDurationMs;
      videoSeconds = seconds((ms ?? 0) / 1000);
      units.processorSeconds = processor(job.kind, provider, ranSeconds);
      const stored = gbMonths(context.storedBytes, STORAGE_MONTHS.kept);
      if (stored !== undefined) units.storedGbMonths = stored;
      break;
    }
    case 'SEGMENT': {
      videoSeconds = seconds(spanSeconds(input));
      units.processorSeconds = processor(job.kind, provider, ranSeconds);
      const stored = gbMonths(context.storedBytes, STORAGE_MONTHS.kept);
      if (stored !== undefined) units.storedGbMonths = stored;
      break;
    }
    case 'HIGHLIGHTS': {
      const run = context.run;
      videoSeconds = seconds(run ? run.readMs / 1000 : (context.videoDurationMs ?? 0) / 1000);
      const ai = record(output?.ai);
      const read = run
        ? done
          ? ai?.read === true && ai.noSpeech !== true
          : job.stage !== null && READ_STAGES.has(job.stage)
        : false;
      const looked = run?.vision
        ? done
          ? ai?.watched === true
          : job.stage !== null && LOOK_STAGES.has(job.stage)
        : false;
      if (read || looked) {
        provider = engine;
        estimated = true;
      }
      const boxSeconds = Math.max(0, ranSeconds - (run?.listenOverlapSeconds ?? 0));
      units.processorSeconds = processor(job.kind, 'ffmpeg', boxSeconds);
      if (read) Object.assign(units, readTokens(videoSeconds));
      if (looked) units.pictures = CLIP_ESTIMATES.visionPictures.value;
      break;
    }
    case 'RENDER': {
      videoSeconds = renderSeconds(job, output);
      units.processorSeconds = processor(job.kind, provider, ranSeconds);
      const proof = input?.proof === true;
      const stored = gbMonths(
        num(output?.bytes),
        proof ? STORAGE_MONTHS.oneDay : STORAGE_MONTHS.kept,
      );
      if (stored !== undefined) units.storedGbMonths = stored;
      break;
    }
    case 'DOWNLOAD': {
      videoSeconds = seconds((num(input?.durationMs) ?? num(output?.durationMs) ?? 0) / 1000);
      units.processorSeconds = processor(job.kind, provider, ranSeconds);
      const stored = gbMonths(num(output?.bytes), STORAGE_MONTHS.oneDay);
      if (stored !== undefined) units.storedGbMonths = stored;
      break;
    }
    case 'TRANSCRIBE': {
      const listened = num(output?.secondsListened);
      const asked = Array.isArray(input?.ranges)
        ? input.ranges.reduce<number>((sum, range) => sum + spanSeconds(record(range)), 0)
        : 0;
      videoSeconds = seconds(listened ?? asked);
      const model = typeof output?.model === 'string' && output.model ? output.model : null;
      provider = model ?? 'unknown';
      units.audioSeconds = videoSeconds;
      if (isHostedListener(provider)) {
        units.processorSeconds = 0;
      } else if (provider === 'simulation') {
        // A stand-in listened: priced as our own box would have listened (research 07's speed).
        units.processorSeconds = seconds(
          videoSeconds * CLIP_ESTIMATES.ownListenRealTime.value * vcpusFor(job.kind, provider),
        );
        estimated = true;
      } else {
        units.processorSeconds = processor(job.kind, provider, ranSeconds);
        // No output: we cannot tell who listened, so it is priced as our own box.
        if (!model) estimated = true;
      }
      break;
    }
    case 'FACES': {
      provider = 'media-service';
      videoSeconds = seconds(spanSeconds(input));
      units.processorSeconds = processor(job.kind, provider, ranSeconds);
      break;
    }
    case 'SPEECH': {
      provider = 'media-service';
      videoSeconds = seconds((num(output?.durationMs) ?? 0) / 1000);
      units.processorSeconds = processor(job.kind, provider, ranSeconds);
      break;
    }
    case 'TRANSLATE': {
      provider = engine;
      videoSeconds = seconds(spanSeconds(input));
      Object.assign(units, translateTokens(videoSeconds));
      estimated = true;
      break;
    }
    case 'AUTO_EDIT': {
      provider = 'api';
      videoSeconds = seconds(spanSeconds(record(input?.range)));
      break;
    }
    case 'EMOTE': {
      videoSeconds = seconds(spanSeconds(input, 'startMs', 'endMs'));
      units.processorSeconds = processor(job.kind, provider, ranSeconds);
      const stored = gbMonths(emoteBytes(output), STORAGE_MONTHS.oneDay);
      if (stored !== undefined) units.storedGbMonths = stored;
      break;
    }
  }

  return { videoSeconds, ranSeconds, provider, units, estimated, prices: CLIP_PRICES_DATE };
}
