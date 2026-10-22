/**
 * What the analytics PDF says, worked out from the overview the page already
 * holds (revamp, 2026-10-22). Pure, like `analytics-view-model.ts`, so every
 * number, label and chart line in the report is testable without rendering a
 * PDF; `report-document.tsx` only lays it out.
 */
import type { TrendTone } from '@postgear/ui';
import { niceCeiling } from '@postgear/ui/lib/nice-ceiling';
import type { AnalyticsOverview, ChannelMetric } from '@/types/analytics';
import {
  channelShares,
  combinedPoints,
  comparedTo,
  engagementRatePoints,
  formatDelta,
  formatMetric,
  formatPercent,
  metricLabel,
  metricSummary,
  seriesForMetric,
  syncBadge,
  type Trend,
  toneForIndex,
  trendFor,
} from '../analytics-view-model';

export interface ReportContext {
  /** The workspace's name. */
  workspace: string;
  /** The channel the page is filtered to, or null for all of them. */
  channelName: string | null;
  generatedAt: Date;
  /** The viewer's locale; tests pin one. */
  locale?: string;
}

export type ReportIcon = 'users' | 'eye' | 'heart' | 'percent';

export interface ReportKpi {
  key: string;
  label: string;
  icon: ReportIcon;
  tone: TrendTone;
  value: string;
  trend: Trend;
  /** Said when there is no move to show. */
  fallback: string;
  points: (number | null)[];
  /** A level (followers): its line fits its own range. */
  level: boolean;
}

export interface ReportHighlight {
  label: string;
  value: string;
  detail: string;
}

export interface ReportSeries {
  id: string;
  label: string;
  tone: TrendTone;
  /** One value per entry of the chart's `dates`; null where the channel has none. */
  values: (number | null)[];
}

export interface ReportChart {
  metric: ChannelMetric;
  title: string;
  total: string;
  trend: Trend;
  dates: string[];
  series: ReportSeries[];
}

export interface ReportShare {
  id: string;
  name: string;
  platform: string;
  tone: TrendTone;
  display: string;
  /** Percent of the total, 0 to 100. */
  share: number;
}

export interface ReportPost {
  rank: number;
  text: string;
  channel: string;
  platform: string;
  tone: TrendTone;
  published: string;
  views: string;
  engagements: string;
  rate: string;
}

export type ReportStatusTone = 'success' | 'danger' | 'neutral';

export interface ReportChannel {
  id: string;
  name: string;
  platform: string;
  tone: TrendTone;
  status: string;
  statusTone: ReportStatusTone;
  followers: string;
  followersDelta: string | null;
  impressions: string;
  engagements: string;
  rate: string;
  posts: string;
}

export interface ReportData {
  fileName: string;
  workspace: string;
  /** "Last 30 days". */
  rangeLabel: string;
  /** "Sep 23 to Oct 22, 2026". */
  period: string;
  /** "All channels" or the channel's name. */
  scope: string;
  generated: string;
  simulated: boolean;
  against: string;
  chips: string[];
  kpis: ReportKpi[];
  highlights: ReportHighlight[];
  charts: ReportChart[];
  shares: ReportShare[];
  sharesMetric: string;
  topPosts: ReportPost[];
  channels: ReportChannel[];
  /** Every platform the report draws a logo for. */
  platforms: string[];
}

/** How many top posts the report lists. */
export const REPORT_TOP_POSTS = 10;

/**
 * The report's font is Sora's Latin subset (`public/fonts/sora`, Fontsource's
 * `latin` file). Anything outside it (emoji, other scripts, most accented
 * letters past Latin-1) would print as an empty box, so it is dropped and the
 * spaces it leaves are closed up. The kept ranges are that subset's: Basic
 * Latin, Latin-1, a few extras, general punctuation, the euro and trademark.
 */
export function pdfSafe(text: string): string {
  // Whitespace first: a line break is outside the kept ranges and would
  // otherwise vanish and glue two words together.
  return text
    .replace(/\s+/g, ' ')
    .replace(/[^ -~ -ÿıŒœ -⁯€™−]/g, '')
    .replace(/ {2,}/g, ' ')
    .trim();
}

/** The first line of a post, safe for the PDF and cut to `max` characters. */
export function postLine(preview: string, max = 90): string {
  const first =
    preview
      .split('\n')
      .map((line) => pdfSafe(line))
      .find((line) => line.length > 0) ?? '';
  if (!first) return 'Empty post';
  if (first.length <= max) return first;
  // Cut at the last whole word that fits, unless that throws away most of it.
  const cut = first.slice(0, max - 3);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}...`;
}

/**
 * A channel's status as a printed report says it: a good sync gets its date
 * ("Synced Oct 22"), since "2h ago" is wrong by the time someone reads it.
 */
export function printedStatus(
  label: string,
  lastSyncedAt: string | null,
  ok: boolean,
  locale?: string,
): string {
  if (!ok || !lastSyncedAt) return label;
  const date = new Date(lastSyncedAt);
  if (Number.isNaN(date.getTime())) return label;
  return `Synced ${date.toLocaleDateString(locale, { month: 'short', day: 'numeric' })}`;
}

/** A `YYYY-MM-DD` day as written in the report ("Oct 22"), read in UTC so it never shifts. */
function day(date: string, locale: string | undefined, withYear: boolean): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(locale, {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    ...(withYear ? { year: 'numeric' } : {}),
  });
}

/** "Sep 23 to Oct 22, 2026"; both years when the range crosses one. */
export function periodLabel(from: string, to: string, locale?: string): string {
  const crosses = from.slice(0, 4) !== to.slice(0, 4);
  return `${day(from, locale, crosses)} to ${day(to, locale, true)}`;
}

/** `postgear-analytics-30-days-2026-10-22.pdf`, dated on the viewer's own calendar. */
export function reportFileName(range: number, generatedAt: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  const date = `${generatedAt.getFullYear()}-${pad(generatedAt.getMonth() + 1)}-${pad(generatedAt.getDate())}`;
  return `postgear-analytics-${range}-days-${date}.pdf`;
}

function chartFor(overview: AnalyticsOverview, metric: ChannelMetric): ReportChart {
  const lines = seriesForMetric(overview, metric);
  const dates = [...new Set(lines.flatMap((line) => line.points.map((point) => point.x)))].sort();
  const summary = metricSummary(overview, metric);

  return {
    metric,
    title: metricLabel(metric),
    total: formatMetric(summary.value),
    trend: trendFor(summary),
    dates,
    series: lines.map((line) => {
      const byDate = new Map(line.points.map((point) => [point.x, point.y]));
      return {
        id: line.id,
        label: pdfSafe(line.label),
        tone: line.tone ?? 'primary',
        values: dates.map((date) => byDate.get(date) ?? null),
      };
    }),
  };
}

function highlightsFor(overview: AnalyticsOverview): ReportHighlight[] {
  const highlights: ReportHighlight[] = [];
  const reach = channelShares(overview, 'impressions')[0];
  if (reach && reach.value > 0) {
    highlights.push({
      label: 'Biggest reach',
      value: pdfSafe(reach.channel.name),
      detail: `${formatMetric(reach.value)} impressions, ${Math.round(reach.share)}% of the total`,
    });
  }

  const rated = overview.channels
    .filter((channel) => channel.engagementRate !== null)
    .sort((a, b) => (b.engagementRate ?? 0) - (a.engagementRate ?? 0))[0];
  if (rated) {
    highlights.push({
      label: 'Best engagement rate',
      value: formatPercent(rated.engagementRate),
      detail: `${pdfSafe(rated.name)}, from ${formatMetric(rated.impressions.value)} impressions`,
    });
  }

  const top = overview.topPosts[0];
  if (top) {
    highlights.push({
      label: 'Top post',
      value: postLine(top.preview, 60),
      detail: `${formatMetric(top.metrics.engagements)} engagements on ${pdfSafe(top.channelName)}`,
    });
  }

  return highlights;
}

/** Everything the PDF prints, from the overview on screen. */
export function buildReport(overview: AnalyticsOverview, context: ReportContext): ReportData {
  const { locale } = context;
  const now = context.generatedAt;
  // A channel's colour is its place in the overview, as on the page.
  const toneOf = (channelId: string): TrendTone =>
    toneForIndex(
      Math.max(
        0,
        overview.channels.findIndex((channel) => channel.channelId === channelId),
      ),
    );
  const { totals } = overview;
  const posts = `${formatMetric(totals.posts, locale)} ${totals.posts === 1 ? 'post' : 'posts'}`;
  const channelCount = overview.channels.length;

  const kpis: ReportKpi[] = [
    {
      key: 'followers',
      label: 'Followers',
      icon: 'users',
      tone: 'success',
      value: formatMetric(totals.followers?.value ?? null, locale),
      trend: trendFor(totals.followers, locale),
      fallback: totals.followers ? 'No previous period' : 'Not reported',
      points: combinedPoints(overview, 'followers').map((point) => point.value),
      level: true,
    },
    {
      key: 'impressions',
      label: 'Impressions',
      icon: 'eye',
      tone: 'primary',
      value: formatMetric(totals.impressions.value, locale),
      trend: trendFor(totals.impressions, locale),
      fallback: 'No previous period',
      points: combinedPoints(overview, 'impressions').map((point) => point.value),
      level: false,
    },
    {
      key: 'engagements',
      label: 'Engagements',
      icon: 'heart',
      tone: 'accent',
      value: formatMetric(totals.engagements.value, locale),
      trend: trendFor(totals.engagements, locale),
      fallback: 'No previous period',
      points: combinedPoints(overview, 'engagements').map((point) => point.value),
      level: false,
    },
    {
      key: 'engagementRate',
      label: 'Engagement Rate',
      icon: 'percent',
      tone: 'secondary',
      value: formatPercent(totals.engagementRate),
      trend: { kind: 'none' },
      fallback: `From ${posts}`,
      points: engagementRatePoints(overview),
      level: false,
    },
  ];

  const charts = (['impressions', 'engagements'] as const)
    .map((metric) => chartFor(overview, metric))
    .filter((chart) => chart.series.length > 0);

  const shares = channelShares(overview, 'impressions').map((share) => ({
    id: share.channel.channelId,
    name: pdfSafe(share.channel.name),
    platform: share.channel.providerIdentifier,
    tone: share.tone,
    display: formatMetric(share.value, locale),
    share: share.share,
  }));

  const topPosts = overview.topPosts.slice(0, REPORT_TOP_POSTS).map((post) => ({
    rank: post.rank,
    // One line in the report's post column.
    text: postLine(post.preview, 62),
    channel: pdfSafe(post.channelName),
    platform: post.providerIdentifier,
    tone: toneOf(post.channelId),
    published: new Date(post.publishDate).toLocaleDateString(locale, {
      month: 'short',
      day: 'numeric',
    }),
    views: formatMetric(post.metrics.impressions, locale),
    engagements: formatMetric(post.metrics.engagements, locale),
    rate: formatPercent(post.metrics.engagementRate),
  }));

  const channels = overview.channels.map((channel) => {
    const badge = syncBadge(channel, now);
    return {
      id: channel.channelId,
      name: pdfSafe(channel.name),
      platform: channel.providerIdentifier,
      tone: toneOf(channel.channelId),
      status: printedStatus(
        badge.label,
        channel.sync.lastSyncedAt,
        badge.variant === 'success',
        locale,
      ),
      statusTone: (badge.variant === 'success'
        ? 'success'
        : badge.variant === 'danger'
          ? 'danger'
          : 'neutral') as ReportStatusTone,
      followers: formatMetric(channel.followers?.value ?? null, locale),
      followersDelta:
        channel.followers?.delta != null && channel.followers.delta !== 0
          ? formatDelta(channel.followers.delta, locale)
          : null,
      impressions: formatMetric(channel.impressions.value, locale),
      engagements: formatMetric(channel.engagements.value, locale),
      rate: formatPercent(channel.engagementRate),
      posts: formatMetric(channel.posts, locale),
    };
  });

  return {
    fileName: reportFileName(overview.range, now),
    workspace: pdfSafe(context.workspace),
    rangeLabel: `Last ${overview.range} days`,
    period: periodLabel(overview.from, overview.to, locale),
    scope: context.channelName ? pdfSafe(context.channelName) : 'All channels',
    generated: now.toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' }),
    simulated: overview.simulated,
    against: comparedTo(overview.range),
    chips: [
      `${channelCount} ${channelCount === 1 ? 'channel' : 'channels'}`,
      posts,
      `${formatMetric(totals.impressions.value, locale)} impressions`,
    ],
    kpis,
    highlights: highlightsFor(overview),
    charts,
    shares,
    sharesMetric: 'Impressions',
    topPosts,
    channels,
    platforms: [...new Set(overview.channels.map((channel) => channel.providerIdentifier))],
  };
}

export interface ChartGeometry {
  lines: { id: string; tone: TrendTone; d: string }[];
  ticks: { y: number; label: string }[];
  labels: { x: number; label: string; anchor: 'start' | 'middle' | 'end' }[];
  plot: { left: number; right: number; top: number; bottom: number };
}

/**
 * A line chart's drawing in a `width` by `height` box: one path per series
 * (a gap where a value is missing), four grid steps from zero to a round
 * ceiling, and up to `maxLabels` dates along the bottom.
 */
export function chartGeometry(
  chart: Pick<ReportChart, 'dates' | 'series'>,
  width: number,
  height: number,
  locale?: string,
  maxLabels = 6,
): ChartGeometry {
  const plot = { left: 34, right: width - 6, top: 8, bottom: height - 18 };
  const values = chart.series.flatMap((line) =>
    line.values.filter((value): value is number => value !== null),
  );
  const ceiling = niceCeiling(values.length > 0 ? Math.max(...values) : 0);
  const count = chart.dates.length;
  const xFor = (index: number) =>
    count <= 1
      ? (plot.left + plot.right) / 2
      : plot.left + (index / (count - 1)) * (plot.right - plot.left);
  const yFor = (value: number) => plot.bottom - (value / ceiling) * (plot.bottom - plot.top);

  const lines = chart.series.map((line) => {
    let d = '';
    let open = false;
    line.values.forEach((value, index) => {
      if (value === null) {
        open = false;
        return;
      }
      d += `${open ? ' L' : ' M'} ${xFor(index).toFixed(1)} ${yFor(value).toFixed(1)}`;
      open = true;
    });
    return { id: line.id, tone: line.tone, d: d.trim() };
  });

  const ticks = [0, 1, 2, 3, 4].map((step) => {
    const value = (ceiling / 4) * step;
    return { y: yFor(value), label: compact(value, locale) };
  });

  const slots = Math.min(count, maxLabels);
  const chosen = new Set<number>();
  for (let slot = 0; slot < slots; slot += 1) {
    chosen.add(slots <= 1 ? 0 : Math.round((slot / (slots - 1)) * (count - 1)));
  }
  const labels = [...chosen]
    .sort((a, b) => a - b)
    .map((index) => ({
      x: xFor(index),
      label: day(chart.dates[index], locale, false),
      anchor: (index === 0 ? 'start' : index === count - 1 ? 'end' : 'middle') as
        | 'start'
        | 'middle'
        | 'end',
    }));

  return { lines, ticks, labels, plot };
}

/**
 * A KPI card's mini line and the area under it, in a `width` by `height` box,
 * as the page's `Sparkline` draws them: from zero, or (`fitRange`, for a
 * level) between the lowest and highest value with no area, since a fill to
 * an arbitrary floor would exaggerate the change.
 */
export function sparkPaths(
  points: (number | null)[],
  width: number,
  height: number,
  fitRange = false,
): { line: string; area: string | null } {
  const values = points.filter((value): value is number => value !== null);
  if (values.length === 0) return { line: '', area: null };
  const low = Math.min(...values);
  const high = Math.max(...values);
  const floor = fitRange ? (high === low ? low - 1 : low) : 0;
  const scale = fitRange ? (high === low ? 2 : high - low) : niceCeiling(high);
  const step = points.length > 1 ? (width - 2) / (points.length - 1) : 0;
  const base = height - 1;
  let line = '';
  let area = '';
  let open = false;
  let lastX = 0;
  points.forEach((value, index) => {
    const x = 1 + index * step;
    if (value === null) {
      if (open) area += ` L ${lastX.toFixed(1)} ${base} Z`;
      open = false;
      return;
    }
    const y = base - ((value - floor) / scale) * (height - 2);
    line += `${open ? ' L' : ' M'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    area += open
      ? ` L ${x.toFixed(1)} ${y.toFixed(1)}`
      : ` M ${x.toFixed(1)} ${base} L ${x.toFixed(1)} ${y.toFixed(1)}`;
    open = true;
    lastX = x;
  });
  if (open) area += ` L ${lastX.toFixed(1)} ${base} Z`;
  return { line: line.trim(), area: fitRange ? null : area.trim() };
}

/** An axis number in little room: 1,500, then 12k, 1.2M. */
export function compact(value: number, locale?: string): string {
  return new Intl.NumberFormat(locale, {
    notation: value >= 10_000 ? 'compact' : 'standard',
    maximumFractionDigits: value >= 10_000 ? 1 : 0,
  }).format(value);
}
