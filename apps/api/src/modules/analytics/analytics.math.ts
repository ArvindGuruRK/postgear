/**
 * The arithmetic behind the Analytics page, with nothing else in it: no
 * Prisma, no Nest, no clock it was not handed. Every number the page shows
 * (a range's series, a stat's delta, an engagement rate, "above average",
 * the CSV) is computed here from plain rows, so each can be pinned by a
 * unit test and the service is left with fetching and shaping.
 *
 * ## Days are UTC calendar days
 *
 * A range of N days is the last N UTC days ending today, inclusive, and the
 * previous period is the N days before it. The worker writes a metric's
 * day in UTC too (`abstract/analytics.ts` in social-core), so the two agree
 * without a timezone anywhere in between. A person's local day is a
 * presentation concern the page may take up later; the stored day is not.
 */
import type {
  AnalyticsOverview,
  AnalyticsRange,
  ChannelMetric,
  Comparison,
  MetricChange,
  MetricSeries,
  PostComparison,
  PostMetrics,
} from './analytics.types';

export const DAY_MS = 24 * 60 * 60_000;

/** Metrics that are a count on a day rather than what happened that day. */
export const LEVEL_METRICS: ReadonlySet<ChannelMetric> = new Set<ChannelMetric>(['followers']);

/** A difference of five percent either way reads as "about the same". */
export const EVEN_BAND = 0.05;

export interface RangeWindow {
  range: AnalyticsRange;
  /** Inclusive, `YYYY-MM-DD`. */
  from: string;
  to: string;
  previousFrom: string;
  previousTo: string;
  /** Every day of the range, oldest first. */
  days: string[];
}

/** One stored point, with its day already a key. */
export interface MetricRow {
  metric: string;
  date: string;
  value: number;
}

export function dayKey(value: Date | number): string {
  return new Date(value).toISOString().slice(0, 10);
}

export function utcMidnight(value: Date | number): Date {
  const date = new Date(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function rangeWindow(range: AnalyticsRange, now: number = Date.now()): RangeWindow {
  const today = utcMidnight(now).getTime();
  const fromMs = today - (range - 1) * DAY_MS;
  const days: string[] = [];

  for (let day = fromMs; day <= today; day += DAY_MS) {
    days.push(dayKey(day));
  }

  return {
    range,
    from: dayKey(fromMs),
    to: dayKey(today),
    previousFrom: dayKey(fromMs - range * DAY_MS),
    previousTo: dayKey(fromMs - DAY_MS),
    days,
  };
}

/**
 * A metric's series over the window, from its rows (any dates; only this
 * metric). Days without a row carry 0. A level's total is the latest value
 * inside the range and its previous is the value at the range start: the
 * latest recorded on or before the first day; a flow's are the two sums.
 */
export function buildSeries(
  metric: ChannelMetric,
  rows: MetricRow[],
  window: RangeWindow,
): MetricSeries {
  const byDay = new Map<string, number>();

  for (const row of rows) {
    byDay.set(row.date, row.value);
  }

  const points = window.days.map((date) => ({ date, value: byDay.get(date) ?? 0 }));
  const inRange = rows.filter((row) => row.date >= window.from && row.date <= window.to);

  if (LEVEL_METRICS.has(metric)) {
    const latest = latestRow(inRange) ?? latestRow(rows.filter((row) => row.date <= window.to));
    const atStart = latestRow(rows.filter((row) => row.date <= window.from));

    return {
      metric,
      points,
      total: latest?.value ?? 0,
      previous: atStart?.value ?? null,
      recordedDays: new Set(inRange.map((row) => row.date)).size,
    };
  }

  const before = rows.filter(
    (row) => row.date >= window.previousFrom && row.date <= window.previousTo,
  );

  return {
    metric,
    points,
    total: sum(inRange.map((row) => row.value)),
    previous: before.length === 0 ? null : sum(before.map((row) => row.value)),
    recordedDays: new Set(inRange.map((row) => row.date)).size,
  };
}

function latestRow(rows: MetricRow[]): MetricRow | undefined {
  let latest: MetricRow | undefined;

  for (const row of rows) {
    if (!latest || row.date > latest.date) {
      latest = row;
    }
  }

  return latest;
}

export function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

export function changeOf(value: number, previous: number | null): MetricChange {
  if (previous === null) {
    return { value, delta: null, percent: null };
  }

  const delta = value - previous;

  return {
    value,
    delta,
    percent: previous === 0 ? null : round((delta / previous) * 100, 1),
  };
}

export const NO_CHANGE: Readonly<MetricChange> = Object.freeze({
  value: 0,
  delta: null,
  percent: null,
});

/**
 * Adds changes across channels: the values summed, the delta summed over
 * the channels that have one, and the percent recomputed against their
 * summed previous. A channel with no previous period contributes its value
 * and nothing else: counting it as a gain from zero would read as growth
 * that never happened.
 */
export function sumChanges(changes: MetricChange[]): MetricChange {
  const value = sum(changes.map((change) => change.value));
  const withPrevious = changes.filter((change) => change.delta !== null);

  if (withPrevious.length === 0) {
    return { value, delta: null, percent: null };
  }

  const delta = sum(withPrevious.map((change) => change.delta ?? 0));
  const previous = sum(withPrevious.map((change) => change.value - (change.delta ?? 0)));

  return {
    value,
    delta,
    percent: previous === 0 ? null : round((delta / previous) * 100, 1),
  };
}

export function engagementRate(engagements: number, impressions: number): number | null {
  return impressions > 0 ? round((engagements / impressions) * 100, 2) : null;
}

export function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** Above or below an average, with a band either side that reads as even. */
export function comparisonOf(value: number, average: number): Comparison {
  if (average === 0) {
    return value > 0 ? 'above' : 'even';
  }

  const ratio = value / average;

  if (ratio > 1 + EVEN_BAND) {
    return 'above';
  }
  if (ratio < 1 - EVEN_BAND) {
    return 'below';
  }
  return 'even';
}

/** The stored counters of a snapshot. */
export interface SnapshotCounters {
  likes: number;
  comments: number;
  shares: number;
  clicks: number;
  impressions: number;
  saves: number;
  views: number;
}

export function postMetricsOf(row: SnapshotCounters): PostMetrics {
  const engagements = row.likes + row.comments + row.shares + row.saves;

  return {
    likes: row.likes,
    comments: row.comments,
    shares: row.shares,
    clicks: row.clicks,
    impressions: row.impressions,
    saves: row.saves,
    views: row.views,
    engagements,
    engagementRate: engagementRate(engagements, row.impressions),
  };
}

/** The per-post average of a set of snapshots (one per post), or null for none. */
export function averagePostMetrics(rows: SnapshotCounters[]): PostMetrics | null {
  if (rows.length === 0) {
    return null;
  }

  const mean = (pick: (row: SnapshotCounters) => number) =>
    round(sum(rows.map(pick)) / rows.length, 1);

  return postMetricsOf({
    likes: mean((row) => row.likes),
    comments: mean((row) => row.comments),
    shares: mean((row) => row.shares),
    clicks: mean((row) => row.clicks),
    impressions: mean((row) => row.impressions),
    saves: mean((row) => row.saves),
    views: mean((row) => row.views),
  });
}

export function comparePost(metrics: PostMetrics, average: PostMetrics): PostComparison {
  const comparison: PostComparison = {};

  for (const key of [
    'impressions',
    'likes',
    'comments',
    'shares',
    'clicks',
    'saves',
    'views',
    'engagements',
  ] as const) {
    comparison[key] = comparisonOf(metrics[key], average[key]);
  }

  if (metrics.engagementRate !== null && average.engagementRate !== null) {
    comparison.engagementRate = comparisonOf(metrics.engagementRate, average.engagementRate);
  }

  return comparison;
}

/** Leaderboard order: engagements, then engagement rate, then the newer post. */
export function compareTopPosts(
  a: { metrics: PostMetrics; publishDate: string },
  b: { metrics: PostMetrics; publishDate: string },
): number {
  return (
    b.metrics.engagements - a.metrics.engagements ||
    (b.metrics.engagementRate ?? -1) - (a.metrics.engagementRate ?? -1) ||
    b.publishDate.localeCompare(a.publishDate)
  );
}

/* ───────────────────────────── CSV ───────────────────────────── */

const CSV_NEWLINE = '\r\n';

/** RFC 4180: quote when needed, double the quotes inside. */
export function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);

  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvLine(cells: unknown[]): string {
  return cells.map(csvCell).join(',');
}

/**
 * The overview as a spreadsheet: a daily-metrics section (one row per
 * channel, metric and day) and a top-posts section, each with its own
 * header. Opens with a byte-order mark so Excel reads the UTF-8 names.
 */
export function renderCsv(overview: AnalyticsOverview): string {
  const lines: string[] = [];

  lines.push(csvLine(['section', 'channel', 'provider', 'date', 'metric', 'value']));

  for (const channel of overview.channels) {
    for (const series of channel.series) {
      for (const point of series.points) {
        lines.push(
          csvLine([
            'daily',
            channel.name,
            channel.providerIdentifier,
            point.date,
            series.metric,
            point.value,
          ]),
        );
      }
    }
  }

  lines.push('');
  lines.push(
    csvLine([
      'section',
      'rank',
      'channel',
      'provider',
      'published',
      'preview',
      'url',
      'impressions',
      'likes',
      'comments',
      'shares',
      'clicks',
      'saves',
      'views',
      'engagements',
      'engagement_rate',
    ]),
  );

  for (const post of overview.topPosts) {
    lines.push(
      csvLine([
        'top_posts',
        post.rank,
        post.channelName,
        post.providerIdentifier,
        post.publishDate,
        post.preview,
        post.releaseURL,
        post.metrics.impressions,
        post.metrics.likes,
        post.metrics.comments,
        post.metrics.shares,
        post.metrics.clicks,
        post.metrics.saves,
        post.metrics.views,
        post.metrics.engagements,
        post.metrics.engagementRate,
      ]),
    );
  }

  return `﻿${lines.join(CSV_NEWLINE)}${CSV_NEWLINE}`;
}

export function exportFilename(window: Pick<RangeWindow, 'from' | 'to'>): string {
  return `postgear-analytics-${window.from}-${window.to}.csv`;
}
