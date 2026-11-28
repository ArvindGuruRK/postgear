/**
 * How long a queued Clips job waits, in rules (Sprint 13, Module 15). Pure:
 * `ClipQueueService` reads the rows and the paces and hands them here.
 *
 * - **The size of a job** is minutes of work: video minutes for every kind
 *   that works on video (the whole video for an import and Find Clips, the
 *   stretch for a sharp range, a listen, faces, an emote; the clip for an
 *   export), spoken minutes for a voice. Unknown (an import whose length the
 *   probe did not give) is null, and an estimate that needs it has no honest
 *   number.
 * - **The pace of a kind** is seconds a job holds its slot per minute of
 *   work: a rolling average of finished jobs (`nextPace`), or a fixed prior
 *   before there is one. The time held includes any wait inside the job (a
 *   Find Clips run waiting for its listening, an export for its sharp
 *   range): that is the time the slot is taken, which is what the queue
 *   behind it feels.
 * - **The wait** (`waitSeconds`) lays the jobs ahead onto the class's slots
 *   as they free up: each slot is free when its running job is expected to
 *   end, each job ahead takes the slot that frees first, and our turn is the
 *   first slot free after them. This is "the jobs ahead plus the running
 *   ones, divided by the slots", without counting a slot that is free now
 *   as busy.
 */
import { type ClipJobKind, renderedDuration } from '@postgear/video-engine';

/**
 * Seconds per minute of work before any job of the kind has finished. A
 * starting guess only, replaced by the rolling average after the first job:
 * listening is research 07's figure for the default model on a processor
 * (about real time; Module 02 measured `small` at 10 s a minute), an export
 * is research 07's measured "about real time" for a 1080p clip, the rest
 * are rough figures of their FFmpeg and download work.
 */
export const PRIOR_SECONDS_PER_MINUTE: Readonly<Record<ClipJobKind, number>> = Object.freeze({
  IMPORT: 30,
  SEGMENT: 15,
  HIGHLIGHTS: 10,
  RENDER: 60,
  DOWNLOAD: 15,
  TRANSCRIBE: 60,
  FACES: 10,
  TRANSLATE: 10,
  SPEECH: 60,
  AUTO_EDIT: 60,
  EMOTE: 120,
});

/** A voice is about 15 characters a second, so 900 characters a minute. */
const CHARACTERS_PER_SPOKEN_MINUTE = 900;
/** The smallest size a job counts as (a 3 second emote), so a pace never divides by nothing. */
export const MIN_WORK_MINUTES = 0.05;
/** A sample is weighted at least this much: the average follows a machine that got faster or slower. */
const MIN_SAMPLE_WEIGHT = 0.2;
/** Samples counted; past this the average is a plain rolling one. */
const MAX_SAMPLES = 50;
/** A job that held its slot longer than this is an outlier (a stuck run), not a pace. */
export const MAX_SAMPLE_SECONDS = 12 * 60 * 60;

export interface WorkLengths {
  /** The video's length (`ClipVideo.durationMs`), when known. */
  videoMs: number | null;
  /** The clip's length (`Clip.durationMs`), for an export. */
  clipMs: number | null;
}

type Json = Record<string, unknown>;

function asObject(value: unknown): Json | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : null;
}

function spanMs(value: Json | null, from: string, to: string): number | null {
  const start = value?.[from];
  const end = value?.[to];
  return typeof start === 'number' && typeof end === 'number' && end > start ? end - start : null;
}

function minutes(ms: number | null | undefined): number | null {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return null;
  return Math.max(MIN_WORK_MINUTES, ms / 60_000);
}

/**
 * The job's size in minutes of work, or null when it is not known. `input`
 * may be left out for an IMPORT, Find Clips or an export (their size comes
 * from `lengths`); `output` adds the length a finished job measured.
 */
export function workMinutes(
  job: { kind: ClipJobKind; input?: unknown; output?: unknown },
  lengths: WorkLengths,
): number | null {
  const input = asObject(job.input);
  const output = asObject(job.output);
  switch (job.kind) {
    case 'IMPORT': {
      const measured = output?.durationMs;
      return minutes(typeof measured === 'number' ? measured : lengths.videoMs);
    }
    case 'HIGHLIGHTS':
      return minutes(lengths.videoMs);
    case 'RENDER': {
      const rendered = output?.durationMs;
      if (typeof rendered === 'number') return minutes(rendered);
      if (lengths.clipMs !== null) return minutes(lengths.clipMs);
      return minutes(documentMs(input?.document));
    }
    case 'SEGMENT':
    case 'FACES':
    case 'TRANSLATE':
      return minutes(spanMs(input, 'fromMs', 'toMs'));
    case 'EMOTE':
      return minutes(spanMs(input, 'startMs', 'endMs'));
    case 'AUTO_EDIT':
      return minutes(spanMs(asObject(input?.range), 'fromMs', 'toMs'));
    case 'DOWNLOAD': {
      const length = input?.durationMs;
      return minutes(typeof length === 'number' ? length : null);
    }
    case 'TRANSCRIBE': {
      const ranges = input?.ranges;
      if (!Array.isArray(ranges)) return null;
      let total = 0;
      for (const range of ranges) total += spanMs(asObject(range), 'fromMs', 'toMs') ?? 0;
      return minutes(total);
    }
    case 'SPEECH': {
      const text = input?.text;
      if (typeof text !== 'string' || text.length === 0) return null;
      return Math.max(MIN_WORK_MINUTES, text.length / CHARACTERS_PER_SPOKEN_MINUTE);
    }
  }
}

function documentMs(document: unknown): number | null {
  if (!asObject(document) || !Array.isArray((document as { segments?: unknown }).segments)) {
    return null;
  }
  try {
    return renderedDuration(document as Parameters<typeof renderedDuration>[0]);
  } catch {
    return null;
  }
}

/** A kind's rolling average: seconds held per minute of work, and how many jobs it has seen. */
export interface Pace {
  secondsPerMinute: number;
  samples: number;
}

/** The pace once one more finished job is counted. */
export function nextPace(pace: Pace | null, sampleSecondsPerMinute: number): Pace {
  if (!pace || !Number.isFinite(pace.secondsPerMinute) || pace.samples < 1) {
    return { secondsPerMinute: sampleSecondsPerMinute, samples: 1 };
  }
  const samples = Math.min(MAX_SAMPLES, pace.samples + 1);
  const weight = Math.max(1 / samples, MIN_SAMPLE_WEIGHT);
  return {
    secondsPerMinute:
      pace.secondsPerMinute + (sampleSecondsPerMinute - pace.secondsPerMinute) * weight,
    samples,
  };
}

/**
 * One finished job as a sample (seconds per minute), or null when it says
 * nothing about the pace: no length, a non-positive or outlying time.
 */
export function paceSample(heldSeconds: number, work: number | null): number | null {
  if (work === null || !Number.isFinite(heldSeconds)) return null;
  if (heldSeconds <= 0 || heldSeconds > MAX_SAMPLE_SECONDS) return null;
  return heldSeconds / Math.max(MIN_WORK_MINUTES, work);
}

/** Seconds of work a job of `kind` and `work` minutes is expected to hold its slot. */
export function expectedSeconds(
  kind: ClipJobKind,
  work: number | null,
  pace: Pace | null,
): number | null {
  if (work === null) return null;
  const perMinute = pace?.secondsPerMinute ?? PRIOR_SECONDS_PER_MINUTE[kind];
  return Number.isFinite(perMinute) && perMinute >= 0 ? perMinute * work : null;
}

/** Seconds left of a job holding a slot: what is expected, less the share its progress says is done. */
export function secondsLeft(expected: number | null, progress: number): number | null {
  if (expected === null) return null;
  const done = Math.max(0, Math.min(100, Number.isFinite(progress) ? progress : 0)) / 100;
  return Math.max(0, expected * (1 - done));
}

export interface QueueLoad {
  /** Seconds each job ahead (in start order) is expected to take; null when not known. */
  ahead: ReadonlyArray<number | null>;
  /** Seconds left of each job holding a slot of the class; null when not known. */
  running: ReadonlyArray<number | null>;
  /**
   * Seconds left of this workspace's own jobs in the same per-workspace
   * count, when that count is full (it starts only after one of them ends).
   */
  ownFull: ReadonlyArray<number | null> | null;
  /** The class's global slots. */
  slots: number;
}

/** Seconds until our turn, or null when a job in the way has no honest number. */
export function waitSeconds(load: QueueLoad): number | null {
  if (load.ahead.some((value) => value === null)) return null;
  if (load.running.some((value) => value === null)) return null;
  const slots = Math.max(1, Math.floor(Number.isFinite(load.slots) ? load.slots : 1));

  // A slot is free when its job ends; with more running than slots (the
  // slots were lowered), a slot frees only once enough of them have ended.
  const ends = (load.running as number[]).slice().sort((a, b) => a - b);
  const lanes = ends.slice(Math.max(0, ends.length - slots));
  while (lanes.length < slots) lanes.unshift(0);

  for (const seconds of load.ahead as number[]) {
    lanes.sort((a, b) => a - b);
    lanes[0] = (lanes[0] as number) + seconds;
  }
  let wait = Math.min(...lanes);

  if (load.ownFull && load.ownFull.length > 0) {
    if (load.ownFull.some((value) => value === null)) return null;
    wait = Math.max(wait, Math.min(...(load.ownFull as number[])));
  }
  return wait;
}

/** Whole minutes, in seconds: under 30 seconds is 0 ("less than a minute"). */
export function roundToMinutes(seconds: number): number {
  return Math.max(0, Math.round(seconds / 60)) * 60;
}
