/**
 * Save To Media on a finished download (Sprint 12, Module 18):
 * `clipSaveDownloadWorkflow`'s one activity.
 *
 * The prepared MP4 comes down from the private space, a poster is made one
 * second in, both go to the public media space under keys derived from the
 * download's job id (`exportMediaKeys`, so a retry overwrites its own files
 * and the failure bookkeeping knows what to remove), and the API's
 * `finish-save-download` makes the Media row (`origin: 'upload'`) and marks
 * the download saved. No job row of its own: the state is the download's
 * `output.media`, which the API set to `saving` before starting this.
 *
 * If it fails for good, `saveDownloadFailed` removes the public files no
 * Media row uses and sets `output.media` to `failed`, so the button comes
 * back. Nothing is charged for Save To Media, so nothing is given back.
 */
import * as path from 'node:path';
import type { MediaFacts } from '@postgear/media-tools';
import { type PrivateStorage, type StorageBackend, StorageNotFoundError } from '@postgear/storage';
import type { DownloadOutput } from '@postgear/video-engine';
import { ClipStepError } from '../failures';
import type { ClipInternalClient } from '../internal-client';
import { exportMediaKeys } from '../keys';
import type { ClipRows, DownloadRow } from '../rows';

export interface SavePoster {
  file: string;
  bytes: number;
}

export interface SaveDownloadRun {
  row: DownloadRow;
  output: DownloadOutput;
  dir: string;
  signal: AbortSignal;
  privateStorage: Pick<PrivateStorage, 'getToFile'>;
  storage: Pick<StorageBackend, 'put' | 'delete'>;
  internal: Pick<ClipInternalClient, 'finishSaveDownload'>;
  poster(opts: {
    cwd: string;
    signal: AbortSignal;
    input: string;
    output: string;
    facts: Pick<MediaFacts, 'durationMs' | 'width' | 'height'>;
    atMs: number;
  }): Promise<SavePoster>;
  heartbeat(): void;
}

export async function runSaveDownload(run: SaveDownloadRun): Promise<{ mediaId: string }> {
  const { row, output, dir, signal } = run;
  if (output.width === null || output.height === null) {
    // Only a video has a picture to show in Media.
    throw new ClipStepError('media_save_failed', { retryable: false });
  }
  const width = output.width;
  const height = output.height;

  const local = path.join(dir, 'file.mp4');
  try {
    await run.privateStorage.getToFile(output.key, local, signal);
  } catch (error) {
    if (error instanceof StorageNotFoundError) {
      // Deleted or expired meanwhile: no retry brings it back.
      throw new ClipStepError('media_save_failed', { retryable: false, cause: error });
    }
    throw error;
  }
  run.heartbeat();

  const poster = await run.poster({
    cwd: dir,
    signal,
    input: local,
    output: path.join(dir, 'poster.jpg'),
    facts: { durationMs: output.durationMs, width, height },
    atMs: Math.min(1_000, Math.floor(output.durationMs / 2)),
  });
  if (signal.aborted) throw new ClipStepError('cancelled');

  const keys = exportMediaKeys(row.id, row.createdAt);
  await run.storage.delete(keys.video);
  await run.storage.put(keys.video, { filePath: local, size: output.bytes }, 'video/mp4');
  run.heartbeat();
  await run.storage.delete(keys.poster);
  await run.storage.put(keys.poster, { filePath: poster.file, size: poster.bytes }, 'image/jpeg');
  if (signal.aborted) throw new ClipStepError('cancelled');

  return run.internal.finishSaveDownload(row.id, {
    organizationId: row.organizationId,
    key: keys.video,
    bytes: output.bytes,
    posterKey: keys.poster,
    durationMs: output.durationMs,
    width,
    height,
    fps: output.fps ?? 30,
  });
}

export interface SaveFailedDeps {
  rows: Pick<ClipRows, 'downloadRow' | 'mediaUsesKey' | 'markSaveFailed'>;
  storage: Pick<StorageBackend, 'delete'>;
}

/** Save To Media failed for good: its public files go (unless a Media row uses them), the button comes back. */
export async function saveDownloadFailed(
  deps: SaveFailedDeps,
  ref: { organizationId: string; jobId: string },
): Promise<void> {
  const row = await deps.rows.downloadRow(ref.organizationId, ref.jobId);
  if (!row) return;
  const keys = exportMediaKeys(row.id, row.createdAt);
  for (const key of [keys.video, keys.poster]) {
    if (!(await deps.rows.mediaUsesKey(row.organizationId, key))) await deps.storage.delete(key);
  }
  await deps.rows.markSaveFailed(row.organizationId, row.id);
}
