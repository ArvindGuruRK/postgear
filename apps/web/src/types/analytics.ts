/**
 * Analytics shapes, mirroring what `/analytics/*` returns (Sprint 7).
 *
 * Declared here rather than imported from the API or `@postgear/social-core`'s
 * root, for the reason `channel.ts` gives: nothing server-side reaches the
 * browser bundle. The API's `analytics.service.ts` is the source; keep the
 * two in step.
 *
 * ## Levels and flows
 *
 * `followers` is a level — the count on a day — so a range shows its latest
 * value and the change since the range began. Every other metric is a flow —
 * what happened on a day — so a range shows its sum and the change against
 * the same-length period before it.
 */

export type AnalyticsRange = 7 | 30 | 90;

export const ANALYTICS_RANGES: readonly AnalyticsRange[] = [7, 30, 90] as const;

export function isAnalyticsRange(value: unknown): value is AnalyticsRange {
  return value === 7 || value === 30 || value === 90;
}

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

export interface MetricPoint {
  /** `YYYY-MM-DD`, UTC. */
  date: string;
  value: number;
}

/** One metric over the range, with the previous period for comparison. */
export interface MetricSeries {
  metric: ChannelMetric;
  /** One point per day of the range; days the platform reported nothing for carry 0. */
  points: MetricPoint[];
  /** Flows: the sum over the range. Levels (`followers`): the latest value. */
  total: number;
  /**
   * Flows: the sum over the previous period of the same length. Levels: the
   * value at the start of the range. Null when nothing was recorded then.
   */
  previous: number | null;
  /** Days inside the range that have a recorded value. */
  recordedDays: number;
}

/** A change against the previous period, for the delta badge on a stat. */
export interface MetricChange {
  /** The current figure (sum, or latest level). */
  value: number;
  /** Absolute change against `previous`; null when there is no previous period to compare. */
  delta: number | null;
  /** `delta / previous`, as a percentage; null when `previous` is 0 or missing. */
  percent: number | null;
}

/** Whether this channel's platform can be synced at all, and how the last sync went. */
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
  /** `engagements / impressions * 100`; null when there were no impressions. */
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

/** One entry of the leaderboard. */
export interface TopPost {
  rank: number;
  group: string;
  /** The root row of the channel's chain — what the snapshot is keyed on. */
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
  /** Published posts with synced metrics inside the range, across the shown channels. */
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
  comparison: Partial<Record<PostMetricKey | 'engagements' | 'engagementRate', Comparison>>;
  /** Every snapshot, oldest first, for the engagement-over-time line. */
  history: { capturedAt: string; metrics: PostMetrics }[];
}

/** `GET /analytics/posts/:group`. */
export interface PostAnalytics {
  group: string;
  publishDate: string;
  preview: string;
  state: 'DRAFT' | 'QUEUE' | 'PUBLISHED' | 'ERROR';
  channels: PostChannelAnalytics[];
}

/** `GET /analytics/sync`. */
export interface AnalyticsSyncOverview {
  /** The scheduler answered; null `workerOnline` when it did not. */
  reachable: boolean;
  workerOnline: boolean | null;
  simulated: boolean;
  channels: ChannelSyncStatus[];
}

/** `POST /analytics/sync` body and reply. */
export interface SyncNowRequest {
  channelId?: string;
}

export interface SyncNowResult {
  /** False when the scheduler could not be reached; the request was logged, not queued. */
  requested: boolean;
  /** How many channels were asked to sync. */
  channels: number;
}

export const METRIC_LABELS: Record<ChannelMetric, string> = {
  followers: 'Followers',
  impressions: 'Impressions',
  reach: 'Reach',
  engagements: 'Engagements',
  likes: 'Likes',
  comments: 'Comments',
  shares: 'Shares',
  clicks: 'Clicks',
  views: 'Views',
};

export const POST_METRIC_LABELS: Record<PostMetricKey, string> = {
  impressions: 'Impressions',
  likes: 'Likes',
  comments: 'Comments',
  shares: 'Shares',
  clicks: 'Clicks',
  saves: 'Saves',
  views: 'Views',
};
