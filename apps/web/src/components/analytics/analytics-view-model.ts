/**
 * What the analytics page shows, computed from what the API returns: pure,
 * so every judgement the page makes about a number is testable without React.
 *
 * The API (`apps/web/src/types/analytics.ts`) already does the arithmetic:
 * sums, deltas, percentages, averages, above/below. What is left to the web
 * is *presentation*: how a delta becomes a trend badge or a "No change"
 * caption, which metrics are worth a tab, how a channel's sync standing
 * becomes one badge, how the fleet's standing becomes one pill, and how an
 * instant becomes "2h ago". Each of those is a small decision that would be
 * wrong silently if it lived inline in JSX, so each is a function here with
 * a test next to it.
 *
 * Numbers are formatted in the viewer's locale (thousands separators follow
 * it), which is why the page only renders them after mount: see
 * `use-mounted.ts` for the hydration reason.
 */
import type { BadgeProps, TrendSeries, TrendTone } from '@postgear/ui';
import type {
  AnalyticsOverview,
  AnalyticsRange,
  AnalyticsSyncOverview,
  ChannelAnalytics,
  ChannelMetric,
  ChannelSyncStatus,
  Comparison,
  MetricChange,
  MetricPoint,
  PostMetricKey,
  PostMetrics,
} from '@/types/analytics';
import { isAnalyticsRange, METRIC_LABELS, POST_METRIC_KEYS } from '@/types/analytics';

export const DEFAULT_RANGE: AnalyticsRange = 30;

/** The filters the page keeps in the URL: `?range=7&channel=<id>`. */
export interface AnalyticsFilters {
  range: AnalyticsRange;
  channelId: string | null;
}

export function filtersFromParams(params: URLSearchParams): AnalyticsFilters {
  const range = Number(params.get('range'));
  return {
    range: isAnalyticsRange(range) ? range : DEFAULT_RANGE,
    channelId: params.get('channel') || null,
  };
}

/** Only what differs from the defaults, so the plain `/analytics` URL stays plain. */
export function paramsFromFilters(filters: AnalyticsFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.range !== DEFAULT_RANGE) params.set('range', String(filters.range));
  if (filters.channelId) params.set('channel', filters.channelId);
  return params;
}

/** The query `GET /analytics/overview` and `GET /analytics/export` take. */
export function apiQuery(filters: AnalyticsFilters): URLSearchParams {
  const params = new URLSearchParams({ range: String(filters.range) });
  if (filters.channelId) params.set('channelId', filters.channelId);
  return params;
}

/**
 * The CSV lives behind a full navigation, not a fetch: the browser's own
 * download handling shows the file, and the session cookie travels because
 * the API is the same host (see `lib/api.ts`).
 */
export function exportUrl(baseUrl: string, filters: AnalyticsFilters): string {
  return `${baseUrl}/analytics/export?${apiQuery(filters).toString()}`;
}

/** `1,204` in the viewer's locale; a dash for nothing. */
export function formatMetric(value: number | null | undefined, locale?: string): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '–';
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value);
}

/** `3.4%`; a dash when there were no impressions to divide by. */
export function formatPercent(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '–';
  return `${value.toFixed(digits)}%`;
}

/** `+1,204` / `−37`: a delta with its sign, in the viewer's locale. */
export function formatDelta(delta: number, locale?: string): string {
  const sign = delta > 0 ? '+' : delta < 0 ? '−' : '';
  return `${sign}${formatMetric(Math.abs(delta), locale)}`;
}

export type Trend =
  /** A real move, shown as the stat card's arrow. */
  | { kind: 'trend'; value: string; direction: 'up' | 'down' }
  /** The number is exactly where it was: a quiet caption, not a flat arrow. */
  | { kind: 'even'; caption: string }
  /** No previous period to compare with (the channel is new, or the data is). */
  | { kind: 'none' };

/**
 * The trend badge for a stat. Percent when the previous period lets one be
 * computed, the absolute delta otherwise (a channel that had 0 impressions
 * last month and 400 this month has no percentage, but "+400" is still
 * worth saying).
 */
export function trendFor(change: MetricChange | null | undefined, locale?: string): Trend {
  if (!change || change.delta === null) return { kind: 'none' };
  if (change.delta === 0) return { kind: 'even', caption: 'No change' };
  const direction = change.delta > 0 ? 'up' : 'down';
  if (change.percent !== null && Number.isFinite(change.percent)) {
    return { kind: 'trend', direction, value: `${Math.abs(change.percent).toFixed(1)}%` };
  }
  return { kind: 'trend', direction, value: formatMetric(Math.abs(change.delta), locale) };
}

/** The metrics worth a tab on the trend chart, in the order they get one. */
export const CHART_METRICS: readonly ChannelMetric[] = [
  'impressions',
  'engagements',
  'followers',
  'reach',
  'clicks',
] as const;

/** Only the chart metrics any shown channel actually reported. */
export function metricsAvailable(overview: AnalyticsOverview): ChannelMetric[] {
  const present = new Set<ChannelMetric>();
  for (const channel of overview.channels) {
    for (const series of channel.series) {
      if (series.points.length > 0) present.add(series.metric);
    }
  }
  return CHART_METRICS.filter((metric) => present.has(metric));
}

/**
 * One tone per channel, cycling through the system's action colours by the
 * channel's position in the overview, so a channel keeps its colour across
 * the chart, the bar list and the legend on the same page.
 */
export const CHANNEL_TONES: readonly TrendTone[] = [
  'primary',
  'ai',
  'accent',
  'success',
  'secondary',
  'danger',
] as const;

export function toneForIndex(index: number): TrendTone {
  return CHANNEL_TONES[
    ((index % CHANNEL_TONES.length) + CHANNEL_TONES.length) % CHANNEL_TONES.length
  ];
}

/** One line per channel for the trend chart; channels without the metric are left out. */
export function seriesForMetric(
  overview: AnalyticsOverview,
  metric: ChannelMetric,
  channelId: string | null = null,
): TrendSeries[] {
  const lines: TrendSeries[] = [];
  overview.channels.forEach((channel, index) => {
    if (channelId && channel.channelId !== channelId) return;
    const series = channel.series.find((entry) => entry.metric === metric);
    if (!series || series.points.length === 0) return;
    lines.push({
      id: channel.channelId,
      label: channel.name,
      tone: toneForIndex(index),
      points: series.points.map((point) => ({ x: point.date, y: point.value })),
    });
  });
  return lines;
}

/**
 * One metric across every shown channel, by day, oldest first: what a stat
 * card's sparkline draws. Each channel's value on a day is added up (for
 * followers, a level, that is the audience across the channels that day).
 */
export function combinedPoints(overview: AnalyticsOverview, metric: ChannelMetric): MetricPoint[] {
  const byDate = new Map<string, number>();
  for (const channel of overview.channels) {
    const series = channel.series.find((entry) => entry.metric === metric);
    for (const point of series?.points ?? []) {
      byDate.set(point.date, (byDate.get(point.date) ?? 0) + point.value);
    }
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, value]) => ({ date, value }));
}

/**
 * The engagement rate by day across the shown channels, as percentages; null
 * on a day with no impressions (no rate rather than a fake 0%).
 */
export function engagementRatePoints(overview: AnalyticsOverview): (number | null)[] {
  const engagements = new Map(
    combinedPoints(overview, 'engagements').map((point) => [point.date, point.value]),
  );
  return combinedPoints(overview, 'impressions').map((point) =>
    point.value > 0 ? ((engagements.get(point.date) ?? 0) / point.value) * 100 : null,
  );
}

/**
 * One metric's figure for the range across the shown channels, with its move
 * against the previous period: the number in the Performance header. Channels
 * with no previous figure are left out of the comparison, and when none has
 * one there is nothing to compare.
 */
export function metricSummary(overview: AnalyticsOverview, metric: ChannelMetric): MetricChange {
  let value = 0;
  let previous: number | null = null;
  for (const channel of overview.channels) {
    const series = channel.series.find((entry) => entry.metric === metric);
    if (!series) continue;
    value += series.total;
    if (series.previous !== null) previous = (previous ?? 0) + series.previous;
  }
  if (previous === null) return { value, delta: null, percent: null };
  const delta = value - previous;
  return { value, delta, percent: previous === 0 ? null : (delta / previous) * 100 };
}

/** One channel's part of a metric, for the By Channel panel beside the chart. */
export interface ChannelShare {
  channel: ChannelAnalytics;
  /** The channel's colour on this page (its position in the overview). */
  tone: TrendTone;
  value: number;
  /** Percent of the shown channels' total, 0 when the total is 0. */
  share: number;
}

/**
 * Each channel's figure for a metric, biggest first. Channels that never
 * reported the metric are left out: a 0% bar for a platform that cannot
 * count clicks would read as "no clicks".
 */
export function channelShares(overview: AnalyticsOverview, metric: ChannelMetric): ChannelShare[] {
  const rows: Omit<ChannelShare, 'share'>[] = [];
  overview.channels.forEach((channel, index) => {
    const series = channel.series.find((entry) => entry.metric === metric);
    if (!series || series.points.length === 0) return;
    rows.push({ channel, tone: toneForIndex(index), value: series.total });
  });
  const sum = rows.reduce((total, row) => total + row.value, 0);
  return rows
    .map((row) => ({ ...row, share: sum > 0 ? (row.value / sum) * 100 : 0 }))
    .sort((a, b) => b.value - a.value);
}

/**
 * Whether the channel picker should say "(no metrics)" beside a channel.
 *
 * The overview's own verdict wins: it knows simulation mode, where every
 * platform gets numbers, and a LinkedIn channel full of metrics was labelled
 * "(no metrics)" from the platform list alone (2026-10-22). Only before the
 * overview loads, or for a channel it does not list, does the platform list
 * decide.
 */
export function lacksMetrics(
  channel: { id: string; providerIdentifier: string },
  overview: AnalyticsOverview | null,
  supportedPlatforms: ReadonlySet<string>,
): boolean {
  const listed = overview?.channels.find((entry) => entry.channelId === channel.id);
  if (listed) return listed.support === 'unsupported';
  return !supportedPlatforms.has(channel.providerIdentifier);
}

/** How many top posts show before "Show All". */
export const TOP_POSTS_PREVIEW = 5;

/** "vs previous 30 days": what a trend is measured against. */
export function comparedTo(range: AnalyticsRange): string {
  return `vs previous ${range} days`;
}

/** The shape of a channel's impressions over the range, for the table's sparkline. */
export function sparklineFor(channel: ChannelAnalytics, metric: ChannelMetric = 'impressions') {
  const series = channel.series.find((entry) => entry.metric === metric);
  return series ? series.points.map((point) => point.value) : [];
}

/** True once anything at all was recorded: the page's "No metrics yet" gate. */
export function hasMetrics(overview: AnalyticsOverview): boolean {
  return (
    overview.topPosts.length > 0 ||
    overview.channels.some((channel) =>
      channel.series.some((series) => series.recordedDays > 0 || series.total > 0),
    )
  );
}

export const RANGE_LABELS: Record<AnalyticsRange, string> = {
  7: 'Last 7 days',
  30: 'Last 30 days',
  90: 'Last 90 days',
};

export function metricLabel(metric: ChannelMetric): string {
  return METRIC_LABELS[metric];
}

/**
 * "2h ago", "3d ago", "just now": the short form a table cell has room
 * for. Beyond a week the date itself says more than a count of days.
 */
export function relativeTime(iso: string | null | undefined, now: Date): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const diff = now.getTime() - date.getTime();
  const future = diff < 0;
  const abs = Math.abs(diff);
  const minutes = Math.round(abs / 60_000);
  const hours = Math.round(abs / 3_600_000);
  const days = Math.round(abs / 86_400_000);

  if (minutes < 1) return 'just now';
  if (days >= 7) {
    return date.toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
      ...(date.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
    });
  }
  const span = minutes < 60 ? `${minutes}m` : hours < 24 ? `${hours}h` : `${days}d`;
  return future ? `in ${span}` : `${span} ago`;
}

export interface SyncBadge {
  variant: NonNullable<BadgeProps['variant']>;
  label: string;
  /** Why, when the label alone does not say: shown as a tooltip. */
  explanation: string | null;
}

/**
 * One badge for a channel's analytics standing. The order is what the
 * person needs to act on first: a channel that needs reconnecting is
 * actionable whatever its platform supports; "Not supported" is final and
 * explained; "Never synced" is a wait, not a fault.
 */
export function syncBadge(
  channel: Pick<ChannelAnalytics, 'providerName' | 'support' | 'sync'>,
  now: Date,
): SyncBadge {
  const { support, sync } = channel;

  if (sync.status === 'needs_reconnect' || support === 'needs_reconnect') {
    return {
      variant: 'danger',
      label: 'Needs Reconnect',
      explanation: `${channel.providerName} no longer accepts the saved authorization. Reconnect the channel to resume syncing.`,
    };
  }
  if (sync.status === 'needs_permissions') {
    return {
      variant: 'danger',
      label: 'Needs Permissions',
      explanation:
        sync.error ??
        `The ${channel.providerName} account did not grant the permission its metrics need. Reconnect and accept it.`,
    };
  }
  if (support === 'needs_setup') {
    return {
      variant: 'outline',
      label: 'Finish Setup',
      explanation: 'The channel is not fully connected yet, so there is nothing to sync.',
    };
  }
  if (support === 'unsupported' || sync.status === 'unsupported') {
    return {
      variant: 'outline',
      label: 'Not Supported',
      explanation: `${channel.providerName} does not expose metrics PostGear can read, so this channel is listed without numbers.`,
    };
  }
  if (sync.status === 'failed') {
    return {
      variant: 'danger',
      label: 'Sync Failed',
      explanation:
        sync.error ?? 'The last sync did not finish. The worker retries on its next run.',
    };
  }
  if (sync.status === 'ok') {
    const when = relativeTime(sync.lastSyncedAt, now);
    return { variant: 'success', label: when ? `Synced ${when}` : 'Synced', explanation: null };
  }
  return {
    variant: 'secondary',
    label: 'Never Synced',
    explanation: 'The worker syncs metrics daily; use Sync now to fetch them straight away.',
  };
}

export type SyncPillStatus = 'online' | 'away' | 'busy' | 'pending';

export interface SyncPresentation {
  status: SyncPillStatus;
  label: string;
  explanation: string;
  /** One line per channel for the tooltip: "Acme Marketing: synced 2h ago". */
  lines: string[];
}

function channelLine(channel: ChannelSyncStatus, now: Date): string {
  const when = relativeTime(channel.lastSyncedAt, now);
  const standing =
    channel.status === 'ok'
      ? `synced ${when ?? 'recently'}`
      : channel.status === 'never'
        ? channel.support === 'unsupported'
          ? 'not supported'
          : 'never synced'
        : channel.status === 'failed'
          ? `failed${when ? ` (last good sync ${when})` : ''}`
          : channel.status === 'needs_reconnect'
            ? 'needs reconnect'
            : channel.status === 'needs_permissions'
              ? 'needs permissions'
              : 'not supported';
  return `${channel.name}: ${standing}`;
}

/**
 * The fleet's standing as one pill, reading the analytics sync the way a
 * status light would: online when every supported channel last synced fine, busy when
 * one needs a person (reconnect, permissions, a failure), away when nothing
 * has synced yet or nothing can run a sync, pending while the API is asked.
 */
export function syncPresentation(
  sync: AnalyticsSyncOverview | null | 'unknown',
  now: Date,
): SyncPresentation {
  if (sync === 'unknown') {
    return {
      status: 'pending',
      label: 'Checking Sync',
      explanation: 'Asking the API when each channel last synced.',
      lines: [],
    };
  }
  if (sync === null) {
    return {
      status: 'busy',
      label: 'Sync Status Unavailable',
      explanation: 'The API did not answer. Metrics shown are whatever was synced before.',
      lines: [],
    };
  }

  const lines = sync.channels.map((channel) => channelLine(channel, now));
  const supported = sync.channels.filter(
    (channel) => channel.support === 'supported' && channel.status !== 'unsupported',
  );
  const attention = sync.channels.filter(
    (channel) =>
      channel.status === 'failed' ||
      channel.status === 'needs_reconnect' ||
      channel.status === 'needs_permissions',
  );

  if (!sync.reachable) {
    return {
      status: 'away',
      label: 'Scheduler Unreachable',
      explanation:
        'The API cannot reach Temporal, so no sync can be queued. Metrics shown are whatever was synced before.',
      lines,
    };
  }
  if (sync.workerOnline === false) {
    return {
      status: 'away',
      label: 'No Worker Running',
      explanation:
        'Temporal is up but no PostGear worker is polling it. Start one (npm run dev:worker) or nothing syncs.',
      lines,
    };
  }
  if (attention.length > 0) {
    return {
      status: 'busy',
      label:
        attention.length === 1
          ? '1 channel needs attention'
          : `${attention.length} channels need attention`,
      explanation: 'A channel failed to sync or needs reconnecting. The table below says which.',
      lines,
    };
  }
  if (supported.length === 0) {
    return {
      status: 'away',
      label: 'Nothing To Sync',
      explanation:
        'None of the connected channels is on a platform PostGear can read metrics from.',
      lines,
    };
  }
  if (supported.every((channel) => channel.status === 'ok')) {
    const latest = supported
      .map((channel) => channel.lastSyncedAt)
      .filter((value): value is string => value !== null)
      .sort()
      .at(-1);
    const when = relativeTime(latest, now);
    return {
      status: 'online',
      label: when ? `Synced ${when}` : 'Metrics synced',
      explanation: `${sync.simulated ? 'Simulated metrics; ' : ''}every supported channel synced. The worker refreshes daily.`,
      lines,
    };
  }
  return {
    status: 'away',
    label: 'Not Synced Yet',
    explanation:
      'A supported channel has never synced. The worker runs daily; Sync now fetches straight away.',
    lines,
  };
}

/** The post metrics the dialog lays out: the four that always matter, plus any the platform reported. */
export function postMetricsToShow(
  metrics: PostMetrics,
  average: PostMetrics | null,
): PostMetricKey[] {
  const always: PostMetricKey[] = ['impressions', 'likes', 'comments', 'shares'];
  return POST_METRIC_KEYS.filter(
    (key) => always.includes(key) || metrics[key] > 0 || (average !== null && average[key] > 0),
  );
}

export function comparisonFor(
  comparison: Partial<Record<string, Comparison>>,
  key: string,
): Comparison | null {
  return comparison[key] ?? null;
}

/**
 * A fingerprint of what a sync would change, so a poll that finds nothing
 * new leaves the page alone rather than re-rendering every chart.
 */
export function syncFingerprint(overview: AnalyticsOverview): string {
  return [
    overview.totals.impressions.value,
    overview.totals.engagements.value,
    overview.totals.posts,
    ...overview.channels.map(
      (channel) => `${channel.channelId}:${channel.sync.lastSyncedAt ?? ''}`,
    ),
    ...overview.topPosts.map((post) => `${post.postId}:${post.capturedAt}`),
  ].join('|');
}
