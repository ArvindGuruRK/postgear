/**
 * The analytics routes' logic: the overview, one post's figures, the sync
 * status line, "sync now", and the CSV.
 *
 * ## Nothing is fetched from a platform here
 *
 * The worker's `analyticsSyncWorkflow` reads the platforms and writes the
 * rows; this service only reads rows and shapes them. That is what keeps
 * the page fast and the API free of platform credentials: a request never
 * waits on LinkedIn, and a platform having a bad day shows up as a status
 * on the sync line, not as a 500.
 *
 * ## `support` is computed, not stored
 *
 * Whether a channel *can* be synced depends on its provider (does the
 * platform expose metrics?) and its health (can PostGear still talk to it?),
 * both of which the channels module already knows. In simulation every
 * platform is supported — the stand-in answers for all of them — which is
 * also what lets the seeded LinkedIn member channel, whose real provider
 * has no metrics, carry demo data honestly: the page says "simulated".
 */
import {
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isDocumentEmpty, parseDocument, renderPlainText } from '@postgear/social-core';
import { securityLogger } from '../../common/logging/security-logger';
import { analyticsSimulated, type Env } from '../../config/env';
import { ChannelsService, type ChannelView } from '../channels/channels.service';
import { groupState } from '../posts/post-state';
import { parseCustomized } from '../posts/posts.service';
import { SchedulingService } from '../scheduling/scheduling.service';
import {
  averagePostMetrics,
  buildSeries,
  changeOf,
  comparePost,
  compareTopPosts,
  DAY_MS,
  dayKey,
  engagementRate,
  exportFilename,
  type MetricRow,
  NO_CHANGE,
  postMetricsOf,
  type RangeWindow,
  rangeWindow,
  renderCsv,
  sumChanges,
  utcMidnight,
} from './analytics.math';
import { ANALYTICS_MESSAGES } from './analytics.messages';
import {
  AnalyticsRepository,
  type RootRow,
  type SnapshotRow,
  type SnapshotWithPost,
  type SyncRow,
} from './analytics.repository';
import {
  type AnalyticsOverview,
  type AnalyticsSupport,
  type AnalyticsSyncOverview,
  type AnalyticsSyncState,
  CHANNEL_METRICS,
  type ChannelAnalytics,
  type ChannelMetric,
  type ChannelSyncStatus,
  type MetricSeries,
  type PostAnalytics,
  type PostChannelAnalytics,
  type SyncNowResult,
  type TopPost,
} from './analytics.types';
import type { OverviewQuery, SyncNowInput } from './dto/analytics.schema';

/** Characters of text shown for a post — the same as the queue's preview. */
const PREVIEW_LENGTH = 160;

/** Leaderboard length. */
const TOP_POSTS = 10;

/** How far back a channel's per-post average looks. */
const AVERAGE_DAYS = 90;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SYNC_STATES: Record<SyncRow['status'], AnalyticsSyncState> = {
  NEVER: 'never',
  OK: 'ok',
  FAILED: 'failed',
  UNSUPPORTED: 'unsupported',
  NEEDS_RECONNECT: 'needs_reconnect',
  NEEDS_PERMISSIONS: 'needs_permissions',
};

/** The time source, injectable so the spec can pin the range. */
export const ANALYTICS_CLOCK = Symbol('ANALYTICS_CLOCK');
export type Clock = () => number;

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly repository: AnalyticsRepository,
    private readonly channels: ChannelsService,
    private readonly scheduling: SchedulingService,
    private readonly config: ConfigService<Env, true>,
    @Inject(ANALYTICS_CLOCK) private readonly clock: Clock,
  ) {}

  /** `GET /analytics/overview`. */
  async overview(orgId: string, query: OverviewQuery): Promise<AnalyticsOverview> {
    const now = this.clock();
    const window = rangeWindow(query.range, now);
    const channels = await this.shownChannels(orgId, query.channelId);
    const ids = channels.map((channel) => channel.id);
    const simulated = this.simulated();
    const supported = this.providerSupport();

    const [rows, syncs, snapshots] = await Promise.all([
      this.repository.metricRows(
        orgId,
        ids,
        new Date(`${window.previousFrom}T00:00:00.000Z`),
        new Date(`${window.to}T00:00:00.000Z`),
      ),
      this.repository.syncRows(orgId, ids),
      this.repository.latestSnapshotsForPostsPublishedBetween(
        orgId,
        ids,
        new Date(`${window.from}T00:00:00.000Z`),
        new Date(new Date(`${window.to}T00:00:00.000Z`).getTime() + DAY_MS),
      ),
    ]);

    const syncByChannel = new Map(syncs.map((sync) => [sync.integrationId, sync]));
    const postsByChannel = new Map<string, number>();

    for (const snapshot of snapshots) {
      postsByChannel.set(
        snapshot.integrationId,
        (postsByChannel.get(snapshot.integrationId) ?? 0) + 1,
      );
    }

    const shaped = channels.map((channel) =>
      this.channelAnalytics(
        channel,
        rows.filter((row) => row.integrationId === channel.id),
        window,
        syncByChannel.get(channel.id),
        postsByChannel.get(channel.id) ?? 0,
        this.supportOf(channel, supported, simulated),
      ),
    );

    const withFollowers = shaped.filter((channel) => channel.followers !== null);
    const impressions = sumChanges(shaped.map((channel) => channel.impressions));
    const engagements = sumChanges(shaped.map((channel) => channel.engagements));

    return {
      range: window.range,
      from: window.from,
      to: window.to,
      generatedAt: new Date(now).toISOString(),
      simulated,
      totals: {
        followers:
          withFollowers.length === 0
            ? null
            : sumChanges(withFollowers.map((channel) => channel.followers ?? NO_CHANGE)),
        impressions,
        engagements,
        engagementRate: engagementRate(engagements.value, impressions.value),
        posts: snapshots.length,
      },
      channels: shaped,
      topPosts: this.topPosts(snapshots, channels),
    };
  }

  /** `GET /analytics/export`: the same overview, as a spreadsheet. */
  async exportCsv(orgId: string, query: OverviewQuery): Promise<{ filename: string; csv: string }> {
    const overview = await this.overview(orgId, query);

    return { filename: exportFilename(overview), csv: renderCsv(overview) };
  }

  /** `GET /analytics/posts/:group`. */
  async post(orgId: string, group: string): Promise<PostAnalytics> {
    if (!UUID_PATTERN.test(group)) {
      throw new NotFoundException(ANALYTICS_MESSAGES.POST_NOT_FOUND);
    }

    const roots = await this.repository.findRootsByGroup(orgId, group);

    if (roots.length === 0) {
      throw new NotFoundException(ANALYTICS_MESSAGES.POST_NOT_FOUND);
    }

    const channelIds = [...new Set(roots.map((root) => root.integrationId))];
    const since = new Date(utcMidnight(this.clock()).getTime() - AVERAGE_DAYS * DAY_MS);

    const [liveChannels, history, recent] = await Promise.all([
      this.channels.list(orgId),
      this.repository.snapshotsForPosts(
        orgId,
        roots.map((root) => root.id),
      ),
      this.repository.latestSnapshotsSince(orgId, channelIds, since),
    ]);

    const liveById = new Map(liveChannels.map((channel) => [channel.id, channel]));
    const supported = this.providerSupport();
    const simulated = this.simulated();
    const shared = roots.find((root) => !parseCustomized(root.settings)) ?? roots[0];

    return {
      group,
      publishDate: roots[0].publishDate.toISOString(),
      preview: previewOf(shared.content),
      state: groupState(roots.map((root) => root.state)),
      channels: roots.map((root) =>
        this.postChannel(
          root,
          liveById.get(root.integrationId),
          history.filter((row) => row.postId === root.id),
          recent.filter((row) => row.integrationId === root.integrationId),
          supported,
          simulated,
        ),
      ),
    };
  }

  /** `GET /analytics/sync`. */
  async syncOverview(orgId: string): Promise<AnalyticsSyncOverview> {
    const [channels, scheduler] = await Promise.all([
      this.channels.list(orgId),
      this.scheduling.status(),
    ]);
    const syncs = await this.repository.syncRows(
      orgId,
      channels.map((channel) => channel.id),
    );
    const syncByChannel = new Map(syncs.map((sync) => [sync.integrationId, sync]));
    const supported = this.providerSupport();
    const simulated = this.simulated();

    return {
      reachable: scheduler.reachable,
      workerOnline: scheduler.workerOnline,
      simulated,
      channels: channels.map((channel) =>
        this.channelSyncStatus(
          channel,
          syncByChannel.get(channel.id),
          this.supportOf(channel, supported, simulated),
        ),
      ),
    };
  }

  /**
   * `POST /analytics/sync`: asks the worker to sync one channel, or every
   * channel that can be synced, now. Best-effort, like every scheduler
   * call: `requested: false` means the scheduler could not be reached, and
   * the daily loop will sync regardless.
   */
  async syncNow(orgId: string, input: SyncNowInput): Promise<SyncNowResult> {
    const channels = await this.shownChannels(orgId, input.channelId);
    const supported = this.providerSupport();
    const simulated = this.simulated();
    const targets = channels.filter(
      (channel) => this.supportOf(channel, supported, simulated) === 'supported',
    );

    if (targets.length === 0) {
      return { requested: true, channels: 0 };
    }

    const requested = await this.scheduling.syncAnalyticsNow(
      targets.map((channel) => ({ integrationId: channel.id, organizationId: orgId })),
    );

    return { requested, channels: targets.length };
  }

  /* ───────────────────────────── shaping ───────────────────────────── */

  /**
   * Every live channel of the workspace, or the one asked for. A channel
   * id the workspace cannot see is refused and recorded — a stale client,
   * or a probe — the way the posts and AI modules refuse one.
   */
  private async shownChannels(orgId: string, channelId?: string): Promise<ChannelView[]> {
    const channels = await this.channels.list(orgId);

    if (!channelId) {
      return channels;
    }

    const chosen = channels.filter((channel) => channel.id === channelId);

    if (chosen.length === 0) {
      securityLogger.warn('analytics.foreign_reference', { orgId, channelId });
      throw new UnprocessableEntityException(ANALYTICS_MESSAGES.CHANNEL_UNAVAILABLE);
    }

    return chosen;
  }

  private channelAnalytics(
    channel: ChannelView,
    rows: { metric: string; date: Date; value: number }[],
    window: RangeWindow,
    sync: SyncRow | undefined,
    posts: number,
    support: AnalyticsSupport,
  ): ChannelAnalytics {
    const byMetric = new Map<string, MetricRow[]>();

    for (const row of rows) {
      const list = byMetric.get(row.metric) ?? [];
      list.push({ metric: row.metric, date: dayKey(row.date), value: row.value });
      byMetric.set(row.metric, list);
    }

    const series: MetricSeries[] = CHANNEL_METRICS.filter((metric) => byMetric.has(metric)).map(
      (metric) => buildSeries(metric, byMetric.get(metric) ?? [], window),
    );
    const find = (metric: ChannelMetric) => series.find((entry) => entry.metric === metric);
    const followers = find('followers');
    const impressions = find('impressions');
    const engagements = find('engagements');
    const impressionsChange = impressions
      ? changeOf(impressions.total, impressions.previous)
      : { ...NO_CHANGE };
    const engagementsChange = engagements
      ? changeOf(engagements.total, engagements.previous)
      : { ...NO_CHANGE };

    return {
      channelId: channel.id,
      name: channel.name,
      providerIdentifier: channel.providerIdentifier,
      providerName: channel.providerName,
      picture: channel.picture,
      profile: channel.profile,
      support,
      sync: {
        status: sync ? SYNC_STATES[sync.status] : 'never',
        lastSyncedAt: sync?.lastSyncedAt?.toISOString() ?? null,
        error: sync?.lastError ?? null,
      },
      followers: followers ? changeOf(followers.total, followers.previous) : null,
      impressions: impressionsChange,
      engagements: engagementsChange,
      engagementRate: engagementRate(engagementsChange.value, impressionsChange.value),
      posts,
      series,
    };
  }

  private topPosts(snapshots: SnapshotWithPost[], channels: ChannelView[]): TopPost[] {
    const channelById = new Map(channels.map((channel) => [channel.id, channel]));

    return snapshots
      .flatMap((snapshot) => {
        const channel = channelById.get(snapshot.integrationId);

        if (!channel) {
          return [];
        }

        return [
          {
            rank: 0,
            group: snapshot.post.group,
            postId: snapshot.postId,
            channelId: channel.id,
            channelName: channel.name,
            providerIdentifier: channel.providerIdentifier,
            providerName: channel.providerName,
            picture: channel.picture,
            preview: previewOf(snapshot.post.content),
            publishDate: snapshot.post.publishDate.toISOString(),
            releaseURL: snapshot.post.releaseURL,
            capturedAt: snapshot.capturedAt.toISOString(),
            metrics: postMetricsOf(snapshot),
          },
        ];
      })
      .sort(compareTopPosts)
      .slice(0, TOP_POSTS)
      .map((post, index) => ({ ...post, rank: index + 1 }));
  }

  private postChannel(
    root: RootRow,
    live: ChannelView | undefined,
    history: SnapshotRow[],
    recent: SnapshotRow[],
    supported: Map<string, boolean>,
    simulated: boolean,
  ): PostChannelAnalytics {
    const latest = history[history.length - 1];
    const metrics = latest ? postMetricsOf(latest) : null;
    const average = averagePostMetrics(recent);

    return {
      channelId: root.integration.id,
      name: live?.name ?? root.integration.name,
      providerIdentifier: root.integration.providerIdentifier,
      providerName:
        live?.providerName ??
        this.channels
          .listProviders()
          .find((provider) => provider.identifier === root.integration.providerIdentifier)?.name ??
        root.integration.providerIdentifier,
      picture: live?.picture ?? root.integration.picture,
      releaseURL: root.releaseURL,
      // A channel disconnected after the post went out keeps its history but
      // cannot be synced again.
      support: live ? this.supportOf(live, supported, simulated) : 'unsupported',
      metrics,
      capturedAt: latest?.capturedAt.toISOString() ?? null,
      average,
      comparison: metrics && average ? comparePost(metrics, average) : {},
      history: history.map((row) => ({
        capturedAt: row.capturedAt.toISOString(),
        metrics: postMetricsOf(row),
      })),
    };
  }

  private channelSyncStatus(
    channel: ChannelView,
    sync: SyncRow | undefined,
    support: AnalyticsSupport,
  ): ChannelSyncStatus {
    return {
      channelId: channel.id,
      name: channel.name,
      providerIdentifier: channel.providerIdentifier,
      providerName: channel.providerName,
      support,
      status: sync ? SYNC_STATES[sync.status] : 'never',
      lastSyncedAt: sync?.lastSyncedAt?.toISOString() ?? null,
      lastAttemptAt: sync?.lastAttemptAt?.toISOString() ?? null,
      error: sync?.lastError ?? null,
      channelDays: sync?.channelDays ?? 0,
      postsSynced: sync?.postsSynced ?? 0,
    };
  }

  /**
   * Health first, then the platform: a channel that needs setting up or
   * reconnecting cannot be synced whatever its platform offers, and the
   * action the page should offer is the health's.
   */
  private supportOf(
    channel: ChannelView,
    supported: Map<string, boolean>,
    simulated: boolean,
  ): AnalyticsSupport {
    if (channel.health === 'needs_setup') {
      return 'needs_setup';
    }
    if (channel.health === 'needs_reconnect') {
      return 'needs_reconnect';
    }
    return simulated || supported.get(channel.providerIdentifier) ? 'supported' : 'unsupported';
  }

  private providerSupport(): Map<string, boolean> {
    return new Map(
      this.channels.listProviders().map((provider) => [provider.identifier, provider.analytics]),
    );
  }

  private simulated(): boolean {
    return analyticsSimulated({
      ANALYTICS_SIMULATION: this.config.get('ANALYTICS_SIMULATION', { infer: true }),
      PUBLISH_SIMULATION: this.config.get('PUBLISH_SIMULATION', { infer: true }),
    });
  }
}

/** The first 160 characters of a post's text, as the queue shows it. */
export function previewOf(content: string | null): string {
  const document = parseDocument(content);

  if (isDocumentEmpty(document)) {
    return '';
  }

  const characters = Array.from(renderPlainText(document));

  return characters.length <= PREVIEW_LENGTH
    ? characters.join('')
    : `${characters
        .slice(0, PREVIEW_LENGTH - 1)
        .join('')
        .trimEnd()}…`;
}
