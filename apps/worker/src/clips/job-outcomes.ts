/**
 * Reading a job's row, and what happens when a job ends badly.
 *
 * The workflow runs these after the work activity has finally failed (all
 * retries spent, or a permanent failure) or was cancelled, inside a
 * non-cancellable scope, so the bookkeeping happens once, on the last
 * attempt, whatever the worker did on the way. Every step is idempotent:
 * the activity may be retried, a key that was never written deletes fine,
 * and the rows move only while the job is still open (so the bell rings once).
 *
 * - **Failed**: delete what the job stored, the job FAILED with one sentence,
 *   for an import the video FAILED with the same `{ code, message }` and a
 *   `clip_video_failed` bell, for an export a `clip_export_failed` bell; an
 *   import's minutes are given back in full.
 * - **Cancelled**: delete what the job stored, the job CANCELLED; an import's
 *   video is soft deleted with every file under it, and its minutes given back.
 * - **Highlights** (Module 16), failed or cancelled: the signals file the run
 *   may have stored is deleted, the job and its run take the same end (a
 *   failure always reads "We could not finish looking for clips. Your AI
 *   minutes were given back."), and the AI minutes are given back in full.
 * - **Download** (Module 18), failed or cancelled: whatever it stored under
 *   its download folder goes, the job takes the end (a failure keeps the
 *   platform's own reason or reads "We could not prepare this file. Try
 *   again."), and both charges (the day's download and the import minutes)
 *   are given back in full.
 * - A job that is already DONE is never touched: a cancel that arrives after
 *   the finish loses, and the finished video stays.
 */

import type { ClipJobKindName, ClipJobWorkflowInput } from '@postgear/scheduling';
import type { PrivateStorage, StorageBackend } from '@postgear/storage';
import { clipKeys } from '@postgear/storage';
import {
  CLIP_JOB_INPUT_SCHEMAS,
  type ClipJobInputs,
  type ClipPlatformId,
  type RenderInput,
} from '@postgear/video-engine';
import { downloadFailureCode } from './download/download.run';
import { ClipStepError } from './failures';
import type { ClipInternalClient } from './internal-client';
import { storedJobError } from './job-progress';
import {
  allImportKeys,
  exportMediaKeys,
  facesFileKey,
  heardFileKey,
  allWatchKeys,
  highlightsSignalsKey,
  segmentKey,
  speechKeys,
} from './keys';
import { exportFailedNotification, videoFailedNotification } from './notifications';
import type { ClipRows, JobRow } from './rows';

/** Failures after which an upload's ORIGINAL is deleted too: no retry can use it. */
export const DELETE_ORIGINAL_ON: ReadonlySet<string> = new Set([
  'clips_minutes_used',
  'upload_not_video',
]);

export interface OutcomeDeps {
  rows: ClipRows;
  privateStorage: Pick<PrivateStorage, 'delete' | 'deletePrefix'>;
  storage: Pick<StorageBackend, 'delete'>;
  internal: Pick<ClipInternalClient, 'reverseCharges'>;
  now?: () => Date;
}

export interface JobFailure extends ClipJobWorkflowInput {
  code: string;
  platform?: ClipPlatformId;
}

/**
 * The job row and its input, parsed with the schema for its kind. A missing
 * row, another workspace's row, another kind or an input that does not parse
 * can never succeed, so each is a permanent `tool_failed`.
 */
export async function openJob<K extends ClipJobKindName>(
  rows: Pick<ClipRows, 'job'>,
  ref: ClipJobWorkflowInput,
  kind: K,
): Promise<{ job: JobRow; input: ClipJobInputs[K] }> {
  const job = await rows.job(ref.organizationId, ref.jobId);
  if (!job || job.kind !== kind) {
    throw new ClipStepError('tool_failed', { retryable: false });
  }
  const parsed = CLIP_JOB_INPUT_SCHEMAS[kind].safeParse(job.input);
  if (!parsed.success) {
    console.error(
      JSON.stringify({
        event: 'clips.job.bad_input',
        jobId: job.id,
        kind,
        path: parsed.error.issues[0]?.path.join('.') ?? '',
      }),
    );
    throw new ClipStepError('tool_failed', { retryable: false });
  }
  return { job, input: parsed.data as ClipJobInputs[K] };
}

/** The job's input if it parses, else null (bookkeeping must work even for a bad row). */
function inputOf<K extends ClipJobKindName>(job: JobRow, kind: K): ClipJobInputs[K] | null {
  const parsed = CLIP_JOB_INPUT_SCHEMAS[kind].safeParse(job.input);
  return parsed.success ? (parsed.data as ClipJobInputs[K]) : null;
}

async function deleteKeys(
  remove: (key: string) => Promise<void>,
  keys: string[],
  jobId: string,
): Promise<void> {
  const failures: string[] = [];
  for (const key of keys) {
    try {
      await remove(key);
    } catch {
      failures.push(key);
    }
  }
  if (failures.length > 0) {
    console.warn(
      JSON.stringify({ event: 'clips.cleanup.delete_failed', jobId, keys: failures.length }),
    );
    // Thrown so Temporal tries the bookkeeping again; every step is safe to repeat.
    throw new ClipStepError('tool_failed', { retryable: true });
  }
}

/** The public files an export may have stored, unless a Media row already uses them. */
async function exportKeysToDelete(deps: OutcomeDeps, job: JobRow): Promise<string[]> {
  const keys = exportMediaKeys(job.id, job.createdAt);
  const result: string[] = [];
  for (const key of [keys.video, keys.poster]) {
    if (!(await deps.rows.mediaUsesKey(job.organizationId, key))) result.push(key);
  }
  return result;
}

async function reverse(deps: OutcomeDeps, job: JobRow): Promise<void> {
  await deps.internal.reverseCharges(job.id, { organizationId: job.organizationId });
}

/** The failure bookkeeping (see the file comment). Answers whether this call closed the job. */
export async function failJob(deps: OutcomeDeps, failure: JobFailure): Promise<boolean> {
  const now = (deps.now ?? (() => new Date()))();
  const job = await deps.rows.job(failure.organizationId, failure.jobId);
  if (!job || job.status === 'DONE') return false;
  const error = storedJobError(failure.code, failure.platform);
  const org = job.organizationId;

  switch (job.kind) {
    case 'IMPORT': {
      const input = inputOf(job, 'IMPORT');
      const videoId = job.videoId ?? input?.videoId ?? null;
      if (videoId) {
        await deleteKeys(
          (key) => deps.privateStorage.delete(key),
          allImportKeys(org, videoId, job.id),
          job.id,
        );
        if (input?.origin.type === 'upload' && DELETE_ORIGINAL_ON.has(failure.code)) {
          await deleteOriginal(deps, org, videoId, input.origin.originalKey, job.id);
        }
      }
      const video = videoId ? await deps.rows.video(org, videoId) : null;
      const closed = await deps.rows.closeJob({
        jobId: job.id,
        organizationId: org,
        status: 'FAILED',
        error,
        video: video ? { id: video.id, mark: 'failed' } : undefined,
        notification: video ? videoFailedNotification(org, video, error) : undefined,
        now,
      });
      await reverse(deps, job);
      return closed;
    }

    case 'SEGMENT': {
      const input = inputOf(job, 'SEGMENT');
      const videoId = job.videoId ?? input?.videoId ?? null;
      if (videoId) {
        await deleteKeys(
          (key) => deps.privateStorage.delete(key),
          [segmentKey(org, videoId, job.id)],
          job.id,
        );
      }
      return deps.rows.closeJob({
        jobId: job.id,
        organizationId: org,
        status: 'FAILED',
        error,
        now,
      });
    }

    case 'HIGHLIGHTS':
      return closeHighlights(deps, job, 'FAILED', storedJobError('highlights_failed'), now);

    case 'RENDER': {
      const input = inputOf(job, 'RENDER');
      await cleanupRender(deps, job, input);
      const clipId = job.clipId ?? input?.clipId ?? null;
      // A Preview Export answers in its dialog; only a real export rings the bell.
      const clip = clipId && !input?.proof ? await deps.rows.clip(org, clipId) : null;
      return deps.rows.closeJob({
        jobId: job.id,
        organizationId: org,
        status: 'FAILED',
        error,
        notification: clip ? exportFailedNotification(org, clip, error) : undefined,
        now,
      });
    }

    case 'DOWNLOAD':
      return closeDownload(
        deps,
        job,
        'FAILED',
        storedJobError(downloadFailureCode(failure.code), failure.platform),
        now,
      );

    // Sprint 13: an AI step that failed keeps nothing and gives its AI minutes back.
    case 'TRANSCRIBE':
    case 'FACES':
    case 'TRANSLATE':
    case 'SPEECH':
      return closeAiStep(
        deps,
        job,
        'FAILED',
        storedJobError(aiFailureCode(job.kind, failure.code)),
        now,
      );

    default:
      return deps.rows.closeJob({
        jobId: job.id,
        organizationId: org,
        status: 'FAILED',
        error,
        now,
      });
  }
}

/** The cancel bookkeeping (see the file comment). Answers whether this call closed the job. */
export async function cancelJob(deps: OutcomeDeps, ref: ClipJobWorkflowInput): Promise<boolean> {
  const now = (deps.now ?? (() => new Date()))();
  const job = await deps.rows.job(ref.organizationId, ref.jobId);
  if (!job || job.status === 'DONE') return false;
  const error = storedJobError('cancelled');
  const org = job.organizationId;

  switch (job.kind) {
    case 'IMPORT': {
      const input = inputOf(job, 'IMPORT');
      const videoId = job.videoId ?? input?.videoId ?? null;
      if (videoId) {
        // Everything under the video goes, the ORIGINAL of an upload included.
        await deps.privateStorage.deletePrefix(clipKeys.videoPrefix(org, videoId));
      }
      const closed = await deps.rows.closeJob({
        jobId: job.id,
        organizationId: org,
        status: 'CANCELLED',
        error,
        video: videoId ? { id: videoId, mark: 'removed' } : undefined,
        now,
      });
      await reverse(deps, job);
      return closed;
    }

    case 'SEGMENT': {
      const input = inputOf(job, 'SEGMENT');
      const videoId = job.videoId ?? input?.videoId ?? null;
      if (videoId) {
        await deleteKeys(
          (key) => deps.privateStorage.delete(key),
          [segmentKey(org, videoId, job.id)],
          job.id,
        );
      }
      return deps.rows.closeJob({
        jobId: job.id,
        organizationId: org,
        status: 'CANCELLED',
        error,
        now,
      });
    }

    case 'HIGHLIGHTS':
      return closeHighlights(deps, job, 'CANCELLED', error, now);

    case 'RENDER': {
      await cleanupRender(deps, job, inputOf(job, 'RENDER'));
      return deps.rows.closeJob({
        jobId: job.id,
        organizationId: org,
        status: 'CANCELLED',
        error,
        now,
      });
    }

    case 'DOWNLOAD':
      return closeDownload(deps, job, 'CANCELLED', error, now);

    case 'TRANSCRIBE':
    case 'FACES':
    case 'TRANSLATE':
    case 'SPEECH':
      return closeAiStep(deps, job, 'CANCELLED', error, now);

    default:
      return deps.rows.closeJob({
        jobId: job.id,
        organizationId: org,
        status: 'CANCELLED',
        error,
        now,
      });
  }
}

/**
 * A download that ended badly (Module 18): its folder emptied (no asset row
 * exists yet: that is written with DONE), the job closed, and both charges
 * given back (`rev:<entryId>`, through the API).
 */
async function closeDownload(
  deps: OutcomeDeps,
  job: JobRow,
  status: 'FAILED' | 'CANCELLED',
  error: { code: string; message: string },
  now: Date,
): Promise<boolean> {
  await deps.privateStorage.deletePrefix(clipKeys.downloadPrefix(job.organizationId, job.id));
  const closed = await deps.rows.closeJob({
    jobId: job.id,
    organizationId: job.organizationId,
    status,
    error,
    now,
  });
  await reverse(deps, job);
  return closed;
}

/**
 * A highlights run that ended badly: its signals file out (the old one stays,
 * since the row swap never happened), the job and the run closed together,
 * and every AI minute it was charged given back (`rev:<entryId>`).
 */
async function closeHighlights(
  deps: OutcomeDeps,
  job: JobRow,
  status: 'FAILED' | 'CANCELLED',
  error: { code: string; message: string },
  now: Date,
): Promise<boolean> {
  const org = job.organizationId;
  const input = inputOf(job, 'HIGHLIGHTS');
  const videoId = job.videoId ?? input?.videoId ?? null;
  if (videoId) {
    await deleteKeys(
      (key) => deps.privateStorage.delete(key),
      // Module 06: the motion file, the state file and every still go too.
      [highlightsSignalsKey(org, videoId, job.id), ...allWatchKeys(org, videoId, job.id)],
      job.id,
    );
  }
  const closed = await deps.rows.closeJob({
    jobId: job.id,
    organizationId: org,
    status,
    error,
    highlightRunId: input?.runId ?? null,
    now,
  });
  await reverse(deps, job);
  return closed;
}

/** The sentence's code for a failed AI step: its own code when it has one, else the kind's. */
const AI_STEP_FAILURES: Readonly<Record<string, string>> = Object.freeze({
  TRANSCRIBE: 'transcribe_failed',
  FACES: 'faces_failed',
  TRANSLATE: 'translate_failed',
  SPEECH: 'voice_failed',
});

/** Codes an AI step may end with as they are (each has its own sentence). */
const AI_STEP_OWN_CODES = new Set([
  'no_speech',
  'language_unsupported',
  'captions_off',
  'no_faces',
  'voice_off',
  'timed_out',
  'cancelled',
]);

export function aiFailureCode(kind: string, code: string): string {
  if (AI_STEP_OWN_CODES.has(code)) return code;
  return AI_STEP_FAILURES[kind] ?? 'tool_failed';
}

/**
 * An AI step that ended badly (Sprint 13): the job closed and every AI minute
 * it was charged given back (`rev:<entryId>`, through the API, so a job that
 * fails twice cannot give back twice). Nothing was stored: a step writes its
 * file and its row only as it finishes, and the Python side's heard file sits
 * at a key made from the job id, removed here.
 */
async function closeAiStep(
  deps: OutcomeDeps,
  job: JobRow,
  status: 'FAILED' | 'CANCELLED',
  error: { code: string; message: string },
  now: Date,
): Promise<boolean> {
  const org = job.organizationId;
  if (job.kind === 'TRANSCRIBE' && job.videoId) {
    await deleteKeys(
      (key) => deps.privateStorage.delete(key),
      [heardFileKey(org, job.videoId, job.id)],
      job.id,
    );
  }
  if (job.kind === 'FACES' && job.videoId) {
    // Module 07: a face file Python wrote before the job closed is never kept.
    await deleteKeys(
      (key) => deps.privateStorage.delete(key),
      [facesFileKey(org, job.videoId, job.id)],
      job.id,
    );
  }
  if (job.kind === 'SPEECH') {
    // Module 09: the line, the WAV and a made `.m4a` whose row never landed all go.
    const keys = speechKeys(org, job.id);
    await deleteKeys(
      (key) => deps.privateStorage.delete(key),
      [keys.text, keys.wav, keys.sound],
      job.id,
    );
  }
  const closed = await deps.rows.closeJob({
    jobId: job.id,
    organizationId: org,
    status,
    error,
    now,
  });
  await reverse(deps, job);
  return closed;
}

async function cleanupRender(
  deps: OutcomeDeps,
  job: JobRow,
  input: RenderInput | null,
): Promise<void> {
  if (input?.proof) {
    await deps.privateStorage.deletePrefix(clipKeys.proofPrefix(job.organizationId, job.id));
    return;
  }
  await deleteKeys((key) => deps.storage.delete(key), await exportKeysToDelete(deps, job), job.id);
}

async function deleteOriginal(
  deps: OutcomeDeps,
  org: string,
  videoId: string,
  originalKey: string,
  jobId: string,
): Promise<void> {
  await deleteKeys((key) => deps.privateStorage.delete(key), [originalKey], jobId);
  const rows = await deps.rows.videoAssets(org, videoId);
  await deps.rows.deleteAssets(
    org,
    rows.filter((row) => row.kind === 'ORIGINAL' && row.key === originalKey).map((row) => row.id),
  );
}
