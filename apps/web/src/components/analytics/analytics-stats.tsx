'use client';

/**
 * The four numbers at the top: followers, impressions, engagements and the
 * engagement rate, each with its move against the previous period.
 *
 * Four `StatCard`s. The arrow is a real move; the caption under it is what
 * the number cannot say on its own: "No change" when the delta is exactly
 * zero (a flat arrow would be a lie in either direction), "No previous
 * period" when the range began before the data did, "Not reported" when no
 * platform gave a follower count, and the posts count under the rate.
 *
 * Restrained (§15): a StatCard grid is a dense surface, so the icons are
 * muted and the only colour is the trend's success/danger.
 */
import { Card, cn, Skeleton, StatCard } from '@postgear/ui';
import { Eye, Heart, type LucideIcon, Percent, Users } from 'lucide-react';
import type { AnalyticsTotals } from '@/types/analytics';
import { formatMetric, formatPercent, type Trend, trendFor } from './analytics-view-model';

export function MetricCard({
  metric,
  label,
  value,
  icon,
  trend,
  caption,
  className,
}: {
  metric: string;
  label: string;
  value: string;
  icon: LucideIcon;
  trend: Trend;
  caption?: string;
  className?: string;
}) {
  const line =
    trend.kind === 'even' ? trend.caption : trend.kind === 'none' ? 'No previous period' : null;
  const captions = [line, caption].filter((text): text is string => Boolean(text));

  return (
    <StatCard
      className={cn('p-5', className)}
      data-testid="analytics-stat"
      data-metric={metric}
      label={label}
      value={value}
      icon={icon}
      trend={
        trend.kind === 'trend'
          ? { value: `${trend.value} vs previous period`, direction: trend.direction }
          : undefined
      }
      caption={captions.length > 0 ? captions.join(' · ') : undefined}
    />
  );
}

export function AnalyticsStats({
  totals,
  className,
}: {
  totals: AnalyticsTotals;
  className?: string;
}) {
  const posts = `${formatMetric(totals.posts)} ${totals.posts === 1 ? 'post' : 'posts'}`;

  return (
    <section
      className={cn('grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4', className)}
      aria-label="Totals"
    >
      <MetricCard
        metric="followers"
        label="Followers"
        value={formatMetric(totals.followers?.value ?? null)}
        icon={Users}
        trend={trendFor(totals.followers)}
        caption={totals.followers ? undefined : 'Not reported'}
      />
      <MetricCard
        metric="impressions"
        label="Impressions"
        value={formatMetric(totals.impressions.value)}
        icon={Eye}
        trend={trendFor(totals.impressions)}
      />
      <MetricCard
        metric="engagements"
        label="Engagements"
        value={formatMetric(totals.engagements.value)}
        icon={Heart}
        trend={trendFor(totals.engagements)}
      />
      <MetricCard
        metric="engagementRate"
        label="Engagement rate"
        value={formatPercent(totals.engagementRate)}
        icon={Percent}
        trend={{ kind: 'none' }}
        caption={posts}
      />
    </section>
  );
}

/** The same grid while the numbers are not there yet, so nothing moves when they arrive. */
export function AnalyticsStatsSkeleton({ className }: { className?: string }) {
  return (
    <section
      className={cn('grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4', className)}
      aria-busy="true"
      aria-label="Loading totals"
    >
      {['followers', 'impressions', 'engagements', 'engagementRate'].map((metric) => (
        <Card key={metric} className="flex h-[7.25rem] flex-col gap-2 p-5">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-8 w-28" />
          <Skeleton className="h-3 w-16" />
        </Card>
      ))}
    </section>
  );
}
