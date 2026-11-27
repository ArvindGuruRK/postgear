/**
 * Auto-Edit Video (Sprint 13, Module 10): the Node half of an AUTO_EDIT job.
 *
 * | Stage       | Progress | What happens |
 * | ----------- | -------- | ------------ |
 * | `listening` | 0-80     | Waits for the video's listen job (Module 02's TRANSCRIBE job, its own charge), when the API started or joined one |
 * | `applying`  | 90-100   | The API makes the whole-video clip with the recipe applied (`autoEdit`, idempotent on the job's `clipId`), then the job is DONE with `{ clipId, skipped, noSpeech }` |
 *
 * Rules:
 * - A listen job that FAILED, was CANCELLED or is gone fails this job with
 *   `transcribe_failed` (never retried) and no clip is made. A listen job
 *   that heard nobody is DONE: the clip is still made, and the API says which
 *   parts it skipped (`noSpeech`).
 * - The job has no charge of its own: the listening was charged under the
 *   listen job's key and is given back by that job's own path.
 * - Logs carry ids and counts only, never a word of what was said.
 */
import {
  type AutoEditInput,
  type AutoEditOutput,
  autoEditOutputSchema,
} from '@postgear/video-engine';
import { ClipStepError } from '../failures';
import type { ClipInternalClient } from '../internal-client';
import type { JobProgress } from '../job-progress';
import type { ClipRows } from '../rows';

/** How often the listen job is looked at (the same pace as Find Clips' wait). */
export const AUTO_EDIT_LISTEN_POLL_MS = 2_000;
const TERMINAL = new Set(['DONE', 'FAILED', 'CANCELLED']);

export interface AutoEditRun {
  jobId: string;
  organizationId: string;
  input: AutoEditInput;
  rows: Pick<ClipRows, 'job'>;
  internal: Pick<ClipInternalClient, 'autoEdit'>;
  progress: Pick<JobProgress, 'report' | 'flush' | 'done'>;
  signal: AbortSignal;
  heartbeat(): void;
  /** Tests make the wait instant. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

export interface AutoEditOutcome {
  /** False when the job was closed while it ran (a cancel won the race). */
  finished: boolean;
  output: AutoEditOutput | null;
}

function throwIfCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new ClipStepError('cancelled', { retryable: false });
}

function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done, { once: true });
  });
}

/** Waits for the listen job's end; any end but DONE is `transcribe_failed`. */
async function waitForListen(run: AutoEditRun, listenJobId: string): Promise<void> {
  let progress = 0;
  for (;;) {
    throwIfCancelled(run.signal);
    const job = await run.rows.job(run.organizationId, listenJobId);
    if (job?.kind !== 'TRANSCRIBE') {
      throw new ClipStepError('transcribe_failed', { retryable: false });
    }
    if (TERMINAL.has(job.status)) {
      if (job.status === 'DONE') return;
      if (job.status === 'CANCELLED') {
        // Cancelling an Auto-Edit cancels its listen job right after it: give
        // this job's own cancel one look to land, so it reads Cancelled, not Failed.
        await (run.sleep ?? defaultSleep)(AUTO_EDIT_LISTEN_POLL_MS, run.signal);
        throwIfCancelled(run.signal);
      }
      console.warn(
        JSON.stringify({
          event: 'clips.auto_edit.listen_ended',
          jobId: run.jobId,
          listenJobId,
          status: job.status,
        }),
      );
      throw new ClipStepError('transcribe_failed', { retryable: false });
    }
    run.heartbeat();
    // The listen job reports its own progress; this one creeps so the page moves.
    progress = Math.min(80, progress + 0.5);
    await run.progress.report({ stage: 'listening', progress: Math.floor(progress) });
    await (run.sleep ?? defaultSleep)(AUTO_EDIT_LISTEN_POLL_MS, run.signal);
  }
}

export async function runAutoEdit(run: AutoEditRun): Promise<AutoEditOutcome> {
  if (run.input.listenJobId) {
    await run.progress.report({ stage: 'listening', progress: 0 });
    await waitForListen(run, run.input.listenJobId);
  }

  throwIfCancelled(run.signal);
  await run.progress.report({ stage: 'applying', progress: 90 });
  await run.progress.flush();
  run.heartbeat();
  const answer = await run.internal.autoEdit(run.jobId, { organizationId: run.organizationId });
  const parsed = autoEditOutputSchema.safeParse(answer);
  if (!parsed.success || parsed.data.clipId !== run.input.clipId) {
    console.error(
      JSON.stringify({ event: 'clips.auto_edit.bad_answer', jobId: run.jobId, ok: parsed.success }),
    );
    throw new ClipStepError('auto_edit_failed', { retryable: false });
  }

  const finished = await run.progress.done(parsed.data);
  console.log(
    JSON.stringify({
      event: 'clips.auto_edit.done',
      jobId: run.jobId,
      clipId: parsed.data.clipId,
      listened: run.input.listenJobId !== null,
      skipped: parsed.data.skipped.length,
      noSpeech: parsed.data.noSpeech,
      finished,
    }),
  );
  return { finished, output: finished ? parsed.data : null };
}
