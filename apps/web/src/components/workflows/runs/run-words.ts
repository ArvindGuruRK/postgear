/**
 * Run and step statuses in words (Module 08, blueprint 7.3). Rejected and
 * Review Expired are outcomes, not failures, so they read neutral.
 */
import type { AutomationRunStatus } from '@/types/workflows';
import type { StepPaint, StepPaintState } from './run-model';

export type RunTone = 'neutral' | 'running' | 'waiting' | 'success' | 'danger';

export const RUN_STATUS: Record<AutomationRunStatus, { label: string; tone: RunTone }> = {
  QUEUED: { label: 'Queued', tone: 'running' },
  RUNNING: { label: 'Running', tone: 'running' },
  WAITING: { label: 'Waiting For Review', tone: 'waiting' },
  SUCCEEDED: { label: 'Succeeded', tone: 'success' },
  FAILED: { label: 'Failed', tone: 'danger' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
  REJECTED: { label: 'Rejected', tone: 'neutral' },
  EXPIRED: { label: 'Review Expired', tone: 'neutral' },
};

export const STEP_STATE_WORDS: Record<StepPaintState, string> = {
  queued: 'Queued',
  running: 'Running',
  waiting: 'Waiting For Review',
  succeeded: 'Succeeded',
  dryRun: 'Dry Run',
  handled: 'Error Handled',
  failed: 'Failed',
  skipped: 'Skipped',
  cancelled: 'Cancelled',
};

/** "Succeeded after 2 attempts", or the state's word alone. */
export function stepBadgeText(paint: Pick<StepPaint, 'state' | 'attempts'>): string {
  const word = STEP_STATE_WORDS[paint.state];
  return paint.attempts > 1 && paint.state !== 'running' && paint.state !== 'queued'
    ? `${word} after ${paint.attempts} attempts`
    : word;
}

/** "3.1 s", "420 ms", "2 min 5 s". */
export function formatDuration(ms: number | null): string {
  if (ms === null || ms < 0) return '';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return rest ? `${minutes} min ${rest} s` : `${minutes} min`;
}
