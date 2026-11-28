/**
 * Listening (Sprint 13, Module 02): the Node half of a TRANSCRIBE job.
 *
 * The workflow runs three steps:
 * 1. `prepareTranscribe` (here): the job goes RUNNING at "Listening to what is
 *    said", the video and its analysis sound are looked up, and the one JSON
 *    object the Python service takes is built (storage keys, never paths).
 * 2. `mediaPyTranscribe` (Python, on `postgear-media-py`): listens and stores
 *    the heard file at a key made from the job id.
 * 3. `finishTranscribe` (here): the heard file is merged into the video's
 *    transcript (`mergeTranscript`: nothing already indexed is renumbered),
 *    the new file replaces the old one in one transaction with the job's
 *    DONE, and a stretch where nothing was heard gives its AI minutes back.
 *
 * Speech text never reaches a log line, an error or a workflow payload: the
 * words travel only inside the two stored files.
 */
import { readFile, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { gunzip, gzip } from 'node:zlib';
import {
  heardFile,
  MEDIA_CONTRACT_VERSION,
  type MediaPyTranscribeInput,
  type MediaPyTranscribeOutput,
} from '@postgear/media-contract';
import { isOwnSample, resolveSimulationLink, SAMPLE_NAMES } from '@postgear/media-tools';
import type { PrivateStorage } from '@postgear/storage';
import {
  decodeTranscript,
  emptyTranscript,
  encodeTranscript,
  isTranscriptLanguage,
  mergeTranscript,
  readTranscriptAssetMeta,
  type TranscribeInput,
  type Transcript,
  TranscriptFileError,
  transcribeOutputSchema,
  transcriptAssetMeta,
} from '@postgear/video-engine';
import { ClipStepError } from '../failures';
import { deleteQuietly } from '../import/import.steps';
import type { ClipInternalClient } from '../internal-client';
import type { JobProgress } from '../job-progress';
import { heardFileKey, transcriptFileKey } from '../keys';
import type { AssetRow, ClipRows, VideoLinkRow, VideoRow } from '../rows';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

export const TRANSCRIPT_MIME = 'application/gzip';
/** A stored transcript or heard file larger than this is refused before it is unzipped. */
const MAX_GZ_BYTES = 32 * 1024 * 1024;
const MAX_JSON_BYTES = 256 * 1024 * 1024;

/** Forcing switches in a video's title, read only when the providers are simulated. */
export const LISTEN_FAIL_MARKER = '[simulate:listen-fail]';
export const LISTEN_SILENT_MARKER = '[simulate:no-speech]';
export const LISTEN_SLOW_MARKER = '[simulate:listen-slow]';

export interface TranscribeRun {
  jobId: string;
  organizationId: string;
  input: TranscribeInput;
  rows: Pick<
    ClipRows,
    'video' | 'videoAssets' | 'videoLink' | 'speechStaysHere' | 'finishTranscribe'
  >;
  privateStorage: PrivateStorage;
  progress: Pick<JobProgress, 'report'>;
  simulated: boolean;
  now: () => Date;
}

/** Which sample's recorded transcript a simulated listen answers from, and any forced state. */
export function simulationHint(
  video: Pick<VideoRow, 'title'>,
  link: VideoLinkRow | null,
): NonNullable<MediaPyTranscribeInput['simulation']> {
  let sample: string | null = null;
  if (link && link.platform !== 'upload' && link.externalId) {
    const answer = resolveSimulationLink({
      platform: link.platform,
      kind: link.kind === 'upload' ? 'video' : link.kind,
      externalId: link.externalId,
      canonicalUrl: 'https://sim.invalid/',
    });
    if (answer?.type === 'video') sample = answer.sample;
  } else {
    // An upload named like a developer's own sample reads that sample's recorded words.
    const title = video.title.toLowerCase();
    sample = SAMPLE_NAMES.find((name) => isOwnSample(name) && title.includes(name)) ?? null;
  }
  const force = video.title.includes(LISTEN_FAIL_MARKER)
    ? 'fail'
    : video.title.includes(LISTEN_SILENT_MARKER)
      ? 'no-speech'
      : video.title.includes(LISTEN_SLOW_MARKER)
        ? 'slow'
        : null;
  return { sample, force };
}

/** The newest asset of a kind (a job's file replaces the last one of its kind). */
function newest(assets: readonly AssetRow[], kind: AssetRow['kind']): AssetRow | null {
  return assets.filter((row) => row.kind === kind).at(-1) ?? null;
}

/** The video's transcript in `language` (`auto`: its first listened or supplied one). */
export function transcriptAssetFor(assets: readonly AssetRow[], language: string): AssetRow | null {
  const candidates = assets
    .filter((row) => row.kind === 'TRANSCRIPT')
    .map((row) => ({ row, meta: readTranscriptAssetMeta(row.meta) }))
    .filter((item) => item.meta !== null && item.meta.source !== 'translated');
  if (language === 'auto') return candidates[0]?.row ?? null;
  return candidates.find((item) => item.meta?.language === language)?.row ?? null;
}

/** Step 1: the Python activity's input. Throws a permanent `no_speech` for a video with no sound. */
export async function prepareTranscribe(run: TranscribeRun): Promise<MediaPyTranscribeInput> {
  await run.progress.report({ stage: 'listening', progress: 3 });
  const [video, link, assets, speechStaysHere] = await Promise.all([
    run.rows.video(run.organizationId, run.input.videoId),
    run.rows.videoLink(run.organizationId, run.input.videoId),
    run.rows.videoAssets(run.organizationId, run.input.videoId),
    run.rows.speechStaysHere(run.organizationId),
  ]);
  if (!video || video.deletedAt || video.status !== 'READY' || video.durationMs === null) {
    throw new ClipStepError('transcribe_failed', { retryable: false });
  }
  const audio = newest(assets, 'ANALYSIS_AUDIO');
  if (!video.hasAudio || !audio) throw new ClipStepError('no_speech', { retryable: false });

  return {
    version: MEDIA_CONTRACT_VERSION,
    jobId: run.jobId,
    orgId: run.organizationId,
    videoId: video.id,
    audioKey: audio.key,
    durationMs: video.durationMs,
    ranges: run.input.ranges.map((range) => ({ fromMs: range.fromMs, toMs: range.toMs })),
    language: run.input.language,
    // Module 17 item 26: the media service never uses its hosted lane for this job.
    ownMachineOnly: speechStaysHere,
    simulation: run.simulated ? simulationHint(video, link) : null,
  };
}

async function readGz(storage: PrivateStorage, key: string, file: string): Promise<string> {
  await storage.getToFile(key, file);
  const bytes = await readFile(file);
  if (bytes.length > MAX_GZ_BYTES)
    throw new ClipStepError('transcribe_failed', { retryable: false });
  const json = await gunzipAsync(bytes, { maxOutputLength: MAX_JSON_BYTES });
  return json.toString('utf8');
}

export interface FinishTranscribeResult {
  /** False when the job was closed meanwhile: nothing was kept. */
  finished: boolean;
  noSpeech: boolean;
}

/**
 * Step 3: merge, store, and close the job. `dir` is the activity's scratch
 * folder. A retry is safe: the transcript key is made from the job id, and
 * the row swap happens with the job's DONE or not at all.
 */
export async function finishTranscribe(
  run: TranscribeRun,
  heard: MediaPyTranscribeOutput,
  dir: string,
  internal: Pick<ClipInternalClient, 'reverseCharges'>,
): Promise<FinishTranscribeResult> {
  const { organizationId: org, jobId } = run;
  const videoId = run.input.videoId;
  const expectedHeardKey = heardFileKey(org, videoId, jobId);
  // The key is ours by construction; an answer naming any other key is refused.
  if (heard.heardKey !== expectedHeardKey) {
    throw new ClipStepError('transcribe_failed', { retryable: false });
  }
  await run.progress.report({ stage: 'listening', progress: 92 });

  let incoming: ReturnType<typeof heardFile.parse>;
  try {
    incoming = heardFile.parse(
      JSON.parse(await readGz(run.privateStorage, heard.heardKey, path.join(dir, 'heard.json.gz'))),
    );
  } catch (error) {
    if (error instanceof ClipStepError) throw error;
    throw new ClipStepError('transcribe_failed', { retryable: true, cause: error });
  }

  // Module 16: Detect Automatically may hear a language we cannot draw (the
  // API refuses one asked for by name before any charge). Nothing is stored,
  // the job fails with the language sentence and the minutes go back.
  if (
    run.input.language === 'auto' &&
    incoming.words.length > 0 &&
    !isTranscriptLanguage(incoming.language)
  ) {
    await deleteQuietly(run.privateStorage, [heard.heardKey]);
    throw new ClipStepError('language_unsupported', { retryable: false });
  }

  const assets = await run.rows.videoAssets(org, videoId);
  // The language asked for, or the one this listen found, picks which transcript grows.
  const language = run.input.language === 'auto' ? 'auto' : run.input.language;
  const existingAsset = transcriptAssetFor(assets, language);
  const existingMeta = existingAsset ? readTranscriptAssetMeta(existingAsset.meta) : null;

  let existing: Transcript = emptyTranscript(incoming.language, incoming.model);
  if (existingAsset) {
    try {
      existing = decodeTranscript(
        await readGz(
          run.privateStorage,
          existingAsset.key,
          path.join(dir, 'transcript-old.json.gz'),
        ),
      );
    } catch (error) {
      // An unreadable old file must not block listening: start over from what was just heard.
      if (!(error instanceof TranscriptFileError)) {
        throw new ClipStepError('transcribe_failed', { retryable: true, cause: error });
      }
    }
  }

  const merged = mergeTranscript(existing, {
    ranges: incoming.ranges,
    words: incoming.words,
    language: incoming.language,
    model: incoming.model,
  });
  const bytes = await gzipAsync(Buffer.from(encodeTranscript(merged), 'utf8'));
  const file = path.join(dir, 'transcript.json.gz');
  await writeFile(file, bytes);
  const key = transcriptFileKey(org, videoId, jobId);
  await run.privateStorage.putFile(key, file, TRANSCRIPT_MIME);

  const noSpeech = incoming.words.length === 0;
  const output = transcribeOutputSchema.parse({
    transcriptAssetId: jobId,
    language: merged.language,
    wordCount: incoming.words.length,
    noSpeech,
    secondsListened: heard.secondsListened,
    model: incoming.model,
  });

  let finished: Awaited<ReturnType<ClipRows['finishTranscribe']>>;
  try {
    finished = await run.rows.finishTranscribe({
      jobId,
      organizationId: org,
      videoId,
      replaceAssetId: existingAsset?.id ?? null,
      asset: {
        id: jobId,
        videoId,
        kind: 'TRANSCRIPT',
        key,
        bytes: bytes.length,
        mimeType: TRANSCRIPT_MIME,
        meta: { ...transcriptAssetMeta(merged, existingMeta?.fixes ?? [], existingMeta?.fileName) },
      },
      output,
      now: run.now(),
    });
  } catch (error) {
    await deleteQuietly(run.privateStorage, [key]);
    throw error;
  }
  if (!finished.finished) {
    await deleteQuietly(run.privateStorage, [key, heard.heardKey]);
    return { finished: false, noSpeech };
  }
  await deleteQuietly(run.privateStorage, [...finished.replacedKeys, heard.heardKey]);

  if (noSpeech) {
    // Nothing was heard: the stretch stays covered (never listened to again) and the minutes go back.
    await internal.reverseCharges(jobId, { organizationId: org });
  }
  console.log(
    JSON.stringify({
      event: 'clips.transcribe.done',
      jobId,
      videoId,
      language: merged.language,
      words: incoming.words.length,
      totalWords: merged.words.length,
      noSpeech,
      model: incoming.model,
      secondsListened: heard.secondsListened,
    }),
  );
  return { finished: true, noSpeech };
}
