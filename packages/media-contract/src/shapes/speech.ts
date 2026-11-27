/**
 * `mediaPySpeak`: a typed line made into a voice (Sprint 13, Module 09, Text
 * To Speech, behind `CLIPS_TTS`).
 *
 * The line itself never rides in the payload (README rule 7): the Node side
 * stores it as the **speech text file** at a key made from the job's id, and
 * Python reads it from there. Python writes a mono 16-bit WAV at `outKey`
 * (also made from the job's id) and answers the key, its length and its rate.
 * The Node side turns that WAV into the workspace's own sound (the editor's
 * AAC `.m4a` with its peaks, exactly like an uploaded sound) and removes both
 * files.
 *
 * Every key sits in the workspace's library space,
 * `clips/<org>/library/<job hex>.<json|wav|m4a>`, because a made voice
 * belongs to the workspace, not to a video.
 *
 * Two Speaker bindings: the simulated one (a tone pattern whose length follows
 * the text) and Kokoro, which runs as **its own program** beside the service
 * (`apps/media/voice-program`, GPL-3.0-or-later, because `kokoro-onnx` loads
 * espeak-ng inside whatever process imports it). The service never imports it.
 *
 * `VoiceList` is the service's `GET /voices` answer: the voices of the binding
 * it runs, which is the only list the API offers.
 */
import { z } from 'zod/v4';
import { contractVersion, orgId, storageKey, uuid } from './common';
import { binding } from './health';

/** The rate every made voice is written at (Kokoro's own rate, kept for the simulated binding). */
export const SPEECH_SAMPLE_RATE = 24_000;
/** The longest line one voice is made from (the route's limit). */
export const SPEECH_MAX_CHARACTERS = 500;
/** The longest voice one call may answer: 500 characters at a slow pace is far under it. */
export const SPEECH_MAX_MS = 10 * 60 * 1000;
/** Read only by the simulated binding: a forcing switch, from `[simulate:voice-fail]` and `[simulate:voice-slow]`. */
export const SPEECH_SIMULATION_FORCES = ['fail', 'slow'] as const;

/** A voice's id: short, lowercase, dashes. Never a path or a file name. */
export const voiceId = z
  .string()
  .max(32)
  .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+){0,3}$/)
  .meta({ id: 'VoiceId' });

const speakSimulationHint = z
  .strictObject({ force: z.enum(SPEECH_SIMULATION_FORCES).nullable() })
  .meta({ id: 'SpeakSimulationHint' });

export const mediaPySpeakInput = z
  .strictObject({
    version: contractVersion,
    jobId: uuid,
    orgId,
    /** The speech text file (`SpeechTextFile`), never the text itself. */
    textKey: storageKey,
    voiceId,
    /** Where the WAV goes. */
    outKey: storageKey,
    simulation: speakSimulationHint.nullable(),
  })
  .meta({ id: 'MediaPySpeakInput', title: 'MediaPySpeakInput' });

export const mediaPySpeakOutput = z
  .strictObject({
    /** The WAV, at the asked `outKey`. */
    soundKey: storageKey,
    durationMs: z.number().int().min(1).max(SPEECH_MAX_MS),
    sampleRate: z.literal(SPEECH_SAMPLE_RATE),
    /** What spoke, such as `simulation`. */
    producer: z.string().min(1).max(80),
  })
  .meta({ id: 'MediaPySpeakOutput', title: 'MediaPySpeakOutput' });

/** The speech text file (a stored file both sides read): the line, nothing else. */
export const speechTextFile = z
  .strictObject({
    version: z.literal(1),
    text: z.string().min(1).max(SPEECH_MAX_CHARACTERS),
  })
  .meta({ id: 'SpeechTextFile', title: 'SpeechTextFile' });

/** The spoken languages a voice can read (the API matches a line's script to them). */
export const VOICE_LANGUAGES = ['en', 'hi', 'ta'] as const;

/** One voice on offer: its id, a name a person reads, and the languages it reads. */
export const voiceInfo = z
  .strictObject({
    id: voiceId,
    name: z.string().min(1).max(40),
    languages: z.array(z.enum(VOICE_LANGUAGES)).min(1).max(VOICE_LANGUAGES.length),
  })
  .meta({ id: 'VoiceInfo' });

/** `GET /voices`: the speaker the service runs and its voices (none while it is `off`). */
export const voiceList = z
  .strictObject({
    speaker: binding,
    voices: z.array(voiceInfo).max(64),
  })
  .meta({ id: 'VoiceList', title: 'VoiceList' });

export type VoiceInfo = z.infer<typeof voiceInfo>;
export type VoiceList = z.infer<typeof voiceList>;
export type MediaPySpeakInput = z.infer<typeof mediaPySpeakInput>;
export type MediaPySpeakOutput = z.infer<typeof mediaPySpeakOutput>;
export type SpeechTextFile = z.infer<typeof speechTextFile>;
