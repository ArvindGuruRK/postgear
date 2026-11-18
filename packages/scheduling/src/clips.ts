/**
 * Sprint 12: the contract between the API and the worker for Clips.
 *
 * Video work never shares a queue with publishing: a scheduled post must
 * never wait behind a four-hour import or a render. `postgear-media` takes
 * imports, sharp ranges, analysis and downloads; `postgear-media-quick` (the
 * same `media` role, its own slots) the small waiting-caller helpers (probe,
 * channel list, runtime check); `postgear-render` takes exports and previews
 * one at a time, because FFmpeg uses every core on its own. One worker entry
 * point serves the queues `WORKER_ROLES` names.
 *
 * Every long task is a `ClipJob` row and one workflow keyed on the row id:
 * the API writes the row first and then starts the workflow, so the
 * maintenance reconcile can start any job whose start was lost.
 *
 * Pure, like the rest of this package: workflow code imports it.
 */
import type { RetryPolicyValues } from './retry-policy';

export const MEDIA_TASK_QUEUE = 'postgear-media';
/**
 * The waiting-caller helpers (probe, channel list, runtime check), served by
 * the `media` role with its own slots. A person waits on these for at most
 * 25 seconds, so they must never queue behind two four-hour imports holding
 * every `WORKER_MEDIA_CONCURRENCY` slot of `postgear-media`.
 */
export const MEDIA_QUICK_TASK_QUEUE = 'postgear-media-quick';
/** Activity slots for the quick helpers: each is a short yt-dlp or ffprobe call. */
export const MEDIA_QUICK_CONCURRENCY = 8;
export const RENDER_TASK_QUEUE = 'postgear-render';
/** Reserved for Sprint 13's Python service. Nothing polls it yet. */
export const MEDIA_PY_TASK_QUEUE = 'postgear-media-py';

/** The roles a worker process can take, and the queue each serves. */
export const WORKER_ROLES = ['publishing', 'media', 'render'] as const;
export type WorkerRole = (typeof WORKER_ROLES)[number];

// --- Workflows with a job row ----------------------------------------------------

export const CLIP_IMPORT_WORKFLOW = 'clipImportWorkflow';
export const CLIP_SEGMENT_WORKFLOW = 'clipSegmentWorkflow';
export const CLIP_HIGHLIGHTS_WORKFLOW = 'clipHighlightsWorkflow';
export const CLIP_RENDER_WORKFLOW = 'clipRenderWorkflow';
export const CLIP_DOWNLOAD_WORKFLOW = 'clipDownloadWorkflow';

// --- Waiting-caller helpers (no row: the API waits for the answer) -------------

export const CLIP_PROBE_WORKFLOW = 'clipProbeWorkflow';
export const CLIP_LIST_CHANNEL_WORKFLOW = 'clipListChannelWorkflow';
export const CLIP_RUNTIME_CHECK_WORKFLOW = 'clipRuntimeCheckWorkflow';
/**
 * A workspace's uploaded sticker made a PNG or APNG (Module 12), on the quick
 * media queue: it is one short ffprobe and FFmpeg call a person is waiting
 * on, and must not queue behind long imports on `postgear-media`. The API
 * waits up to `CLIP_WAIT_FOR_ANSWER_MS`; past that the row stays `checking`
 * and the Uploaded tab asks again.
 */
export const CLIP_STICKER_CHECK_WORKFLOW = 'clipStickerCheckWorkflow';
/** The check's whole limit: two attempts of a 6 second, 120 frame picture with room. */
export const CLIP_STICKER_CHECK_TIMEOUT_MS = 90_000;
/**
 * A workspace's uploaded sound made the editor's AAC `.m4a` with its peaks
 * (Module 14), on the quick media queue for the same reason: a person waits
 * on it. The doc named `postgear-media`; the quick queue keeps an upload from
 * waiting behind a long import.
 */
export const CLIP_SOUND_CHECK_WORKFLOW = 'clipSoundCheckWorkflow';
/** The check's whole limit: two attempts of a 10 minute, 20 MB sound with room. */
export const CLIP_SOUND_CHECK_TIMEOUT_MS = 180_000;

/** The job kinds, as the `ClipJobKind` enum spells them. */
export type ClipJobKindName = 'IMPORT' | 'SEGMENT' | 'HIGHLIGHTS' | 'RENDER' | 'DOWNLOAD';

/** Which workflow runs a job of each kind. */
export const CLIP_JOB_WORKFLOWS: Readonly<Record<ClipJobKindName, string>> = Object.freeze({
  IMPORT: CLIP_IMPORT_WORKFLOW,
  SEGMENT: CLIP_SEGMENT_WORKFLOW,
  HIGHLIGHTS: CLIP_HIGHLIGHTS_WORKFLOW,
  RENDER: CLIP_RENDER_WORKFLOW,
  DOWNLOAD: CLIP_DOWNLOAD_WORKFLOW,
});

/** Which queue each kind runs on. */
export const CLIP_JOB_QUEUES: Readonly<Record<ClipJobKindName, string>> = Object.freeze({
  IMPORT: MEDIA_TASK_QUEUE,
  SEGMENT: MEDIA_TASK_QUEUE,
  HIGHLIGHTS: MEDIA_TASK_QUEUE,
  RENDER: RENDER_TASK_QUEUE,
  DOWNLOAD: MEDIA_TASK_QUEUE,
});

export function clipJobWorkflowId(jobId: string): string {
  return `clip-job:${jobId}`;
}

/** One probe per link at a time: the id is a hash of the canonical link. */
export function clipProbeWorkflowId(linkHash: string): string {
  return `clip-probe:${linkHash}`;
}

/** One check per uploaded sticker. */
export function clipStickerCheckWorkflowId(assetId: string): string {
  return `clip-sticker-check:${assetId}`;
}

/** One check per uploaded sound. */
export function clipSoundCheckWorkflowId(assetId: string): string {
  return `clip-sound-check:${assetId}`;
}

export function clipListChannelWorkflowId(cacheKeyHash: string): string {
  return `clip-list:${cacheKeyHash}`;
}

/** Cancelling a clip job reuses the publishing `CANCEL_SIGNAL` (`workflows.ts`). */

/** The whole workflow's limit, per kind. A stuck job ends instead of holding a slot for ever. */
export const CLIP_JOB_TIMEOUTS_MS: Readonly<Record<ClipJobKindName, number>> = Object.freeze({
  IMPORT: 6 * 60 * 60_000,
  SEGMENT: 30 * 60_000,
  HIGHLIGHTS: 60 * 60_000,
  // A 30 minute clip at 1080p60 measured 0.42x real time on a busy laptop:
  // about 71 minutes, so the limit leaves room above that.
  RENDER: 2 * 60 * 60_000,
  DOWNLOAD: 2 * 60 * 60_000,
});

/** Long activities heartbeat at least this often; a dead worker is noticed within it. */
export const CLIP_HEARTBEAT_MS = 60_000;

/** How long the API waits on a probe or a channel list before answering with a sentence. */
export const CLIP_WAIT_FOR_ANSWER_MS = 25_000;
/** The probe activity's own limit, inside the API's wait. */
export const CLIP_PROBE_TIMEOUT_MS = 20_000;
/** The runtime check's wait: it only asks the worker for its tool versions. */
export const CLIP_RUNTIME_CHECK_WAIT_MS = 10_000;

/** Two attempts a minute apart: a video job is heavy, so a flaky retry loop is costly. */
export const CLIP_RETRY_POLICY: RetryPolicyValues = {
  initialIntervalMs: 60_000,
  backoffCoefficient: 1,
  maximumIntervalMs: 60_000,
  maximumAttempts: 2,
};

/**
 * `ApplicationFailure.type` values clip activities throw. A non-retryable
 * one ends the job at once; `retryable` gets the policy above.
 */
export const CLIP_FAILURE_TYPES = {
  retryable: 'ClipRetryable',
  permanent: 'ClipPermanent',
} as const;

/**
 * Error codes that never get a second attempt (the workflow reads the code
 * off the failure). Mirrors `NON_RETRYABLE_CLIP_CODES` in the engine.
 */
export const CLIP_NON_RETRYABLE: readonly string[] = [
  'link_private',
  'link_not_found',
  'link_live',
  'link_unsupported',
  'link_not_a_video',
  'upload_not_video',
  'clip_range_invalid',
  'clips_video_too_long',
  'clips_minutes_used',
  'clips_storage_full',
  'format_gone',
  'font_missing',
  'render_output_invalid',
  'sticker_missing',
  'sticker_unusable',
  'sticker_too_large',
  'sound_missing',
  'sound_unusable',
  'sound_too_long',
  'cancelled',
];

/** The three priorities a job can carry, copied from `clips.queue_priority` at creation. */
export const CLIP_JOB_PRIORITIES = ['low', 'normal', 'high'] as const;
export type ClipJobPriority = (typeof CLIP_JOB_PRIORITIES)[number];

/** What every clip job workflow is started with: the row id and its workspace. */
export interface ClipJobWorkflowInput {
  jobId: string;
  organizationId: string;
}

/** Notification `type` values Clips writes (the API's catalogue lists them). */
export const CLIP_NOTIFICATION_TYPES = {
  videoReady: 'clip_video_ready',
  videoFailed: 'clip_video_failed',
  exportReady: 'clip_export_ready',
  exportFailed: 'clip_export_failed',
  videoExpiring: 'clip_video_expiring',
  videoRemoved: 'clip_video_removed',
  storageOverLimit: 'clip_storage_over_limit',
} as const;

/**
 * The bell's titles for the rows both sides write. The worker writes the
 * video rows and the API the export rows (and both when the reconcile fails
 * a job), so the words live here, once, and never drift.
 */
export const CLIP_NOTIFICATION_TITLES = {
  videoReady: 'Your video is ready',
  videoFailed: 'Your video could not be imported',
  exportReady: 'Your clip is ready',
  exportFailed: 'Your clip could not be exported',
} as const;

/** The longest line under a title: platform titles can be long. */
export const CLIP_NOTIFICATION_MAX_CONTENT = 300;
/** A video or clip name quoted inside that line is cut to this. */
const CLIP_NOTIFICATION_MAX_NAME = 120;

/** A video's page (Module 07): where every video notice leads. */
export function clipVideoPagePath(organizationId: string, videoId: string): string {
  return `/${organizationId}/clips/video/${videoId}`;
}

/** A clip's editor (Module 08): where every export notice leads. */
export function clipEditPagePath(organizationId: string, clipId: string): string {
  return `/${organizationId}/clips/edit/${clipId}`;
}

/** The clip's editor opened on its Export tab: where an export notice leads (Module 15). */
export function clipExportPagePath(organizationId: string, clipId: string): string {
  return `${clipEditPagePath(organizationId, clipId)}?tab=export`;
}

function capLine(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > CLIP_NOTIFICATION_MAX_CONTENT
    ? `${trimmed.slice(0, CLIP_NOTIFICATION_MAX_CONTENT - 3)}...`
    : trimmed;
}

/** `"Name"`, cut short, or the fallback when the name is empty. */
function quotedName(name: string, fallback: string): string {
  const trimmed = name.trim();
  if (!trimmed) return fallback;
  const cut =
    trimmed.length > CLIP_NOTIFICATION_MAX_NAME
      ? `${trimmed.slice(0, CLIP_NOTIFICATION_MAX_NAME - 3)}...`
      : trimmed;
  return `"${cut}"`;
}

/** The line under "Your video is ready": the video's own title. */
export function clipVideoReadyLine(videoTitle: string): string {
  return capLine(videoTitle) || CLIP_NOTIFICATION_TITLES.videoReady;
}

/** `"Name": the reason`, for a failed import or export; the reason is always one of our sentences. */
export function clipFailedLine(name: string, reason: string, kind: 'video' | 'clip'): string {
  return capLine(`${quotedName(name, kind === 'video' ? 'Your video' : 'Your clip')}: ${reason}`);
}

/** The line under "Your clip is ready". */
export function clipExportReadyLine(clipTitle: string): string {
  return capLine(`${quotedName(clipTitle, 'Your clip')} is in Media, ready to post.`);
}

/** A QUEUED job older than this with no running workflow is started by the reconcile. */
export const CLIP_RECONCILE_START_AFTER_MS = 2 * 60_000;
/** Preview Export files and downloads are kept this long. */
export const CLIP_SHORT_LIVED_MS = 24 * 60 * 60_000;

/** One program the worker checked (`clipRuntimeCheckWorkflow`). */
export interface ClipToolCheck {
  /** `ffmpeg`, `ffprobe`, `yt-dlp`, `js-runtime`, `filter-graph`, `libass`, `libharfbuzz`, `libx264`. */
  name: string;
  ok: boolean;
  /** Required for the worker's roles; a missing optional tool is a warning. */
  required: boolean;
  version: string | null;
  /** A plain sentence when not ok, never a tool's output. */
  reason: string | null;
}

/** What `clipRuntimeCheckWorkflow` answers: the worker's video tools, as it sees them. */
export interface ClipRuntimeReport {
  /** Every required check passed. */
  ok: boolean;
  /** Fetches come from fixtures (`CLIPS_SIMULATION=true` on the worker). */
  simulation: boolean;
  /** The platforms the worker may fetch from (`CLIPS_PLATFORMS`). */
  platforms: string[];
  checks: ClipToolCheck[];
  /** ISO time of the check. */
  checkedAt: string;
}

/** The runtime check's workflow id: one per minute, so concurrent pages share it. */
export function clipRuntimeCheckWorkflowId(now: Date): string {
  return `clip-runtime-check:${Math.floor(now.getTime() / 60_000)}`;
}

// --- Worker to API (internal routes) ------------------------------------------
//
// The worker writes job, video and asset rows itself (as publishing does), but
// never touches the usage ledger or the Media library: those stay behind the
// API's services. It calls these routes on `API_URL` with
// `X-PostGear-Internal: AUTOMATION_INTERNAL_TOKEN`; each is idempotent, so a
// retried activity calls again safely.

export const CLIP_INTERNAL_PREFIX = '/internal/clips';

export const CLIP_INTERNAL_ROUTES = {
  /** An upload's import minutes, charged once its length is known (key `clips.import:<jobId>`). */
  chargeImport: (jobId: string) => `${CLIP_INTERNAL_PREFIX}/jobs/${jobId}/charge-import`,
  /** Reverse every charge made for this job, in full. Never refused; safe to repeat. */
  reverseCharges: (jobId: string) => `${CLIP_INTERNAL_PREFIX}/jobs/${jobId}/reverse`,
  /** A finished export becomes a Media row, the clip is marked exported, the notification written. */
  finishExport: (jobId: string) => `${CLIP_INTERNAL_PREFIX}/jobs/${jobId}/finish-export`,
  /**
   * Any job ended (done, failed or cancelled): the API starts the next waiting
   * jobs of that workspace, highest priority first, within the plan's
   * `clips.concurrent_imports`. The worker never resolves plan values.
   */
  settled: (jobId: string) => `${CLIP_INTERNAL_PREFIX}/jobs/${jobId}/settled`,
  /**
   * The maintenance pass: start QUEUED jobs whose start was lost (older than
   * `CLIP_RECONCILE_START_AFTER_MS`, within the cap) and fail RUNNING jobs
   * whose workflow is gone, reversing their charges. Lives in the API, next
   * to the resolver and the ledger it needs.
   */
  reconcile: `${CLIP_INTERNAL_PREFIX}/reconcile`,
} as const;

export interface ClipSettledBody {
  organizationId: string;
}

export interface ClipSettledAnswer {
  /** Jobs this call started. */
  started: number;
}

export interface ClipReconcileAnswer {
  started: number;
  failed: number;
}

export interface ClipChargeImportBody {
  organizationId: string;
  /** The probed length of the uploaded file. */
  durationMs: number;
}

/** 200 when charged (or already charged by an earlier attempt); 402 with `{ code }` when refused. */
export interface ClipChargeImportAnswer {
  charged: true;
  /** Thousandths of a minute, as the ledger stores them. */
  units: number;
}

export interface ClipReverseBody {
  organizationId: string;
}

export interface ClipReverseAnswer {
  /** Entries reversed by this call (0 when already reversed or never charged). */
  reversed: number;
}

export interface ClipFinishExportBody {
  organizationId: string;
  clipId: string;
  revision: number;
  /** The rendered file in the public media space. */
  key: string;
  bytes: number;
  /** Its poster picture in the public media space. */
  posterKey: string | null;
  durationMs: number;
  width: number;
  height: number;
  fps: number;
  /** The name it gets in Media, ending in `.mp4`. */
  name: string;
  /**
   * `documentFingerprint` of the exported document (Module 15), stored on the
   * clip as `lastExportedFingerprint`; null for a job started before it existed.
   */
  fingerprint?: string | null;
}

export interface ClipFinishExportAnswer {
  mediaId: string;
}
