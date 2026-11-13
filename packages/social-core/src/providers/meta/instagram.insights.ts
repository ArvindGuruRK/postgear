/**
 * Instagram insights, read the same way whichever door the channel came in by.
 *
 * An Instagram account connected through a Facebook Page is read on
 * `graph.facebook.com`; one connected with Instagram Login is read on
 * `graph.instagram.com`. The metric names, the response shapes and the quirks
 * are the same on both, so the mapping lives here once and each provider passes
 * in its own host and its own `fetchJson`.
 */
import {
  asCount,
  clampDays,
  DAY_MS,
  dayKey,
  type MetricEntry,
  sumByDay,
  todayKey,
  utcMidnight,
  windowStart,
} from '../../abstract/analytics';
import {
  type ChannelMetricPoint,
  EMPTY_POST_METRICS,
  type PostMetrics,
} from '../../abstract/social.provider.interface';
import { type GraphInsight, graphInsightEntries, isGraphMissingObject } from './meta.graph';

/** The provider's own `fetchJson`, so retries and error classes stay the provider's. */
export type GraphRead = <T>(url: string) => Promise<T>;

/**
 * Instagram reports interactions (`likes`, `comments`, `shares`, `saves`) as
 * one total over the requested span: `metric_type=total_value` is the only
 * form those metrics support. A per-day series therefore takes one call per
 * day. Rather than ninety calls a sync, each sync reads today and the two
 * days before it, and the daily cadence fills the window over time: a day
 * is written once, as its own total, and overwritten if a later read revises
 * it. The three-day overlap is what survives a missed sync.
 */
const TOTAL_VALUE_BACKFILL_DAYS = 3;

/** Media insight names → post counters. `reach` is the closest Instagram has to impressions. */
const MEDIA_INSIGHTS: Record<string, keyof PostMetrics> = {
  likes: 'likes',
  comments: 'comments',
  shares: 'shares',
  saved: 'saves',
  views: 'views',
  reach: 'impressions',
};

/**
 * The account's follower level, daily reach, and its interactions for the
 * last few days: see `TOTAL_VALUE_BACKFILL_DAYS` for why only a few.
 *
 * The level is the account's `followers_count` field. The `follower_count`
 * *insight* is new followers per day (a flow), and is withheld for accounts
 * under a hundred followers, so it is not what a level chart needs.
 */
export async function instagramChannelAnalytics(
  read: GraphRead,
  graphBase: string,
  accountId: string,
  accessToken: string,
  days: number,
): Promise<ChannelMetricPoint[]> {
  const base = `${graphBase}/${encodeURIComponent(accountId)}`;
  const window = clampDays(days);
  const now = Date.now();
  const entries: MetricEntry[] = [];

  const account = await read<{ followers_count?: number }>(
    `${base}?${new URLSearchParams({ fields: 'followers_count', access_token: accessToken })}`,
  );

  if (account.followers_count !== undefined) {
    entries.push({
      metric: 'followers',
      date: todayKey(now),
      value: asCount(account.followers_count),
    });
  }

  const daily = await read<{ data?: GraphInsight[] }>(
    `${base}/insights?${new URLSearchParams({
      metric: 'reach',
      period: 'day',
      since: String(Math.floor(windowStart(window, now).getTime() / 1_000)),
      until: String(Math.floor(now / 1_000)),
      access_token: accessToken,
    })}`,
  );

  entries.push(...graphInsightEntries(daily.data ?? [], { reach: 'reach' }));

  for (let back = 0; back < Math.min(window, TOTAL_VALUE_BACKFILL_DAYS); back += 1) {
    const dayStart = utcMidnight(now - back * DAY_MS).getTime();
    const dayEnd = Math.min(dayStart + DAY_MS - 1_000, now);

    const totals = await read<{ data?: GraphInsight[] }>(
      `${base}/insights?${new URLSearchParams({
        metric: 'likes,comments,shares,saves,views',
        metric_type: 'total_value',
        period: 'day',
        since: String(Math.floor(dayStart / 1_000)),
        until: String(Math.floor(dayEnd / 1_000)),
        access_token: accessToken,
      })}`,
    );

    entries.push(...totalValueEntries(totals.data ?? [], dayKey(dayStart)));
  }

  return sumByDay(entries);
}

/** One media item's lifetime insights, or null once Instagram no longer has it. */
export async function instagramPostAnalytics(
  read: GraphRead,
  graphBase: string,
  mediaId: string,
  accessToken: string,
): Promise<PostMetrics | null> {
  try {
    const response = await read<{ data?: GraphInsight[] }>(
      `${graphBase}/${encodeURIComponent(mediaId)}/insights?${new URLSearchParams({
        metric: Object.keys(MEDIA_INSIGHTS).join(','),
        access_token: accessToken,
      })}`,
    );

    const metrics: PostMetrics = { ...EMPTY_POST_METRICS };

    for (const insight of response.data ?? []) {
      const key = insight.name ? MEDIA_INSIGHTS[insight.name] : undefined;

      if (key) {
        metrics[key] = asCount(insight.values?.[0]?.value ?? insight.total_value?.value);
      }
    }

    return metrics;
  } catch (error) {
    if (isGraphMissingObject(error)) {
      return null;
    }
    throw error;
  }
}

/**
 * A day's interaction totals as entries. `saves` has no channel metric of
 * its own; like likes, comments and shares it counts towards engagements.
 */
function totalValueEntries(insights: GraphInsight[], date: string): MetricEntry[] {
  const entries: MetricEntry[] = [];
  let engagements = 0;

  for (const insight of insights) {
    const value = asCount(insight.total_value?.value ?? insight.values?.[0]?.value);

    switch (insight.name) {
      case 'likes':
        entries.push({ metric: 'likes', date, value });
        engagements += value;
        break;
      case 'comments':
        entries.push({ metric: 'comments', date, value });
        engagements += value;
        break;
      case 'shares':
        entries.push({ metric: 'shares', date, value });
        engagements += value;
        break;
      case 'saves':
        engagements += value;
        break;
      case 'views':
        entries.push({ metric: 'views', date, value });
        break;
    }
  }

  if (entries.length > 0) {
    entries.push({ metric: 'engagements', date, value: engagements });
  }

  return entries;
}
