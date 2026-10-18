/**
 * Persistence for the analytics routes: reads only.
 *
 * The worker is the only writer of the three analytics tables; this module
 * never writes a metric, so there is no transaction here to get wrong. What
 * it owes the rest of the app is the same thing every repository does:
 * `organizationId` in every `where`, taken from the caller and never from
 * a row, so a channel or post id from another workspace yields nothing
 * rather than something.
 *
 * ## The "latest snapshot per post" reads
 *
 * Snapshots are append-only, so "a post's current metrics" is its newest
 * row. Prisma's `distinct` with an ordering returns the first row of each
 * group, which with `capturedAt desc` is exactly that: one query, no
 * window function, and bounded by the number of posts rather than the
 * number of syncs.
 */
import { Injectable } from '@nestjs/common';
import { type AnalyticsSyncStatus, prisma, type State } from '@postgear/db';

export interface MetricSnapshotRow {
  integrationId: string;
  metric: string;
  date: Date;
  value: number;
}

export interface SyncRow {
  integrationId: string;
  status: AnalyticsSyncStatus;
  lastSyncedAt: Date | null;
  lastAttemptAt: Date | null;
  lastError: string | null;
  channelDays: number;
  postsSynced: number;
}

export interface SnapshotRow {
  postId: string;
  integrationId: string;
  capturedAt: Date;
  likes: number;
  comments: number;
  shares: number;
  clicks: number;
  impressions: number;
  saves: number;
  views: number;
}

/** A snapshot with the post it describes, for the leaderboard. */
export interface SnapshotWithPost extends SnapshotRow {
  post: {
    id: string;
    group: string;
    publishDate: Date;
    content: string;
    releaseURL: string | null;
  };
}

/** The root row of one channel's chain in a group. */
export interface RootRow {
  id: string;
  group: string;
  integrationId: string;
  state: State;
  publishDate: Date;
  content: string;
  settings: string | null;
  releaseURL: string | null;
  integration: {
    id: string;
    name: string;
    providerIdentifier: string;
    picture: string | null;
    profile: string | null;
    deletedAt: Date | null;
  };
}

const SNAPSHOT_SELECT = {
  postId: true,
  integrationId: true,
  capturedAt: true,
  likes: true,
  comments: true,
  shares: true,
  clicks: true,
  impressions: true,
  saves: true,
  views: true,
} as const;

@Injectable()
export class AnalyticsRepository {
  /** Daily channel metrics for these channels between two days, inclusive. */
  async metricRows(
    orgId: string,
    integrationIds: string[],
    from: Date,
    to: Date,
  ): Promise<MetricSnapshotRow[]> {
    if (integrationIds.length === 0) {
      return [];
    }

    return prisma.channelMetricSnapshot.findMany({
      where: {
        organizationId: orgId,
        integrationId: { in: integrationIds },
        date: { gte: from, lte: to },
      },
      orderBy: [{ date: 'asc' }, { metric: 'asc' }],
      select: { integrationId: true, metric: true, date: true, value: true },
    });
  }

  async syncRows(orgId: string, integrationIds: string[]): Promise<SyncRow[]> {
    if (integrationIds.length === 0) {
      return [];
    }

    return prisma.analyticsSync.findMany({
      where: { organizationId: orgId, integrationId: { in: integrationIds } },
      select: {
        integrationId: true,
        status: true,
        lastSyncedAt: true,
        lastAttemptAt: true,
        lastError: true,
        channelDays: true,
        postsSynced: true,
      },
    });
  }

  /**
   * The latest snapshot of every published root post on these channels
   * whose publish time falls in `[from, until)`.
   */
  async latestSnapshotsForPostsPublishedBetween(
    orgId: string,
    integrationIds: string[],
    from: Date,
    until: Date,
  ): Promise<SnapshotWithPost[]> {
    if (integrationIds.length === 0) {
      return [];
    }

    return prisma.postMetricSnapshot.findMany({
      where: {
        organizationId: orgId,
        integrationId: { in: integrationIds },
        post: {
          organizationId: orgId,
          parentPostId: null,
          deletedAt: null,
          publishDate: { gte: from, lt: until },
        },
      },
      orderBy: [{ postId: 'asc' }, { capturedAt: 'desc' }],
      distinct: ['postId'],
      select: {
        ...SNAPSHOT_SELECT,
        post: {
          select: { id: true, group: true, publishDate: true, content: true, releaseURL: true },
        },
      },
    });
  }

  /** The latest snapshot per post on these channels, for posts published since `since`. */
  async latestSnapshotsSince(
    orgId: string,
    integrationIds: string[],
    since: Date,
  ): Promise<SnapshotRow[]> {
    if (integrationIds.length === 0) {
      return [];
    }

    return prisma.postMetricSnapshot.findMany({
      where: {
        organizationId: orgId,
        integrationId: { in: integrationIds },
        post: { organizationId: orgId, deletedAt: null, publishDate: { gte: since } },
      },
      orderBy: [{ postId: 'asc' }, { capturedAt: 'desc' }],
      distinct: ['postId'],
      select: SNAPSHOT_SELECT,
    });
  }

  /** The root rows of a group, one per channel, with their channels, live or not. */
  async findRootsByGroup(orgId: string, group: string): Promise<RootRow[]> {
    return prisma.post.findMany({
      where: { organizationId: orgId, group, parentPostId: null, deletedAt: null },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        group: true,
        integrationId: true,
        state: true,
        publishDate: true,
        content: true,
        settings: true,
        releaseURL: true,
        integration: {
          select: {
            id: true,
            name: true,
            providerIdentifier: true,
            picture: true,
            profile: true,
            deletedAt: true,
          },
        },
      },
    });
  }

  /** Every snapshot of these posts, oldest first. */
  async snapshotsForPosts(orgId: string, postIds: string[]): Promise<SnapshotRow[]> {
    if (postIds.length === 0) {
      return [];
    }

    return prisma.postMetricSnapshot.findMany({
      where: { organizationId: orgId, postId: { in: postIds } },
      orderBy: [{ capturedAt: 'asc' }, { id: 'asc' }],
      select: SNAPSHOT_SELECT,
    });
  }
}
