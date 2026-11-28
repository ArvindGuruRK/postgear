/**
 * Auto-Edit Video's words and sums (Sprint 13, Module 10, CA-6.4), apart
 * from React: the button's label with its price, the stretch it works on,
 * the job's steps in words and what a finished job says.
 */
import { CLIP_MAX_MS, type RecipeSkip } from '@postgear/video-engine';
import type { ClipJobView } from '@/types/clips';
import type { AutoEditOutput } from '@/types/clips-recipes';
import { minutesLabel } from '../setup/setup-model';
import { waitingLine } from '../waiting-words';

export const AUTO_EDIT_LABEL = 'Auto-Edit Video';
export const AUTO_EDIT_HELP =
  'Makes one clip of the whole video with a recipe applied, ready to open in the editor.';
export const AUTO_EDIT_TOO_LONG =
  'Auto-Edit works on up to 30 minutes at a time. Pick the part you want.';
export const NO_MINUTES_NEEDED = 'No AI minutes needed';
export const NO_SPEECH_NOTE = 'We could not hear anyone, so we only applied the shape.';
export const AUTO_EDIT_RUNNING = 'We are already auto-editing this video.';
export const AUTO_EDIT_DONE = 'Your clip is ready.';
export const LISTENING_STEP = 'Listening to what is said';
export const APPLYING_STEP = 'Applying your recipe';

/** "Auto-Edit Video (12 AI Minutes)", or plain when nothing needs listening (or while unknown). */
export function autoEditButtonLabel(aiMinutes: number | null): string {
  return aiMinutes !== null && aiMinutes > 0
    ? `${AUTO_EDIT_LABEL} (${minutesLabel(aiMinutes)})`
    : AUTO_EDIT_LABEL;
}

/** The stretch the dialog opens on: the whole video, or its first 30 minutes. */
export function initialAutoEditRange(durationMs: number): { fromMs: number; toMs: number } {
  return { fromMs: 0, toMs: Math.max(0, Math.min(Math.round(durationMs), CLIP_MAX_MS)) };
}

/** True when the video is longer than Auto-Edit takes at once (the range handles show). */
export function needsAutoEditRange(durationMs: number): boolean {
  return durationMs > CLIP_MAX_MS;
}

/** True when a chosen stretch is longer than Auto-Edit takes at once. */
export function rangeTooLong(range: { fromMs: number; toMs: number }): boolean {
  return range.toMs - range.fromMs > CLIP_MAX_MS;
}

/** The job's step in words; queued, the waiting line with its time (Module 15). */
export function autoEditStepLabel(
  job:
    | (Pick<ClipJobView, 'stage' | 'stageLabel'> & Partial<Pick<ClipJobView, 'status' | 'waiting'>>)
    | null,
): string {
  if (!job) return LISTENING_STEP;
  if (job.status === 'QUEUED')
    return waitingLine({ status: 'QUEUED', waiting: job.waiting ?? null });
  if (job.stage === 'listening') return LISTENING_STEP;
  if (job.stage === 'applying') return APPLYING_STEP;
  return job.stageLabel;
}

function isSkip(value: unknown): value is RecipeSkip {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as RecipeSkip).part === 'string' &&
    typeof (value as RecipeSkip).reason === 'string'
  );
}

/** What a finished AUTO_EDIT job made (its `result` is an `AutoEditOutput`), read defensively. */
export function autoEditOutputOf(
  job: Pick<ClipJobView, 'clipId' | 'result'>,
  fallbackClipId: string,
): AutoEditOutput {
  const result = (job.result ?? {}) as unknown as Partial<AutoEditOutput>;
  const skipped: RecipeSkip[] = Array.isArray(result.skipped)
    ? (result.skipped as unknown[]).filter(isSkip)
    : [];
  const clipId = typeof result.clipId === 'string' ? result.clipId : (job.clipId ?? fallbackClipId);
  return { clipId, skipped, noSpeech: result.noSpeech === true };
}
