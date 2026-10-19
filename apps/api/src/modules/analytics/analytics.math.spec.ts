/**
 * The page's arithmetic, pinned: UTC ranges and their previous periods,
 * levels against flows, the delta badge, the "even" band, the per-post
 * average and comparison, the leaderboard order, and RFC 4180 CSV.
 */
import {
  averagePostMetrics,
  buildSeries,
  changeOf,
  comparePost,
  compareTopPosts,
  comparisonOf,
  csvCell,
  engagementRate,
  exportFilename,
  postMetricsOf,
  rangeWindow,
  renderCsv,
  sumChanges,
} from './analytics.math';
import type { AnalyticsOverview, PostMetrics } from './analytics.types';

const NOW = Date.UTC(2026, 9, 15, 13, 30); // 2026-10-15 13:30Z

describe('rangeWindow', () => {
  it('is the last N UTC days ending today, with the N days before as the previous period', () => {
    const week = rangeWindow(7, NOW);

    expect(week).toMatchObject({
      range: 7,
      from: '2026-10-09',
      to: '2026-10-15',
      previousFrom: '2026-10-02',
      previousTo: '2026-10-08',
    });
    expect(week.days).toHaveLength(7);
    expect(week.days[0]).toBe('2026-10-09');
    expect(week.days[6]).toBe('2026-10-15');

    const quarter = rangeWindow(90, NOW);
    expect(quarter.from).toBe('2026-07-18');
    expect(quarter.days).toHaveLength(90);
    expect(quarter.previousTo).toBe('2026-07-17');
  });

  it('does not let a late-evening local time move the day', () => {
    expect(rangeWindow(7, Date.UTC(2026, 9, 15, 23, 59, 59)).to).toBe('2026-10-15');
    expect(rangeWindow(7, Date.UTC(2026, 9, 16, 0, 0, 1)).to).toBe('2026-10-16');
  });
});

describe('buildSeries', () => {
  const window = rangeWindow(7, NOW);

  it('sums a flow over the range and over the previous period, zero-filling missing days', () => {
    const series = buildSeries(
      'impressions',
      [
        { metric: 'impressions', date: '2026-10-01', value: 999 }, // before the previous period
        { metric: 'impressions', date: '2026-10-02', value: 10 },
        { metric: 'impressions', date: '2026-10-08', value: 20 },
        { metric: 'impressions', date: '2026-10-09', value: 5 },
        { metric: 'impressions', date: '2026-10-15', value: 7 },
      ],
      window,
    );

    expect(series.total).toBe(12);
    expect(series.previous).toBe(30);
    expect(series.recordedDays).toBe(2);
    expect(series.points).toHaveLength(7);
    expect(series.points[0]).toEqual({ date: '2026-10-09', value: 5 });
    expect(series.points[1]).toEqual({ date: '2026-10-10', value: 0 });
    expect(series.points[6]).toEqual({ date: '2026-10-15', value: 7 });
  });

  it('reads a level as its latest value, against the value at the range start', () => {
    const series = buildSeries(
      'followers',
      [
        { metric: 'followers', date: '2026-10-07', value: 100 },
        { metric: 'followers', date: '2026-10-09', value: 110 },
        { metric: 'followers', date: '2026-10-12', value: 120 },
      ],
      window,
    );

    expect(series.total).toBe(120);
    expect(series.previous).toBe(110);
    expect(series.recordedDays).toBe(2);
    expect(series.points.map((point) => point.value)).toEqual([110, 0, 0, 120, 0, 0, 0]);
  });

  it('has no previous when nothing was recorded then', () => {
    expect(
      buildSeries('followers', [{ metric: 'followers', date: '2026-10-12', value: 5 }], window)
        .previous,
    ).toBeNull();
    expect(
      buildSeries('likes', [{ metric: 'likes', date: '2026-10-12', value: 5 }], window).previous,
    ).toBeNull();
  });

  it('a level recorded only before the range still has a current value', () => {
    const series = buildSeries(
      'followers',
      [{ metric: 'followers', date: '2026-10-01', value: 90 }],
      window,
    );

    expect(series.total).toBe(90);
    expect(series.previous).toBe(90);
    expect(series.recordedDays).toBe(0);
  });
});

describe('changes', () => {
  it('computes the delta and the percentage, null where there is nothing to compare', () => {
    expect(changeOf(120, 100)).toEqual({ value: 120, delta: 20, percent: 20 });
    expect(changeOf(90, 100)).toEqual({ value: 90, delta: -10, percent: -10 });
    expect(changeOf(7, 0)).toEqual({ value: 7, delta: 7, percent: null });
    expect(changeOf(7, null)).toEqual({ value: 7, delta: null, percent: null });
    expect(changeOf(1, 3).percent).toBe(-66.7);
  });

  it('sums channel changes, recomputing the percentage from the summed previous', () => {
    expect(
      sumChanges([changeOf(120, 100), changeOf(30, 20), { value: 5, delta: null, percent: null }]),
    ).toEqual({ value: 155, delta: 30, percent: 25 });
    expect(sumChanges([{ value: 5, delta: null, percent: null }])).toEqual({
      value: 5,
      delta: null,
      percent: null,
    });
    expect(sumChanges([])).toEqual({ value: 0, delta: null, percent: null });
  });

  it('engagement rate is a percentage with two decimals, null without impressions', () => {
    expect(engagementRate(33, 1000)).toBe(3.3);
    expect(engagementRate(1, 3)).toBe(33.33);
    expect(engagementRate(5, 0)).toBeNull();
  });
});

describe('comparisonOf', () => {
  it('reads five percent either way as even', () => {
    expect(comparisonOf(104, 100)).toBe('even');
    expect(comparisonOf(96, 100)).toBe('even');
    expect(comparisonOf(106, 100)).toBe('above');
    expect(comparisonOf(94, 100)).toBe('below');
    expect(comparisonOf(0, 0)).toBe('even');
    expect(comparisonOf(1, 0)).toBe('above');
  });
});

describe('post metrics', () => {
  const row = {
    likes: 10,
    comments: 2,
    shares: 3,
    clicks: 4,
    impressions: 500,
    saves: 5,
    views: 0,
  };

  it('derives engagements and the rate from the counters', () => {
    expect(postMetricsOf(row)).toEqual({ ...row, engagements: 20, engagementRate: 4 });
    expect(postMetricsOf({ ...row, impressions: 0 }).engagementRate).toBeNull();
  });

  it('averages one snapshot per post, and compares against it', () => {
    const average = averagePostMetrics([row, { ...row, likes: 30, impressions: 700 }]);

    expect(average).toMatchObject({ likes: 20, impressions: 600, engagements: 30 });
    expect(averagePostMetrics([])).toBeNull();

    const comparison = comparePost(postMetricsOf(row), average as PostMetrics);
    expect(comparison.likes).toBe('below');
    expect(comparison.comments).toBe('even');
    expect(comparison.impressions).toBe('below');
    expect(comparison.engagements).toBe('below');
    expect(comparison.engagementRate).toBe('below');
  });

  it('ranks by engagements, then rate, then recency', () => {
    const post = (engagements: number, impressions: number, publishDate: string) => ({
      metrics: {
        ...postMetricsOf({
          ...row,
          likes: engagements,
          comments: 0,
          shares: 0,
          saves: 0,
          impressions,
        }),
      },
      publishDate,
    });
    const sorted = [
      post(10, 1000, '2026-10-01'),
      post(20, 1000, '2026-10-01'),
      post(10, 100, '2026-10-02'),
      post(10, 100, '2026-10-03'),
    ].sort(compareTopPosts);

    expect(
      sorted.map((entry) => [
        entry.metrics.engagements,
        entry.metrics.impressions,
        entry.publishDate,
      ]),
    ).toEqual([
      [20, 1000, '2026-10-01'],
      [10, 100, '2026-10-03'],
      [10, 100, '2026-10-02'],
      [10, 1000, '2026-10-01'],
    ]);
  });
});

describe('CSV', () => {
  it('quotes per RFC 4180', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('has, comma')).toBe('"has, comma"');
    expect(csvCell('says "hi"')).toBe('"says ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(3.5)).toBe('3.5');
  });

  it('renders both sections with a byte-order mark and CRLF line ends', () => {
    const overview: AnalyticsOverview = {
      range: 7,
      from: '2026-10-09',
      to: '2026-10-15',
      generatedAt: '2026-10-15T13:30:00.000Z',
      simulated: true,
      totals: {
        followers: null,
        impressions: changeOf(0, null),
        engagements: changeOf(0, null),
        engagementRate: null,
        posts: 1,
      },
      channels: [
        {
          channelId: 'ch',
          name: 'Acme, Inc',
          providerIdentifier: 'linkedin',
          providerName: 'LinkedIn',
          picture: null,
          profile: null,
          color: 0,
          support: 'supported',
          sync: { status: 'ok', lastSyncedAt: null, error: null },
          followers: null,
          impressions: changeOf(0, null),
          engagements: changeOf(0, null),
          engagementRate: null,
          posts: 1,
          series: [
            {
              metric: 'likes',
              points: [{ date: '2026-10-09', value: 3 }],
              total: 3,
              previous: null,
              recordedDays: 1,
            },
          ],
        },
      ],
      topPosts: [
        {
          rank: 1,
          group: 'g',
          postId: 'p',
          channelId: 'ch',
          channelName: 'Acme, Inc',
          providerIdentifier: 'linkedin',
          providerName: 'LinkedIn',
          picture: null,
          color: 0,
          preview: 'He said "go"',
          publishDate: '2026-10-10T09:00:00.000Z',
          releaseURL: null,
          capturedAt: '2026-10-15T09:00:00.000Z',
          metrics: postMetricsOf({
            likes: 1,
            comments: 0,
            shares: 0,
            clicks: 0,
            impressions: 50,
            saves: 0,
            views: 0,
          }),
        },
      ],
    };

    const csv = renderCsv(overview);
    const lines = csv.split('\r\n');

    expect(csv.startsWith('﻿')).toBe(true);
    expect(lines[0]).toBe('﻿section,channel,provider,date,metric,value');
    expect(lines[1]).toBe('daily,"Acme, Inc",linkedin,2026-10-09,likes,3');
    expect(lines[2]).toBe('');
    expect(lines[3]).toContain('section,rank,channel,provider,published,preview,url');
    expect(lines[4]).toBe(
      'top_posts,1,"Acme, Inc",linkedin,2026-10-10T09:00:00.000Z,"He said ""go""",,50,1,0,0,0,0,0,1,2',
    );
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(exportFilename(overview)).toBe('postgear-analytics-2026-10-09-2026-10-15.csv');
  });
});
