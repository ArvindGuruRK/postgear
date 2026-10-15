/**
 * The analytics page's judgements about numbers, pinned.
 *
 * What would be silent if wrong: a delta of zero rendered as a green arrow,
 * a channel that needs reconnecting badged "Not supported", a chart tab for
 * a metric no channel reported, a pill saying "online" while a channel has
 * failed, and thousands separators missing from a six-figure number.
 */
import type {
  AnalyticsOverview,
  AnalyticsSyncOverview,
  ChannelAnalytics,
  ChannelSyncStatus,
} from '@/types/analytics';
import {
  apiQuery,
  exportUrl,
  filtersFromParams,
  formatDelta,
  formatMetric,
  formatPercent,
  hasMetrics,
  metricsAvailable,
  paramsFromFilters,
  postMetricsToShow,
  relativeTime,
  seriesForMetric,
  sparklineFor,
  syncBadge,
  syncFingerprint,
  syncPresentation,
  toneForIndex,
  trendFor,
} from './analytics-view-model';

const NOW = new Date('2026-10-15T12:00:00.000Z');

function channel(overrides: Partial<ChannelAnalytics> = {}): ChannelAnalytics {
  return {
    channelId: 'ch_linkedin',
    name: 'Acme Marketing',
    providerIdentifier: 'linkedin',
    providerName: 'LinkedIn',
    picture: null,
    profile: 'acme',
    support: 'supported',
    sync: { status: 'ok', lastSyncedAt: '2026-10-15T10:00:00.000Z', error: null },
    followers: { value: 1200, delta: 40, percent: 3.4 },
    impressions: { value: 5000, delta: 500, percent: 11.1 },
    engagements: { value: 250, delta: -10, percent: -3.8 },
    engagementRate: 5,
    posts: 3,
    series: [
      {
        metric: 'impressions',
        points: [
          { date: '2026-10-13', value: 100 },
          { date: '2026-10-14', value: 200 },
        ],
        total: 300,
        previous: 250,
        recordedDays: 2,
      },
      {
        metric: 'followers',
        points: [
          { date: '2026-10-13', value: 1190 },
          { date: '2026-10-14', value: 1200 },
        ],
        total: 1200,
        previous: 1160,
        recordedDays: 2,
      },
    ],
    ...overrides,
  };
}

function overview(channels: ChannelAnalytics[] = [channel()]): AnalyticsOverview {
  return {
    range: 30,
    from: '2026-09-16',
    to: '2026-10-15',
    generatedAt: NOW.toISOString(),
    simulated: true,
    totals: {
      followers: { value: 1200, delta: 40, percent: 3.4 },
      impressions: { value: 5000, delta: 500, percent: 11.1 },
      engagements: { value: 250, delta: -10, percent: -3.8 },
      engagementRate: 5,
      posts: 3,
    },
    channels,
    topPosts: [],
  };
}

function syncChannel(overrides: Partial<ChannelSyncStatus> = {}): ChannelSyncStatus {
  return {
    channelId: 'ch_linkedin',
    name: 'Acme Marketing',
    providerIdentifier: 'linkedin',
    providerName: 'LinkedIn',
    support: 'supported',
    status: 'ok',
    lastSyncedAt: '2026-10-15T10:00:00.000Z',
    lastAttemptAt: '2026-10-15T10:00:00.000Z',
    error: null,
    channelDays: 30,
    postsSynced: 3,
    ...overrides,
  };
}

function sync(channels: ChannelSyncStatus[], overrides: Partial<AnalyticsSyncOverview> = {}) {
  return { reachable: true, workerOnline: true, simulated: true, channels, ...overrides };
}

describe('filters in the URL', () => {
  it('reads a valid range and channel and falls back to the defaults', () => {
    expect(filtersFromParams(new URLSearchParams('range=7&channel=ch_1'))).toEqual({
      range: 7,
      channelId: 'ch_1',
    });
    expect(filtersFromParams(new URLSearchParams('range=14&channel='))).toEqual({
      range: 30,
      channelId: null,
    });
  });

  it('writes only what differs from the defaults and always sends the range to the API', () => {
    expect(paramsFromFilters({ range: 30, channelId: null }).toString()).toBe('');
    expect(paramsFromFilters({ range: 7, channelId: 'ch_1' }).toString()).toBe(
      'range=7&channel=ch_1',
    );
    expect(apiQuery({ range: 30, channelId: null }).toString()).toBe('range=30');
    expect(apiQuery({ range: 90, channelId: 'ch_1' }).toString()).toBe('range=90&channelId=ch_1');
    expect(exportUrl('http://localhost:3001', { range: 7, channelId: null })).toBe(
      'http://localhost:3001/analytics/export?range=7',
    );
  });
});

describe('formatting', () => {
  it('formats metrics with thousands separators and a dash for nothing', () => {
    expect(formatMetric(1204, 'en-US')).toBe('1,204');
    expect(formatMetric(1234567.8, 'en-US')).toBe('1,234,568');
    expect(formatMetric(null)).toBe('–');
    expect(formatMetric(Number.NaN)).toBe('–');
  });

  it('formats percentages to one decimal and deltas with a sign', () => {
    expect(formatPercent(3.456)).toBe('3.5%');
    expect(formatPercent(null)).toBe('–');
    expect(formatDelta(1204, 'en-US')).toBe('+1,204');
    expect(formatDelta(-37, 'en-US')).toBe('−37');
    expect(formatDelta(0, 'en-US')).toBe('0');
  });
});

describe('trendFor', () => {
  it('prefers the percentage, falls back to the delta, and says "No change" for zero', () => {
    expect(trendFor({ value: 500, delta: 50, percent: 11.11 })).toEqual({
      kind: 'trend',
      direction: 'up',
      value: '11.1%',
    });
    expect(trendFor({ value: 400, delta: 400, percent: null }, 'en-US')).toEqual({
      kind: 'trend',
      direction: 'up',
      value: '400',
    });
    expect(trendFor({ value: 90, delta: -10, percent: -10 })).toEqual({
      kind: 'trend',
      direction: 'down',
      value: '10.0%',
    });
    expect(trendFor({ value: 90, delta: 0, percent: 0 })).toEqual({
      kind: 'even',
      caption: 'No change',
    });
  });

  it('has nothing to say without a previous period', () => {
    expect(trendFor({ value: 90, delta: null, percent: null })).toEqual({ kind: 'none' });
    expect(trendFor(null)).toEqual({ kind: 'none' });
  });
});

describe('chart data', () => {
  it('lists only the metrics some channel reported, in the chart order', () => {
    expect(metricsAvailable(overview())).toEqual(['impressions', 'followers']);
    expect(metricsAvailable(overview([channel({ series: [] })]))).toEqual([]);
  });

  it('draws one line per channel that has the metric, with a stable tone per channel', () => {
    const second = channel({ channelId: 'ch_x', name: 'Acme on X', series: [] });
    const lines = seriesForMetric(overview([channel(), second]), 'impressions');

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ id: 'ch_linkedin', label: 'Acme Marketing', tone: 'primary' });
    expect(lines[0].points).toEqual([
      { x: '2026-10-13', y: 100 },
      { x: '2026-10-14', y: 200 },
    ]);

    const filtered = seriesForMetric(overview([second, channel()]), 'impressions', 'ch_linkedin');
    expect(filtered).toHaveLength(1);
    expect(filtered[0].tone).toBe('ai');
  });

  it('cycles tones and never runs out', () => {
    expect(toneForIndex(0)).toBe('primary');
    expect(toneForIndex(6)).toBe('primary');
    expect(toneForIndex(7)).toBe('ai');
  });

  it('gives the sparkline the raw values and nothing when the metric is missing', () => {
    expect(sparklineFor(channel())).toEqual([100, 200]);
    expect(sparklineFor(channel(), 'clicks')).toEqual([]);
  });

  it('knows when nothing has been recorded at all', () => {
    expect(hasMetrics(overview())).toBe(true);
    const bare = channel({
      series: [{ metric: 'impressions', points: [], total: 0, previous: null, recordedDays: 0 }],
    });
    expect(hasMetrics(overview([bare]))).toBe(false);
  });
});

describe('relativeTime', () => {
  it('counts minutes, hours and days and switches to the date after a week', () => {
    expect(relativeTime('2026-10-15T11:59:40.000Z', NOW)).toBe('just now');
    expect(relativeTime('2026-10-15T11:35:00.000Z', NOW)).toBe('25m ago');
    expect(relativeTime('2026-10-15T10:00:00.000Z', NOW)).toBe('2h ago');
    expect(relativeTime('2026-10-12T12:00:00.000Z', NOW)).toBe('3d ago');
    expect(relativeTime('2026-10-15T14:00:00.000Z', NOW)).toBe('in 2h');
    expect(relativeTime('2026-09-01T12:00:00.000Z', NOW)).toMatch(/Sep/);
    expect(relativeTime(null, NOW)).toBeNull();
    expect(relativeTime('not a date', NOW)).toBeNull();
  });
});

describe('syncBadge', () => {
  it('puts the actionable standing first, then the final one, then the wait', () => {
    expect(
      syncBadge(
        channel({
          support: 'needs_reconnect',
          sync: { status: 'needs_reconnect', lastSyncedAt: null, error: null },
        }),
        NOW,
      ),
    ).toMatchObject({ variant: 'danger', label: 'Needs reconnect' });

    expect(
      syncBadge(
        channel({
          support: 'unsupported',
          sync: { status: 'unsupported', lastSyncedAt: null, error: null },
        }),
        NOW,
      ),
    ).toMatchObject({ variant: 'outline', label: 'Not supported' });

    expect(syncBadge(channel(), NOW)).toEqual({
      variant: 'success',
      label: 'Synced 2h ago',
      explanation: null,
    });

    expect(
      syncBadge(channel({ sync: { status: 'never', lastSyncedAt: null, error: null } }), NOW),
    ).toMatchObject({ variant: 'secondary', label: 'Never synced' });

    expect(
      syncBadge(
        channel({ sync: { status: 'failed', lastSyncedAt: null, error: 'Rate limited' } }),
        NOW,
      ),
    ).toMatchObject({ variant: 'danger', label: 'Sync failed', explanation: 'Rate limited' });
  });
});

describe('syncPresentation', () => {
  it('is pending while asking and busy when the API did not answer', () => {
    expect(syncPresentation('unknown', NOW).status).toBe('pending');
    expect(syncPresentation(null, NOW).status).toBe('busy');
  });

  it('is online only when every supported channel last synced fine', () => {
    const shown = syncPresentation(
      sync([
        syncChannel(),
        syncChannel({
          channelId: 'ch_x',
          name: 'Acme on X',
          support: 'unsupported',
          status: 'unsupported',
          lastSyncedAt: null,
        }),
      ]),
      NOW,
    );
    expect(shown.status).toBe('online');
    expect(shown.label).toBe('Synced 2h ago');
    expect(shown.lines).toEqual(['Acme Marketing: synced 2h ago', 'Acme on X: not supported']);
  });

  it('is busy when a channel needs a person and away when nothing has synced or can', () => {
    expect(
      syncPresentation(
        sync([
          syncChannel(),
          syncChannel({ channelId: 'ch_x', name: 'Acme on X', status: 'needs_reconnect' }),
        ]),
        NOW,
      ),
    ).toMatchObject({ status: 'busy', label: '1 channel needs attention' });

    expect(
      syncPresentation(sync([syncChannel({ status: 'never', lastSyncedAt: null })]), NOW),
    ).toMatchObject({ status: 'away', label: 'Not synced yet' });

    expect(
      syncPresentation(sync([syncChannel()], { reachable: false, workerOnline: null }), NOW),
    ).toMatchObject({
      status: 'away',
      label: 'Scheduler unreachable',
    });
    expect(syncPresentation(sync([syncChannel()], { workerOnline: false }), NOW)).toMatchObject({
      status: 'away',
      label: 'No worker running',
    });
    expect(
      syncPresentation(sync([syncChannel({ support: 'unsupported', status: 'unsupported' })]), NOW),
    ).toMatchObject({ status: 'away', label: 'Nothing to sync' });
  });
});

describe('post metrics', () => {
  it('always shows the four core metrics and adds the ones the platform reported', () => {
    const metrics = {
      likes: 10,
      comments: 0,
      shares: 0,
      clicks: 0,
      impressions: 500,
      saves: 4,
      views: 0,
      engagements: 14,
      engagementRate: 2.8,
    };
    expect(postMetricsToShow(metrics, null)).toEqual([
      'impressions',
      'likes',
      'comments',
      'shares',
      'saves',
    ]);
    expect(postMetricsToShow(metrics, { ...metrics, views: 30 })).toContain('views');
  });
});

describe('syncFingerprint', () => {
  it('changes when a sync lands and not when only the generation time moves', () => {
    const before = overview();
    const regenerated = { ...before, generatedAt: '2026-10-15T12:05:00.000Z' };
    expect(syncFingerprint(regenerated)).toBe(syncFingerprint(before));

    const synced = overview([
      channel({ sync: { status: 'ok', lastSyncedAt: '2026-10-15T11:00:00.000Z', error: null } }),
    ]);
    expect(syncFingerprint(synced)).not.toBe(syncFingerprint(before));
  });
});
