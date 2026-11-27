/**
 * What the browser sees of a `ClipJob` (Sprint 12, Module 02).
 *
 * Never the raw row: `input` holds plan values and a RENDER's whole document,
 * and `output` holds storage keys. The view carries the step in words
 * ("Getting the video"), the progress, an honest estimate of the time left,
 * our error sentence, and a small result picked field by field per kind.
 */
import type { ClipJob } from '@postgear/db';
import {
  CLIP_JOB_OUTPUT_SCHEMAS,
  CLIP_JOB_STAGES,
  type ClipError,
  type ClipJobKind,
  type ClipPlatformId,
  clipErrorMessage,
  estimateEtaSeconds,
  jobLabel,
  type ProgressSample,
  type RecipeSkip,
} from '@postgear/video-engine';
import { z } from 'zod';

export interface ClipJobView {
  id: string;
  kind: ClipJobKind;
  status: ClipJob['status'];
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
  /**
   * The finished job's result, per kind; never a storage key. Flat values,
   * except an AUTO_EDIT's `skipped` (Module 10: the parts its recipe left out).
   */
  result: Record<string, string | number | boolean | null | RecipeSkip[]> | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export const TERMINAL_JOB_STATUSES = new Set<ClipJob['status']>(['DONE', 'FAILED', 'CANCELLED']);

const storedErrorSchema = z.object({
  code: z.string().min(1).max(64),
  message: z.string().max(400),
});

/** Codes whose sentence names the platform, so the stored sentence is kept. */
const PLATFORM_CODES = new Set(['platform_resting', 'platform_paused']);

/** Our codes are short snake_case words; anything else is shown as `tool_failed`. */
const CODE = /^[a-z][a-z0-9_]{1,63}$/;

/**
 * The error a person reads. The worker stores our own sentence, but the view
 * re-derives it from the code anyway, so a row written by an older worker
 * (or tampered with) can never put other text on a page. The code itself is
 * answered too, so one that is not a plain word (a path, a key, a tool's
 * line) becomes `tool_failed` (security sweep, Module 20).
 */
export function errorOf(raw: unknown): ClipError | null {
  const parsed = storedErrorSchema.safeParse(raw);
  if (!parsed.success) return null;
  const { message } = parsed.data;
  const code = CODE.test(parsed.data.code) ? parsed.data.code : 'tool_failed';
  if (PLATFORM_CODES.has(code)) {
    const platform = /^(YouTube|Twitch|Kick) /.exec(message)?.[1]?.toLowerCase() as
      | ClipPlatformId
      | undefined;
    return { code, message: clipErrorMessage(code, platform) };
  }
  return { code, message: clipErrorMessage(code) };
}

function resultOf(kind: ClipJobKind, raw: unknown): ClipJobView['result'] {
  if (raw === null || raw === undefined) return null;
  const parsed = CLIP_JOB_OUTPUT_SCHEMAS[kind].safeParse(raw);
  if (!parsed.success) return null;
  const output = parsed.data;
  switch (kind) {
    case 'IMPORT': {
      const value = output as z.infer<(typeof CLIP_JOB_OUTPUT_SCHEMAS)['IMPORT']>;
      return { durationMs: value.durationMs };
    }
    case 'SEGMENT': {
      const value = output as z.infer<(typeof CLIP_JOB_OUTPUT_SCHEMAS)['SEGMENT']>;
      return { gone: value.gone };
    }
    case 'HIGHLIGHTS': {
      const value = output as z.infer<(typeof CLIP_JOB_OUTPUT_SCHEMAS)['HIGHLIGHTS']>;
      return { found: value.found };
    }
    case 'RENDER': {
      const value = output as z.infer<(typeof CLIP_JOB_OUTPUT_SCHEMAS)['RENDER']>;
      return {
        mediaId: value.mediaId,
        durationMs: value.durationMs,
        hasPreview: value.proofKey !== null,
      };
    }
    case 'DOWNLOAD': {
      const value = output as z.infer<(typeof CLIP_JOB_OUTPUT_SCHEMAS)['DOWNLOAD']>;
      return { bytes: value.bytes, fileName: value.fileName };
    }
    // Sprint 13. Numbers and flags only: never a word of what was said, never a key.
    case 'TRANSCRIBE': {
      const value = output as z.infer<(typeof CLIP_JOB_OUTPUT_SCHEMAS)['TRANSCRIBE']>;
      return { language: value.language, wordCount: value.wordCount, noSpeech: value.noSpeech };
    }
    case 'FACES': {
      const value = output as z.infer<(typeof CLIP_JOB_OUTPUT_SCHEMAS)['FACES']>;
      return { found: value.found, sampled: value.sampled };
    }
    case 'TRANSLATE': {
      const value = output as z.infer<(typeof CLIP_JOB_OUTPUT_SCHEMAS)['TRANSLATE']>;
      return { wordCount: value.wordCount };
    }
    case 'SPEECH': {
      const value = output as z.infer<(typeof CLIP_JOB_OUTPUT_SCHEMAS)['SPEECH']>;
      // Module 09: the made voice's sound id, which the editor adds as `{ asset: assetId }`.
      return { assetId: value.assetId, durationMs: value.durationMs };
    }
    case 'AUTO_EDIT': {
      const value = output as z.infer<(typeof CLIP_JOB_OUTPUT_SCHEMAS)['AUTO_EDIT']>;
      // Module 10: the clip to open, and what the recipe left out (part and reason, never words).
      return {
        clipId: value.clipId,
        skipped: value.skipped.map((skip) => ({ part: skip.part, reason: skip.reason })),
        noSpeech: value.noSpeech,
      };
    }
  }
}

/**
 * The step, only when it is one of the kind's steps from the contract. Any
 * other text on the row (a bug, or a row changed by hand) reads as none, so
 * it never reaches a page (security sweep, Module 20).
 */
function stageOf(kind: ClipJobKind, stage: string | null): string | null {
  if (stage === null) return null;
  return (CLIP_JOB_STAGES[kind] as readonly string[]).includes(stage) ? stage : null;
}

/** Whether a RENDER job is a Preview Export (its input says so). */
function isProof(job: Pick<ClipJob, 'kind' | 'input'>): boolean {
  if (job.kind !== 'RENDER' || !job.input || typeof job.input !== 'object') return false;
  return (job.input as { proof?: unknown }).proof === true;
}

export function toJobView(
  job: ClipJob,
  eta: { samples: readonly ProgressSample[]; priorSeconds: number | null } | null = null,
): ClipJobView {
  const running = job.status === 'RUNNING';
  const stage = stageOf(job.kind, job.stage);
  return {
    id: job.id,
    kind: job.kind,
    status: job.status,
    stage,
    stageLabel: jobLabel(job.kind, job.status, stage, { proof: isProof(job) }),
    progress: Math.max(0, Math.min(100, Math.round(job.progress))),
    etaSeconds: running && eta ? estimateEtaSeconds(eta.samples, eta.priorSeconds) : null,
    videoId: job.videoId,
    clipId: job.clipId,
    error: job.status === 'FAILED' || job.status === 'CANCELLED' ? errorOf(job.error) : null,
    result: job.status === 'DONE' ? resultOf(job.kind, job.output) : null,
    createdAt: job.createdAt.toISOString(),
    // On a QUEUED import, `startedAt` is the claim on an import slot (see
    // `claimWaitingImports`), not a start: the view says it has not started.
    startedAt: job.status === 'QUEUED' ? null : (job.startedAt?.toISOString() ?? null),
    finishedAt: job.finishedAt?.toISOString() ?? null,
  };
}

/** The middle value, or null for none: a workspace's typical job length. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] as number)
    : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}
