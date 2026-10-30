/**
 * A failed step in words (Module 08, blueprint 7.3): what to do next, and
 * the plain text block **Copy Details** puts on the clipboard for support
 * (workflow, run, step, error code, time). Pure, so both are unit tested.
 */
import type { RunStep, RunStepError } from '@/types/workflows';

/** The next step for a failure, by the code the worker stored. */
const NEXT_STEP: Record<string, string> = {
  not_connected: 'Reconnect the app in Connections, then test the workflow again.',
  out_of_credits: 'Add credits in Billing, then run the workflow again.',
  limit: 'This run reached a limit. Make the workflow do less in one run, then try again.',
  timeout: 'The app may be slow right now. Try again later, or make the step do less.',
  temporary: 'This is often temporary. Try again in a few minutes.',
  unexpected: 'Try again. If it keeps happening, copy the details and send them to support.',
};

const FIX_THE_STEP = 'Check the step in the Editor, fix what it says, then test again.';

export function failureNextStep(error: Pick<RunStepError, 'code' | 'retryable'> | null): string {
  if (!error) return FIX_THE_STEP;
  return NEXT_STEP[error.code] ?? (error.retryable ? NEXT_STEP.temporary : FIX_THE_STEP);
}

/** The first sentence of a message: errors read as one sentence. */
export function oneSentence(message: string): string {
  const trimmed = message.trim();
  const end = trimmed.search(/[.!?](\s|$)/);
  return end === -1 ? trimmed : trimmed.slice(0, end + 1);
}

export interface CopyDetailsInput {
  workflowName: string;
  runId: string;
  step: Pick<RunStep, 'nodeKey' | 'nodeName' | 'error' | 'finishedAt' | 'updatedAt' | 'attempts'>;
}

/** The block Copy Details copies: one fact per line, nothing secret. */
export function copyDetailsText({ workflowName, runId, step }: CopyDetailsInput): string {
  const at = step.finishedAt ?? step.updatedAt;
  const date = at ? new Date(at) : null;
  const time = date && !Number.isNaN(date.getTime()) ? date.toISOString() : 'Unknown';
  return [
    `Workflow: ${workflowName}`,
    `Run: ${runId}`,
    `Step: ${step.nodeName} (${step.nodeKey})`,
    `Error code: ${step.error?.code ?? 'none'}`,
    `Time: ${time}`,
    `Attempts: ${step.attempts}`,
    `Message: ${step.error?.message ?? 'No message'}`,
  ].join('\n');
}
