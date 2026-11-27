/**
 * Export All's words and pure helpers (Module 11, section 2): the note under
 * each clip, a row's state, the counts line, the chip's name, the quality a
 * shared recipe asks for, and how the batch's stream keeps the list current.
 */
import {
  CLIP_ERROR_MESSAGES,
  type ExportQuality,
  isExportQuality,
  QUALITY_LABELS,
} from '@postgear/video-engine';
import type { ClipJobView, ClipListItem } from '@/types/clips';
import type {
  ClipExportBatchJob,
  ClipExportBatchStarted,
  ClipExportBatchView,
  ClipExportNote,
} from '@/types/clips-batch';
import type { RecipeView } from '@/types/clips-recipes';
import { mergeJobView } from '../clip-job-model';

export const EXPORT_ALL_TOO_MANY = 'Export up to 30 clips at once.';
export const BULK_TOO_MANY = 'Pick up to 50 clips at once.';
export const EXPORT_ALL_FAILED_ROW = 'This clip could not be exported.';
export const EXPORT_ALL_CANCELLED_ROW = 'This export was cancelled.';
export const EXPORT_ALL_CLOSE_LINE =
  'You can close this. The exports carry on, and the bell tells you when they are done.';
export const EXPORT_ALL_UNREACHABLE =
  'We could not start the exports. Check your connection and try again.';
/** A clip whose export waits for the workspace's turn (the job's own label says the same). */
export const WAITING_LABEL = 'Waiting for its turn';
export const EXPORT_ALL_LOAD_FAILED = 'The exports could not be loaded. Check your connection.';

/** The sentence under a clip for what the batch did with it; null for a plain export. */
export function noteLine(note: ClipExportNote, quality: ExportQuality): string | null {
  switch (note) {
    case 'lowered':
      return `Exports at ${QUALITY_LABELS[quality]}, the best this plan allows.`;
    case 'current':
      return 'Already exported, so it is left as it is.';
    case 'running':
      return 'Already exporting.';
    case 'removed':
      return CLIP_ERROR_MESSAGES.montage_video_removed;
    default:
      return null;
  }
}

export type BatchRowState =
  | 'skipped'
  | 'removed'
  | 'waiting'
  | 'running'
  | 'done'
  | 'failed'
  | 'cancelled';

/** Where one clip of the batch is. */
export function rowState(row: Pick<ClipExportBatchJob, 'note' | 'jobId' | 'job'>): BatchRowState {
  if (row.note === 'removed') return 'removed';
  if (row.note === 'current' || row.jobId === null) return 'skipped';
  const job = row.job;
  if (!job) return 'waiting';
  switch (job.status) {
    case 'DONE':
      return 'done';
    case 'FAILED':
      return 'failed';
    case 'CANCELLED':
      return 'cancelled';
    case 'RUNNING':
      return 'running';
    default:
      return 'waiting';
  }
}

/** The counts from the rows themselves, so the stream's changes show at once. */
export function batchCounts(rows: readonly ClipExportBatchJob[]): {
  total: number;
  done: number;
  failed: number;
  finished: boolean;
} {
  let done = 0;
  let failed = 0;
  let open = 0;
  for (const row of rows) {
    const state = rowState(row);
    if (state === 'done' || state === 'skipped') done += 1;
    else if (state === 'failed' || state === 'cancelled' || state === 'removed') failed += 1;
    else open += 1;
  }
  return { total: rows.length, done, failed, finished: open === 0 };
}

/** "3 of 8 done", "8 of 8 done", "6 of 8 done, 2 could not be exported". */
export function countsLine(counts: { total: number; done: number; failed: number }): string {
  const base = `${counts.done} of ${counts.total} done`;
  return counts.failed > 0 ? `${base}, ${counts.failed} could not be exported` : base;
}

/** The chip in the page's actions: "Exporting 8 Clips". */
export function chipLabel(total: number): string {
  return total === 1 ? 'Exporting 1 Clip' : `Exporting ${total} Clips`;
}

/**
 * The quality to preselect: when every clip wears the same recipe and that
 * recipe names an export quality. Null otherwise (the plan's best is used).
 */
export function sharedRecipeQuality(
  clips: ReadonlyArray<Pick<ClipListItem, 'recipeId'>>,
  recipes: readonly RecipeView[],
): ExportQuality | null {
  const first = clips[0]?.recipeId ?? null;
  if (!first || clips.some((clip) => (clip.recipeId ?? null) !== first)) return null;
  const quality = recipes.find((recipe) => recipe.id === first)?.settings.exportQuality;
  return quality && isExportQuality(quality) ? quality : null;
}

/** The list right after `POST /clips/exports`, named from the clips we already have. */
export function batchFromStart(
  started: ClipExportBatchStarted,
  clips: ReadonlyArray<Pick<ClipListItem, 'id' | 'title'>>,
): ClipExportBatchView {
  const titles = new Map(clips.map((clip) => [clip.id, clip.title]));
  const jobs: ClipExportBatchJob[] = started.jobs.map((row) => ({
    clipId: row.clipId,
    clipTitle: titles.get(row.clipId) ?? '',
    jobId: row.jobId,
    note: row.note,
    quality: row.quality,
    job: null,
  }));
  return { batchId: started.batchId, jobs, ...batchCounts(jobs) };
}

/** A job event of the batch's stream put in its row (a finished job never runs again). */
export function mergeBatchJob(view: ClipExportBatchView, next: ClipJobView): ClipExportBatchView {
  let changed = false;
  const jobs = view.jobs.map((row) => {
    if (row.jobId !== next.id) return row;
    const merged = mergeJobView(row.job, next);
    if (merged === row.job) return row;
    changed = true;
    return { ...row, job: merged };
  });
  return changed ? { ...view, jobs, ...batchCounts(jobs) } : view;
}

/** A fresh read of the batch merged over what the stream showed, row by row. */
export function mergeBatchView(
  current: ClipExportBatchView | null,
  next: ClipExportBatchView,
): ClipExportBatchView {
  if (!current || current.batchId !== next.batchId) return next;
  const known = new Map(current.jobs.map((row) => [row.clipId, row]));
  const jobs = next.jobs.map((row) => {
    const before = known.get(row.clipId);
    const job =
      before?.job && row.job ? mergeJobView(before.job, row.job) : (row.job ?? before?.job ?? null);
    return { ...row, clipTitle: row.clipTitle || before?.clipTitle || '', job };
  });
  return { ...next, jobs, ...batchCounts(jobs) };
}

/** Whether any job of the batch is still going. */
export function batchRunning(view: ClipExportBatchView | null): boolean {
  return view ? !batchCounts(view.jobs).finished : false;
}
