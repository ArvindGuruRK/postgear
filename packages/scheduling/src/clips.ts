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
/**
 * Sprint 13: the Python media service (`apps/media`) polls this queue. It
 * serves activities only; the workflows stay here in TypeScript and call them
 * by name through `apps/worker/src/clips/media-py.ts`.
 */
export const MEDIA_PY_TASK_QUEUE = 'postgear-media-py';
/** Reserved for an always-on graphics card worker (decision D13-11). Nothing polls it. */
export const MEDIA_GPU_TASK_QUEUE = 'postgear-media-gpu';

/**
 * How long a workflow lets each Python activity run, as data, so the stub
 * and its tests read one table. `heartbeatMs` null means the activity is too
 * short to heartbeat (it cannot be cancelled midway, and need not be).
 * `scheduleToCloseMs` caps the wait for a Python worker to pick it up too,
 * so a stopped service answers fast instead of queueing for ever.
 */
export interface MediaPyTiming {
  startToCloseMs: number;
  scheduleToCloseMs: number;
  heartbeatMs: number | null;
  maximumAttempts: number;
}

export const MEDIA_PY_TIMINGS = Object.freeze({
  // A health check is instant; four seconds with no Python worker means "off".
  mediaPyHealth: Object.freeze({
    startToCloseMs: 4_000,
    scheduleToCloseMs: 4_000,
    heartbeatMs: null,
    maximumAttempts: 1,
  }),
  // Listening: as long as the job itself may take, less the bookkeeping
  // reserve; a heartbeat between chunks (a chunk is under a minute of work on
  // the hosted lane and a few minutes on a processor). Two attempts: finished
  // chunks are kept on the box, so the second starts where the first stopped.
  mediaPyTranscribe: Object.freeze({
    startToCloseMs: 6 * 60 * 60_000 + 40 * 60_000,
    scheduleToCloseMs: 6 * 60 * 60_000 + 45 * 60_000,
    heartbeatMs: 10 * 60_000,
    maximumAttempts: 2,
  }),
  // Module 06: the picture measure decodes two small frames a second; an hour
  // of a stretch is a few minutes on a processor. A heartbeat every stretch
  // and every few hundred frames. Two attempts.
  mediaPyMotion: Object.freeze({
    startToCloseMs: 2 * 60 * 60_000,
    scheduleToCloseMs: 2 * 60 * 60_000 + 5 * 60_000,
    heartbeatMs: 5 * 60_000,
    maximumAttempts: 2,
  }),
  // Module 07: faces at five small pictures a second over one clip's stretch
  // (a minute or two, plus handles): seconds on a processor, a few minutes for
  // a long stretch. A heartbeat every few seconds of video. Two attempts.
  mediaPyDetectFaces: Object.freeze({
    startToCloseMs: 40 * 60_000,
    scheduleToCloseMs: 45 * 60_000,
    heartbeatMs: 2 * 60_000,
    maximumAttempts: 2,
  }),
  // At most 48 stills, each one seek and one picture.
  mediaPyStills: Object.freeze({
    startToCloseMs: 10 * 60_000,
    scheduleToCloseMs: 12 * 60_000,
    heartbeatMs: 2 * 60_000,
    maximumAttempts: 2,
  }),
  // Module 09: one typed line (at most 500 characters, about half a minute of
  // voice) made into a WAV. Instant under simulation; a local voice on a
  // processor is well under a minute. A heartbeat before and after the work.
  mediaPySpeak: Object.freeze({
    startToCloseMs: 5 * 60_000,
    scheduleToCloseMs: 6 * 60_000,
    heartbeatMs: 2 * 60_000,
    maximumAttempts: 2,
  }),
} satisfies Record<string, MediaPyTiming>);

/** The roles a worker process can take, and the queue each serves. */
export const WORKER_ROLES = ['publishing', 'media', 'render'] as const;
export type WorkerRole = (typeof WORKER_ROLES)[number];

// --- Workflows with a job row ----------------------------------------------------

export const CLIP_IMPORT_WORKFLOW = 'clipImportWorkflow';
export const CLIP_SEGMENT_WORKFLOW = 'clipSegmentWorkflow';
export const CLIP_HIGHLIGHTS_WORKFLOW = 'clipHighlightsWorkflow';
export const CLIP_RENDER_WORKFLOW = 'clipRenderWorkflow';
export const CLIP_DOWNLOAD_WORKFLOW = 'clipDownloadWorkflow';
// Sprint 13 (Clips AI). Each runs on `postgear-media` and calls the Python
// service on `postgear-media-py` where it needs sound or picture work.
export const CLIP_TRANSCRIBE_WORKFLOW = 'clipTranscribeWorkflow';
export const CLIP_FACES_WORKFLOW = 'clipFacesWorkflow';
export const CLIP_TRANSLATE_WORKFLOW = 'clipTranslateWorkflow';
export const CLIP_SPEECH_WORKFLOW = 'clipSpeechWorkflow';
/**
 * Module 10: Auto-Edit Video. Waits for the video's listen job (its own
 * TRANSCRIBE job and charge) and then asks the API to make the whole-video
 * clip with the recipe applied. No charge of its own.
 */
export const CLIP_AUTO_EDIT_WORKFLOW = 'clipAutoEditWorkflow';

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
export type ClipJobKindName =
  | 'IMPORT'
  | 'SEGMENT'
  | 'HIGHLIGHTS'
  | 'RENDER'
  | 'DOWNLOAD'
  | 'TRANSCRIBE'
  | 'FACES'
  | 'TRANSLATE'
  | 'SPEECH'
  | 'AUTO_EDIT';

/** Which workflow runs a job of each kind. */
export const CLIP_JOB_WORKFLOWS: Readonly<Record<ClipJobKindName, string>> = Object.freeze({
  IMPORT: CLIP_IMPORT_WORKFLOW,
  SEGMENT: CLIP_SEGMENT_WORKFLOW,
  HIGHLIGHTS: CLIP_HIGHLIGHTS_WORKFLOW,
  RENDER: CLIP_RENDER_WORKFLOW,
  DOWNLOAD: CLIP_DOWNLOAD_WORKFLOW,
  TRANSCRIBE: CLIP_TRANSCRIBE_WORKFLOW,
  FACES: CLIP_FACES_WORKFLOW,
  TRANSLATE: CLIP_TRANSLATE_WORKFLOW,
  SPEECH: CLIP_SPEECH_WORKFLOW,
  AUTO_EDIT: CLIP_AUTO_EDIT_WORKFLOW,
});

/** Which queue each kind runs on. */
export const CLIP_JOB_QUEUES: Readonly<Record<ClipJobKindName, string>> = Object.freeze({
  IMPORT: MEDIA_TASK_QUEUE,
  SEGMENT: MEDIA_TASK_QUEUE,
  HIGHLIGHTS: MEDIA_TASK_QUEUE,
  RENDER: RENDER_TASK_QUEUE,
  DOWNLOAD: MEDIA_TASK_QUEUE,
  TRANSCRIBE: MEDIA_TASK_QUEUE,
  FACES: MEDIA_TASK_QUEUE,
  TRANSLATE: MEDIA_TASK_QUEUE,
  SPEECH: MEDIA_TASK_QUEUE,
  AUTO_EDIT: MEDIA_TASK_QUEUE,
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

/**
 * Save To Media on a finished download (Module 18), on `postgear-media`: the
 * file copied to the public media space with a poster, then the API's
 * `finishSaveDownload` makes the Media row. No job row of its own: the state
 * is the download job's `output.media`. One per download at a time; a failed
 * one may be asked again under the same id.
 */
export const CLIP_SAVE_DOWNLOAD_WORKFLOW = 'clipSaveDownloadWorkflow';

export function clipSaveDownloadWorkflowId(jobId: string): string {
  return `clip-save-download:${jobId}`;
}

/**
 * Save To Media's time, smallest to largest, so the workflow always outlives
 * its own retries and writes `failed` itself:
 * - one try at the copy (at most 250 MB down and up again, one poster);
 * - both tries with the minute between them: the activity's
 *   `scheduleToCloseTimeout`;
 * - the whole save, the failure bookkeeping included: the workflow's
 *   execution limit. The API reads a `saving` row older than this as failed
 *   (its workflow has ended by then), so the person can ask again.
 */
export const CLIP_SAVE_DOWNLOAD_ATTEMPT_MS = 12 * 60_000;
export const CLIP_SAVE_DOWNLOAD_WORK_MS = 25 * 60_000;
export const CLIP_SAVE_DOWNLOAD_TIMEOUT_MS = 35 * 60_000;

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
  // Listening on a processor can run slower than real time on a long video:
  // six hours of sound is given seven. The hosted lane finishes in minutes.
  TRANSCRIBE: 7 * 60 * 60_000,
  FACES: 60 * 60_000,
  TRANSLATE: 30 * 60_000,
  SPEECH: 30 * 60_000,
  // Module 10: most of it is waiting for the listen job (at most 30 minutes
  // of sound, well inside the listen job's own limit), then one apply call.
  AUTO_EDIT: 3 * 60 * 60_000,
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
  // Sprint 13: nothing a second listen would change.
  'no_speech',
  'language_unsupported',
  'captions_off',
  'captions_missing',
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
  // Module 19: retention, rights requests and the storage notice (the API writes these).
  videoExpiring: 'A video will be removed soon',
  videoRemoved: 'A video was removed',
  storageOverLimit: 'Your videos are over your plan',
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

/** Module 19: the line under "A video will be removed soon". */
export function clipVideoExpiringLine(videoTitle: string): string {
  return capLine(
    `${quotedName(videoTitle, 'Your video')} will be removed in 3 days. Open it to keep it longer.`,
  );
}

/** Module 19: the line under "A video was removed" when nobody opened it for `days` days. */
export function clipVideoExpiredLine(videoTitle: string, days: number): string {
  const n = Math.max(1, Math.floor(days));
  return capLine(
    `${quotedName(videoTitle, 'Your video')} was removed because nobody opened it for ${n} ${n === 1 ? 'day' : 'days'}.`,
  );
}

/** Module 19: the line under "A video was removed" after a rights request. */
export const CLIP_VIDEO_RIGHTS_REMOVED_LINE = 'A video was removed after a request from its owner.';

/**
 * Module 19: the line under "Your videos are over your plan", to a tenth of a
 * gigabyte rounded the way the space meter beside it rounds (so the two never
 * disagree). Only where plain rounding would hide the overrun ("1 GB, over your
 * plan's 1 GB") does the amount used round up instead.
 */
export function clipStorageOverLine(usedGb: number, limitGb: number): string {
  const safe = (value: number) => (Number.isFinite(value) && value > 0 ? value : 0);
  // The meter's steps: tenths under 100 GB, whole gigabytes from there.
  const step = (value: number) => (safe(value) >= 100 ? 1 : 10);
  const round = (value: number) => Math.round(safe(value) * step(value)) / step(value);
  const limit = round(limitGb);
  let used = round(usedGb);
  if (used <= limit && safe(usedGb) > safe(limitGb)) {
    const per = step(usedGb);
    used = Math.max(Math.ceil(safe(usedGb) * per) / per, Math.round((limit + 1 / per) * per) / per);
  }
  const fmt = (value: number) => value.toLocaleString('en-GB');
  return `Your videos use ${fmt(used)} GB, over your plan's ${fmt(limit)} GB. Delete some, or upgrade, to bring in more.`;
}

/** Module 19: the Clips page's Videos tab sorted by size, where the storage notice leads. */
export function clipVideosBySizePath(organizationId: string): string {
  return `/${organizationId}/clips?tab=videos&sort=size`;
}

/** A QUEUED job older than this with no running workflow is started by the reconcile. */
export const CLIP_RECONCILE_START_AFTER_MS = 2 * 60_000;
/** Preview Export files and downloads are kept this long. */
export const CLIP_SHORT_LIVED_MS = 24 * 60 * 60_000;

/** One program the worker checked (`clipRuntimeCheckWorkflow`). */
export interface ClipToolCheck {
  /** `ffmpeg`, `ffprobe`, `yt-dlp`, `js-runtime`, `filter-graph`, `libass`, `libharfbuzz`, `libx264`, `libmp3lame`. */
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
  /**
   * Sprint 13: the Python media service, asked through Temporal
   * (`mediaPyHealth` on `postgear-media-py`). Absent from a Sprint 12 worker;
   * `ok: false` when it did not answer in time.
   */
  mediaPy?: ClipMediaPyReport;
}

/** The Python service as the runtime check saw it. */
export interface ClipMediaPyReport {
  ok: boolean;
  simulation: boolean | null;
  contractVersion: number | null;
  serviceVersion: string | null;
  /** Binding name to its state (`simulation`, `live`, `off`). */
  bindings: Record<string, string>;
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
  /**
   * Sprint 13, Module 05: a Find Clips run with a setup reads its transcript
   * for moments. The API holds the model client and its keys, so it reads,
   * picks, fits and titles; the worker blends the answer with the signals.
   */
  pickMoments: (jobId: string) => `${CLIP_INTERNAL_PREFIX}/jobs/${jobId}/pick-moments`,
  /**
   * Sprint 13, Module 06: Look For Action's check on stills. The worker names
   * the stills (keys of this job only); the API reads them, asks the model
   * closed questions and answers one verdict a burst. Only on a run that
   * started with the vision switch on.
   */
  checkStills: (jobId: string) => `${CLIP_INTERNAL_PREFIX}/jobs/${jobId}/check-stills`,
  /**
   * Sprint 13, Module 08: a Find Clips run made with Follow The Speaker. The
   * API marks the run's clips to follow on first open and asks for faces for
   * the top few (free). The worker calls it once after writing the clips; a
   * failure never fails the run.
   */
  followSpeaker: (jobId: string) => `${CLIP_INTERNAL_PREFIX}/jobs/${jobId}/follow-speaker`,
  /**
   * Sprint 13, Module 10: an AUTO_EDIT job's last stage. The API makes the
   * whole-video clip with the recipe applied (idempotent on the job's
   * `clipId`) and answers `{ clipId, skipped, noSpeech }`.
   */
  autoEdit: (jobId: string) => `${CLIP_INTERNAL_PREFIX}/jobs/${jobId}/auto-edit`,
  /**
   * Sprint 13, Module 10: a Find Clips run whose setup has a recipe (or
   * silences, a hook title or a brand kit). The API applies it to the run's
   * new clips and answers `{ applied, skipped }`. Called once after
   * `followSpeaker`; a failure never fails the run.
   */
  applyRecipe: (jobId: string) => `${CLIP_INTERNAL_PREFIX}/jobs/${jobId}/apply-recipe`,
  /** A finished export becomes a Media row, the clip is marked exported, the notification written. */
  finishExport: (jobId: string) => `${CLIP_INTERNAL_PREFIX}/jobs/${jobId}/finish-export`,
  /**
   * Module 18: a finished download the worker copied to the public media
   * space becomes a Media row (`origin: 'upload'`), and the download's
   * `output.media` says `saved`. A second call answers the first one's id.
   */
  finishSaveDownload: (jobId: string) =>
    `${CLIP_INTERNAL_PREFIX}/jobs/${jobId}/finish-save-download`,
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
  /**
   * Module 19: the housekeeping pass (`ClipSweepService`): expiry notices and
   * removals, expired downloads, abandoned uploads, stale sharp ranges,
   * unused workspace stickers and sounds, old failed imports, the charge
   * backstop, the storage notice, and once a day the orphan files and the
   * override expiry. Each part in its own try, a bounded batch per pass.
   */
  sweep: `${CLIP_INTERNAL_PREFIX}/sweep`,
} as const;

/** Module 10: what both recipe routes take. */
export interface ClipRecipeJobBody {
  organizationId: string;
}

/** Module 10: one part of a recipe not applied (mirrors the engine's `RecipeSkip`). */
export interface ClipAutoEditSkip {
  part: string;
  reason: string;
}

/** Module 10: `POST .../auto-edit`. */
export interface ClipAutoEditAnswer {
  clipId: string;
  skipped: ClipAutoEditSkip[];
  noSpeech: boolean;
}

/** Module 10: `POST .../apply-recipe`. */
export interface ClipApplyRecipeAnswer {
  applied: number;
  skipped: number;
}

/** Module 19: what one sweep pass did, part by part (counts only). */
export interface ClipSweepAnswer {
  noticed: number;
  expired: number;
  downloads: number;
  uploads: number;
  segments: number;
  library: number;
  failedImports: number;
  charges: number;
  storageNotices: number;
  /** Null when the daily parts did not run in this pass. */
  orphans: { objects: number; deleted: number; missing: number } | null;
  overridesExpired: number | null;
  /** Parts that threw (by name); the rest still ran. */
  failedParts: string[];
}

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
  /**
   * Module 06: give back only this step's charge (Look For Action when its
   * motion measure failed and the run went on without it). Absent: every charge.
   */
  step?: 'action';
}

/** One moment the picker found, fitted to a sentence at each end. Video time. Never the words. */
export interface ClipPickedMoment {
  fromMs: number;
  toMs: number;
  fromRow: number;
  toRow: number;
  parts: { hook: number; standsAlone: number; payoff: number; clarity: number; shareable: number };
  /** The five parts added, 0 to 100. */
  score: number;
  funny: boolean;
  matchesRequest: boolean;
  /** At most eight words, or null when the model gave none. */
  title: string | null;
}

export interface ClipPickMomentsAnswer {
  moments: ClipPickedMoment[];
  /** No words were heard in the stretch: the run uses the signals alone (the reading charge was given back). */
  noSpeech: boolean;
  /** The person asked for something. */
  asked: boolean;
}

/** One burst for the still check: its four stills (this job's keys) and two facts. */
export interface ClipStillBurst {
  stillKeys: string[];
  /** Where its peak is, seconds into the video. */
  momentSec: number;
  spanSec: number;
  withSound: boolean;
}

export interface ClipCheckStillsBody {
  organizationId: string;
  bursts: ClipStillBurst[];
}

/** What the check saw in one burst; null when its call failed (the burst counts as unchecked). */
export interface ClipStillVerdict {
  notable: boolean;
  kind: 'crash_or_fall' | 'win_or_score' | 'surprise' | 'visual_gag' | 'nothing';
  sure: number;
  /** One sentence of at most 15 words; empty when not notable. */
  line: string;
}

export interface ClipCheckStillsAnswer {
  verdicts: Array<ClipStillVerdict | null>;
}

/** The most bursts one run shows the still checker, and stills a burst. */
export const CLIP_STILL_BURSTS_MAX = 12;
export const CLIP_STILLS_PER_BURST = 4;

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

/** Module 18: a download's copy in the public media space, ready to become a Media row. */
export interface ClipFinishSaveDownloadBody {
  organizationId: string;
  /** The MP4 in the public media space. */
  key: string;
  bytes: number;
  /** Its poster picture in the public media space. */
  posterKey: string | null;
  durationMs: number;
  width: number;
  height: number;
  fps: number;
}

export interface ClipFinishSaveDownloadAnswer {
  mediaId: string;
}
