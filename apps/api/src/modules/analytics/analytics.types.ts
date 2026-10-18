/**
 * What `/analytics/*` returns: the server-side copy of
 * `apps/web/src/types/analytics.ts`.
 *
 * Declared twice on purpose, for the reason every web type file gives: the
 * API's packages must never reach the browser bundle, and the browser's
 * files are not part of this program. This is the source; the web file
 * mirrors it, and the service spec asserts shapes against this one. Keep
 * the two in step: a field added here is a field the page can show.
 *
 * ## Levels and flows
 *
 * `followers` is a level (the count on a day), so a range shows its latest
 * value and the change since the range began. Every other metric is a flow
 * (what happened on a day), so a range shows its sum and the change against
 * the same-length period before it. `analytics.math.ts` is where that
 * distinction is applied.
 */
import type { State } from '@postgear/db';

export type AnalyticsRange = 7 | 30 | 90;

export type ChannelMetric =
  | 'followers'
  | 'impressions'
  | 'reach'
  | 'engagements'
  | 'likes'
  | 'comments'
  | 'shares'
  | 'clicks'
  | 'views';

/** In display order. The order the overview lists a channel's series in. */
export const CHANNEL_METRICS: readonly ChannelMetric[] = [
  'followers',
  'impressions',
  'reach',
  'engagements',
  'likes',
  'comments',
  'shares',
  'clicks',
  'views',
] as const;

export interface MetricPoint {
  /** `YYYY-MM-DD`, UTC. */
  date: string;
  value: number;
}

export interface MetricSeries {
  metric: ChannelMetric;
  /** One point per day of the range; days with nothing recorded carry 0. */
  points: MetricPoint[];
  /** Flows: the sum over the range. Levels: the latest value. */
  total: number;
  /** Flows: the previous period's sum. Levels: the value at the range start. Null when unrecorded. */
  previous: number | null;
  /** Days inside the range that have a recorded value. */
  recordedDays: number;
}

export interface MetricChange {
  value: number;
  /** Absolute change against the previous figure; null without one. */
  delta: number | null;
  /** `delta / previous`, as a percentage; null when `previous` is 0 or missing. */
  percent: number | null;
}

export type AnalyticsSupport = 'supported' | 'unsupported' | 'needs_reconnect' | 'needs_setup';

export type AnalyticsSyncState =
  | 'never'
  | 'ok'
  | 'failed'
  | 'unsupported'
  | 'needs_reconnect'
  | 'needs_permissions';

export interface ChannelSyncStatus {
  channelId: string;
  name: string;
  providerIdentifier: string;
  providerName: string;
  support: AnalyticsSupport;
  status: AnalyticsSyncState;
  lastSyncedAt: string | null;
  lastAttemptAt: string | null;
  /** Already safe to show. */
  error: string | null;
  channelDays: number;
  postsSynced: number;
}

export interface ChannelAnalytics {
  channelId: string;
  name: string;
  providerIdentifier: string;
  providerName: string;
  picture: string | null;
  profile: string | null;
  support: AnalyticsSupport;
  sync: Pick<ChannelSyncStatus, 'status' | 'lastSyncedAt' | 'error'>;
  followers: MetricChange | null;
  impressions: MetricChange;
  engagements: MetricChange;
  /** `engagements / impressions * 100`; null without impressions. */
  engagementRate: number | null;
  /** Published posts on this channel whose metrics were synced inside the range. */
  posts: number;
  /** Every metric the platform reported, one series each. */
  series: MetricSeries[];
}

export interface PostMetrics {
  likes: number;
  comments: number;
  shares: number;
  clicks: number;
  impressions: number;
  saves: number;
  views: number;
  /** likes + comments + shares + saves. */
  engagements: number;
  /** `engagements / impressions * 100`; null without impressions. */
  engagementRate: number | null;
}

export const POST_METRIC_KEYS = [
  'impressions',
  'likes',
  'comments',
  'shares',
  'clicks',
  'saves',
  'views',
] as const;

export type PostMetricKey = (typeof POST_METRIC_KEYS)[number];

export interface TopPost {
  rank: number;
  group: string;
  /** The root row of the channel's chain: what the snapshot is keyed on. */
  postId: string;
  channelId: string;
  channelName: string;
  providerIdentifier: string;
  providerName: string;
  picture: string | null;
  preview: string;
  publishDate: string;
  releaseURL: string | null;
  capturedAt: string;
  metrics: PostMetrics;
}

export interface AnalyticsTotals {
  followers: MetricChange | null;
  impressions: MetricChange;
  engagements: MetricChange;
  engagementRate: number | null;
  posts: number;
}

/** `GET /analytics/overview?range=&channelId=`. */
export interface AnalyticsOverview {
  range: AnalyticsRange;
  /** `YYYY-MM-DD`, inclusive. */
  from: string;
  to: string;
  generatedAt: string;
  /** Metrics come from a stand-in (`ANALYTICS_SIMULATION=true`), not the platforms. */
  simulated: boolean;
  totals: AnalyticsTotals;
  channels: ChannelAnalytics[];
  topPosts: TopPost[];
}

export type Comparison = 'above' | 'below' | 'even';

export type PostComparison = Partial<
  Record<PostMetricKey | 'engagements' | 'engagementRate', Comparison>
>;

export interface PostChannelAnalytics {
  channelId: string;
  name: string;
  providerIdentifier: string;
  providerName: string;
  picture: string | null;
  releaseURL: string | null;
  support: AnalyticsSupport;
  /** The latest snapshot; null when none has been taken yet. */
  metrics: PostMetrics | null;
  capturedAt: string | null;
  /** The channel's per-post average over the last 90 days, for "above/below average". */
  average: PostMetrics | null;
  comparison: PostComparison;
  /** Every snapshot, oldest first. */
  history: { capturedAt: string; metrics: PostMetrics }[];
}

/** `GET /analytics/posts/:group`. */
export interface PostAnalytics {
  group: string;
  publishDate: string;
  preview: string;
  state: State;
  channels: PostChannelAnalytics[];
}

/** `GET /analytics/sync`. */
export interface AnalyticsSyncOverview {
  reachable: boolean;
  workerOnline: boolean | null;
  simulated: boolean;
  channels: ChannelSyncStatus[];
}

/** `POST /analytics/sync`. */
export interface SyncNowResult {
  /** False when the scheduler could not be reached; the request was logged, not queued. */
  requested: boolean;
  /** How many channels were asked to sync. */
  channels: number;
}
