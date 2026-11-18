/**
 * The browser's calls to the `/clips` routes (Sprint 12). Every call goes
 * through `api()` (cookies, typed `ApiError` with the refusal `code`, the
 * 402 listener that refreshes the plan's limits); the job stream is read
 * with `lib/sse.ts`.
 *
 * Later modules add their calls here (videos, uploads, clips, exports).
 */
import type {
  ClipDetail,
  ClipImportOutcome,
  ClipJobView,
  ClipsStatus,
  ClipVideoView,
  ClipView,
  ExportQuality,
} from '@/types/clips';
import { api } from './api';

const jobPath = (jobId: string) => `/clips/jobs/${encodeURIComponent(jobId)}`;
const clipPath = (clipId: string) => `/clips/${encodeURIComponent(clipId)}`;

/**
 * Imports a video from a link. The server probes the link itself and never
 * trusts a probe the browser sends. `existing: true` (and no job) when the
 * workspace already has it; 422 `rights_required` without the tick.
 */
export function importClipVideo(url: string, rightsConfirmed: boolean): Promise<ClipImportOutcome> {
  return api<ClipImportOutcome>('/clips/videos', {
    method: 'POST',
    body: { url, rightsConfirmed },
  });
}

/** One video (`GET /clips/videos/:videoId`); the page's players read the rest of its answer in Module 07. */
export function getClipVideo(
  videoId: string,
  options: { signal?: AbortSignal } = {},
): Promise<{ video: ClipVideoView }> {
  return api(`/clips/videos/${encodeURIComponent(videoId)}`, { signal: options.signal });
}

/** A new clip of a READY video: 409 `video_not_ready`, 422 `clip_range_invalid`. */
export function createClip(
  videoId: string,
  fromMs: number,
  toMs: number,
): Promise<{ clip: ClipView; job: ClipJobView | null }> {
  return api('/clips', { method: 'POST', body: { videoId, fromMs, toMs } });
}

/** The clip, its video, the light copy to play and whether the sharp range is in. */
export function getClip(
  clipId: string,
  options: { signal?: AbortSignal } = {},
): Promise<ClipDetail> {
  return api<ClipDetail>(clipPath(clipId), { signal: options.signal });
}

/** Starts an export of the clip as it is now: 409 `export_running` while one runs. */
export async function exportClip(clipId: string, quality: ExportQuality): Promise<ClipJobView> {
  const { job } = await api<{ job: ClipJobView }>(`${clipPath(clipId)}/exports`, {
    method: 'POST',
    body: { quality },
  });
  return job;
}

/** The video tools, the platforms switched on, and the storage gauge. */
export async function getClipsStatus(options: { signal?: AbortSignal } = {}): Promise<ClipsStatus> {
  const { status } = await api<{ status: ClipsStatus }>('/clips/status', {
    signal: options.signal,
  });
  return status;
}

export async function getClipJob(
  jobId: string,
  options: { signal?: AbortSignal } = {},
): Promise<ClipJobView> {
  const { job } = await api<{ job: ClipJobView }>(jobPath(jobId), { signal: options.signal });
  return job;
}

/** 409 `job_finished` when it ended first; 503 `tools_offline` when the cancel could not reach the worker. */
export async function cancelClipJob(jobId: string): Promise<ClipJobView> {
  const { job } = await api<{ job: ClipJobView }>(`${jobPath(jobId)}/cancel`, { method: 'POST' });
  return job;
}

/** The live progress stream (`progress`, `done`, `failed`, `cancelled`, `error`); GET, read with `lib/sse.ts`. */
export function clipJobEventsPath(jobId: string): string {
  return `${jobPath(jobId)}/events`;
}
