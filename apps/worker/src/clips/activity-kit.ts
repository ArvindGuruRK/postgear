/**
 * The frame every long clip activity runs in.
 *
 * - **Heartbeats** every few seconds on a timer, whatever the step is doing,
 *   so a dead worker is noticed within the heartbeat timeout and a cancel
 *   reaches the activity quickly (Temporal delivers a cancel only in a
 *   heartbeat's answer; the clip workers also cap the heartbeat throttle).
 * - **Cancel**: `signal` is `Context.current().cancellationSignal`, handed to
 *   every tool, download and FFmpeg run, so a cancel kills the program tree.
 * - **Errors**: a cancel the workflow asked for is reported as a cancellation;
 *   a worker shutting down (or a reset, or a pause) is a retryable failure,
 *   so the next worker picks the job up; anything else goes through
 *   `clipFailure` and carries our code, never a tool's text.
 * - **Scratch**: `<jobId>_<attempt>`, so two attempts never share a folder.
 */
import { CLIP_FAILURE_TYPES } from '@postgear/scheduling';
import { Context } from '@temporalio/activity';
import { ApplicationFailure, CancelledFailure } from '@temporalio/common';
import { clipFailure } from './failures';

/** How often the timer heartbeats. Well under the heartbeat timeout; the SDK throttles sends. */
export const HEARTBEAT_EVERY_MS = 5_000;

export interface ActivityRun {
  /** Aborts when the workflow cancels the activity or the worker stops. */
  signal: AbortSignal;
  /** 1 for the first attempt. */
  attempt: number;
  /** An extra heartbeat (between files, for example). Never throws. */
  heartbeat(): void;
  /** The scratch folder name for this job and attempt. */
  scratchId(jobId: string): string;
}

export function scratchIdFor(jobId: string, attempt: number): string {
  return `${jobId}_${Math.max(1, Math.floor(attempt))}`;
}

/**
 * Runs `fn` with heartbeats and the cancel signal, and turns whatever it
 * throws into the failure Temporal should see.
 */
export async function runClipActivity<T>(
  activity: string,
  jobId: string | undefined,
  fn: (run: ActivityRun) => Promise<T>,
): Promise<T> {
  const context = Context.current();
  const heartbeat = (): void => {
    try {
      context.heartbeat();
    } catch {
      // Heartbeats are bookkeeping; a failed one is retried on the next tick.
    }
  };
  const timer = setInterval(heartbeat, HEARTBEAT_EVERY_MS);
  timer.unref?.();
  try {
    return await fn({
      signal: context.cancellationSignal,
      attempt: context.info.attempt,
      heartbeat,
      scratchId: (id) => scratchIdFor(id, context.info.attempt),
    });
  } catch (error) {
    throw activityFailure(error, context, activity, jobId);
  } finally {
    clearInterval(timer);
  }
}

/** The error an activity throws, given what it caught and why (if) it was stopped. */
export function activityFailure(
  error: unknown,
  context: Pick<Context, 'cancellationSignal' | 'cancellationDetails'>,
  activity: string,
  jobId: string | undefined,
): Error {
  if (context.cancellationSignal.aborted) {
    const details = context.cancellationDetails;
    if (!details || details.cancelRequested) {
      return new CancelledFailure('cancelled');
    }
    // The worker is stopping (or the activity was reset, paused or timed
    // out): not the person's cancel, so the next attempt may run it.
    console.warn(
      JSON.stringify({
        event: 'clips.activity.interrupted',
        activity,
        jobId,
        workerShutdown: details.workerShutdown,
        timedOut: details.timedOut,
      }),
    );
    return ApplicationFailure.create({
      message: `clip ${activity} interrupted`,
      type: CLIP_FAILURE_TYPES.retryable,
      nonRetryable: false,
      details: [{ code: 'tool_failed' }],
    });
  }
  return clipFailure(error, { activity, jobId });
}
