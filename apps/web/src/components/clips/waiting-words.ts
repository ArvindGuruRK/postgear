/**
 * What a Clips job waiting for its turn says (Sprint 13, Module 15), in one
 * place for every page that shows one: the video card, Find Clips, the
 * export and batch rows, Emote Maker, the listen bars, Detect Camera and
 * voice lines.
 *
 * - "Waiting for our turn" while QUEUED (the API's `stageLabel` says the
 *   same; it said "Waiting for its turn" before).
 * - With an estimate (`waiting.aboutSeconds`, whole minutes): "Waiting for
 *   our turn, about 4 minutes", "about 1 minute", or "less than a minute".
 * - A second line while a low priority job waits: "Plans with a higher
 *   priority go first." (the UX blueprint's "Paid plans go first." is not
 *   true: the Free plan's priority is low, and what goes first is a higher
 *   priority, whatever the plan).
 *
 * Pure, so the words are tested without a browser.
 */
import type { ClipJobView } from '@/types/clips';

export const WAITING_WORDS = 'Waiting for our turn';
export const LOW_PRIORITY_LINE = 'Plans with a higher priority go first.';

type QueuedJob = Pick<ClipJobView, 'status' | 'waiting'>;

/** Whether the job is still waiting to start (QUEUED). */
export function isQueuedJob(job: Pick<ClipJobView, 'status'> | null | undefined): boolean {
  return job?.status === 'QUEUED';
}

/** "about 4 minutes", "about 1 minute", "less than a minute", or null with no honest answer. */
export function waitingTime(aboutSeconds: number | null | undefined): string | null {
  if (aboutSeconds === null || aboutSeconds === undefined || !Number.isFinite(aboutSeconds)) {
    return null;
  }
  const minutes = Math.round(Math.max(0, aboutSeconds) / 60);
  if (minutes < 1) return 'less than a minute';
  if (minutes === 1) return 'about 1 minute';
  return `about ${minutes.toLocaleString('en-GB')} minutes`;
}

/** "Waiting for our turn", with the time when there is one. */
export function waitingLine(job: QueuedJob | null | undefined): string {
  const time = waitingTime(job?.waiting?.aboutSeconds);
  return time ? `${WAITING_WORDS}, ${time}` : WAITING_WORDS;
}

/** The second line, only while a low priority job waits for its turn. */
export function lowPriorityLine(job: QueuedJob | null | undefined): string | null {
  return isQueuedJob(job) && job?.waiting?.lowPriority === true ? LOW_PRIORITY_LINE : null;
}

/** The waiting line while the job is QUEUED, otherwise the place's own words for its work. */
export function queuedOr(job: QueuedJob | null | undefined, words: string): string {
  return isQueuedJob(job) ? waitingLine(job) : words;
}

/**
 * A job's step in words: the waiting line while QUEUED, the API's step
 * while running, or `fallback` when there is no job (yet) or no step.
 */
export function jobWords(
  job: Pick<ClipJobView, 'status' | 'waiting' | 'stageLabel'> | null | undefined,
  fallback: string = WAITING_WORDS,
): string {
  if (!job) return fallback;
  return queuedOr(job, job.stageLabel?.trim() || fallback);
}
