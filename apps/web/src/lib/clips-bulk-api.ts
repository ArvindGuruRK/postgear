/**
 * Sprint 13, Module 11: the browser's calls for many clips at once (bulk
 * Hide and Delete, Export All and its batches, Create Montage). Kept beside
 * `clips-api.ts` (same `api()` door, same refusal codes).
 */
import type { ExportQuality } from '@postgear/video-engine';
import type {
  ClipBulkStatusBody,
  ClipExportBatchStarted,
  ClipExportBatchSummary,
  ClipExportBatchView,
  CreateMontageAnswer,
  CreateMontageBody,
} from '@/types/clips-batch';
import { api } from './api';

/** Most clips one bulk Hide or Delete takes (the server refuses more). */
export const BULK_MAX_CLIPS = 50;
/** Most clips one Export All takes. */
export const EXPORT_ALL_MAX_CLIPS = 30;

const batchPath = (batchId: string) => `/clips/exports/batches/${encodeURIComponent(batchId)}`;

/** Hide or Unhide every clip; all are in the workspace or nothing changes (404 `clip_not_found`). */
export function bulkSetClipStatus(body: ClipBulkStatusBody): Promise<{ updated: number }> {
  return api('/clips/bulk', { method: 'PATCH', body });
}

/** Deletes every clip; all are in the workspace or nothing changes (404 `clip_not_found`). */
export function bulkDeleteClips(clipIds: string[]): Promise<{ deleted: number }> {
  return api('/clips/bulk', { method: 'DELETE', body: { clipIds } });
}

/** Export All: one export per clip (202), each with what the batch did with it. */
export function startExportBatch(
  clipIds: string[],
  quality: ExportQuality,
): Promise<ClipExportBatchStarted> {
  return api('/clips/exports', { method: 'POST', body: { clipIds, quality } });
}

/** The batch's clips with their jobs, for the list. */
export function getExportBatch(
  batchId: string,
  options: { signal?: AbortSignal } = {},
): Promise<ClipExportBatchView> {
  return api(batchPath(batchId), { signal: options.signal });
}

/** The batch's live stream: one job event per change, for every job of it (read with `lib/sse.ts`). */
export function exportBatchEventsPath(batchId: string): string {
  return `${batchPath(batchId)}/events`;
}

/** This person's batches still running, so the page's chip survives a reload. */
export async function listOpenExportBatches(
  options: { signal?: AbortSignal } = {},
): Promise<ClipExportBatchSummary[]> {
  const { batches } = await api<{ batches: ClipExportBatchSummary[] }>(
    '/clips/exports/batches?open=1',
    { signal: options.signal },
  );
  return batches;
}

/**
 * Create Montage: a new clip (origin MONTAGE) stitched from the clips in
 * order. 422 with a montage code and its sentence (`montage_shapes_differ`
 * when the shapes differ and no `ratio` was given).
 */
export function createMontage(body: CreateMontageBody): Promise<CreateMontageAnswer> {
  return api('/clips/montages', { method: 'POST', body });
}
