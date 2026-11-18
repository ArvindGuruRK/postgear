/**
 * Clip jobs: the long tasks behind every wait, and the contract between the
 * API, which writes a `ClipJob` row and starts its workflow, and the worker,
 * which does the work and writes status back.
 *
 * The API validates a job's `input` with the schema for its kind before the
 * row is written, and the worker parses it again before it starts, so a row
 * that one side cannot read never runs. The worker never resolves a plan
 * value: everything that depends on the plan (limits, quality, the mark,
 * priority) is copied into the input when the job is made, so a plan change
 * mid-job never alters a running one.
 */
import { z } from 'zod';
import { clipDocumentSchema } from './document/schema';
import { CLIP_PLATFORMS, LINK_KINDS } from './links/types';
import { EXPORT_QUALITIES } from './quality';

export const CLIP_JOB_KINDS = ['IMPORT', 'SEGMENT', 'HIGHLIGHTS', 'RENDER', 'DOWNLOAD'] as const;
export type ClipJobKind = (typeof CLIP_JOB_KINDS)[number];

export const CLIP_JOB_STATUSES = ['QUEUED', 'RUNNING', 'DONE', 'FAILED', 'CANCELLED'] as const;
export type ClipJobStatus = (typeof CLIP_JOB_STATUSES)[number];

export const JOB_PRIORITIES = ['low', 'normal', 'high'] as const;
export type JobPriority = (typeof JOB_PRIORITIES)[number];

/** Higher runs first when several jobs wait for a slot. */
export function priorityRank(priority: string): number {
  const index = (JOB_PRIORITIES as readonly string[]).indexOf(priority);
  return index < 0 ? 1 : index;
}

/** The steps of each kind, in order. */
export const CLIP_JOB_STAGES = {
  IMPORT: ['fetching', 'preparing'],
  SEGMENT: ['fetching'],
  HIGHLIGHTS: ['loudness', 'scenes', 'chat', 'scoring'],
  RENDER: ['fetching', 'rendering', 'finishing'],
  DOWNLOAD: ['fetching'],
} as const satisfies Record<ClipJobKind, readonly string[]>;

export type ClipJobStage = (typeof CLIP_JOB_STAGES)[ClipJobKind][number];

/** What a person reads for each step. Never "proxy", "segment", "render" or "job". */
const STAGE_LABELS: Record<ClipJobKind, Record<string, string>> = {
  IMPORT: { fetching: 'Getting the video', preparing: 'Preparing the preview' },
  SEGMENT: { fetching: 'Getting the sharp video' },
  HIGHLIGHTS: {
    loudness: 'Listening for loud moments',
    scenes: 'Looking for scene changes',
    chat: 'Reading the chat',
    scoring: 'Picking the best moments',
  },
  RENDER: { fetching: 'Getting the sharp video', rendering: 'Rendering', finishing: 'Finishing' },
  DOWNLOAD: { fetching: 'Getting your file' },
};

export const WAITING_LABEL = 'Waiting for its turn';
export const PREVIEW_LABEL = 'Making the preview';

/** The words for a job's current step. A Preview Export only ever shows "Making the preview". */
export function stageLabel(
  kind: ClipJobKind,
  stage: string | null,
  opts: { proof?: boolean } = {},
): string {
  if (kind === 'RENDER' && opts.proof) {
    return PREVIEW_LABEL;
  }
  if (!stage) {
    return WAITING_LABEL;
  }
  return STAGE_LABELS[kind][stage] ?? WAITING_LABEL;
}

/** What a finished job says under its card. */
export const JOB_END_LABELS = {
  DONE: 'Done',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
} as const satisfies Partial<Record<ClipJobStatus, string>>;

/**
 * The words under a job's card, from its status first: a finished job says
 * so (its last stage stays on the row, but it is over), a running one names
 * its step, and a queued one is waiting (a Preview Export always says
 * "Making the preview" until it ends).
 */
export function jobLabel(
  kind: ClipJobKind,
  status: ClipJobStatus,
  stage: string | null,
  opts: { proof?: boolean } = {},
): string {
  if (status === 'DONE' || status === 'FAILED' || status === 'CANCELLED') {
    return JOB_END_LABELS[status];
  }
  return stageLabel(kind, status === 'RUNNING' ? stage : null, opts);
}

// --- Shared pieces ------------------------------------------------------------

export const linkRefSchema = z
  .object({
    platform: z.enum(CLIP_PLATFORMS),
    kind: z.enum(LINK_KINDS),
    externalId: z.string().min(1).max(128),
    canonicalUrl: z.string().url().max(500).startsWith('https://'),
    channel: z.string().min(1).max(64).optional(),
  })
  .strict();

const uuid = z.string().uuid();
const storageKey = z.string().min(1).max(300);
const wholeMs = z.number().int().min(0);

/** The import's plan values, copied in by the API. */
export const importLimitsSchema = z
  .object({
    maxVideoMs: z.number().int().positive(),
    storageBytes: z.number().int().min(0),
    retentionDays: z.number().int().positive(),
  })
  .strict();
export type ImportLimits = z.infer<typeof importLimitsSchema>;

/** Where the video comes from: a recognised link, or a file the browser uploaded in parts. */
export const videoOriginSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('link'), link: linkRefSchema }).strict(),
  z.object({ type: z.literal('upload'), originalKey: storageKey }).strict(),
]);
export type VideoOrigin = z.infer<typeof videoOriginSchema>;

// --- Inputs -------------------------------------------------------------------

export const importInputSchema = z
  .object({
    videoId: uuid,
    origin: videoOriginSchema,
    limits: importLimitsSchema,
    /** From the probe, when the platform said; sizes the free-disk check. */
    expectedBytes: z.number().int().min(0).nullable(),
  })
  .strict();

export const segmentInputSchema = z
  .object({
    videoId: uuid,
    clipId: uuid,
    origin: videoOriginSchema,
    /** Source time, already widened by the handles and clamped to the video. */
    fromMs: wholeMs,
    toMs: wholeMs,
    /** The tallest rendition worth fetching for the plan's best quality. */
    maxHeight: z.number().int().min(144).max(2160),
  })
  .strict()
  .refine((input) => input.fromMs < input.toMs, 'A range must end after it starts');

export const highlightsInputSchema = z
  .object({
    videoId: uuid,
    runId: uuid,
  })
  .strict();

export const renderInputSchema = z
  .object({
    clipId: uuid,
    videoId: uuid,
    /** The revision the document was frozen at. */
    revision: z.number().int().positive(),
    document: clipDocumentSchema,
    quality: z.enum(EXPORT_QUALITIES),
    /** Preview Export: a small render kept 24 hours, no Media row, no charge. */
    proof: z.boolean(),
    /** The Free plan's mark, decided by the API from the plan. */
    watermark: z.boolean(),
    /** The file name the export gets in Media. */
    name: z.string().min(1).max(200),
  })
  .strict();

export const downloadInputSchema = z
  .object({
    link: linkRefSchema,
    formatId: z.string().min(1).max(32),
    expectedBytes: z.number().int().min(0).nullable(),
  })
  .strict();

export const CLIP_JOB_INPUT_SCHEMAS = {
  IMPORT: importInputSchema,
  SEGMENT: segmentInputSchema,
  HIGHLIGHTS: highlightsInputSchema,
  RENDER: renderInputSchema,
  DOWNLOAD: downloadInputSchema,
} as const;

export type ImportInput = z.infer<typeof importInputSchema>;
export type SegmentInput = z.infer<typeof segmentInputSchema>;
export type HighlightsInput = z.infer<typeof highlightsInputSchema>;
export type RenderInput = z.infer<typeof renderInputSchema>;
export type DownloadInput = z.infer<typeof downloadInputSchema>;

export interface ClipJobInputs {
  IMPORT: ImportInput;
  SEGMENT: SegmentInput;
  HIGHLIGHTS: HighlightsInput;
  RENDER: RenderInput;
  DOWNLOAD: DownloadInput;
}

// --- Outputs ------------------------------------------------------------------

export const importOutputSchema = z
  .object({ durationMs: wholeMs, assets: z.number().int().min(0) })
  .strict();

export const segmentOutputSchema = z
  .object({
    /** True when the platform copy is gone and exports fall back to the light copy. */
    gone: z.boolean(),
    assetId: uuid.nullable(),
  })
  .strict();

export const highlightsOutputSchema = z.object({ found: z.number().int().min(0) }).strict();

export const renderOutputSchema = z
  .object({
    mediaId: uuid.nullable(),
    /** Preview Export only: the private key of the small file. */
    proofKey: storageKey.nullable(),
    durationMs: wholeMs,
  })
  .strict();

export const downloadOutputSchema = z
  .object({ key: storageKey, bytes: z.number().int().min(0), fileName: z.string().min(1).max(200) })
  .strict();

export const CLIP_JOB_OUTPUT_SCHEMAS = {
  IMPORT: importOutputSchema,
  SEGMENT: segmentOutputSchema,
  HIGHLIGHTS: highlightsOutputSchema,
  RENDER: renderOutputSchema,
  DOWNLOAD: downloadOutputSchema,
} as const;

export type ImportOutput = z.infer<typeof importOutputSchema>;
export type SegmentOutput = z.infer<typeof segmentOutputSchema>;
export type RenderOutput = z.infer<typeof renderOutputSchema>;
export type DownloadOutput = z.infer<typeof downloadOutputSchema>;

// --- How long it will take ------------------------------------------------------

export interface ProgressSample {
  /** Epoch milliseconds. */
  at: number;
  /** 0 to 100. */
  progress: number;
}

/** Below this the rate is noise: no estimate is given. */
export const ETA_MIN_PROGRESS = 5;
/** Only the recent past counts, so a slow start does not haunt a fast finish. */
const ETA_WINDOW_MS = 60_000;
const ETA_MIN_SPAN_MS = 3_000;

/**
 * Seconds left, or null when there is no honest answer.
 *
 * From the samples inside the last minute it takes the average progress per
 * second and projects the rest. Before there is a few seconds of history it
 * falls back on `priorSeconds`, the median length of this workspace's recent
 * finished jobs of the kind, scaled by what is left. Below 5 percent, or for
 * a step that reports no number, it answers null. Never negative; rounded up.
 */
export function estimateEtaSeconds(
  samples: readonly ProgressSample[],
  priorSeconds: number | null,
): number | null {
  const last = samples[samples.length - 1];
  if (!last || !Number.isFinite(last.progress) || last.progress < ETA_MIN_PROGRESS) {
    return null;
  }
  if (last.progress >= 100) {
    return 0;
  }

  const remainingShare = (100 - last.progress) / 100;
  const window = samples.filter((s) => s.at >= last.at - ETA_WINDOW_MS);
  const first = window[0] ?? last;
  const span = last.at - first.at;
  const gained = last.progress - first.progress;

  if (span >= ETA_MIN_SPAN_MS && gained > 0) {
    const perSecond = gained / (span / 1000);
    return Math.max(0, Math.ceil((100 - last.progress) / perSecond));
  }

  if (priorSeconds !== null && Number.isFinite(priorSeconds) && priorSeconds > 0) {
    return Math.max(0, Math.ceil(priorSeconds * remainingShare));
  }

  return null;
}
