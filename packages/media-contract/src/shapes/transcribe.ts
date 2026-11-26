/**
 * `mediaPyTranscribe`: listen to stretches of a video's analysis sound and
 * hand back the words with a time each (Sprint 13, Module 02).
 *
 * The sound is the 16 kHz mono WAV the import made (`ANALYSIS_AUDIO`), named
 * by its storage key. The answer is small: a key to the **heard file** (the
 * words and the speech curve of the asked stretches, gzipped JSON in the
 * video's own key space) and a few numbers. The Node workflow merges the
 * heard file into the video's transcript and removes it. Speech text is never
 * in the activity's payload, so it is never in Temporal's history.
 */
import { z } from 'zod/v4';
import { contractVersion, orgId, sourceMs, storageKey, timeRange, uuid } from './common';

/** `auto`, or an ISO 639-1 code. Which codes are offered is `video-engine`'s `TRANSCRIPT_LANGUAGES`. */
export const languageChoice = z
  .string()
  .regex(/^(?:auto|[a-z]{2,3})$/)
  .meta({ id: 'LanguageChoice' });

/** The most stretches one call may listen to. */
export const MAX_TRANSCRIBE_RANGES = 64;

/**
 * Read only by the simulated binding: which sample's recorded transcript to
 * answer from, and a forcing switch for states a hand check could not reach.
 */
export const SIMULATION_FORCES = ['fail', 'no-speech', 'slow'] as const;

const simulationHint = z
  .strictObject({
    /** A sample's name (`talk`, `stream`, `two-speakers`, `verideck`); null for any other video. */
    sample: z
      .string()
      .regex(/^[a-z0-9-]{1,32}$/)
      .nullable(),
    force: z.enum(SIMULATION_FORCES).nullable(),
  })
  .meta({ id: 'SimulationHint' });

export const mediaPyTranscribeInput = z
  .strictObject({
    version: contractVersion,
    jobId: uuid,
    orgId,
    videoId: uuid,
    /** The 16 kHz mono analysis sound. */
    audioKey: storageKey,
    /** The video's whole length, so a range past the end is refused before any work. */
    durationMs: sourceMs,
    /** The stretches to listen to, in the video's time; they never overlap. */
    ranges: z.array(timeRange).min(1).max(MAX_TRANSCRIBE_RANGES),
    language: languageChoice,
    simulation: simulationHint.nullable(),
  })
  .meta({ id: 'MediaPyTranscribeInput', title: 'MediaPyTranscribeInput' });

export const mediaPyTranscribeOutput = z
  .strictObject({
    /** The heard file: words and the speech curve of the asked stretches. */
    heardKey: storageKey,
    /** The language found (or the one asked for), ISO 639-1. */
    language: z.string().regex(/^[a-z]{2,3}$/),
    /** How sure the listener was of the language, 0 to 1; null when it was asked for or unknown. */
    languageProbability: z.number().min(0).max(1).nullable(),
    /** What listened, such as `faster-whisper:small`, `groq:whisper-large-v3-turbo` or `simulation`. */
    model: z.string().min(1).max(80),
    /** Seconds of sound it worked on. */
    secondsListened: z.number().min(0),
    wordCount: z.number().int().min(0),
    /** No word was heard in any asked stretch. */
    noSpeech: z.boolean(),
  })
  .meta({ id: 'MediaPyTranscribeOutput', title: 'MediaPyTranscribeOutput' });

/**
 * The heard file's own shape (not an activity payload: it is a stored file
 * both sides read and write). Times are whole milliseconds of the video.
 */
const heardWord = z
  .strictObject({
    start: sourceMs,
    end: sourceMs,
    text: z.string().min(1).max(80),
    sure: z.number().min(0).max(1),
  })
  .meta({ id: 'HeardWord' });

export const heardFile = z
  .strictObject({
    version: z.literal(1),
    language: z.string().regex(/^[a-z]{2,3}$/),
    model: z.string().min(1).max(80),
    ranges: z.array(timeRange).min(1).max(MAX_TRANSCRIBE_RANGES),
    words: z.array(heardWord).max(400_000),
    /**
     * How sure we are someone is talking, 0 to 1, two values a second from the
     * start of the video. Null where nothing was listened to.
     */
    speech: z.strictObject({
      sampleRateHz: z.literal(2),
      values: z.array(z.number().min(0).max(1).nullable()).max(24 * 3600 * 2),
    }),
  })
  .meta({ id: 'HeardFile', title: 'HeardFile' });

export type MediaPyTranscribeInput = z.infer<typeof mediaPyTranscribeInput>;
export type MediaPyTranscribeOutput = z.infer<typeof mediaPyTranscribeOutput>;
export type HeardFile = z.infer<typeof heardFile>;
