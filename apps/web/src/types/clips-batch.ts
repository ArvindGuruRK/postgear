/**
 * Sprint 13, Module 11: the shapes of the routes that act on many clips at
 * once (bulk Hide and Delete, Export All and its batches, Create Montage).
 * Kept beside `clips.ts` so the Clips screens share one contract.
 */
import type { ExportQuality, Ratio } from '@postgear/video-engine';
import type { ClipJobView, ClipView } from './clips';

/** `PATCH /clips/bulk`: the same status field the single clip PATCH takes. */
export interface ClipBulkStatusBody {
  clipIds: string[];
  status: 'HIDDEN' | 'DRAFT';
}

/**
 * What the batch did with one clip:
 * - `queued`: exported at the chosen quality;
 * - `lowered`: exported at the best quality the plan allows (`quality` is the one used);
 * - `current`: already exported and current, nothing to do (`jobId` null);
 * - `running`: an export of it already runs (`jobId` is that job);
 * - `removed`: a montage that plays a removed video, skipped (`jobId` null), counted as failed.
 */
export type ClipExportNote = 'queued' | 'lowered' | 'current' | 'running' | 'removed';

/** `POST /clips/exports` (202). */
export interface ClipExportBatchStarted {
  batchId: string;
  jobs: Array<{
    clipId: string;
    jobId: string | null;
    quality: ExportQuality;
    note: ClipExportNote;
  }>;
}

/** One clip of a batch, as `GET /clips/exports/batches/:batchId` answers it. */
export interface ClipExportBatchJob {
  clipId: string;
  clipTitle: string;
  jobId: string | null;
  note: ClipExportNote;
  quality: ExportQuality;
  job: ClipJobView | null;
}

/** `GET /clips/exports/batches/:batchId`. */
export interface ClipExportBatchView {
  batchId: string;
  total: number;
  done: number;
  failed: number;
  finished: boolean;
  jobs: ClipExportBatchJob[];
}

/** One row of `GET /clips/exports/batches?open=1`: a batch of this person still running. */
export interface ClipExportBatchSummary {
  batchId: string;
  total: number;
  done: number;
  failed: number;
}

/** Between Clips: a straight cut, or a 0.3 s picture and sound mix. */
export type MontageTransition = 'cut' | 'fade';

/** `POST /clips/montages`. */
export interface CreateMontageBody {
  /** 2 to 15, in play order. */
  clipIds: string[];
  /** The one shape for every clip; needed when the clips' shapes differ. */
  ratio?: Ratio;
  transition: MontageTransition;
  /** An opening title card's line; null or absent for none. */
  titleCard?: string | null;
}

/** `POST /clips/montages` (201). */
export interface CreateMontageAnswer {
  clip: ClipView;
}
