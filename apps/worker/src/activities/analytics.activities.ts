/**
 * The activities behind `analyticsSyncWorkflow`: when a channel is next due,
 * and one sync of its metrics.
 *
 * ## What one sync writes
 *
 * The window's daily channel metrics, upserted on (channel, metric, day) so
 * a re-read of a day the platform revised overwrites rather than
 * duplicates; one new `PostMetricSnapshot` per published post the channel
 * still has — append-only, so the per-post line has history; and the
 * `AnalyticsSync` row the status line reads. The row is written on every
 * outcome, including the failures, with a message composed by class of
 * failure (`lib/analytics-sync.ts`) and never the platform's own words.
 *
 * ## Why a per-post failure is not a sync failure
 *
 * Fifty posts, one platform call each: a single post the platform has
 * trouble with (rate-limited, briefly unavailable, deleted between the list
 * and the read) must not throw away the forty-nine others or the channel
 * series already written. Each read is caught on its own and counted; the
 * sync is a failure only when the *channel* read is.
 */

import { AnalyticsSyncStatus, decryptNullable, prisma, State } from '@postgear/db';
import {
  ANALYTICS_SYNC_MAX_POSTS,
  ANALYTICS_SYNC_WINDOW_DAYS,
  type AnalyticsSyncInput,
  type AnalyticsSyncSkipReason,
} from '@postgear/scheduling';
import type { ChannelContext } from '@postgear/social-core';
import { ApplicationFailure, Context } from '@temporalio/activity';
import { nextSyncSlot } from '../lib/analytics-slot';
import {
  chunk,
  distinctDays,
  planUpserts,
  safeFailure,
  UPSERT_BATCH_SIZE,
} from '../lib/analytics-sync';
import type { ActivityDeps } from './deps';

export type AnalyticsSchedule =
  | { status: 'active'; nextSyncAt: string; lastSyncedAt: string | null }
  | { status: 'skip'; reason: AnalyticsSyncSkipReason };

export interface AnalyticsSyncResult {
  channelDays: number;
  postsSynced: number;
}

/** `ApplicationFailure.type` for a sync worth retrying; the workflow logs anything else and waits. */
export const ANALYTICS_RETRYABLE_FAILURE = 'AnalyticsRetryable';

/** Heartbeat cadence, under the workflow's one-minute heartbeat timeout. */
const HEARTBEAT_MS = 15_000;

/** Per-post reads in flight at once. Platforms rate-limit per account, and fifty at once is how a sync earns a 429. */
const POST_CONCURRENCY = 3;

const NOTHING: AnalyticsSyncResult = { channelDays: 0, postsSynced: 0 };

export function createAnalyticsActivities(deps: ActivityDeps) {
  return {
    /** When this channel should next sync, or why it never will as it stands. */
    async loadAnalyticsSchedule(input: AnalyticsSyncInput): Promise<AnalyticsSchedule> {
      const row = await prisma.integration.findFirst({
        where: { id: input.integrationId, organizationId: input.organizationId },
        select: {
          deletedAt: true,
          refreshNeeded: true,
          inBetweenSteps: true,
          disabled: true,
          providerIdentifier: true,
          analyticsSync: { select: { lastSyncedAt: true } },
        },
      });

      if (!row || row.deletedAt) {
        return { status: 'skip', reason: 'gone' };
      }
      if (row.refreshNeeded) {
        return { status: 'skip', reason: 'needs_reconnect' };
      }
      if (row.inBetweenSteps) {
        return { status: 'skip', reason: 'not_set_up' };
      }
      if (row.disabled) {
        return { status: 'skip', reason: 'disabled' };
      }
      if (!deps.analytics.resolve(row.providerIdentifier)) {
        // Written so the Analytics page can say "this platform exposes no
        // metrics" rather than "never synced", which reads as a fault.
        await writeSync(input, { status: AnalyticsSyncStatus.UNSUPPORTED, lastError: null });
        return { status: 'skip', reason: 'unsupported' };
      }

      const lastSyncedAt = row.analyticsSync?.lastSyncedAt ?? null;
      const now = Date.now();
      const nextSyncAt =
        lastSyncedAt === null
          ? now
          : nextSyncSlot(lastSyncedAt.getTime(), input.integrationId, now);

      return {
        status: 'active',
        nextSyncAt: new Date(nextSyncAt).toISOString(),
        lastSyncedAt: lastSyncedAt?.toISOString() ?? null,
      };
    },

    /**
     * One sync. Returns normally on every outcome a person has to act on
     * (the row says what), and throws a retryable failure only when the
     * platform was transiently unavailable, so Temporal tries again.
     */
    async syncChannelAnalytics(input: AnalyticsSyncInput): Promise<AnalyticsSyncResult> {
      const integration = await prisma.integration.findFirst({
        where: {
          id: input.integrationId,
          organizationId: input.organizationId,
          deletedAt: null,
          disabled: false,
          inBetweenSteps: false,
        },
        select: {
          id: true,
          internalId: true,
          rootInternalId: true,
          providerIdentifier: true,
          name: true,
          profile: true,
          token: true,
          additionalSettings: true,
        },
      });

      if (!integration) {
        // The next loop of the workflow reads why and exits.
        return NOTHING;
      }

      const provider = deps.analytics.resolve(integration.providerIdentifier);

      if (!provider) {
        await writeSync(input, { status: AnalyticsSyncStatus.UNSUPPORTED, lastError: null });
        return NOTHING;
      }

      const token = integration.token ? (decryptNullable(integration.token) ?? '') : '';
      const now = new Date();

      if (!token) {
        await writeSync(input, {
          status: AnalyticsSyncStatus.NEEDS_RECONNECT,
          lastAttemptAt: now,
          lastError: `${integration.name} has no credentials stored. Reconnect it to read its metrics.`,
        });
        return NOTHING;
      }

      const context: ChannelContext = {
        id: integration.id,
        internalId: integration.internalId,
        rootInternalId: integration.rootInternalId ?? integration.internalId,
        providerIdentifier: integration.providerIdentifier,
        name: integration.name,
        profile: integration.profile,
        additionalSettings: parseJsonObject(integration.additionalSettings),
      };

      const activity = Context.current();
      const heartbeat = setInterval(() => activity.heartbeat(), HEARTBEAT_MS);

      try {
        const points = await provider.channelAnalytics(context, token, ANALYTICS_SYNC_WINDOW_DAYS);
        const rows = planUpserts(points, input);

        for (const batch of chunk(rows, UPSERT_BATCH_SIZE)) {
          await prisma.$transaction(
            batch.map((row) =>
              prisma.channelMetricSnapshot.upsert({
                where: {
                  integrationId_metric_date: {
                    integrationId: row.integrationId,
                    metric: row.metric,
                    date: row.date,
                  },
                },
                create: row,
                update: { value: row.value },
              }),
            ),
          );
          activity.heartbeat();
        }

        const postsSynced = await syncPosts(input, context, token, provider, activity);

        await writeSync(input, {
          status: AnalyticsSyncStatus.OK,
          lastSyncedAt: now,
          lastAttemptAt: now,
          lastError: null,
          channelDays: distinctDays(rows),
          postsSynced,
        });

        return { channelDays: distinctDays(rows), postsSynced };
      } catch (error) {
        const failure = safeFailure(error, integration.name);

        console.warn(
          JSON.stringify({
            event: 'analytics.sync_failed',
            orgId: input.organizationId,
            channelId: input.integrationId,
            provider: integration.providerIdentifier,
            status: failure.status,
            reason: error instanceof Error ? error.name : 'unknown',
            detail: error instanceof Error ? error.message : String(error),
          }),
        );

        await writeSync(input, {
          status: AnalyticsSyncStatus[failure.status],
          lastAttemptAt: now,
          lastError: failure.message,
        }).catch(() => undefined);

        if (failure.retry) {
          throw ApplicationFailure.create({
            type: ANALYTICS_RETRYABLE_FAILURE,
            nonRetryable: false,
            message: failure.message,
          });
        }

        return NOTHING;
      } finally {
        clearInterval(heartbeat);
      }
    },
  };
}

export type AnalyticsActivities = ReturnType<typeof createAnalyticsActivities>;

/* ───────────────────────────── helpers ───────────────────────────── */

/**
 * Reads and records the newest published posts' counters. Each read is
 * caught on its own — see the file comment — and a null (the platform no
 * longer has the post) is simply not a snapshot.
 */
async function syncPosts(
  input: AnalyticsSyncInput,
  context: ChannelContext,
  token: string,
  provider: NonNullable<ReturnType<ActivityDeps['analytics']['resolve']>>,
  activity: Context,
): Promise<number> {
  if (!provider.postAnalytics) {
    return 0;
  }

  const posts = await prisma.post.findMany({
    where: {
      organizationId: input.organizationId,
      integrationId: input.integrationId,
      state: State.PUBLISHED,
      parentPostId: null,
      releaseId: { not: null },
      deletedAt: null,
    },
    orderBy: [{ publishDate: 'desc' }, { id: 'asc' }],
    take: ANALYTICS_SYNC_MAX_POSTS,
    select: { id: true, releaseId: true },
  });

  let synced = 0;
  let failed = 0;
  const read = provider.postAnalytics.bind(provider);

  await mapWithConcurrency(posts, POST_CONCURRENCY, async (post) => {
    try {
      const metrics = await read(context, token, post.releaseId ?? '');

      if (!metrics) {
        return;
      }

      await prisma.postMetricSnapshot.create({
        data: {
          organizationId: input.organizationId,
          postId: post.id,
          integrationId: input.integrationId,
          likes: metrics.likes,
          comments: metrics.comments,
          shares: metrics.shares,
          clicks: metrics.clicks,
          impressions: metrics.impressions,
          saves: metrics.saves,
          views: metrics.views,
        },
      });
      synced += 1;
    } catch (error) {
      failed += 1;
      activity.log.warn('post metrics not read', {
        postId: post.id,
        reason: error instanceof Error ? error.name : 'unknown',
      });
    } finally {
      activity.heartbeat();
    }
  });

  if (failed > 0) {
    console.warn(
      JSON.stringify({
        event: 'analytics.sync_failed',
        scope: 'posts',
        orgId: input.organizationId,
        channelId: input.integrationId,
        provider: context.providerIdentifier,
        failed,
        synced,
      }),
    );
  }

  return synced;
}

async function writeSync(
  input: AnalyticsSyncInput,
  data: {
    status: AnalyticsSyncStatus;
    lastSyncedAt?: Date;
    lastAttemptAt?: Date;
    lastError: string | null;
    channelDays?: number;
    postsSynced?: number;
  },
): Promise<void> {
  // The integration was looked up with the organization before any write
  // here, and `integrationId` is unique, so this is one row of this tenant.
  await prisma.analyticsSync.upsert({
    where: { integrationId: input.integrationId },
    create: { organizationId: input.organizationId, integrationId: input.integrationId, ...data },
    update: data,
  });
}

async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  run: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;

  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      await run(item);
    }
  });

  await Promise.all(lanes);
}

function parseJsonObject(raw: string | null): Record<string, unknown> {
  if (!raw) {
    return {};
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
