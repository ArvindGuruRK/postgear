/**
 * When Retry From Here is offered on a failed step, and why it is disabled
 * (Module 08, WF-12.2, P1). A new run starts at the step with the earlier
 * steps' results, so it must only be offered where running the step again
 * cannot do harm twice: the step says it is safe to repeat (`retry:
 * 'safe'`), it does not make posts go out, and a live run still uses the
 * version that is live now.
 */
import { getDefinition } from '@postgear/automation';
import { ApiError } from '@/lib/api';
import type { AutomationRunMode, AutomationRunStatus, RunStep } from '@/types/workflows';
import { isTerminalRun } from './run-model';

export const RETRY_PUBLISHING =
  'Publishing steps cannot be retried from here. Start a new run instead.';
export const RETRY_NOT_SAFE =
  'This step cannot be safely run twice, so it cannot be retried from here. Start a new run instead.';
export const RETRY_OLD_VERSION = 'This run used an older version.';
export const RETRY_NOT_FAILED = 'Only a step that failed can be retried.';

export type RetryState =
  /** Not offered: the step did not fail, or the run is still going. */
  { show: false } | { show: true; enabled: true } | { show: true; enabled: false; reason: string };

export interface RetryInput {
  step: Pick<RunStep, 'status' | 'nodeType'>;
  run: { status: AutomationRunStatus; mode: AutomationRunMode; version: number | null };
  /** The version live runs use now. */
  activeVersion: number | null;
}

export function retryFromHereState({ step, run, activeVersion }: RetryInput): RetryState {
  if (step.status !== 'FAILED' || !isTerminalRun(run.status)) return { show: false };
  const definition = getDefinition(step.nodeType);
  if (definition?.publishes) return { show: true, enabled: false, reason: RETRY_PUBLISHING };
  if (definition?.retry !== 'safe') return { show: true, enabled: false, reason: RETRY_NOT_SAFE };
  if (run.mode === 'LIVE' && run.version !== activeVersion) {
    return { show: true, enabled: false, reason: RETRY_OLD_VERSION };
  }
  return { show: true, enabled: true };
}

/** The API's refusal in one sentence (it may know better than the browser did). */
export function retryErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'retry_old_version') return RETRY_OLD_VERSION;
    if (error.code === 'retry_step_not_failed') return RETRY_NOT_FAILED;
    if (error.code === 'retry_not_safe') return error.message || RETRY_NOT_SAFE;
    return error.message;
  }
  return 'The retry could not start. Try again in a moment.';
}
