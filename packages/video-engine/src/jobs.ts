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
import { isStarterRecipeId, type RecipeSkip } from './recipes/schema';

export const CLIP_JOB_KINDS = [
  'IMPORT',
  'SEGMENT',
  'HIGHLIGHTS',
  'RENDER',
  'DOWNLOAD',
  // Sprint 13 (Clips AI).
  'TRANSCRIBE',
  'FACES',
  'TRANSLATE',
  'SPEECH',
  // Module 10: Auto-Edit Video.
  'AUTO_EDIT',
] as const;
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
  // Sprint 13 adds `listening`, `reading` and `watching` to a run that asks for them.
  HIGHLIGHTS: ['loudness', 'scenes', 'chat', 'listening', 'reading', 'watching', 'scoring'],
  RENDER: ['fetching', 'rendering', 'finishing'],
  DOWNLOAD: ['fetching'],
  TRANSCRIBE: ['listening'],
  FACES: ['faces'],
  TRANSLATE: ['translating'],
  SPEECH: ['voice'],
  AUTO_EDIT: ['listening', 'applying'],
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
    listening: 'Listening to what is said',
    reading: 'Reading for the best moments',
    watching: 'Watching for action',
    scoring: 'Picking the best moments',
  },
  RENDER: { fetching: 'Getting the sharp video', rendering: 'Rendering', finishing: 'Finishing' },
  DOWNLOAD: { fetching: 'Getting your file' },
  TRANSCRIBE: { listening: 'Listening to what is said' },
  FACES: { faces: 'Finding faces' },
  TRANSLATE: { translating: 'Translating the captions' },
  SPEECH: { voice: 'Making the voice' },
  AUTO_EDIT: { listening: 'Listening to what is said', applying: 'Applying your recipe' },
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
  // Own keys only: a stage like `constructor` must not read a built-in object member.
  const labels = STAGE_LABELS[kind];
  return (Object.hasOwn(labels, stage) ? labels[stage] : undefined) ?? WAITING_LABEL;
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

/** The most heat map points an import carries (YouTube sends 100). */
export const MAX_REPLAYED_POINTS = 1_000;

/** One point of YouTube's heat map, source time. */
export const replayedPointSchema = z
  .object({
    startMs: z.number().int().min(0),
    endMs: z.number().int().min(0),
    value: z.number().min(0).max(1),
  })
  .strict()
  .refine((point) => point.startMs < point.endMs, 'A point must end after it starts');
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
    /**
     * Module 16: YouTube's "most replayed" heat map from the probe, copied by
     * the API; the import stores it as the video's first signal track.
     */
    replayed: z.array(replayedPointSchema).max(MAX_REPLAYED_POINTS).optional(),
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
    /**
     * `documentFingerprint` of the frozen document (Module 15): the clip is
     * Exported while its document still has it, and a preview is stale once
     * it differs. Absent on jobs made before Module 15.
     */
    fingerprint: z.string().min(1).max(64).optional(),
    /**
     * Sprint 13 Module 11, Export All: the batch this export belongs to. Its
     * clip's own bell is skipped; one notice comes when the batch's last job ends.
     */
    batchId: uuid.optional(),
  })
  .strict();

/**
 * Who ticked the rights box, when, and under which wording (Module 18): a
 * download makes no `ClipVideo`, so its job row is where the record lives.
 */
export const rightsRecordSchema = z
  .object({
    byUserId: z.string().min(1).max(64),
    at: z.string().datetime(),
    textVersion: z.string().min(1).max(32),
  })
  .strict();

/**
 * A download in any format (Module 18). The API probed the link again, found
 * the format in the fresh probe and copied in everything the worker needs, so
 * the worker never resolves a plan value: `maxBytes` is the space the plan
 * still has (the fetch stops past it).
 */
export const downloadInputSchema = z
  .object({
    link: linkRefSchema,
    /** `LinkFormat.id` from the probe: `h1080`, `h720`, `h360`, `audio`. */
    formatId: z.string().min(1).max(32),
    /** "720p", "Audio Only": what the Downloads row calls it. */
    label: z.string().min(1).max(40),
    /** True for Audio Only, which is delivered as MP3. */
    audioOnly: z.boolean(),
    /** The video's title, for the row and the saved file's name. */
    title: z.string().min(1).max(300),
    durationMs: wholeMs,
    expectedBytes: z.number().int().min(0).nullable(),
    maxBytes: z.number().int().positive(),
    rights: rightsRecordSchema,
  })
  .strict();

// --- Sprint 13 (Clips AI) inputs ----------------------------------------------

/** A stretch of the video, whole milliseconds. */
export const msRangeSchema = z
  .object({ fromMs: wholeMs, toMs: wholeMs })
  .strict()
  .refine((range) => range.fromMs < range.toMs, 'A range must end after it starts');

/** `auto`, or an ISO 639-1 code (which codes are offered: `TRANSCRIPT_LANGUAGES`). */
export const languageChoiceSchema = z.string().regex(/^(?:auto|[a-z]{2,3})$/);
const languageCodeSchema = z.string().regex(/^[a-z]{2,3}$/);

/** The most stretches one listening job takes (the gaps of one request). */
export const MAX_LISTEN_RANGES = 64;

/**
 * Listening (Module 02). The API worked out which stretches are still
 * missing, priced them and charged before the row was written, so the worker
 * only listens: `aiMinutes` is what was charged, kept for the give-back note.
 */
export const transcribeInputSchema = z
  .object({
    videoId: uuid,
    language: languageChoiceSchema,
    /** In order, never overlapping, already rounded to listening blocks. */
    ranges: z.array(msRangeSchema).min(1).max(MAX_LISTEN_RANGES),
    aiMinutes: z.number().int().min(0),
  })
  .strict();

/** Finding faces in a clip's stretch of its video (Module 07). Free. */
export const facesInputSchema = z
  .object({ videoId: uuid, clipId: uuid.nullable(), fromMs: wholeMs, toMs: wholeMs })
  .strict()
  .refine((input) => input.fromMs < input.toMs, 'A range must end after it starts');

/** Translating a clip's captions into another language (Module 03). */
export const translateInputSchema = z
  .object({
    videoId: uuid,
    clipId: uuid,
    fromLanguage: languageCodeSchema,
    toLanguage: languageCodeSchema,
    fromMs: wholeMs,
    toMs: wholeMs,
    aiMinutes: z.number().int().min(0),
  })
  .strict()
  .refine((input) => input.fromMs < input.toMs, 'A range must end after it starts');

/** A voice from text (Module 09), behind `CLIPS_TTS`; the route takes at most 500 characters. */
export const speechInputSchema = z
  .object({
    text: z.string().min(1).max(500),
    voiceId: z.string().min(1).max(64),
    aiMinutes: z.number().int().min(0),
  })
  .strict();

/** A starter recipe's id, or the workspace's own recipe row id. */
export const recipeIdSchema = z
  .string()
  .min(1)
  .max(64)
  .refine((id) => isStarterRecipeId(id) || uuid.safeParse(id).success, 'Not a recipe id');

/**
 * Auto-Edit Video (Module 10): one clip over `range` with the recipe applied.
 * The API made `clipId` and, when the recipe needs words the video has not
 * had listened to, started a TRANSCRIBE job (`listenJobId`, its own charge)
 * that this job waits for. `listenStarted` is false when the listening was
 * already running for another caller (it is not this job's to cancel).
 * No charge of its own.
 */
export const autoEditInputSchema = z
  .object({
    videoId: uuid,
    clipId: uuid,
    recipeId: recipeIdSchema,
    range: msRangeSchema,
    listenJobId: uuid.nullable(),
    listenStarted: z.boolean(),
  })
  .strict();

export const CLIP_JOB_INPUT_SCHEMAS = {
  IMPORT: importInputSchema,
  SEGMENT: segmentInputSchema,
  HIGHLIGHTS: highlightsInputSchema,
  RENDER: renderInputSchema,
  DOWNLOAD: downloadInputSchema,
  TRANSCRIBE: transcribeInputSchema,
  FACES: facesInputSchema,
  TRANSLATE: translateInputSchema,
  SPEECH: speechInputSchema,
  AUTO_EDIT: autoEditInputSchema,
} as const;

export type AutoEditInput = z.infer<typeof autoEditInputSchema>;
export type TranscribeInput = z.infer<typeof transcribeInputSchema>;
export type FacesInput = z.infer<typeof facesInputSchema>;
export type TranslateInput = z.infer<typeof translateInputSchema>;
export type SpeechInput = z.infer<typeof speechInputSchema>;
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
  TRANSCRIBE: TranscribeInput;
  FACES: FacesInput;
  TRANSLATE: TranslateInput;
  SPEECH: SpeechInput;
  AUTO_EDIT: AutoEditInput;
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

export const highlightsOutputSchema = z
  .object({
    found: z.number().int().min(0),
    /** Module 16: the tracks the scorer used, in registry order. */
    used: z.array(z.string().min(1).max(32)).max(16).optional(),
    /**
     * Sprint 13, Module 05: a run with a setup, what it did (never a word):
     * whether it read the transcript, heard no speech, was asked for
     * something, and how many clips matched what was asked.
     */
    ai: z
      .object({
        read: z.boolean(),
        noSpeech: z.boolean(),
        asked: z.boolean(),
        matched: z.number().int().min(0),
        /** Module 06: Look For Action ran (its motion measure worked). */
        watched: z.boolean().optional(),
        /** Module 06: clips that action found or helped. */
        actions: z.number().int().min(0).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

/**
 * The export's loudness (Module 14): what the measuring pass read, what the
 * finished file reads, and which `loudnorm` mode ran (`skipped` for a clip
 * with no sound, or one already in range). Module 15's result line reads it.
 */
export const renderLoudnessSchema = z
  .object({
    inputLufs: z.number().nullable(),
    inputTp: z.number().nullable(),
    finalLufs: z.number().nullable(),
    mode: z.enum(['linear', 'dynamic', 'skipped']),
  })
  .strict();

export const renderOutputSchema = z
  .object({
    mediaId: uuid.nullable(),
    /** Preview Export only: the private key of the small file. */
    proofKey: storageKey.nullable(),
    durationMs: wholeMs,
    /** Absent on exports made before Module 14. */
    loudness: renderLoudnessSchema.nullable().optional(),
    /** The finished file's facts (Module 15), as `verifyOutput` read them; absent before. */
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    fps: z.number().positive().optional(),
    bytes: z.number().int().min(0).optional(),
  })
  .strict();

/**
 * Save To Media on a finished download (Module 18): `saving` while the worker
 * copies it, `saved` with the Media row, `failed` when it could not (the
 * button comes back). `startedAt` is when `saving` was written, so the API can
 * tell a save whose workflow ended without a word from one still running;
 * rows written before it was kept have none.
 */
export const downloadMediaSchema = z
  .object({
    status: z.enum(['saving', 'saved', 'failed']),
    mediaId: uuid.nullable(),
    startedAt: z.string().datetime().optional(),
  })
  .strict();

/**
 * A prepared download (Module 18): the DOWNLOAD asset row and its private key,
 * the file's facts as `probeFile` read them (Save To Media needs them for the
 * Media row), and Save To Media's state once someone asked for it.
 */
export const downloadOutputSchema = z
  .object({
    assetId: uuid,
    key: storageKey,
    bytes: z.number().int().min(0),
    ext: z.enum(['mp4', 'mp3']),
    /** The saved file's name: the title made safe, with the extension. */
    fileName: z.string().min(1).max(200),
    durationMs: wholeMs,
    width: z.number().int().positive().nullable(),
    height: z.number().int().positive().nullable(),
    fps: z.number().positive().nullable(),
    media: downloadMediaSchema.optional(),
  })
  .strict();

/**
 * A finished listening job (Module 02). `noSpeech` means nothing was heard in
 * the asked stretches: they are recorded as covered and the charge is given
 * back. Never a word of what was said.
 */
export const transcribeOutputSchema = z
  .object({
    transcriptAssetId: uuid.nullable(),
    language: languageCodeSchema,
    wordCount: z.number().int().min(0),
    noSpeech: z.boolean(),
    secondsListened: z.number().min(0),
    /** What listened, such as `faster-whisper:small` or `simulation`. */
    model: z.string().min(1).max(80),
  })
  .strict();

/** Finding faces: the face file kept (shared by every clip of the stretch) and two counts, never a box. */
export const facesOutputSchema = z
  .object({
    assetId: uuid.nullable(),
    /** Boxes in the whole stretch (0: no face anywhere; the job is still DONE). */
    found: z.number().int().min(0),
    /** Pictures looked at. */
    sampled: z.number().int().min(0),
  })
  .strict();

export const translateOutputSchema = z
  .object({ transcriptAssetId: uuid.nullable(), wordCount: z.number().int().min(0) })
  .strict();

export const speechOutputSchema = z
  .object({ assetId: uuid.nullable(), durationMs: wholeMs })
  .strict();

/** The parts and reasons of `RecipeSkip`, as data, so a job's output is checked like any other. */
export const RECIPE_SKIP_PARTS = [
  'layout',
  'follow',
  'captions',
  'silences',
  'fillers',
  'bleep',
  'hookTitle',
] as const satisfies readonly RecipeSkip['part'][];
export const RECIPE_SKIP_REASONS = [
  'no_transcript',
  'no_speech',
  'not_offered',
  'clip_too_short',
  'nothing_found',
  'no_faces',
] as const satisfies readonly RecipeSkip['reason'][];

// Both ways: a reason added to `RecipeSkip` and not here fails the build.
type MissingSkipPart = Exclude<RecipeSkip['part'], (typeof RECIPE_SKIP_PARTS)[number]>;
type MissingSkipReason = Exclude<RecipeSkip['reason'], (typeof RECIPE_SKIP_REASONS)[number]>;
const skipTablesComplete: [MissingSkipPart, MissingSkipReason] extends [never, never]
  ? true
  : never = true;
void skipTablesComplete;

export const recipeSkipSchema = z
  .object({ part: z.enum(RECIPE_SKIP_PARTS), reason: z.enum(RECIPE_SKIP_REASONS) })
  .strict();

/** A finished Auto-Edit: the clip made, the parts not applied, and whether anyone spoke. */
export const autoEditOutputSchema = z
  .object({
    clipId: uuid,
    skipped: z.array(recipeSkipSchema).max(32),
    noSpeech: z.boolean(),
  })
  .strict();

export const CLIP_JOB_OUTPUT_SCHEMAS = {
  IMPORT: importOutputSchema,
  SEGMENT: segmentOutputSchema,
  HIGHLIGHTS: highlightsOutputSchema,
  RENDER: renderOutputSchema,
  DOWNLOAD: downloadOutputSchema,
  TRANSCRIBE: transcribeOutputSchema,
  FACES: facesOutputSchema,
  TRANSLATE: translateOutputSchema,
  SPEECH: speechOutputSchema,
  AUTO_EDIT: autoEditOutputSchema,
} as const;

export type AutoEditOutput = z.infer<typeof autoEditOutputSchema>;

export type TranscribeOutput = z.infer<typeof transcribeOutputSchema>;
export type FacesOutput = z.infer<typeof facesOutputSchema>;
export type TranslateOutput = z.infer<typeof translateOutputSchema>;
export type SpeechOutput = z.infer<typeof speechOutputSchema>;
export type ImportOutput = z.infer<typeof importOutputSchema>;
export type SegmentOutput = z.infer<typeof segmentOutputSchema>;
export type RenderOutput = z.infer<typeof renderOutputSchema>;
export type DownloadOutput = z.infer<typeof downloadOutputSchema>;
export type DownloadMedia = z.infer<typeof downloadMediaSchema>;
export type RightsRecord = z.infer<typeof rightsRecordSchema>;

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
