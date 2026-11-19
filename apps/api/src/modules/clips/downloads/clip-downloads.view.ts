/**
 * What the Downloads tab sees of a DOWNLOAD job (Sprint 12, Module 18).
 *
 * Never the raw row: the input holds the rights record and the plan's space,
 * the output holds the private storage key. The view reads both through the
 * engine's schemas (a row an older build wrote, or one tampered with, reads
 * as failed rather than as something it is not) and picks what a row shows:
 * the title, the label, the state, the size, the expiry and Save To Media.
 *
 * States, in the order a row lives them:
 * - `preparing`: QUEUED or RUNNING ("Getting your file, 40%").
 * - `ready`: DONE and inside its 24 hours (Save File, Save To Media).
 * - `expired`: DONE and past `expiresAt` (only Delete).
 * - `failed`: FAILED, or DONE with an output we cannot read.
 * - `cancelled`: CANCELLED (never listed; the route may still answer it).
 */
import type { ClipJob } from '@postgear/db';
import { CLIP_SAVE_DOWNLOAD_TIMEOUT_MS } from '@postgear/scheduling';
import {
  type DownloadMedia,
  downloadInputSchema,
  downloadOutputSchema,
  isDownloadExpired,
} from '@postgear/video-engine';
import { type ClipJobView, toJobView } from '../jobs/clip-job-view';

export type DownloadState = 'preparing' | 'ready' | 'failed' | 'cancelled' | 'expired';

export interface DownloadView {
  id: string;
  /** The video's title, as the platform gave it (cleaned). */
  title: string;
  /** "720p", "Audio Only". */
  label: string;
  audioOnly: boolean;
  ext: 'mp4' | 'mp3';
  state: DownloadState;
  /** The job, for the live progress while preparing and the error sentence after. */
  job: ClipJobView;
  /** The prepared file's size once ready. */
  bytes: number | null;
  /** When the file goes (24 hours after it finished); null until it has. */
  expiresAt: string | null;
  /** A ready MP4 whose Save To Media has not run (or failed): the button shows. */
  canSaveToMedia: boolean;
  /** Save To Media's state once someone asked for it. */
  media: DownloadMedia | null;
  createdAt: string;
}

/** The row's input, or a safe stand-in when it cannot be read. */
function inputOf(job: Pick<ClipJob, 'input'>): {
  title: string;
  label: string;
  audioOnly: boolean;
} {
  const parsed = downloadInputSchema.safeParse(job.input);
  if (!parsed.success) return { title: 'Download', label: '', audioOnly: false };
  return {
    title: parsed.data.title,
    label: parsed.data.label,
    audioOnly: parsed.data.audioOnly,
  };
}

/** The finished row's output through the engine's schema, or null. */
export function downloadOutputOf(job: Pick<ClipJob, 'status' | 'output'>) {
  if (job.status !== 'DONE') return null;
  const parsed = downloadOutputSchema.safeParse(job.output);
  return parsed.success ? parsed.data : null;
}

/**
 * A `saving` is taken as ended this long after it started: the workflow's own
 * limit, and a minute for the moment between the row's write and the start.
 */
export const SAVE_TO_MEDIA_STALE_MS = CLIP_SAVE_DOWNLOAD_TIMEOUT_MS + 60_000;

/**
 * Save To Media's state as the row reads at `now`. A `saving` older than
 * `SAVE_TO_MEDIA_STALE_MS` reads as `failed`: its workflow has ended by then
 * without writing (a start that was lost, a worker that went away), so the
 * button comes back and the person can ask again. A row written before
 * `startedAt` was kept is timed from its last write.
 */
export function saveMediaOf(
  media: DownloadMedia | null | undefined,
  job: Pick<ClipJob, 'updatedAt'>,
  now: Date,
): DownloadMedia | null {
  if (media?.status !== 'saving') return media ?? null;
  const started = media.startedAt ? Date.parse(media.startedAt) : job.updatedAt.getTime();
  if (now.getTime() - started < SAVE_TO_MEDIA_STALE_MS) return media;
  return { status: 'failed', mediaId: null };
}

/** The row's state at `now` (see the header). */
export function downloadStateOf(
  job: Pick<ClipJob, 'status' | 'output' | 'expiresAt'>,
  now: Date,
): DownloadState {
  switch (job.status) {
    case 'QUEUED':
    case 'RUNNING':
      return 'preparing';
    case 'FAILED':
      return 'failed';
    case 'CANCELLED':
      return 'cancelled';
    case 'DONE':
      if (!downloadOutputOf(job)) return 'failed';
      return isDownloadExpired(job.expiresAt, now) ? 'expired' : 'ready';
  }
}

export function toDownloadView(job: ClipJob, now: Date = new Date()): DownloadView {
  const input = inputOf(job);
  const output = downloadOutputOf(job);
  const state = downloadStateOf(job, now);
  const media = saveMediaOf(output?.media, job, now);
  const ext = output?.ext ?? (input.audioOnly ? 'mp3' : 'mp4');
  return {
    id: job.id,
    title: input.title,
    label: input.label,
    audioOnly: input.audioOnly,
    ext,
    state,
    job: toJobView(job),
    bytes: output?.bytes ?? null,
    expiresAt:
      state === 'ready' || state === 'expired' ? (job.expiresAt?.toISOString() ?? null) : null,
    canSaveToMedia:
      state === 'ready' && ext === 'mp4' && (media === null || media.status === 'failed'),
    media,
    createdAt: job.createdAt.toISOString(),
  };
}
