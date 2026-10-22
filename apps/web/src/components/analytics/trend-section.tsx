'use client';

/**
 * Performance (revamp, 2026-10-22): one metric over the range, one line per
 * channel, with the metric's total and its move in the header; and beside it
 * (under it below `xl`) the same metric split by channel.
 *
 * Both panels follow one metric switch, so choosing "Engagements" redraws the
 * chart and re-ranks the channels together. The switch lists only the metrics
 * the data has: a tab for "Clicks" that every platform left empty would be a
 * tab to nothing. The chosen metric is local state, not URL state: it is a
 * way of looking, not a filter, and resets harmlessly on reload. When the
 * data stops having it (a channel filter that leaves only X, say) the first
 * available one takes over rather than an empty plot.
 *
 * The chart is the design system's `TrendChart` (restrained by construction,
 * §15: its plot is a light box in the chrome panel). Colours follow each
 * channel's position on the page, so a channel's line, its bar here and its
 * sparkline in the table match.
 */
import { BarList, type BarListItem, Tabs, TabsList, TabsTrigger, TrendChart } from '@postgear/ui';
import { useMemo, useState } from 'react';
import type { AnalyticsOverview, ChannelMetric } from '@/types/analytics';
import {
  AnalyticsPanel,
  PanelHeader,
  SEGMENTED_LIST,
  SEGMENTED_TRIGGER,
  TrendLine,
} from './analytics-ui';
import {
  channelShares,
  comparedTo,
  formatMetric,
  metricLabel,
  metricSummary,
  metricsAvailable,
  seriesForMetric,
  trendFor,
} from './analytics-view-model';
import { ChannelAvatar } from './channel-avatar';

export function TrendSection({ overview }: { overview: AnalyticsOverview }) {
  const available = useMemo(() => metricsAvailable(overview), [overview]);
  const [chosen, setChosen] = useState<ChannelMetric>('impressions');
  const metric = available.includes(chosen) ? chosen : (available[0] ?? null);

  return (
    <div className="grid grid-cols-1 gap-3 md:gap-4 xl:grid-cols-3">
      <Performance overview={overview} metric={metric} available={available} onMetric={setChosen} />
      <ByChannel overview={overview} metric={metric} />
    </div>
  );
}

function Performance({
  overview,
  metric,
  available,
  onMetric,
}: {
  overview: AnalyticsOverview;
  metric: ChannelMetric | null;
  available: ChannelMetric[];
  onMetric: (metric: ChannelMetric) => void;
}) {
  const series = useMemo(
    () => (metric ? seriesForMetric(overview, metric) : []),
    [overview, metric],
  );
  const summary = useMemo(
    () => (metric ? metricSummary(overview, metric) : null),
    [overview, metric],
  );

  return (
    <AnalyticsPanel
      className="flex flex-col gap-4 p-4 md:p-5 xl:col-span-2"
      aria-labelledby="analytics-performance"
    >
      <PanelHeader
        id="analytics-performance"
        title="Performance"
        sub={
          metric && summary ? (
            <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="type-heading text-2xl leading-none text-ink tabular-nums">
                {formatMetric(summary.value)}
              </span>
              <span className="font-sans text-sm text-ink type-muted">
                {metricLabel(metric).toLowerCase()}
              </span>
              <TrendLine
                trend={trendFor(summary)}
                against={comparedTo(overview.range)}
                fallback="No previous period"
              />
            </span>
          ) : null
        }
        aside={
          available.length > 0 ? (
            <Tabs
              value={metric ?? undefined}
              onValueChange={(value) => onMetric(value as ChannelMetric)}
            >
              <TabsList className={`${SEGMENTED_LIST} max-w-full flex-wrap`} aria-label="Metric">
                {available.map((entry) => (
                  <TabsTrigger key={entry} value={entry} className={SEGMENTED_TRIGGER}>
                    {metricLabel(entry)}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          ) : null
        }
      />

      {metric && series.length > 0 ? (
        <TrendChart
          series={series}
          height={260}
          formatValue={(value) => formatMetric(value)}
          aria-label={`${metricLabel(metric)} per day`}
        />
      ) : (
        <div className="flex h-64 items-center justify-center rounded-md border-2 border-outline bg-secondary">
          <span className="font-sans text-sm text-ink type-muted">
            No daily metrics in this range yet.
          </span>
        </div>
      )}
    </AnalyticsPanel>
  );
}

function ByChannel({
  overview,
  metric,
}: {
  overview: AnalyticsOverview;
  metric: ChannelMetric | null;
}) {
  const items = useMemo<BarListItem[]>(
    () =>
      metric
        ? channelShares(overview, metric).map((share) => ({
            id: share.channel.channelId,
            label: share.channel.name,
            value: share.value,
            display: formatMetric(share.value),
            hint: `${share.channel.providerName}, ${Math.round(share.share)}% of the total`,
            tone: share.tone,
            leading: (
              <ChannelAvatar
                id={share.channel.channelId}
                color={share.channel.color}
                name={share.channel.name}
                picture={share.channel.picture}
              />
            ),
          }))
        : [],
    [overview, metric],
  );

  return (
    <AnalyticsPanel
      className="flex flex-col gap-4 p-4 md:p-5"
      aria-labelledby="analytics-by-channel"
    >
      <PanelHeader
        id="analytics-by-channel"
        title="By Channel"
        sub={
          metric ? (
            <span className="font-sans text-sm text-ink type-muted">
              {metricLabel(metric)}, biggest first
            </span>
          ) : null
        }
      />
      <div className="flex-1 rounded-md border-2 border-outline bg-secondary p-4">
        <BarList items={items} emptyMessage="No channel reported this metric in the range." />
      </div>
    </AnalyticsPanel>
  );
}
