/**
 * What the worker records about a channel's publish, for the UI to show.
 *
 * Stored as JSON in `Post.error` on the chain's root row. That column is a
 * free string inherited from the reference schema, which wrote raw provider
 * output into it; PostGear writes this structure instead so the queue can say
 * "attempt 2 of 5, retrying at 10:32" rather than dumping a stack trace.
 *
 * Every reader goes through `parsePublishStatus`, which treats anything it does
 * not recognise — including legacy plain text — as an opaque failure message.
 */
import type { PublishFailureReason } from './workflows';

export type PublishStatus =
  | {
      /**
       * Written just before the platform is called, and replaced by the
       * attempt's outcome. If a retry finds it still here, the previous
       * attempt died mid-call and the outcome is unknown — see
       * `interrupted` in `PublishFailureReason`.
       */
      kind: 'in_flight';
      attempt: number;
      startedAt: string;
    }
  | {
      kind: 'retrying';
      /** 1-based number of the attempt that just failed. */
      attempt: number;
      maxAttempts: number;
      /** ISO instant of the next attempt. */
      nextAttemptAt: string;
      /** Why the attempt failed, written for the person who scheduled the post. */
      message: string;
      updatedAt: string;
    }
  | {
      kind: 'failed';
      reason: PublishFailureReason;
      message: string;
      /** How many attempts were made before giving up. */
      attempts: number;
      failedAt: string;
    };

export function serializePublishStatus(status: PublishStatus): string {
  return JSON.stringify(status);
}

export function parsePublishStatus(raw: string | null | undefined): PublishStatus | null {
  if (!raw) {
    return null;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return legacy(raw);
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return legacy(raw);
  }

  const value = parsed as Record<string, unknown>;

  if (
    value.kind === 'in_flight' &&
    typeof value.attempt === 'number' &&
    typeof value.startedAt === 'string'
  ) {
    return { kind: 'in_flight', attempt: value.attempt, startedAt: value.startedAt };
  }

  if (
    value.kind === 'retrying' &&
    typeof value.attempt === 'number' &&
    typeof value.maxAttempts === 'number' &&
    typeof value.nextAttemptAt === 'string' &&
    typeof value.message === 'string'
  ) {
    return {
      kind: 'retrying',
      attempt: value.attempt,
      maxAttempts: value.maxAttempts,
      nextAttemptAt: value.nextAttemptAt,
      message: value.message,
      updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : value.nextAttemptAt,
    };
  }

  if (value.kind === 'failed' && typeof value.message === 'string') {
    return {
      kind: 'failed',
      reason: isFailureReason(value.reason) ? value.reason : 'unexpected',
      message: value.message,
      attempts: typeof value.attempts === 'number' ? value.attempts : 1,
      failedAt: typeof value.failedAt === 'string' ? value.failedAt : new Date(0).toISOString(),
    };
  }

  return legacy(raw);
}

const FAILURE_REASONS: readonly PublishFailureReason[] = [
  'needs_reconnect',
  'needs_permissions',
  'rejected',
  'retries_exhausted',
  'channel_unavailable',
  'interrupted',
  'unexpected',
];

export function isFailureReason(value: unknown): value is PublishFailureReason {
  return typeof value === 'string' && (FAILURE_REASONS as readonly string[]).includes(value);
}

/** A plain string, as the reference wrote, becomes a failure with that message. */
function legacy(raw: string): PublishStatus {
  return {
    kind: 'failed',
    reason: 'unexpected',
    message: raw.slice(0, 500),
    attempts: 1,
    failedAt: new Date(0).toISOString(),
  };
}
