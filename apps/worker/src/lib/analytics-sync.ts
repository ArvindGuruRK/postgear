/**
 * The pure parts of the analytics sync activity, so they can be tested
 * without a database or a Temporal environment: turning a provider's points
 * into the rows to write, and turning a failure into the row the status
 * line shows.
 *
 * ## Messages are composed here, never copied from the platform
 *
 * `AnalyticsSync.lastError` is shown to the user as-is, so what goes into
 * it is chosen by *class* of failure. A provider's `providerBody` — the
 * platform's own response — is diagnostic and goes only to the log; it can
 * contain the request that caused it, and on some platforms an echo of the
 * token. The provider's own `message` is safe by the contract in
 * `social.abstract.ts` (every message there is written by PostGear), and is
 * used for the one class where it says something useful: a bad request.
 */
import {
  BadBodyError,
  type ChannelMetricPoint,
  isChannelMetricName,
  NotEnoughScopesError,
  RefreshTokenError,
  RetryableError,
} from '@postgear/social-core';

export interface SnapshotRow {
  organizationId: string;
  integrationId: string;
  metric: string;
  /** UTC midnight of the day. */
  date: Date;
  value: number;
}

/** Upserts per transaction. Keeps each statement well inside Postgres's parameter limit. */
export const UPSERT_BATCH_SIZE = 200;

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The rows for a provider's points: validated, one per (metric, day) with
 * the last point winning, oldest first. A point with an unknown metric or
 * an unparseable day is dropped rather than failing the sync.
 */
export function planUpserts(
  points: ChannelMetricPoint[],
  ids: { organizationId: string; integrationId: string },
): SnapshotRow[] {
  const rows = new Map<string, SnapshotRow>();

  for (const point of points) {
    if (
      !isChannelMetricName(point.metric) ||
      !DAY_KEY.test(point.date) ||
      !Number.isFinite(point.value) ||
      point.value < 0
    ) {
      continue;
    }

    const date = new Date(`${point.date}T00:00:00.000Z`);

    if (Number.isNaN(date.getTime())) {
      continue;
    }

    rows.set(`${point.metric}|${point.date}`, {
      organizationId: ids.organizationId,
      integrationId: ids.integrationId,
      metric: point.metric,
      date,
      value: point.value,
    });
  }

  return [...rows.values()].sort(
    (a, b) => a.date.getTime() - b.date.getTime() || a.metric.localeCompare(b.metric),
  );
}

/** How many distinct days the rows cover — what the status line calls `channelDays`. */
export function distinctDays(rows: SnapshotRow[]): number {
  return new Set(rows.map((row) => row.date.getTime())).size;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }

  return batches;
}

export interface SafeFailure {
  status: 'FAILED' | 'NEEDS_RECONNECT' | 'NEEDS_PERMISSIONS';
  /** Already safe to show. */
  message: string;
  /** True when the activity should be retried by Temporal's policy. */
  retry: boolean;
}

/**
 * What a failed sync writes, by class of failure.
 *
 * Only a transient failure (or an unclassified one, which is more likely a
 * platform having a bad minute than a bug) is retried; the others need a
 * person — to reconnect, to re-consent — and retrying would just repeat
 * the same answer every thirty seconds.
 */
export function safeFailure(error: unknown, channelName: string): SafeFailure {
  if (error instanceof RefreshTokenError) {
    return {
      status: 'NEEDS_RECONNECT',
      message: `${channelName} needs reconnecting before its metrics can be read.`,
      retry: false,
    };
  }
  if (error instanceof NotEnoughScopesError) {
    return {
      status: 'NEEDS_PERMISSIONS',
      message: `${channelName} has not granted PostGear permission to read its metrics. Reconnect it and approve every requested permission.`,
      retry: false,
    };
  }
  if (error instanceof BadBodyError) {
    return { status: 'FAILED', message: error.message, retry: false };
  }
  if (error instanceof RetryableError) {
    return {
      status: 'FAILED',
      message: `${channelName} could not be reached. PostGear will try again.`,
      retry: true,
    };
  }

  return {
    status: 'FAILED',
    message: `Reading ${channelName}'s metrics failed unexpectedly. PostGear will try again.`,
    retry: true,
  };
}
