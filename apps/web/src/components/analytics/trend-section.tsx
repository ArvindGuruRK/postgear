'use client';

/**
 * The trend: one metric over the range, one line per channel.
 *
 * The metric switch is a `Tabs` list of only the metrics the data has — a
 * tab for "Clicks" that every platform left empty would be a tab to nothing.
 * The chart is `TrendChart` from the design system, which is restrained by
 * construction (§15); the card and the section header around it carry the
 * treatment. One channel gets the area fill, several get lines only, which
 * `TrendChart` decides for itself.
 *
 * The metric chosen is local state, not URL state: it is a way of looking,
 * not a filter, and resets harmlessly on reload. When the data stops having
 * the chosen metric (a channel filter that leaves only X, say) the first
 * available one takes over rather than showing an empty plot.
 */
import { Card, SectionHeader, Tabs, TabsList, TabsTrigger, Text, TrendChart } from '@postgear/ui';
import { useMemo, useState } from 'react';
import type { AnalyticsOverview, ChannelMetric } from '@/types/analytics';
import {
  formatMetric,
  metricLabel,
  metricsAvailable,
  RANGE_LABELS,
  seriesForMetric,
} from './analytics-view-model';

export function TrendSection({ overview }: { overview: AnalyticsOverview }) {
  const available = useMemo(() => metricsAvailable(overview), [overview]);
  const [chosen, setChosen] = useState<ChannelMetric>('impressions');
  const metric = available.includes(chosen) ? chosen : (available[0] ?? null);
  const series = useMemo(
    () => (metric ? seriesForMetric(overview, metric) : []),
    [overview, metric],
  );

  return (
    <Card className="flex flex-col gap-4 p-5" aria-label="Trend">
      <SectionHeader
        title="Trend"
        description={`${RANGE_LABELS[overview.range]}, by day. Arrow keys read the chart.`}
        actions={
          available.length > 0 ? (
            <Tabs
              value={metric ?? undefined}
              onValueChange={(value) => setChosen(value as ChannelMetric)}
            >
              <TabsList className="flex-wrap" aria-label="Metric">
                {available.map((entry) => (
                  <TabsTrigger key={entry} value={entry} className="px-3 py-1.5">
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
          height={240}
          formatValue={(value) => formatMetric(value)}
          aria-label={`${metricLabel(metric)} per day`}
        />
      ) : (
        <div className="flex h-60 items-center justify-center rounded-md border-2 border-outline">
          <Text size="sm" muted>
            No daily metrics in this range yet.
          </Text>
        </div>
      )}
    </Card>
  );
}
