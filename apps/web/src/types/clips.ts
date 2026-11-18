/**
 * Clips types for the web app (Sprint 12).
 *
 * The clip document, the job contracts and the link shapes come straight
 * from `@postgear/video-engine`: it is pure (no Node built-ins), so the web
 * imports the very same definitions the API validates and the worker
 * renders, and nothing is copied that could drift. Response shapes of the
 * `/clips` routes are added here as their modules land.
 */
import type {
  ClipDocument,
  ClipError,
  ClipJobKind,
  ClipJobStatus,
  ClipPlatformId,
} from '@postgear/video-engine';

export type {
  ClipCanvas,
  ClipDocument,
  ClipErrorCode,
  ClipJobKind,
  ClipJobStage,
  ClipJobStatus,
  ExportQuality,
  LinkFormat,
  LinkInfo,
  LinkRef,
  Ratio,
  Segment,
} from '@postgear/video-engine';

/** `GET /clips/jobs/:jobId` and every job event: never a storage key or a tool's text. */
export interface ClipJobView {
  id: string;
  kind: ClipJobKind;
  status: ClipJobStatus;
  stage: string | null;
  /** In words: the step while running, "Waiting for its turn" while queued, "Done", "Failed" or "Cancelled" once over. */
  stageLabel: string;
  /** 0 to 100. */
  progress: number;
  /** Seconds left, or null when there is no honest answer yet. */
  etaSeconds: number | null;
  videoId: string | null;
  clipId: string | null;
  error: ClipError | null;
  result: Record<string, string | number | boolean | null> | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

/** One event of `GET /clips/jobs/:jobId/events`. */
export type ClipJobEvent =
  | ({ type: 'progress' | 'done' | 'failed' | 'cancelled' } & ClipJobView)
  | { type: 'error'; message: string };

export interface ClipsToolsState {
  /** `ok`, `not_ok` (a tool is missing or broken) or `offline` (no worker answered). */
  state: 'ok' | 'not_ok' | 'offline';
  message: string | null;
  checks: Array<{ name: string; ok: boolean; required: boolean; reason: string | null }>;
  checkedAt: string | null;
}

/** A signed address for a stored file: it stops working at `expiresAt`. */
export interface SignedAddress {
  url: string;
  /** ISO time. */
  expiresAt: string;
}

export type ClipVideoPlatform = ClipPlatformId | 'upload';
export type ClipVideoStatus = 'IMPORTING' | 'READY' | 'FAILED' | 'REMOVED';

/** One video, as every `/clips/videos` route answers it. Never a storage key. */
export interface ClipVideoView {
  id: string;
  platform: ClipVideoPlatform;
  kind: string;
  title: string;
  channelName: string | null;
  /** The platform's own page for the video; null for uploads. */
  link: string | null;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  hasAudio: boolean;
  status: ClipVideoStatus;
  /** Our sentence when the import failed. */
  error: ClipError | null;
  /** False once the platform's sharp copy is gone; exports then use the kept copy. */
  hdAvailable: boolean;
  posterUrl: string | null;
  expiresAt: string | null;
  lastUsedAt: string;
  createdAt: string;
}

/** `POST /clips/videos`: 201 a new import, or 200 `existing: true` with no job. */
export interface ClipImportOutcome {
  video: ClipVideoView;
  job: ClipJobView | null;
  existing: boolean;
}

export type ClipStatusName = 'NEW' | 'DRAFT' | 'HIDDEN';
export type ClipOriginName = 'MANUAL' | 'AI_SIGNALS';

/** One clip with its document (`GET /clips/:clipId`, `POST /clips`). */
export interface ClipView {
  id: string;
  videoId: string;
  title: string;
  status: ClipStatusName;
  origin: ClipOriginName;
  ratio: string;
  durationMs: number;
  score: number | null;
  reasons: string[];
  revision: number;
  /** The last export drew this very revision. */
  exported: boolean;
  lastExportedRevision: number | null;
  exportedMediaId: string | null;
  /** Null only when a stored document no longer reads (the page then says so). */
  document: ClipDocument | null;
  createdAt: string;
  updatedAt: string;
}

/** Whether an export will read the sharp range: stored, still coming, or gone (the light copy). */
export type ClipSharpState = 'ready' | 'fetching' | 'gone';

/** `GET /clips/:clipId`. */
export interface ClipDetail {
  clip: ClipView;
  /** Null when the video was deleted (its exported clips stay). */
  video: ClipVideoView | null;
  /** The light copy of the whole video; play the clip's range of it. */
  playback: SignedAddress | null;
  sharp: ClipSharpState;
}

/** The plan's Clips values `GET /clips/status` carries, as the resolver answered them. */
export type ClipsStatusLimitKey =
  | 'clips.enabled'
  | 'clips.max_video_minutes'
  | 'clips.upload_max_gb'
  | 'clips.storage_gb'
  | 'clips.retention_days'
  | 'clips.concurrent_imports'
  | 'clips.export_max_quality'
  | 'clips.export_watermark'
  | 'clips.queue_priority'
  | 'clips.browse_channels'
  | 'clips.downloads_per_day';

/** One meter in whole minutes: `used` rounds up, `limit` and `remaining` round down. */
export interface ClipsMeterView {
  used: number;
  /** null when the plan has no ceiling. */
  limit: number | null;
  remaining: number | null;
  /** When the cycle resets (ISO). */
  cycleEnd: string;
}

/**
 * `GET /clips/status`. Presentation only: the API re-checks every limit on
 * every request, so these values can draw a lock, never grant anything.
 */
export interface ClipsStatus {
  tools: ClipsToolsState;
  simulation: boolean;
  platforms: ClipPlatformId[];
  storage: { usedBytes: number; limitBytes: number | null };
  /** Values as resolved: read them through `lib/entitlements.ts` helpers, never assume a type. */
  limits: Record<ClipsStatusLimitKey, unknown>;
  meters: { importMinutes: ClipsMeterView; aiMinutes: ClipsMeterView };
  usage: { storageBytes: number };
}
