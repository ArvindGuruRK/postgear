/**
 * What a failed live run tells the workspace (Module 09), inside the
 * transaction that finishes the run (`finalizeRun`), so a run is never
 * finished without its alert or alerted twice.
 *
 * ## Grouped failure alerts
 *
 * At most one alert per workflow per `AUTOMATION_FAILURE_ALERT_WINDOW_MS`:
 *
 * - no alert in the window: "{Workflow} failed at {step}: {reason}." (or,
 *   when failures were held back since the last one, "{Workflow} failed N
 *   more times since the last alert. Latest: at {step}: {reason}.");
 * - an alert in the window: no new row; its `meta.suppressed` counts this
 *   failure, and the next alert after the window reports it.
 *
 * The count lives in the alert's own `meta` (no schema change). The
 * transaction has already incremented `Automation.consecutiveFailures`, which
 * locks the workflow's row until commit, so two runs failing at once read
 * and write the alert one after the other.
 *
 * ## Auto-pause
 *
 * `AUTOMATION_AUTO_PAUSE_AFTER_FAILURES` failed live runs in a row (the
 * count resets on a succeeded live run; rejected, expired and cancelled runs
 * do not count either way) pause an active workflow and tell the workspace.
 * The caller deletes its Temporal Schedule after commit.
 */
import {
  AUTOMATION_AUTO_PAUSE_AFTER_FAILURES,
  AUTOMATION_FAILURE_ALERT_WINDOW_MS,
  AUTOMATION_NOTIFICATION_TYPES,
} from '@postgear/scheduling';
import { runLink } from './executors/in-app';
import type { RunStore } from './run-store';

export const FAILED_TITLE = 'Workflow failed';
export const PAUSED_TITLE = 'Workflow paused';
const NO_REASON = 'Open the run to see what happened.';

export interface LiveFailure {
  organizationId: string;
  automationId: string;
  runId: string;
  /** The failed step's name, when one step's failure ended the run. */
  stepName: string | null;
  /** The run's one sentence. */
  reason: string | null;
  finishedAt: Date;
}

/** A sentence with its full stop. */
function sentence(text: string): string {
  const trimmed = text.trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function where(failure: LiveFailure): string {
  const reason = sentence(failure.reason ?? NO_REASON);
  return failure.stepName ? `at ${failure.stepName}: ${reason}` : reason;
}

/** "Publishing Report failed at Slack: Slack refused the message." */
export function failureMessage(workflow: string, failure: LiveFailure): string {
  return failure.stepName
    ? `${workflow} failed ${where(failure)}`
    : `${workflow} failed: ${where(failure)}`;
}

/** "Publishing Report failed 4 more times since the last alert. Latest: at Slack: ..." */
export function groupedFailureMessage(
  workflow: string,
  times: number,
  failure: LiveFailure,
): string {
  return `${workflow} failed ${times} more times since the last alert. Latest: ${where(failure)}`;
}

export function pausedMessage(workflow: string): string {
  return `${workflow} was paused after ${AUTOMATION_AUTO_PAUSE_AFTER_FAILURES} failed runs in a row. Fix it and turn it back on.`;
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/**
 * Writes (or folds into the last) failure alert, and pauses the workflow at
 * the limit. Returns whether it paused it. Call it with the transaction's
 * store, after the failure was counted.
 */
export async function alertLiveFailure(
  tx: RunStore,
  failure: LiveFailure,
): Promise<{ paused: boolean }> {
  const automation = await tx.loadAutomation(failure.organizationId, failure.automationId);
  if (!automation) return { paused: false };
  const workflow = automation.name;
  const link = runLink(failure.organizationId, failure.automationId, failure.runId);

  const latest = await tx.latestNotification(
    failure.organizationId,
    AUTOMATION_NOTIFICATION_TYPES.failed,
    failure.automationId,
  );
  const inWindow =
    latest !== null &&
    failure.finishedAt.getTime() - latest.createdAt.getTime() < AUTOMATION_FAILURE_ALERT_WINDOW_MS;

  if (latest && inWindow) {
    await tx.updateNotificationMeta(failure.organizationId, latest.id, {
      ...latest.meta,
      suppressed: count(latest.meta.suppressed) + 1,
      latestRunId: failure.runId,
    });
  } else {
    const held = latest ? count(latest.meta.suppressed) : 0;
    await tx.createNotification({
      organizationId: failure.organizationId,
      type: AUTOMATION_NOTIFICATION_TYPES.failed,
      title: FAILED_TITLE,
      content:
        held > 0
          ? groupedFailureMessage(workflow, held + 1, failure)
          : failureMessage(workflow, failure),
      link,
      meta: {
        automationId: failure.automationId,
        automationName: workflow,
        runId: failure.runId,
        count: held + 1,
        suppressed: 0,
      },
      createdAt: failure.finishedAt,
    });
  }

  if (
    automation.deleted ||
    automation.status !== 'ACTIVE' ||
    automation.consecutiveFailures < AUTOMATION_AUTO_PAUSE_AFTER_FAILURES
  ) {
    return { paused: false };
  }

  const paused = await tx.pauseAutomation(failure.organizationId, failure.automationId);
  if (paused) {
    await tx.createNotification({
      organizationId: failure.organizationId,
      type: AUTOMATION_NOTIFICATION_TYPES.paused,
      title: PAUSED_TITLE,
      content: pausedMessage(workflow),
      link,
      meta: {
        automationId: failure.automationId,
        automationName: workflow,
        runId: failure.runId,
        failures: automation.consecutiveFailures,
      },
      createdAt: failure.finishedAt,
    });
  }
  return { paused };
}
