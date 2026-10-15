/**
 * Helpers shared by every provider's `SocialAnalytics` implementation.
 *
 * Each platform reports metrics in its own shape — X hands back per-post
 * counters, LinkedIn daily buckets keyed by epoch milliseconds, Meta buckets
 * keyed by an `end_time`, Pinterest by a date string — but three things are
 * the same everywhere, and they are the things that go subtly wrong when
 * each provider does them itself: a day is a **UTC calendar day**, a window
 * is "the last N days ending today", and per-item counters have to be summed
 * into those days. So those live here, and a provider's analytics method is
 * mostly the platform's field names.
 *
 * ## Why per-post counters are bucketed by publish day
 *
 * X and YouTube expose no per-day channel series to an ordinary app (X's is
 * behind a paid tier; YouTube's needs the separate Analytics API and a scope
 * the connect flow does not ask for). What they do expose is each post's
 * lifetime counters, so a provider sums those into the day each post went
 * out. That is "what the content published on this day has earned so far",
 * re-read on every sync so the number keeps up — the honest series those
 * platforms allow, and the same thing their own dashboards show.
 */
import { ProviderError } from './errors';
import {
  type ChannelMetricName,
  type ChannelMetricPoint,
  isChannelMetricName,
} from './social.provider.interface';

export const DAY_MS = 24 * 60 * 60_000;

/** The most days any provider is asked for; a window past this is clamped, not refused. */
export const MAX_ANALYTICS_DAYS = 366;

/** One metric on one day before summing. The same shape as a point, by design. */
export interface MetricEntry {
  metric: ChannelMetricName;
  date: string;
  value: number;
}

/** `YYYY-MM-DD` in UTC, or an empty string for a value that is not a date. */
export function dayKey(value: Date | number | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

export function todayKey(now: number = Date.now()): string {
  return dayKey(now);
}

/** The UTC midnight that starts the day `value` falls in. */
export function utcMidnight(value: Date | number): Date {
  const date = value instanceof Date ? value : new Date(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** A whole number of days between 1 and `max`; anything unusable becomes 1. */
export function clampDays(days: number, max: number = MAX_ANALYTICS_DAYS): number {
  if (!Number.isFinite(days)) {
    return 1;
  }
  return Math.min(max, Math.max(1, Math.floor(days)));
}

/**
 * The UTC midnight that starts a window of `days` days ending today, so a
 * window of 1 is today alone and a window of 7 is today and the six days
 * before it.
 */
export function windowStart(days: number, now: number = Date.now()): Date {
  return new Date(utcMidnight(now).getTime() - (clampDays(days) - 1) * DAY_MS);
}

/**
 * A platform counter as a number. Google returns statistics as strings, Meta
 * sometimes as objects, and a missing counter should read as nothing rather
 * than as `NaN` poisoning a sum.
 */
export function asCount(value: unknown): number {
  const number = typeof value === 'string' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) && number >= 0 ? number : 0;
}

/**
 * Sums entries into one point per metric per day.
 *
 * Levels (`followers`) are expected once per day, so summing leaves them
 * alone; flows from several posts on one day add up. Entries with an unknown
 * metric or no usable date are dropped rather than failing the sync — a
 * platform adding a field must never cost a channel its metrics.
 */
export function sumByDay(entries: Iterable<MetricEntry>): ChannelMetricPoint[] {
  const totals = new Map<string, ChannelMetricPoint>();

  for (const entry of entries) {
    if (!isChannelMetricName(entry.metric) || !entry.date || !Number.isFinite(entry.value)) {
      continue;
    }

    const key = `${entry.metric}|${entry.date}`;
    const existing = totals.get(key);

    if (existing) {
      existing.value += entry.value;
    } else {
      totals.set(key, { metric: entry.metric, date: entry.date, value: entry.value });
    }
  }

  return [...totals.values()].sort(
    (a, b) => a.date.localeCompare(b.date) || a.metric.localeCompare(b.metric),
  );
}

/**
 * Whether a provider failure means the thing asked for is gone — a post
 * deleted on the platform. `postAnalytics` answers null for those rather
 * than failing the sync, because a deleted post is not an error.
 */
export function isNotFound(error: unknown): boolean {
  return error instanceof ProviderError && error.status === 404;
}
