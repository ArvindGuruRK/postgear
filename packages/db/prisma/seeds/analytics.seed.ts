/**
 * Ninety days of metrics on the demo workspace (Sprint 7), so the Analytics
 * page has every treatment on a fresh clone without a worker having run:
 * two channels with a full quarter of daily figures, a post whose counters
 * have grown across three snapshots, a healthy sync line, and a broken one.
 *
 * ## Why the LinkedIn member channel carries data
 *
 * The real `linkedin` provider has no channel metrics (LinkedIn exposes
 * statistics for organizations only) and in a real deployment the sync
 * writes `UNSUPPORTED` for it. The demo workspace is a simulation
 * (`ANALYTICS_SIMULATION=true` locally), where every platform is
 * supported, and the API computes `support` from that flag; so the seed
 * gives the channel the data a simulated sync would, and the page says
 * "simulated" over it. Re-seeding with the flag off shows the same rows
 * under a channel marked unsupported, which is also honest.
 *
 * ## Deterministic, and idempotent by deletion
 *
 * Every value comes from a small seeded generator keyed on the channel id
 * and the day, so the chart does not move between runs and a browser test
 * can assert on it. None of the three tables has a natural key worth
 * upserting on from here (the post snapshots are append-only), so the
 * workspace's rows are deleted and recreated. Only `@prisma/client` is
 * imported: the seed must not depend on an app package.
 */
import { AnalyticsSyncStatus, type PrismaClient } from '@prisma/client';

const DAY_MS = 24 * 60 * 60_000;
const DAYS = 90;

/** Sunday first; business accounts are quiet at the weekend. */
const WEEKDAY_SHAPE = [0.6, 1.0, 1.1, 1.15, 1.1, 1.0, 0.7];

export interface SeedChannel {
  id: string;
  providerIdentifier: string;
}

export interface SeedPublishedPost {
  id: string;
  integrationId: string;
  publishDate: Date;
}

/** FNV-1a, 32-bit: the same hash the worker's stand-in uses, so the shapes match. */
function hashString(value: string): number {
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash >>> 0;
}

/** Reproducible noise in [-1, 1] for a label. */
function noise(label: string): number {
  return (hashString(label) % 10_001) / 5_000 - 1;
}

function utcMidnight(value: number): number {
  const date = new Date(value);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/** A channel's daily rows for the last `DAYS` days ending today. */
function channelRows(
  organizationId: string,
  channel: SeedChannel,
  today: number,
): { organizationId: string; integrationId: string; metric: string; date: Date; value: number }[] {
  const seed = hashString(channel.id);
  const baseFollowers = 1_200 + (seed % 7_801);
  const growthPerDay = baseFollowers * (0.001 + ((seed >>> 3) % 5) * 0.0005);
  const engagementRate = 0.02 + ((seed >>> 5) % 5) * 0.01;
  const video = channel.providerIdentifier === 'instagram';
  const rows: ReturnType<typeof channelRows> = [];

  for (let back = DAYS - 1; back >= 0; back -= 1) {
    const dayMs = today - back * DAY_MS;
    const date = new Date(dayMs);
    const key = date.toISOString().slice(0, 10);
    const shape = WEEKDAY_SHAPE[date.getUTCDay()];
    const wobble = (metric: string, amount: number) =>
      1 + amount * noise(`${channel.id}:${key}:${metric}`);

    const followers = Math.round(
      baseFollowers + growthPerDay * (DAYS - back) + 10 * noise(`${channel.id}:${key}:followers`),
    );
    const impressions = Math.round(followers * 0.35 * shape * wobble('impressions', 0.3));
    const engagements = Math.round(impressions * engagementRate * wobble('engagements', 0.3));

    const add = (metric: string, value: number) =>
      rows.push({ organizationId, integrationId: channel.id, metric, date, value });

    add('followers', followers);
    add('impressions', impressions);
    add('reach', Math.round(impressions * 0.8));
    add('engagements', engagements);
    add('likes', Math.round(engagements * 0.62));
    add('comments', Math.round(engagements * 0.14));
    add('shares', Math.round(engagements * 0.12));
    add('clicks', Math.round(impressions * 0.018 * wobble('clicks', 0.3)));

    if (video) {
      add('views', Math.round(impressions * 0.55));
    }
  }

  return rows;
}

/**
 * Seeds the three analytics tables for one workspace.
 *
 * Channels on `x` are seeded broken (a `NEEDS_RECONNECT` sync and no
 * metrics, matching the seeded X channel that needs reconnecting) and
 * every other channel gets the full quarter and an `OK` sync an hour ago.
 * Each published post gets three snapshots, two days apart and growing.
 */
export async function seedAnalytics(
  prisma: PrismaClient,
  organizationId: string,
  channels: SeedChannel[],
  publishedPosts: SeedPublishedPost[],
) {
  await prisma.postMetricSnapshot.deleteMany({ where: { organizationId } });
  await prisma.channelMetricSnapshot.deleteMany({ where: { organizationId } });
  await prisma.analyticsSync.deleteMany({ where: { organizationId } });

  const now = Date.now();
  const today = utcMidnight(now);
  const hourAgo = new Date(now - 60 * 60_000);
  let metricRows = 0;

  for (const channel of channels) {
    if (channel.providerIdentifier === 'x') {
      await prisma.analyticsSync.create({
        data: {
          organizationId,
          integrationId: channel.id,
          status: AnalyticsSyncStatus.NEEDS_RECONNECT,
          lastAttemptAt: hourAgo,
          lastError: 'Acme on X needs reconnecting before its metrics can be read.',
        },
      });
      continue;
    }

    const rows = channelRows(organizationId, channel, today);
    await prisma.channelMetricSnapshot.createMany({ data: rows });
    metricRows += rows.length;

    await prisma.analyticsSync.create({
      data: {
        organizationId,
        integrationId: channel.id,
        status: AnalyticsSyncStatus.OK,
        lastSyncedAt: hourAgo,
        lastAttemptAt: hourAgo,
        channelDays: DAYS,
        postsSynced: publishedPosts.filter((post) => post.integrationId === channel.id).length,
      },
    });
  }

  let snapshots = 0;

  for (const post of publishedPosts) {
    const seed = hashString(post.id);
    const impressions = 400 + (seed % 1_601);
    const rate = 0.03 + ((seed >>> 4) % 4) * 0.01;

    // Three readings: two days ago, yesterday, an hour ago, each larger.
    for (const [index, capturedAt] of [
      new Date(now - 2 * DAY_MS),
      new Date(now - DAY_MS),
      hourAgo,
    ].entries()) {
      const growth = 0.6 + index * 0.2;
      const engagements = impressions * growth * rate;

      await prisma.postMetricSnapshot.create({
        data: {
          organizationId,
          postId: post.id,
          integrationId: post.integrationId,
          capturedAt,
          impressions: Math.round(impressions * growth),
          likes: Math.round(engagements * 0.6),
          comments: Math.round(engagements * 0.15),
          shares: Math.round(engagements * 0.1),
          saves: Math.round(engagements * 0.15),
          clicks: Math.round(impressions * growth * 0.02),
          views: 0,
        },
      });
      snapshots += 1;
    }
  }

  return { channels: channels.length, metricRows, snapshots };
}
