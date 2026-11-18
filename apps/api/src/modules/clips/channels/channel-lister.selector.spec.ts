/**
 * The selector: official first, the flat list on the coded failures, the
 * official reason when the flat list cannot run, paging that stays on one
 * binding, and every answer checked against one shape. Also: the factory's
 * simulation answers in process and never reaches the network or the worker.
 */
import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import {
  type ChannelLister,
  ChannelListerError,
  type ChannelPage,
  type ChannelRef,
  type ListedItem,
} from '@postgear/video-engine';
import type { RedisService } from '../../redis/redis.service';
import type { SchedulingService } from '../../scheduling/scheduling.service';
import type { ClipPlatformBreaker } from '../links/platform-breaker';
import { ChannelListerSelector, type ListerSets } from './channel-lister.selector';
import { createListerSets } from './channel-listers.factory';
import { ListingFailure } from './listers/listing-failure';

const CHANNEL: ChannelRef = {
  platform: 'twitch',
  handle: 'acme',
  externalId: '1234',
  displayName: 'Acme',
  avatarUrl: null,
};

function item(externalId: string, overrides: Partial<ListedItem> = {}): ListedItem {
  return {
    externalId,
    kind: 'vod',
    title: `Stream ${externalId}`,
    publishedAt: '2026-11-10T10:00:00.000Z',
    durationSec: 3_600,
    viewCount: 10,
    thumbnailUrl: null,
    state: 'ready',
    ...overrides,
  };
}

function lister(answer: {
  page?: ChannelPage;
  error?: unknown;
  channel?: ChannelRef;
}): jest.Mocked<ChannelLister> {
  return {
    platform: 'twitch',
    resolve: jest.fn(async () => {
      if (answer.error) throw answer.error;
      return answer.channel ?? CHANNEL;
    }),
    list: jest.fn(async () => {
      if (answer.error) throw answer.error;
      return answer.page ?? { items: [item('1')] };
    }),
  } as unknown as jest.Mocked<ChannelLister>;
}

function selectorWith(official: ChannelLister | null, flat: ChannelLister | null) {
  const sets = {
    twitch: { official, flat },
    youtube: { official: null, flat: null },
    kick: { official: null, flat },
  } as unknown as ListerSets;
  return new ChannelListerSelector(sets);
}

const QUERY = { kind: 'streams' as const, limit: 50, sort: 'newest' as const };

beforeAll(() => Logger.overrideLogger(false));

describe('ChannelListerSelector', () => {
  it('asks the official binding first and stays there when it answers', async () => {
    const official = lister({});
    const flat = lister({});
    const { page, source } = await selectorWith(official, flat).list(
      'twitch',
      CHANNEL,
      QUERY,
      null,
    );
    expect(source).toBe('official');
    expect(page.items.map((row) => row.externalId)).toEqual(['1']);
    expect(flat.list).not.toHaveBeenCalled();
  });

  it.each(['platform_rate_limited', 'quota_exhausted', 'lister_unconfigured'] as const)(
    'falls back to the flat list on %s',
    async (code) => {
      const official = lister({ error: new ListingFailure(code) });
      const flat = lister({ page: { items: [item('9')] } });
      const { page, source } = await selectorWith(official, flat).list(
        'twitch',
        CHANNEL,
        QUERY,
        null,
      );
      expect(source).toBe('flat');
      expect(page.items[0].externalId).toBe('9');
    },
  );

  it('uses the flat list alone when the keys are missing', async () => {
    const flat = lister({});
    const { source } = await selectorWith(null, flat).list('twitch', CHANNEL, QUERY, null);
    expect(source).toBe('flat');
  });

  it('does not fall back on a real answer like channel_not_found', async () => {
    const official = lister({ error: new ListingFailure('channel_not_found') });
    const flat = lister({});
    await expect(selectorWith(official, flat).resolve('twitch', 'acme')).rejects.toMatchObject({
      code: 'channel_not_found',
    });
    expect(flat.resolve).not.toHaveBeenCalled();
  });

  it('answers the official reason when the flat list cannot run, and the flat reason when it can', async () => {
    const official = lister({ error: new ListingFailure('quota_exhausted') });
    const offline = lister({ error: new ListingFailure('tools_offline') });
    await expect(
      selectorWith(official, offline).list('twitch', CHANNEL, QUERY, null),
    ).rejects.toMatchObject({
      code: 'quota_exhausted',
    });
    const missing = lister({
      error: new ChannelListerError('channel_not_found', { retryable: false }),
    });
    await expect(
      selectorWith(official, missing).list('twitch', CHANNEL, QUERY, null),
    ).rejects.toMatchObject({
      code: 'channel_not_found',
    });
  });

  it('keeps a flat list on the flat binding, and continues an official list there by position', async () => {
    const official = lister({ error: new ListingFailure('platform_rate_limited') });
    const flat = lister({});
    const selector = selectorWith(official, flat);

    await selector.list('twitch', CHANNEL, QUERY, { source: 'flat', cursor: '51', page: 1 });
    expect(official.list).not.toHaveBeenCalled();
    expect(flat.list).toHaveBeenLastCalledWith(CHANNEL, { ...QUERY, cursor: '51' });

    await selector.list('twitch', CHANNEL, QUERY, {
      source: 'official',
      cursor: 'eyJiIjp7fX0',
      page: 2,
    });
    expect(official.list).toHaveBeenLastCalledWith(CHANNEL, { ...QUERY, cursor: 'eyJiIjp7fX0' });
    expect(flat.list).toHaveBeenLastCalledWith(CHANNEL, { ...QUERY, cursor: '101' });
  });

  it('drops rows that do not fit the shape, and refuses a channel that does not', async () => {
    const official = lister({
      page: {
        items: [
          item('1'),
          item('../etc', {}),
          item('2', { thumbnailUrl: 'http://not-https.example/a.jpg' }),
          { externalId: '3' } as unknown as ListedItem,
        ],
        nextCursor: 'next',
      },
    });
    const { page } = await selectorWith(official, null).list('twitch', CHANNEL, QUERY, null);
    expect(page.items.map((row) => row.externalId)).toEqual(['1']);
    expect(page.nextCursor).toBe('next');

    const broken = lister({ channel: { ...CHANNEL, displayName: '' } });
    await expect(selectorWith(broken, null).resolve('twitch', 'acme')).rejects.toMatchObject({
      code: 'platform_changed',
    });
  });
});

describe('createListerSets in simulation', () => {
  it('lists the fixture channel in process: no network, no worker', async () => {
    const values: Record<string, unknown> = { CLIPS_SIMULATION: 'true', NODE_ENV: 'development' };
    const config = { get: (key: string) => values[key] } as unknown as ConfigService;
    const http = jest.fn(async () => {
      throw new Error('the network was reached');
    });
    const scheduling = { runClipQuery: jest.fn() };
    const sets = createListerSets({
      config: config as never,
      scheduling: scheduling as unknown as SchedulingService,
      redis: {} as RedisService,
      breaker: {} as ClipPlatformBreaker,
      http,
    });
    const selector = new ChannelListerSelector(sets);

    for (const platform of ['twitch', 'kick', 'youtube'] as const) {
      const { channel } = await selector.resolve(platform, 'simstreamer');
      const kind = platform === 'youtube' ? 'uploads' : 'streams';
      const { page } = await selector.list(
        platform,
        channel,
        { kind, limit: 50, sort: 'newest' },
        null,
      );
      expect(page.items.length).toBeGreaterThan(0);
      expect(page.items.length).toBeLessThanOrEqual(50);
    }
    await expect(selector.resolve('twitch', 'someone_else')).rejects.toMatchObject({
      code: 'channel_not_found',
    });
    expect(http).not.toHaveBeenCalled();
    expect(scheduling.runClipQuery).not.toHaveBeenCalled();
  });
});
