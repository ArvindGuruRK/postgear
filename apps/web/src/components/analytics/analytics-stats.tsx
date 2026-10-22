'use client';

/**
 * The four numbers at the top (revamp, 2026-10-22): followers, impressions,
 * engagements and the engagement rate, laid out like Home's KPI cards.
 *
 * Each card has the same four rows, so a row of them lines up: the metric's
 * sticker and name (what it counts behind the info button), the number, its
 * move against the previous period, and the shape of the range as a filled
 * line in the sticker's colour. The chip is a real move; "No change" when the
 * delta is exactly zero, "No previous period" when the range began before
 * the data did, "Not reported" when no platform gave a follower count, and
 * the posts count under the rate, which has no previous period of its own.
 *
 * Two across on a phone, four from `xl`, as on Home.
 */
import { Skeleton, Sparkline, type TrendTone } from '@postgear/ui';
import { Eye, Heart, type LucideIcon, Percent, Users } from 'lucide-react';
import type { AnalyticsOverview } from '@/types/analytics';
import { AnalyticsPanel, InfoButton, Sticker, TrendLine } from './analytics-ui';
import {
  combinedPoints,
  comparedTo,
  engagementRatePoints,
  formatMetric,
  formatPercent,
  type Trend,
  trendFor,
} from './analytics-view-model';

const GRID = 'grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-4';

function MetricCard({
  metric,
  label,
  info,
  icon,
  tone,
  value,
  trend,
  against,
  fallback,
  points,
  level = false,
}: {
  metric: string;
  label: string;
  info: string;
  icon: LucideIcon;
  tone: TrendTone;
  value: string;
  trend: Trend;
  against: string;
  fallback: string;
  points: (number | null)[];
  /** A count on a day (followers), not a flow: its line fits its own range. */
  level?: boolean;
}) {
  return (
    <AnalyticsPanel
      className="flex flex-col gap-3 p-3 sm:p-4 md:p-5"
      data-testid="analytics-stat"
      data-metric={metric}
    >
      {/* On a phone two cards share the row and "Engagement Rate" wraps, so
          the header keeps two lines either way and the numbers stay level
          across the row (Home's tiles do the same). From `sm`, one line. */}
      <div className="flex min-h-12 items-start justify-between gap-2 sm:min-h-8 sm:items-center">
        <span className="flex min-w-0 items-center gap-2">
          <span className="hidden sm:block">
            <Sticker icon={icon} tone={tone} />
          </span>
          <span className="min-w-0 truncate type-heading text-base text-ink sm:text-lg">
            {label}
          </span>
        </span>
        <InfoButton label={label} info={info} />
      </div>

      <span className="type-heading text-3xl leading-none text-ink tabular-nums md:text-4xl">
        {value}
      </span>

      <TrendLine trend={trend} against={against} fallback={fallback} />

      <div className="mt-auto pt-1">
        <Sparkline
          points={points}
          tone={tone}
          area
          fitRange={level}
          fluid
          width={240}
          height={44}
        />
      </div>
    </AnalyticsPanel>
  );
}

export function AnalyticsStats({ overview }: { overview: AnalyticsOverview }) {
  const { totals } = overview;
  const against = comparedTo(overview.range);
  const posts = `${formatMetric(totals.posts)} ${totals.posts === 1 ? 'post' : 'posts'}`;

  return (
    <section className={GRID} aria-label="Totals">
      <MetricCard
        metric="followers"
        label="Followers"
        info="Followers across the shown channels on the range's last day, against its first."
        icon={Users}
        tone="success"
        value={formatMetric(totals.followers?.value ?? null)}
        trend={trendFor(totals.followers)}
        against={against}
        fallback={totals.followers ? 'No previous period' : 'Not reported'}
        points={combinedPoints(overview, 'followers').map((point) => point.value)}
        level
      />
      <MetricCard
        metric="impressions"
        label="Impressions"
        info="How many times your posts were seen in the range, as each platform counts it."
        icon={Eye}
        tone="primary"
        value={formatMetric(totals.impressions.value)}
        trend={trendFor(totals.impressions)}
        against={against}
        fallback="No previous period"
        points={combinedPoints(overview, 'impressions').map((point) => point.value)}
      />
      <MetricCard
        metric="engagements"
        label="Engagements"
        info="Likes, comments, shares and saves on your posts in the range."
        icon={Heart}
        tone="accent"
        value={formatMetric(totals.engagements.value)}
        trend={trendFor(totals.engagements)}
        against={against}
        fallback="No previous period"
        points={combinedPoints(overview, 'engagements').map((point) => point.value)}
      />
      <MetricCard
        metric="engagementRate"
        label="Engagement Rate"
        info="Engagements as a share of impressions: how often a view turned into an action."
        icon={Percent}
        tone="secondary"
        value={formatPercent(totals.engagementRate)}
        trend={{ kind: 'none' }}
        against={against}
        fallback={`From ${posts}`}
        points={engagementRatePoints(overview)}
      />
    </section>
  );
}

/** The same grid while the numbers are not there yet, so nothing moves when they arrive. */
export function AnalyticsStatsSkeleton() {
  return (
    <section className={GRID} aria-busy="true" aria-label="Loading totals">
      {['followers', 'impressions', 'engagements', 'engagementRate'].map((metric) => (
        <AnalyticsPanel key={metric} className="flex flex-col gap-3 p-3 sm:p-4 md:p-5">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-9 w-28" />
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-11 w-full" />
        </AnalyticsPanel>
      ))}
    </section>
  );
}
