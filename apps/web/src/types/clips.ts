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
  AiCostKind,
  AiCostRate,
  ClipDocument,
  ClipError,
  DownloadMedia,
  ClipLayout,
  ClipJobKind,
  ClipJobStatus,
  ClipPlatformId,
  ExportQuality,
  FilmstripMeta,
  LinkInfo,
  LinkRef,
  ListedItem,
  ListKind,
  ListPeriod,
  ListSort,
  Ratio,
  WaveformMeta,
} from '@postgear/video-engine';

export type {
  ClipLayout,
  ClipCanvas,
  ClipDocument,
  ClipErrorCode,
  ClipJobKind,
  ClipJobStage,
  ClipJobStatus,
  ClipPlatformId,
  ExportQuality,
  FilmstripMeta,
  LinkFormat,
  LinkInfo,
  LinkRef,
  ListedItem,
  ListKind,
  ListPeriod,
  ListSort,
  Ratio,
  Segment,
  WaveformMeta,
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

/** Module 18: a download row's state (see `toDownloadView` in the API). */
export type DownloadState = 'preparing' | 'ready' | 'failed' | 'cancelled' | 'expired';

/** Mirrors `/clips/downloads`: one prepared file. Never a storage key. */
export interface DownloadView {
  id: string;
  title: string;
  /** "720p", "Audio Only". */
  label: string;
  audioOnly: boolean;
  ext: 'mp4' | 'mp3';
  state: DownloadState;
  job: ClipJobView;
  bytes: number | null;
  /** ISO time the file goes; null until it is ready. */
  expiresAt: string | null;
  canSaveToMedia: boolean;
  media: DownloadMedia | null;
  createdAt: string;
}

/** Mirrors `POST /clips/downloads`. */
export interface DownloadStarted {
  job: ClipJobView;
  download: DownloadView;
  /** The same file was already being prepared or ready. */
  existing: boolean;
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
  /** Worked out by the API from status, export and posts. */
  state: ClipState;
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

/** What the export's loudness passes measured (Module 14), as the job recorded it. */
export interface ClipExportLoudness {
  inputLufs: number | null;
  inputTp: number | null;
  finalLufs: number | null;
  mode: 'linear' | 'dynamic' | 'skipped';
}

/** One export of a clip (`GET /clips/:clipId/exports`, Module 15): the newest five, any state. */
export interface ClipExportView {
  job: ClipJobView;
  quality: ExportQuality;
  /** What the export drew (`documentFingerprint`); null for exports made before Module 15. */
  fingerprint: string | null;
  /** The file in Media, once done. */
  media: {
    id: string;
    url: string;
    posterUrl: string | null;
    name: string;
    bytes: number;
    width: number | null;
    height: number | null;
    durationMs: number | null;
  } | null;
  loudness: ClipExportLoudness | null;
}

/** The newest Preview Export of a clip (`GET /clips/:clipId/previews/latest`). */
export interface ClipPreviewView {
  job: ClipJobView;
  fingerprint: string | null;
  /** A short-lived address to play it, once done and while it is kept (24 hours). */
  url: string | null;
  expiresAt: string | null;
}

/** `GET /clips/:clipId`: the clip, its video, and the video's light copy, filmstrip and waveform. */
export interface ClipDetail {
  clip: ClipView;
  /** Null when the video was deleted (its exported clips stay). */
  video: ClipVideoView | null;
  /** The light copy of the whole video; play the clip's range of it. */
  playback: SignedAddress | null;
  proxy: { width: number; height: number; fps: number } | null;
  filmstrip: ClipFilmstrip | null;
  waveform: ClipWaveform | null;
  sharp: ClipSharpState;
  /** The stretch held sharp around the clip, in the video's time; null when nothing sharp touches it. */
  held: { fromMs: number; toMs: number } | null;
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

/** Module 19: what the video space holds, in bytes. */
export interface ClipsSpaceByKind {
  /** Imported and uploaded videos with their working files. */
  videos: number;
  /** Prepared downloads, kept 24 hours. */
  downloads: number;
  /** The workspace's own stickers and sounds. */
  library: number;
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
  /** Module 19 adds what the space holds, by kind (they add up to `storageBytes`). */
  usage: { storageBytes: number; byKind?: ClipsSpaceByKind };
  /**
   * Module 19: the videos use more than the plan allows (after a downgrade):
   * new imports, uploads and wider ranges are refused until some are deleted.
   */
  overLimit?: boolean;
  /** Module 06: whether Try A Sample has a video to bring in (absent on an older API: read as false). */
  sample?: { available: boolean };
  /**
   * Sprint 13: the AI layer. `service: 'off'` (or absent, on an older API)
   * disables every AI button and never Sprint 12's tools; `prices` are the AI
   * Minutes rates the API charges by.
   */
  ai?: ClipsAiStatus;
}

/** `GET /clips/status`'s `ai` part (Sprint 13). */
export interface ClipsAiStatus {
  service: 'ok' | 'off';
  prices: Record<AiCostKind, AiCostRate>;
}

// --- Module 06: links, videos, uploads, channels --------------------------------

/** `POST /clips/links/probe`: the link as recognised, what the platform says, and whether we have it. */
export interface ClipProbe {
  link: LinkRef;
  /** `thumbnailUrl` is our own signed picture route, never the platform's address. */
  info: LinkInfo;
  existingVideoId: string | null;
}

/** One card of `GET /clips/videos`: the video and its newest import, to follow live. */
export interface ClipVideoCard {
  video: ClipVideoView;
  job: ClipJobView | null;
  /** Live clips cut from it (absent on an older API). */
  clipCount?: number;
  /** Module 19: bytes the video keeps (every file but Preview Exports). */
  storedBytes?: number;
}

export interface ClipVideoPage {
  videos: ClipVideoCard[];
  nextCursor: string | null;
  total: number;
}

/** Module 19 adds `size`: the biggest first (See What Uses Space). */
export type ClipVideoSort = 'newest' | 'oldest' | 'size';

/** A clip's state on a list: worked out by the API from status, export and posts. */
export type ClipState = 'new' | 'draft' | 'exported' | 'scheduled' | 'hidden';

/** A clip on its video's page (never its document). */
export interface ClipSummary {
  id: string;
  title: string;
  status: ClipStatusName;
  origin: ClipOriginName;
  ratio: string;
  durationMs: number;
  score: number | null;
  revision: number;
  exported: boolean;
  exportedMediaId: string | null;
  /** 0 to 100 while an export of this clip runs (the ring on its card); null otherwise. */
  exportProgress: number | null;
  createdAt: string;
  updatedAt: string;
  state: ClipState;
  /** The part of the video it plays (the video's time), for its line on the timeline; null if unreadable. */
  range: { fromMs: number; toMs: number } | null;
  /** Why Find Clips picked it (`HIGHLIGHT_REASONS` codes, strongest first); empty for a hand-made clip. */
  reasons: string[];
  /**
   * Module 17: the live posts it went out in, newest first, for the card's
   * View Post. Sent by the Clips list and the video page; absent elsewhere.
   */
  posts?: ClipPublishedPost[];
  /**
   * Module 17: when its exported file was made, for the composer's Select A
   * Clip; null with no export or once the file left Media. Sent by the Clips
   * list only.
   */
  exportedAt?: string | null;
}

/** Module 17: one post a clip went out in, as View Post opens it. */
export interface ClipPublishedPost {
  group: string;
  channelName: string;
  providerIdentifier: string;
  /** The live post's address (http or https only). */
  url: string;
  publishedAt: string;
}

/** Module 17: a channel a waiting post goes to. */
export interface ComingUpChannel {
  id: string;
  name: string;
  providerIdentifier: string;
  picture: string | null;
}

/** Module 17: one row of the Create tab's Coming Up panel. */
export interface ComingUpItem {
  group: string;
  publishDate: string;
  channels: ComingUpChannel[];
  clip: {
    id: string;
    title: string;
    ratio: string;
    durationMs: number;
    videoId: string;
    poster: ClipPoster | null;
  };
}

/** `GET /clips/coming-up`: at most five rows, soonest first, and how many there are. */
export interface ComingUpView {
  items: ComingUpItem[];
  total: number;
  /** The workspace has an exported clip (not hidden): the panel is drawn only then. */
  anyExported: boolean;
}

/** One Find Clips run (Module 16), as `GET /clips/videos/:videoId/highlights` gives it. */
export interface HighlightRunView {
  id: string;
  /** The run's job, for progress and Cancel. */
  jobId: string | null;
  status: ClipJobStatus;
  /** Clips the run made. */
  found: number;
  /** The tracks the scorer used ("loudness", "scene", "chat", "replayed"). */
  tracks: string[];
  /** "Sound, picture and chat": the "How this was found" line; null before the run ends. */
  foundBy: string | null;
  /** What the run was charged, in AI minutes. */
  aiMinutes: number;
  /** A failed or cancelled run had its AI minutes given back. */
  refunded: boolean;
  createdAt: string;
  finishedAt: string | null;
}

/** Find Clips on the video page: the price, whether the video has sound, the latest run. */
export interface HighlightsView {
  /** What Find Clips costs for this video, in AI minutes. */
  price: number;
  noSound: boolean;
  run: HighlightRunView | null;
  job: ClipJobView | null;
}

/** `POST /clips/videos/:videoId/highlights` (202): the run, its job and the AI minutes meter after the charge. */
export interface HighlightsStarted {
  run: HighlightRunView;
  job: ClipJobView;
  meter: { used: number; remaining: number | null; limit: number | null; cycleEnd: string };
}

/** The filmstrip: sprite sheets of small pictures along the whole video. */
export interface ClipFilmstrip {
  meta: FilmstripMeta;
  /** One signed address per sheet, in strip order. */
  sheets: string[];
  expiresAt: string;
}

/** The sound's shape: a file of peaks, `perSecond` a second. */
export interface ClipWaveform {
  url: string;
  meta: WaveformMeta;
  expiresAt: string;
}

/** `GET /clips/videos/:videoId`. */
export interface ClipVideoDetail {
  video: ClipVideoView;
  playback: SignedAddress | null;
  proxy: { width: number; height: number; fps: number } | null;
  filmstrip: ClipFilmstrip | null;
  waveform: ClipWaveform | null;
  job: ClipJobView | null;
  clips: ClipSummary[];
  /** Find Clips (Module 16). */
  highlights: HighlightsView;
}

/** `POST /clips/videos/uploads`. */
export interface ClipUploadStarted {
  videoId: string;
  uploadId: string;
  partSize: number;
  partCount: number;
}

/** What a channel can list, as the API offers it. */
export interface ClipChannelList {
  kind: ListKind;
  /** The first is the default. */
  sorts: ListSort[];
  periods: ListPeriod[];
}

/** One saved channel (`GET /clips/channels`). */
export interface ClipChannelView {
  id: string;
  platform: ClipPlatformId;
  handle: string;
  displayName: string;
  /** The platform's own picture address; the browser loads it directly. */
  avatarUrl: string | null;
  broadcasterType: string | null;
  lastSyncedAt: string | null;
  error: string | null;
  createdAt: string;
  /** The platform is switched off: shown so it can be removed, never listed. */
  paused: boolean;
  lists: ClipChannelList[];
}

/** `POST /clips/channels/check`: the channel a name resolves to, not saved. */
export interface ClipChannelPreview {
  platform: ClipPlatformId;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
}

/** One row of a channel's list. */
export interface ClipStreamItem extends ListedItem {
  hidden: boolean;
  imported: boolean;
  videoId: string | null;
}

/** `GET /clips/channels/:id/streams`. */
export interface ClipStreamsPage {
  kind: ListKind;
  sort: ListSort;
  period: ListPeriod | null;
  items: ClipStreamItem[];
  nextCursor: string | null;
  updatedAt: string;
  stale: boolean;
  capped: boolean;
  notice: string | null;
}

// --- Module 07: the Clips library ------------------------------------------------

/** The Clips tab's status filter: a state, or `all` (every state but hidden). */
export type ClipStatusFilter = 'all' | ClipState;
export type ClipCounts = Record<ClipStatusFilter, number>;
export type ClipSource = ClipVideoPlatform;
export type ClipListSort = 'newest' | 'oldest';

/** A card's picture: one filmstrip tile, as a box on its sheet (or the whole poster). */
export interface ClipPoster {
  url: string;
  x: number;
  y: number;
  width: number;
  height: number;
  sheetWidth: number;
  sheetHeight: number;
}

/** The light copy and the clip's range, for the muted hover preview. */
export interface ClipPreview {
  url: string;
  fromMs: number;
  toMs: number;
  expiresAt: string;
}

/** One clip of `GET /clips`. */
export interface ClipListItem extends ClipSummary {
  videoId: string;
  videoTitle: string;
  platform: ClipVideoPlatform;
  poster: ClipPoster | null;
  preview: ClipPreview | null;
}

export interface ClipListPage {
  clips: ClipListItem[];
  counts: ClipCounts;
  page: number;
  pageSize: number;
  /** Clips matching every filter, the status included. */
  total: number;
}

// --- Module 10: saved layouts ----------------------------------------------------

export interface SavedLayoutView {
  id: string;
  name: string;
  ratio: Ratio;
  layout: ClipLayout;
  createdAt: string;
  updatedAt: string;
}
