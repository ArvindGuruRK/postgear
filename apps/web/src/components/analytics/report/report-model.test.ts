/**
 * The analytics PDF's words and numbers, pinned: what would be silent if
 * wrong is an emoji printed as a box, a date shifted a day by the time zone,
 * a highlight naming the wrong channel, or a chart line drawn through a gap.
 */
import type { AnalyticsOverview, ChannelAnalytics, TopPost } from '@/types/analytics';
import {
  buildReport,
  chartGeometry,
  compact,
  pdfSafe,
  periodLabel,
  postLine,
  REPORT_TOP_POSTS,
  reportFileName,
  sparkPaths,
} from './report-model';

const NOW = new Date(2026, 9, 22, 21, 30);

function channel(overrides: Partial<ChannelAnalytics> = {}): ChannelAnalytics {
  return {
    channelId: 'ch_linkedin',
    name: 'Acme Marketing',
    providerIdentifier: 'linkedin',
    providerName: 'LinkedIn',
    picture: null,
    profile: 'acme',
    color: 0,
    support: 'supported',
    sync: { status: 'ok', lastSyncedAt: '2026-10-22T10:00:00.000Z', error: null },
    followers: { value: 1200, delta: 40, percent: 3.4 },
    impressions: { value: 300, delta: 50, percent: 20 },
    engagements: { value: 30, delta: -2, percent: -6.3 },
    engagementRate: 10,
    posts: 3,
    series: [
      {
        metric: 'impressions',
        points: [
          { date: '2026-10-21', value: 100 },
          { date: '2026-10-22', value: 200 },
        ],
        total: 300,
        previous: 250,
        recordedDays: 2,
      },
    ],
    ...overrides,
  };
}

function post(rank: number, overrides: Partial<TopPost> = {}): TopPost {
  return {
    rank,
    group: `g${rank}`,
    postId: `p${rank}`,
    channelId: 'ch_linkedin',
    channelName: 'Acme Marketing',
    providerIdentifier: 'linkedin',
    providerName: 'LinkedIn',
    picture: null,
    color: 0,
    preview: `Post number ${rank}`,
    publishDate: '2026-10-14T09:00:00.000Z',
    releaseURL: null,
    capturedAt: '2026-10-22T10:00:00.000Z',
    metrics: {
      likes: 10,
      comments: 2,
      shares: 1,
      clicks: 0,
      impressions: 500,
      saves: 0,
      views: 0,
      engagements: 13,
      engagementRate: 2.6,
    },
    ...overrides,
  };
}

function overview(
  channels: ChannelAnalytics[] = [channel()],
  topPosts: TopPost[] = [],
): AnalyticsOverview {
  return {
    range: 30,
    from: '2026-09-23',
    to: '2026-10-22',
    generatedAt: NOW.toISOString(),
    simulated: true,
    totals: {
      followers: { value: 1200, delta: 40, percent: 3.4 },
      impressions: { value: 300, delta: 50, percent: 20 },
      engagements: { value: 30, delta: -2, percent: -6.3 },
      engagementRate: 10,
      posts: 3,
    },
    channels,
    topPosts,
  };
}

const CONTEXT = {
  workspace: 'Seed Demo Org',
  channelName: null,
  generatedAt: NOW,
  locale: 'en-US',
};

describe('pdfSafe', () => {
  it('drops what the Latin font cannot draw and closes the gap', () => {
    expect(pdfSafe('Launch day \u{1F680} is here')).toBe('Launch day is here');
    expect(pdfSafe('Café crème')).toBe('Café crème');
    expect(pdfSafe('日本 Tokyo')).toBe('Tokyo');
    expect(pdfSafe('  many\n\nlines  ')).toBe('many lines');
  });
});

describe('postLine', () => {
  it('takes the first line with any text, cut to fit', () => {
    expect(postLine('\n\u{1F525}\nSecond line')).toBe('Second line');
    expect(postLine('x'.repeat(100), 20)).toBe(`${'x'.repeat(17)}...`);
    // A long sentence is cut at a whole word.
    expect(postLine('the first post PostGear published on its own schedule', 40)).toBe(
      'the first post PostGear published on...',
    );
    expect(postLine('\u{1F525}')).toBe('Empty post');
  });
});

describe('dates and names', () => {
  it('writes the period in UTC, so the zone never shifts a day', () => {
    expect(periodLabel('2026-09-23', '2026-10-22', 'en-US')).toBe('Sep 23 to Oct 22, 2026');
    expect(periodLabel('2025-12-20', '2026-01-18', 'en-US')).toBe('Dec 20, 2025 to Jan 18, 2026');
  });

  it("names the file after the range and the viewer's date", () => {
    expect(reportFileName(30, NOW)).toBe('postgear-analytics-30-days-2026-10-22.pdf');
  });

  it('keeps axis numbers short', () => {
    expect(compact(1500, 'en-US')).toBe('1,500');
    expect(compact(12_000, 'en-US')).toBe('12K');
  });
});

describe('buildReport', () => {
  it('describes the range, the scope and the totals', () => {
    const report = buildReport(overview(), CONTEXT);
    expect(report.rangeLabel).toBe('Last 30 days');
    expect(report.scope).toBe('All channels');
    expect(report.chips).toEqual(['1 channel', '3 posts', '300 impressions']);
    expect(report.kpis.map((kpi) => kpi.value)).toEqual(['1,200', '300', '30', '10.0%']);
    expect(report.kpis[0].level).toBe(true);
    expect(report.simulated).toBe(true);
  });

  it('names the channel when the page is filtered to one', () => {
    expect(buildReport(overview(), { ...CONTEXT, channelName: 'Acme Marketing' }).scope).toBe(
      'Acme Marketing',
    );
  });

  it('picks the highlights from the data, and skips what is missing', () => {
    const studio = channel({
      channelId: 'ch_ig',
      name: 'Acme Studio',
      providerIdentifier: 'instagram',
      engagementRate: 12,
      impressions: { value: 100, delta: null, percent: null },
      series: [
        {
          metric: 'impressions',
          points: [{ date: '2026-10-22', value: 100 }],
          total: 100,
          previous: null,
          recordedDays: 1,
        },
      ],
    });
    const report = buildReport(overview([channel(), studio], [post(1)]), CONTEXT);
    expect(report.highlights).toEqual([
      {
        label: 'Biggest reach',
        value: 'Acme Marketing',
        detail: '300 impressions, 75% of the total',
      },
      {
        label: 'Best engagement rate',
        value: '12.0%',
        detail: 'Acme Studio, from 100 impressions',
      },
      { label: 'Top post', value: 'Post number 1', detail: '13 engagements on Acme Marketing' },
    ]);

    expect(buildReport(overview([channel()], []), CONTEXT).highlights.map((h) => h.label)).toEqual([
      'Biggest reach',
      'Best engagement rate',
    ]);
  });

  it('lists at most ten top posts, each in its channel colour', () => {
    const posts = Array.from({ length: 12 }, (_, index) => post(index + 1));
    const report = buildReport(overview([channel()], posts), CONTEXT);
    expect(report.topPosts).toHaveLength(REPORT_TOP_POSTS);
    expect(report.topPosts[0]).toMatchObject({
      rank: 1,
      tone: 'primary',
      views: '500',
      rate: '2.6%',
    });
  });

  it('gives each channel its status and follower move', () => {
    const broken = channel({
      channelId: 'ch_x',
      name: 'Acme on X',
      providerIdentifier: 'x',
      support: 'needs_reconnect',
      followers: null,
      engagementRate: null,
    });
    const [linkedin, x] = buildReport(overview([channel(), broken]), CONTEXT).channels;
    expect(linkedin).toMatchObject({
      status: 'Synced Oct 22',
      statusTone: 'success',
      followersDelta: '+40',
      rate: '10.0%',
    });
    expect(x).toMatchObject({ status: 'Needs Reconnect', statusTone: 'danger', followers: '–' });
    expect(x.tone).toBe('ai');
  });

  it('charts only the metrics some channel reported', () => {
    const report = buildReport(overview(), CONTEXT);
    expect(report.charts.map((chart) => chart.metric)).toEqual(['impressions']);
    expect(report.charts[0].dates).toEqual(['2026-10-21', '2026-10-22']);
  });
});

describe('chartGeometry', () => {
  it('breaks a line where a value is missing', () => {
    const geometry = chartGeometry(
      {
        dates: ['a', 'b', 'c', 'd'],
        series: [{ id: 's', label: 'S', tone: 'primary', values: [10, 20, null, 40] }],
      },
      200,
      100,
      'en-US',
    );
    expect(geometry.lines[0].d.match(/M/g)).toHaveLength(2);
    expect(geometry.ticks.map((tick) => tick.label)[0]).toBe('0');
    expect(geometry.ticks[0].y).toBeGreaterThan(geometry.ticks[4].y);
  });

  it('labels at most the asked number of dates, first and last included', () => {
    const dates = Array.from(
      { length: 30 },
      (_, index) => `2026-10-${String(index + 1).padStart(2, '0')}`,
    );
    const geometry = chartGeometry(
      { dates, series: [{ id: 's', label: 'S', tone: 'primary', values: dates.map(() => 1) }] },
      400,
      120,
      'en-US',
      5,
    );
    expect(geometry.labels).toHaveLength(5);
    expect(geometry.labels[0]).toMatchObject({ label: 'Oct 1', anchor: 'start' });
    expect(geometry.labels[4]).toMatchObject({ label: 'Oct 30', anchor: 'end' });
  });
});

describe('sparkPaths', () => {
  it('draws from zero with an area, or fits a level with none', () => {
    const flow = sparkPaths([0, 10, 20], 102, 22);
    // 20 is already a round ceiling, so the top value touches the top.
    expect(flow.line).toBe('M 1.0 21.0 L 51.0 11.0 L 101.0 1.0');
    expect(flow.area).toContain('Z');

    const level = sparkPaths([1000, 1010, 1020], 102, 22, true);
    expect(level.line).toBe('M 1.0 21.0 L 51.0 11.0 L 101.0 1.0');
    expect(level.area).toBeNull();
  });

  it('draws nothing without values, and a level line through a flat range', () => {
    expect(sparkPaths([null, null], 100, 20)).toEqual({ line: '', area: null });
    expect(sparkPaths([5, 5], 102, 22, true).line).toBe('M 1.0 11.0 L 101.0 11.0');
  });
});
