/**
 * Where metrics come from: the real providers, or a stand-in.
 *
 * The same split as `publisher.ts`, for the same reason: nothing can be
 * read from a real platform locally, because the seeded channels hold fake
 * tokens every platform would answer with a 401. With
 * `ANALYTICS_SIMULATION=true` the platform call is replaced by a stand-in,
 * and everything around it (the daily timer, the upserts, the sync status
 * row, the leaderboard) runs for real against the real database.
 *
 * ## The stand-in is deterministic
 *
 * Every number is derived from a hash of the channel id (or the platform
 * post id) and the calendar day, never from `Math.random`. Two syncs of the
 * same channel on the same day write the same rows, a test can assert on an
 * exact value, and re-seeding does not make yesterday's chart move. The
 * shape is meant to look like a real account: a follower level that trends
 * gently upwards, daily impressions with a weekday curve and a little
 * noise, and a per-post set of counters that grows slowly with age.
 *
 * ## Directives
 *
 * A channel whose *name* contains one of these asks the stand-in to fail:
 *
 * | Directive                       | What the stand-in throws       |
 * |---------------------------------|--------------------------------|
 * | `[simulate:analytics:401]`      | `RefreshTokenError`            |
 * | `[simulate:analytics:403]`      | `NotEnoughScopesError`         |
 * | `[simulate:analytics:429]`      | `RetryableError`, every time   |
 *
 * so the status row's reconnect, permissions and retry treatments can be
 * seen without a platform. The env schema refuses the flag in production.
 */
import {
  type ChannelContext,
  type ChannelMetricPoint,
  DAY_MS,
  dayKey,
  IntegrationManager,
  NotEnoughScopesError,
  type PostMetrics,
  RefreshTokenError,
  RetryableError,
  type SocialAnalytics,
  supportsAnalytics,
  utcMidnight,
} from '@postgear/social-core';
import type { WorkerEnv } from '../config/env';
import { hashString } from './analytics-slot';

/** The slice of a provider the sync activity uses. */
export type AnalyticsProvider = Pick<SocialAnalytics, 'channelAnalytics' | 'postAnalytics'> & {
  identifier: string;
  name: string;
};

export interface AnalyticsSource {
  /** True when a stand-in is in use rather than the platforms. */
  readonly simulated: boolean;
  /** Null when the platform exposes no metrics: the channel is reported as unsupported. */
  resolve(providerIdentifier: string): AnalyticsProvider | null;
}

export function createAnalyticsSource(
  env: Pick<WorkerEnv, 'ANALYTICS_SIMULATION'>,
): AnalyticsSource {
  const manager = new IntegrationManager();

  if (env.ANALYTICS_SIMULATION === 'true') {
    return {
      simulated: true,
      // Every platform is supported in simulation, including the ones whose
      // real API has no metrics, so a local workspace sees the whole page.
      resolve: (identifier) =>
        new SimulatedAnalyticsProvider(identifier, manager.find(identifier)?.name ?? identifier),
    };
  }

  return {
    simulated: false,
    resolve: (identifier) => {
      const provider = manager.find(identifier);
      return provider && supportsAnalytics(provider) ? provider : null;
    },
  };
}

const DIRECTIVE = /\[simulate:analytics:(401|403|429)\]/i;

/** Platforms whose content is watched rather than read, and so report views. */
const VIDEO_PLATFORMS = new Set(['youtube', 'tiktok', 'instagram']);

/** Sunday first. Business accounts are quiet at the weekend. */
const WEEKDAY_SHAPE = [0.6, 1.0, 1.1, 1.15, 1.1, 1.0, 0.7];

/** Growth is measured from here, so a level is a function of the date, not of when it was read. */
const ANCHOR_DAY = Math.floor(Date.UTC(2026, 0, 1) / DAY_MS);

/** Reproducible noise in [-1, 1] for a label. */
function noise(label: string): number {
  return (hashString(label) % 10_001) / 5_000 - 1;
}

/**
 * The stand-in's channel series for the window ending today.
 *
 * Exported for the tests, which pin the ranges and the determinism. The
 * level and the flows are tied together (impressions scale with the
 * follower count), so the engagement rate looks like a real account's.
 */
export function simulatedChannelPoints(
  channelId: string,
  providerIdentifier: string,
  days: number,
  now: number = Date.now(),
): ChannelMetricPoint[] {
  const seed = hashString(channelId);
  const baseFollowers = 1_200 + (seed % 7_801);
  const growthPerDay = baseFollowers * (0.0005 + ((seed >>> 3) % 5) * 0.0005);
  const engagementRate = 0.02 + ((seed >>> 5) % 5) * 0.01;
  const todayNumber = Math.floor(utcMidnight(now).getTime() / DAY_MS);
  const points: ChannelMetricPoint[] = [];

  for (let back = Math.max(1, Math.floor(days)) - 1; back >= 0; back -= 1) {
    const dayNumber = todayNumber - back;
    const date = dayKey(dayNumber * DAY_MS);
    const shape = WEEKDAY_SHAPE[new Date(dayNumber * DAY_MS).getUTCDay()];
    const wobble = (metric: string, amount: number) =>
      1 + amount * noise(`${channelId}:${date}:${metric}`);

    const followers = Math.max(
      100,
      Math.round(
        baseFollowers +
          growthPerDay * (dayNumber - ANCHOR_DAY) +
          10 * noise(`${channelId}:${date}:followers`),
      ),
    );
    const impressions = Math.round(followers * 0.35 * shape * wobble('impressions', 0.3));
    const engagements = Math.round(impressions * engagementRate * wobble('engagements', 0.3));
    const likes = Math.round(engagements * 0.62);
    const comments = Math.round(engagements * 0.14);
    const shares = Math.round(engagements * 0.12);

    points.push(
      { metric: 'followers', date, value: followers },
      { metric: 'impressions', date, value: impressions },
      { metric: 'reach', date, value: Math.round(impressions * 0.8) },
      { metric: 'engagements', date, value: engagements },
      { metric: 'likes', date, value: likes },
      { metric: 'comments', date, value: comments },
      { metric: 'shares', date, value: shares },
      { metric: 'clicks', date, value: Math.round(impressions * 0.018 * wobble('clicks', 0.3)) },
    );

    if (VIDEO_PLATFORMS.has(providerIdentifier)) {
      points.push({ metric: 'views', date, value: Math.round(impressions * 0.55) });
    }
  }

  return points;
}

/**
 * The stand-in's counters for one post: seeded by the platform post id, and
 * nudged upwards by a logarithm of the days since the anchor, so a snapshot
 * taken tomorrow is a little larger than today's and the per-post history
 * line has a slope.
 */
export function simulatedPostMetrics(
  platformPostId: string,
  providerIdentifier: string,
  now: number = Date.now(),
): PostMetrics {
  const seed = hashString(platformPostId);
  const daysSinceAnchor = Math.max(0, Math.floor(utcMidnight(now).getTime() / DAY_MS) - ANCHOR_DAY);
  const growth = 1 + 0.1 * Math.log1p(daysSinceAnchor);
  const impressions = Math.round((200 + (seed % 4_801)) * growth);
  const rate = 0.02 + ((seed >>> 4) % 6) * 0.01;
  const engagements = impressions * rate;

  return {
    impressions,
    likes: Math.round(engagements * 0.6),
    comments: Math.round(engagements * 0.15),
    shares: Math.round(engagements * 0.1),
    saves: Math.round(engagements * 0.15),
    clicks: Math.round(impressions * 0.02),
    views: VIDEO_PLATFORMS.has(providerIdentifier) ? Math.round(impressions * 0.6) : 0,
  };
}

export class SimulatedAnalyticsProvider implements AnalyticsProvider {
  constructor(
    readonly identifier: string,
    readonly name: string,
  ) {}

  async channelAnalytics(
    channel: ChannelContext,
    _accessToken: string,
    days: number,
  ): Promise<ChannelMetricPoint[]> {
    this.failIfAsked(channel);
    return simulatedChannelPoints(channel.id, this.identifier, days);
  }

  async postAnalytics(
    channel: ChannelContext,
    _accessToken: string,
    platformPostId: string,
  ): Promise<PostMetrics | null> {
    this.failIfAsked(channel);
    return simulatedPostMetrics(platformPostId, this.identifier);
  }

  private failIfAsked(channel: ChannelContext): void {
    const match = DIRECTIVE.exec(channel.name);

    switch (match?.[1]) {
      case '401':
        throw new RefreshTokenError(
          `Your ${this.name} connection has expired (simulated).`,
          this.identifier,
          'simulated 401',
          401,
        );
      case '403':
        throw new NotEnoughScopesError(
          this.identifier,
          [],
          `Your ${this.name} account has not granted PostGear permission to read metrics (simulated).`,
        );
      case '429':
        throw new RetryableError(
          `${this.name} rate-limited the request (simulated).`,
          this.identifier,
          'simulated 429',
          429,
        );
    }
  }
}
