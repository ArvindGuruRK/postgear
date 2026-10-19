/**
 * The analytics service against a fake repository, fake channels and a
 * fake scheduler: how rows become the overview, what `support` and the
 * sync status read for each kind of channel, the leaderboard, one post's
 * comparison, "sync now", and the refusals (404 for a foreign post, 422
 * for a foreign channel, logged).
 */
import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { State } from '@postgear/db';
import { securityLogger } from '../../common/logging/security-logger';
import type { Env } from '../../config/env';
import type { ChannelsService, ChannelView } from '../channels/channels.service';
import type { SchedulingService } from '../scheduling/scheduling.service';
import type {
  AnalyticsRepository,
  MetricSnapshotRow,
  RootRow,
  SnapshotRow,
  SnapshotWithPost,
  SyncRow,
} from './analytics.repository';
import { AnalyticsService, previewOf } from './analytics.service';

const NOW = Date.UTC(2026, 9, 15, 12); // 2026-10-15
const DAY = 24 * 60 * 60_000;

const doc = (text: string) =>
  JSON.stringify({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  });

function channel(overrides: Partial<ChannelView>): ChannelView {
  return {
    id: 'ch_li',
    internalId: 'acct',
    rootInternalId: 'acct',
    providerIdentifier: 'linkedin',
    name: 'Acme Marketing',
    profile: 'acme-marketing',
    picture: null,
    disabled: false,
    refreshNeeded: false,
    inBetweenSteps: false,
    tokenExpiration: null,
    postingTimes: [],
    additionalSettings: {},
    createdAt: new Date(NOW),
    health: 'connected',
    providerName: 'LinkedIn',
    color: 0,
    ...overrides,
  };
}

const linkedin = channel({});
const x = channel({
  id: 'ch_x',
  providerIdentifier: 'x',
  providerName: 'X',
  name: 'Acme on X',
  health: 'needs_reconnect',
  refreshNeeded: true,
});
const instagram = channel({
  id: 'ch_ig',
  providerIdentifier: 'instagram',
  providerName: 'Instagram',
  name: 'Acme Studio',
  health: 'needs_setup',
  inBetweenSteps: true,
});

const day = (back: number) => new Date(Date.UTC(2026, 9, 15) - back * DAY);
const metric = (
  integrationId: string,
  name: string,
  back: number,
  value: number,
): MetricSnapshotRow => ({ integrationId, metric: name, date: day(back), value });

function snapshot(overrides: Partial<SnapshotRow>): SnapshotRow {
  return {
    postId: 'post-1',
    integrationId: 'ch_li',
    capturedAt: new Date(NOW - 60_000),
    likes: 10,
    comments: 2,
    shares: 1,
    clicks: 4,
    impressions: 400,
    saves: 1,
    views: 0,
    ...overrides,
  };
}

function withPost(
  row: SnapshotRow,
  overrides: Partial<SnapshotWithPost['post']> = {},
): SnapshotWithPost {
  return {
    ...row,
    post: {
      id: row.postId,
      group: '22222222-2222-4222-8222-222222222222',
      publishDate: day(1),
      content: doc('Yesterday: the first post PostGear published on its own schedule.'),
      releaseURL: 'https://www.linkedin.com/feed/update/urn:li:share:seed-7001',
      ...overrides,
    },
  };
}

function root(overrides: Partial<RootRow>): RootRow {
  return {
    id: 'post-1',
    group: '22222222-2222-4222-8222-222222222222',
    integrationId: 'ch_li',
    state: State.PUBLISHED,
    publishDate: day(1),
    content: doc('Yesterday: the first post.'),
    settings: JSON.stringify({ customized: false }),
    releaseURL: 'https://www.linkedin.com/feed/update/urn:li:share:1',
    integration: {
      id: 'ch_li',
      name: 'Acme Marketing',
      providerIdentifier: 'linkedin',
      picture: null,
      profile: 'acme-marketing',
      deletedAt: null,
    },
    ...overrides,
  };
}

describe('AnalyticsService', () => {
  let repository: jest.Mocked<
    Pick<
      AnalyticsRepository,
      | 'metricRows'
      | 'syncRows'
      | 'latestSnapshotsForPostsPublishedBetween'
      | 'latestSnapshotsSince'
      | 'findRootsByGroup'
      | 'snapshotsForPosts'
    >
  >;
  let channels: { list: jest.Mock; colors: jest.Mock; listProviders: jest.Mock };
  let scheduling: { status: jest.Mock; syncAnalyticsNow: jest.Mock };
  let env: { ANALYTICS_SIMULATION?: string; PUBLISH_SIMULATION: string };
  let service: AnalyticsService;

  beforeEach(() => {
    repository = {
      metricRows: jest.fn().mockResolvedValue([]),
      syncRows: jest.fn().mockResolvedValue([]),
      latestSnapshotsForPostsPublishedBetween: jest.fn().mockResolvedValue([]),
      latestSnapshotsSince: jest.fn().mockResolvedValue([]),
      findRootsByGroup: jest.fn().mockResolvedValue([]),
      snapshotsForPosts: jest.fn().mockResolvedValue([]),
    };
    channels = {
      list: jest.fn().mockResolvedValue([linkedin, x, instagram]),
      colors: jest.fn().mockResolvedValue(
        new Map([
          ['ch_li', 0],
          ['ch_x', 1],
          ['ch_ig', 2],
          ['ch_gone', 3],
        ]),
      ),
      listProviders: jest.fn().mockReturnValue([
        { identifier: 'linkedin', name: 'LinkedIn', analytics: false },
        { identifier: 'x', name: 'X', analytics: true },
        { identifier: 'instagram', name: 'Instagram', analytics: true },
      ]),
    };
    scheduling = {
      status: jest.fn().mockResolvedValue({ reachable: true, workerOnline: true }),
      syncAnalyticsNow: jest.fn().mockResolvedValue(true),
    };
    env = { PUBLISH_SIMULATION: 'false' };
    const config = {
      get: (key: keyof typeof env) => env[key],
    } as unknown as ConfigService<Env, true>;

    service = new AnalyticsService(
      repository as unknown as AnalyticsRepository,
      channels as unknown as ChannelsService,
      scheduling as unknown as SchedulingService,
      config,
      () => NOW,
    );
  });

  describe('overview', () => {
    it('shapes the range, each channel’s series and support, the totals and the leaderboard', async () => {
      repository.metricRows.mockResolvedValue([
        metric('ch_li', 'followers', 10, 1_000), // before the range: the start level
        metric('ch_li', 'followers', 3, 1_050),
        metric('ch_li', 'followers', 0, 1_100),
        metric('ch_li', 'impressions', 8, 500), // previous period
        metric('ch_li', 'impressions', 2, 300),
        metric('ch_li', 'impressions', 0, 400),
        metric('ch_li', 'engagements', 2, 30),
        metric('ch_li', 'engagements', 0, 40),
        metric('ch_x', 'impressions', 1, 50),
      ]);
      repository.syncRows.mockResolvedValue([
        {
          integrationId: 'ch_li',
          status: 'OK',
          lastSyncedAt: new Date(NOW - 3_600_000),
          lastAttemptAt: new Date(NOW - 3_600_000),
          lastError: null,
          channelDays: 90,
          postsSynced: 1,
        } satisfies SyncRow,
        {
          integrationId: 'ch_x',
          status: 'NEEDS_RECONNECT',
          lastSyncedAt: null,
          lastAttemptAt: new Date(NOW - 7_200_000),
          lastError: 'Acme on X needs reconnecting before its metrics can be read.',
          channelDays: 0,
          postsSynced: 0,
        } satisfies SyncRow,
      ]);
      repository.latestSnapshotsForPostsPublishedBetween.mockResolvedValue([
        withPost(snapshot({ postId: 'post-1' })),
        withPost(snapshot({ postId: 'post-2', likes: 50, impressions: 2_000 }), {
          id: 'post-2',
          group: '33333333-3333-4333-8333-333333333333',
          content: doc('Bigger one'),
        }),
        withPost(
          snapshot({ postId: 'post-3', integrationId: 'ch_x', likes: 5, impressions: 100 }),
          {
            id: 'post-3',
            content: doc('On X'),
          },
        ),
      ]);

      const overview = await service.overview('org-1', { range: 7 });

      expect(overview).toMatchObject({
        range: 7,
        from: '2026-10-09',
        to: '2026-10-15',
        generatedAt: new Date(NOW).toISOString(),
        simulated: false,
      });
      expect(repository.metricRows).toHaveBeenCalledWith(
        'org-1',
        ['ch_li', 'ch_x', 'ch_ig'],
        new Date('2026-10-02T00:00:00.000Z'),
        new Date('2026-10-15T00:00:00.000Z'),
      );
      expect(repository.latestSnapshotsForPostsPublishedBetween).toHaveBeenCalledWith(
        'org-1',
        ['ch_li', 'ch_x', 'ch_ig'],
        new Date('2026-10-09T00:00:00.000Z'),
        new Date('2026-10-16T00:00:00.000Z'),
      );

      const [li, onX, ig] = overview.channels;

      // The real LinkedIn member provider has no metrics, and simulation is off.
      expect(li.support).toBe('unsupported');
      expect(li.sync).toEqual({
        status: 'ok',
        lastSyncedAt: new Date(NOW - 3_600_000).toISOString(),
        error: null,
      });
      expect(li.followers).toEqual({ value: 1_100, delta: 100, percent: 10 });
      expect(li.impressions).toEqual({ value: 700, delta: 200, percent: 40 });
      expect(li.engagements).toEqual({ value: 70, delta: null, percent: null });
      expect(li.engagementRate).toBe(10);
      expect(li.posts).toBe(2);
      expect(li.series.map((series) => series.metric)).toEqual([
        'followers',
        'impressions',
        'engagements',
      ]);
      expect(li.series[0].points).toHaveLength(7);

      expect(onX.support).toBe('needs_reconnect');
      expect(onX.sync.status).toBe('needs_reconnect');
      expect(onX.sync.error).toContain('reconnecting');
      expect(onX.followers).toBeNull();
      expect(onX.impressions).toEqual({ value: 50, delta: null, percent: null });
      expect(onX.posts).toBe(1);

      expect(ig.support).toBe('needs_setup');
      expect(ig.sync.status).toBe('never');
      expect(ig.series).toEqual([]);

      expect(overview.totals).toEqual({
        followers: { value: 1_100, delta: 100, percent: 10 },
        // X's 50 impressions have no previous period: they count in the
        // value, not as a gain from nothing.
        impressions: { value: 750, delta: 200, percent: 40 },
        engagements: { value: 70, delta: null, percent: null },
        engagementRate: 9.33,
        posts: 3,
      });

      expect(overview.topPosts.map((post) => [post.rank, post.postId])).toEqual([
        [1, 'post-2'],
        [2, 'post-1'],
        [3, 'post-3'],
      ]);
      expect(overview.topPosts[1]).toMatchObject({
        group: '22222222-2222-4222-8222-222222222222',
        channelId: 'ch_li',
        channelName: 'Acme Marketing',
        providerName: 'LinkedIn',
        preview: 'Yesterday: the first post PostGear published on its own schedule.',
        releaseURL: 'https://www.linkedin.com/feed/update/urn:li:share:seed-7001',
        metrics: { likes: 10, engagements: 14, engagementRate: 3.5 },
      });
    });

    it('treats every platform as supported in simulation', async () => {
      env.ANALYTICS_SIMULATION = 'true';

      const overview = await service.overview('org-1', { range: 30 });

      expect(overview.simulated).toBe(true);
      expect(overview.channels[0].support).toBe('supported');
      // Health still wins over the platform.
      expect(overview.channels[1].support).toBe('needs_reconnect');
    });

    it('follows PUBLISH_SIMULATION when ANALYTICS_SIMULATION is unset', async () => {
      env.PUBLISH_SIMULATION = 'true';

      expect((await service.overview('org-1', { range: 30 })).simulated).toBe(true);
    });

    it('narrows to one channel, and refuses one the workspace cannot see', async () => {
      const overview = await service.overview('org-1', { range: 30, channelId: 'ch_li' });
      expect(overview.channels.map((entry) => entry.channelId)).toEqual(['ch_li']);
      expect(repository.metricRows.mock.calls[0][1]).toEqual(['ch_li']);

      const warn = jest.spyOn(securityLogger, 'warn').mockImplementation(() => undefined);

      await expect(
        service.overview('org-1', { range: 30, channelId: 'someone-elses' }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(warn).toHaveBeenCalledWith('analytics.foreign_reference', {
        orgId: 'org-1',
        channelId: 'someone-elses',
      });
      expect(repository.metricRows).toHaveBeenCalledTimes(1);
      warn.mockRestore();
    });

    it('has empty totals and no channels for a workspace without any', async () => {
      channels.list.mockResolvedValue([]);

      const overview = await service.overview('org-1', { range: 90 });

      expect(overview.channels).toEqual([]);
      expect(overview.topPosts).toEqual([]);
      expect(overview.totals).toEqual({
        followers: null,
        impressions: { value: 0, delta: null, percent: null },
        engagements: { value: 0, delta: null, percent: null },
        engagementRate: null,
        posts: 0,
      });
    });
  });

  describe('exportCsv', () => {
    it('names the file by the range and renders the overview', async () => {
      const file = await service.exportCsv('org-1', { range: 7 });

      expect(file.filename).toBe('postgear-analytics-2026-10-09-2026-10-15.csv');
      expect(file.csv.startsWith('﻿section,channel,provider,date,metric,value')).toBe(true);
    });
  });

  describe('post', () => {
    it('is not found for a malformed group, a group with no rows, or another workspace’s', async () => {
      await expect(service.post('org-1', 'not-a-uuid')).rejects.toBeInstanceOf(NotFoundException);
      expect(repository.findRootsByGroup).not.toHaveBeenCalled();

      await expect(
        service.post('org-1', '22222222-2222-4222-8222-222222222222'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(repository.findRootsByGroup).toHaveBeenCalledWith(
        'org-1',
        '22222222-2222-4222-8222-222222222222',
      );
    });

    it('gives each channel its latest metrics, history, the channel average and a comparison', async () => {
      repository.findRootsByGroup.mockResolvedValue([
        root({}),
        root({
          id: 'post-x',
          integrationId: 'ch_gone',
          state: State.ERROR,
          releaseURL: null,
          integration: {
            id: 'ch_gone',
            name: 'Old X',
            providerIdentifier: 'x',
            picture: null,
            profile: null,
            deletedAt: new Date(NOW),
          },
        }),
      ]);
      repository.snapshotsForPosts.mockResolvedValue([
        snapshot({ capturedAt: new Date(NOW - 2 * DAY), likes: 4, impressions: 100 }),
        snapshot({ capturedAt: new Date(NOW - DAY), likes: 8, impressions: 300 }),
        snapshot({ capturedAt: new Date(NOW - 60_000), likes: 10, impressions: 400 }),
      ]);
      repository.latestSnapshotsSince.mockResolvedValue([
        snapshot({ postId: 'post-1', likes: 10, impressions: 400 }),
        snapshot({ postId: 'post-9', likes: 2, impressions: 400 }),
      ]);

      const post = await service.post('org-1', '22222222-2222-4222-8222-222222222222');

      expect(post).toMatchObject({
        group: '22222222-2222-4222-8222-222222222222',
        publishDate: day(1).toISOString(),
        preview: 'Yesterday: the first post.',
        state: State.ERROR,
      });
      expect(repository.latestSnapshotsSince).toHaveBeenCalledWith(
        'org-1',
        ['ch_li', 'ch_gone'],
        new Date(Date.UTC(2026, 9, 15) - 90 * DAY),
      );

      const [li, gone] = post.channels;

      expect(li).toMatchObject({
        channelId: 'ch_li',
        name: 'Acme Marketing',
        providerName: 'LinkedIn',
        support: 'unsupported',
        capturedAt: new Date(NOW - 60_000).toISOString(),
      });
      expect(li.metrics).toMatchObject({ likes: 10, impressions: 400, engagements: 14 });
      expect(li.history.map((entry) => entry.metrics.likes)).toEqual([4, 8, 10]);
      expect(li.average).toMatchObject({ likes: 6, impressions: 400 });
      expect(li.comparison).toMatchObject({
        likes: 'above',
        impressions: 'even',
        engagements: 'above',
        engagementRate: 'above',
      });

      // Disconnected after the post went out: its history stays, its support does not.
      expect(gone).toMatchObject({
        channelId: 'ch_gone',
        name: 'Old X',
        providerName: 'X',
        support: 'unsupported',
        metrics: null,
        capturedAt: null,
        average: null,
        comparison: {},
        history: [],
      });
    });
  });

  describe('sync', () => {
    it('reports the scheduler and each channel’s standing', async () => {
      repository.syncRows.mockResolvedValue([
        {
          integrationId: 'ch_ig',
          status: 'NEEDS_PERMISSIONS',
          lastSyncedAt: null,
          lastAttemptAt: new Date(NOW),
          lastError: 'Acme Studio has not granted PostGear permission to read its metrics.',
          channelDays: 0,
          postsSynced: 0,
        } satisfies SyncRow,
      ]);
      scheduling.status.mockResolvedValue({ reachable: false, workerOnline: null });

      const overview = await service.syncOverview('org-1');

      expect(overview).toMatchObject({ reachable: false, workerOnline: null, simulated: false });
      expect(overview.channels).toHaveLength(3);
      expect(overview.channels[0]).toMatchObject({
        channelId: 'ch_li',
        support: 'unsupported',
        status: 'never',
        lastSyncedAt: null,
        error: null,
        channelDays: 0,
      });
      expect(overview.channels[2]).toMatchObject({
        channelId: 'ch_ig',
        support: 'needs_setup',
        status: 'needs_permissions',
        lastAttemptAt: new Date(NOW).toISOString(),
        error: expect.stringContaining('permission'),
      });
    });

    it('asks for every channel that can be synced, or the one named', async () => {
      env.ANALYTICS_SIMULATION = 'true';

      await expect(service.syncNow('org-1', {})).resolves.toEqual({
        requested: true,
        channels: 1,
      });
      // Only the healthy channel: X needs reconnecting, Instagram is not set up.
      expect(scheduling.syncAnalyticsNow).toHaveBeenCalledWith([
        { integrationId: 'ch_li', organizationId: 'org-1' },
      ]);

      await expect(service.syncNow('org-1', { channelId: 'ch_li' })).resolves.toEqual({
        requested: true,
        channels: 1,
      });

      // A named channel that cannot be synced is nothing to ask for, not an error.
      await expect(service.syncNow('org-1', { channelId: 'ch_x' })).resolves.toEqual({
        requested: true,
        channels: 0,
      });
      expect(scheduling.syncAnalyticsNow).toHaveBeenCalledTimes(2);
    });

    it('reports an unreachable scheduler honestly, and refuses a foreign channel', async () => {
      env.ANALYTICS_SIMULATION = 'true';
      scheduling.syncAnalyticsNow.mockResolvedValue(false);

      await expect(service.syncNow('org-1', {})).resolves.toEqual({
        requested: false,
        channels: 1,
      });

      const warn = jest.spyOn(securityLogger, 'warn').mockImplementation(() => undefined);
      await expect(service.syncNow('org-1', { channelId: 'nope' })).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
      expect(warn).toHaveBeenCalledWith('analytics.foreign_reference', {
        orgId: 'org-1',
        channelId: 'nope',
      });
      warn.mockRestore();
    });
  });
});

describe('previewOf', () => {
  it('renders the document’s text, cut at 160 characters with an ellipsis', () => {
    expect(previewOf(doc('Short'))).toBe('Short');
    expect(previewOf(null)).toBe('');
    // Content that is not a document is legacy plain text, as the posts module reads it.
    expect(previewOf('{not json')).toBe('{not json');

    const long = previewOf(doc('x'.repeat(200)));
    expect(Array.from(long)).toHaveLength(160);
    expect(long.endsWith('…')).toBe(true);
  });
});
