/**
 * Text To Speech (Sprint 13, Module 09): the Node half of a SPEECH job,
 * behind `CLIPS_TTS`. The API priced it, charged it and wrote the row.
 *
 * The workflow runs three steps:
 * 1. `prepareSpeech` (here): the job goes RUNNING at "Making the voice", the
 *    line is stored as the speech text file (so it never rides in a Temporal
 *    payload or its history) and the Python input is built (keys only).
 * 2. `mediaPySpeak` (Python, on `postgear-media-py`): reads the line, speaks
 *    it (the simulated speaker, or Kokoro run as its own program beside the
 *    service) and stores a WAV at the job's key.
 * 3. `finishSpeech` (here): the WAV is made the editor's AAC `.m4a` with its
 *    peaks, exactly as an uploaded sound is (`convertUploadedSound`), and
 *    kept as the workspace's own sound (an AUDIO asset, `purpose: 'sound'`,
 *    `ready`, plus `voice` and `madeByAi: true`) with the job's DONE in one
 *    transaction. The text file and the WAV are removed.
 *
 * So the editor adds a made voice exactly like an uploaded sound: a sound
 * item whose `ref` is `{ asset: <assetId> }`.
 *
 * A failure or a cancel removes all three files and gives the AI minutes back
 * (`job-outcomes.ts`). Logs carry ids, counts and lengths, never the line.
 */
import * as path from 'node:path';
import {
  MEDIA_CONTRACT_VERSION,
  type MediaPySpeakInput,
  type MediaPySpeakOutput,
  speechTextFile,
} from '@postgear/media-contract';
import { SoundError } from '@postgear/media-tools';
import type { PrivateStorage } from '@postgear/storage';
import {
  type SoundAssetMeta,
  type SpeechInput,
  soundAssetMetaSchema,
  speechOutputSchema,
} from '@postgear/video-engine';
import { ClipStepError } from '../failures';
import { deleteQuietly } from '../import/import.steps';
import type { JobProgress } from '../job-progress';
import { speechKeys } from '../keys';
import type { ClipRows } from '../rows';

/** Forcing switches in the line, read only when the providers are simulated. */
export const VOICE_FAIL_MARKER = '[simulate:voice-fail]';
export const VOICE_SLOW_MARKER = '[simulate:voice-slow]';

/** Every made voice's name in the Uploaded tab; `meta.voice` says which voice. */
export const MADE_VOICE_NAME = 'AI Voice';
export const MADE_VOICE_MIME = 'audio/mp4';

/** What `finishSpeech` needs to turn the WAV into the editor's sound (tests pass a fake). */
export type ConvertSound = (options: {
  cwd: string;
  input: string;
  output: string;
  signal?: AbortSignal;
}) => Promise<{ file: string; durationMs: number; peaks: number[]; bytes: number }>;

export interface SpeechRun {
  jobId: string;
  organizationId: string;
  input: SpeechInput;
  rows: Pick<ClipRows, 'finishSpeech'>;
  privateStorage: Pick<PrivateStorage, 'put' | 'putFile' | 'getToFile' | 'delete'>;
  progress: Pick<JobProgress, 'report'>;
  simulated: boolean;
  now: () => Date;
}

/** A made voice's asset meta: an uploaded sound's `ready` meta, plus which voice and the AI mark. */
export type MadeVoiceMeta = Extract<SoundAssetMeta, { status: 'ready' }> & {
  voice: string;
  madeByAi: true;
};

/** Which forced state a simulated run takes, from the line. */
export function speechForce(text: string): 'fail' | 'slow' | null {
  if (text.includes(VOICE_FAIL_MARKER)) return 'fail';
  if (text.includes(VOICE_SLOW_MARKER)) return 'slow';
  return null;
}

/** Step 1: the line stored as the job's text file, and the Python activity's input. */
export async function prepareSpeech(run: SpeechRun): Promise<MediaPySpeakInput> {
  await run.progress.report({ stage: 'voice', progress: 5 });
  const keys = speechKeys(run.organizationId, run.jobId);
  const parsed = speechTextFile.safeParse({ version: 1, text: run.input.text });
  // The route allows 500 characters; a longer row never reaches Python.
  if (!parsed.success) throw new ClipStepError('voice_failed', { retryable: false });
  await run.privateStorage.put(
    keys.text,
    Buffer.from(JSON.stringify(parsed.data), 'utf8'),
    'application/json',
  );
  return {
    version: MEDIA_CONTRACT_VERSION,
    jobId: run.jobId,
    orgId: run.organizationId,
    textKey: keys.text,
    voiceId: run.input.voiceId,
    outKey: keys.wav,
    simulation: run.simulated ? { force: speechForce(run.input.text) } : null,
  };
}

/**
 * Step 3: the WAV made the editor's sound and kept, with the job's DONE.
 * `dir` is the activity's scratch folder. A retry is safe: the asset's id is
 * the job's and every key is made from it. Returns false when the job was
 * closed meanwhile (what was made is removed).
 */
export async function finishSpeech(
  run: SpeechRun,
  spoken: MediaPySpeakOutput,
  dir: string,
  convert: ConvertSound,
  signal?: AbortSignal,
): Promise<boolean> {
  const { organizationId: org, jobId } = run;
  const keys = speechKeys(org, jobId);
  // The key is ours by construction; an answer naming any other key is refused.
  if (spoken.soundKey !== keys.wav) throw new ClipStepError('voice_failed', { retryable: false });
  await run.progress.report({ stage: 'voice', progress: 80 });

  await run.privateStorage.getToFile(keys.wav, path.join(dir, 'voice.wav'), signal);
  let made: Awaited<ReturnType<ConvertSound>>;
  try {
    made = await convert({ cwd: dir, input: 'voice.wav', output: 'sound.m4a', signal });
  } catch (error) {
    // A WAV FFmpeg cannot use, or one too long, fails the same way every time.
    if (error instanceof SoundError && error.code !== 'tool_failed' && error.code !== 'cancelled') {
      throw new ClipStepError('voice_failed', { retryable: false });
    }
    throw error;
  }
  const durationMs = Math.round(made.durationMs);
  if (!(durationMs > 0)) throw new ClipStepError('voice_failed', { retryable: false });
  await run.progress.report({ stage: 'voice', progress: 92 });

  const ready = soundAssetMetaSchema.parse({
    status: 'ready',
    purpose: 'sound',
    name: MADE_VOICE_NAME,
    durationMs,
    peaks: made.peaks,
  });
  const meta: MadeVoiceMeta = {
    ...(ready as Extract<SoundAssetMeta, { status: 'ready' }>),
    voice: run.input.voiceId,
    madeByAi: true,
  };
  const output = speechOutputSchema.parse({ assetId: jobId, durationMs });

  await run.privateStorage.putFile(keys.sound, path.join(dir, made.file), MADE_VOICE_MIME);
  const finished = await run.rows.finishSpeech({
    jobId,
    organizationId: org,
    asset: {
      id: jobId,
      videoId: null,
      clipId: null,
      kind: 'AUDIO',
      key: keys.sound,
      bytes: made.bytes,
      mimeType: MADE_VOICE_MIME,
      meta: { ...meta },
    },
    output,
    now: run.now(),
  });
  // The line and the WAV are never kept, whatever happened.
  await deleteQuietly(run.privateStorage, [keys.text, keys.wav]);
  if (!finished) {
    await deleteQuietly(run.privateStorage, [keys.sound]);
    return false;
  }
  console.log(
    JSON.stringify({
      event: 'clips.voice.done',
      jobId,
      voice: run.input.voiceId,
      characters: run.input.text.length,
      ms: durationMs,
      bytes: made.bytes,
      producer: spoken.producer,
    }),
  );
  return true;
}
