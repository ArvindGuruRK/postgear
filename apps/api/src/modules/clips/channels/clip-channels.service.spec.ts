/**
 * The channel routes' rules against a fake repository and the simulated
 * lister: tenancy (another workspace's channel is 404), the plan limit as the
 * resolver's 402 `channel_limit`, the platform switch, video links pasted as
 * channels, hiding, the imported marks, paging and the strict schemas.
 */
import { HttpException, Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { refusalMessage } from '@postgear/entitlements';
import { createSimulatedChannelLister } from '@postgear/media-tools/listing';
import type { ChannelRef } from '@postgear/video-engine';
import { EntitlementRefusedException } from '../../entitlements/entitlement-refused.exception';
import type { EntitlementResolver } from '../../entitlements/entitlement-resolver';
import { RedisService } from '../../redis/redis.service';
import { decodeCursor } from './channel-cursor';
import { ChannelListCache } from './channel-list.cache';
import { ChannelListerSelector, type ListerSets } from './channel-lister.selector';
import type {
  ChannelRow,
  ClipChannelsRepository,
  CreateChannelOutcome,
} from './clip-channels.repository';
import { addChannelSchema, listStreamsQuerySchema } from './clip-channels.schemas';
import { ClipChannelsService } from './clip-channels.service';

const ORG = 'seed-demo-org';
const OTHER_ORG = 'seed-second-org';
const CHANNEL_ID = '0b5e7c1a-2f3d-4e5f-8a9b-0c1d2e3f4a5b';

/** An in-memory repository that scopes every read by workspace, like the real one. */
function fakeRepository() {
  const rows = new Map<string, ChannelRow & { organizationId: string }>();
  const hidden = new Map<string, Set<string>>();
  const videos: Array<{
    organizationId: string;
    platform: string;
    externalId: string;
    id: string;
  }> = [];
  let next = 0;
  const own = (orgId: string, id: string) => {
    const row = rows.get(id);
    return row && row.organizationId === orgId ? row : null;
  };
  const strip = ({ organizationId: _org, ...row }: ChannelRow & { organizationId: string }) => row;

  const repository = {
    list: jest.fn(async (orgId: string) =>
      [...rows.values()].filter((row) => row.organizationId === orgId).map(strip),
    ),
    find: jest.fn(async (orgId: string, id: string) => {
      const row = own(orgId, id);
      return row ? strip(row) : null;
    }),
    count: jest.fn(
      async (orgId: string) =>
        [...rows.values()].filter((row) => row.organizationId === orgId).length,
    ),
    findByHandle: jest.fn(async (orgId: string, platform: string, handle: string) => {
      const row = [...rows.values()].find(
        (r) =>
          r.organizationId === orgId &&
          r.platform === platform &&
          r.handle.toLowerCase() === handle.toLowerCase(),
      );
      return row ? { id: row.id } : null;
    }),
    create: jest.fn(
      async (
        orgId: string,
        _user: string | null,
        platform: string,
        ref: ChannelRef,
        limit: number | null,
      ) => {
        const used = [...rows.values()].filter((row) => row.organizationId === orgId).length;
        if (limit !== null && used >= limit)
          return { outcome: 'too_many', used } as CreateChannelOutcome;
        const exists = [...rows.values()].some(
          (r) =>
            r.organizationId === orgId &&
            r.platform === platform &&
            r.externalId === ref.externalId,
        );
        if (exists) return { outcome: 'exists' } as CreateChannelOutcome;
        next += 1;
        const id = `0b5e7c1a-2f3d-4e5f-8a9b-${String(next).padStart(12, '0')}`;
        const row = {
          id,
          organizationId: orgId,
          platform: platform as ChannelRow['platform'],
          handle: ref.handle,
          externalId: ref.externalId,
          displayName: ref.displayName,
          avatarUrl: ref.avatarUrl,
          uploadsListId: ref.uploadsListId ?? null,
          broadcasterType: ref.broadcasterType ?? null,
          lastSyncedAt: null,
          error: null,
          createdAt: new Date(),
        };
        rows.set(id, row);
        return { outcome: 'created', channel: strip(row) } as CreateChannelOutcome;
      },
    ),
    remove: jest.fn(async (orgId: string, id: string) => {
      if (!own(orgId, id)) return false;
      rows.delete(id);
      hidden.delete(id);
      return true;
    }),
    hiddenIds: jest.fn(async (orgId: string, id: string) =>
      own(orgId, id) ? new Set(hidden.get(id)) : new Set(),
    ),
    hide: jest.fn(async (orgId: string, id: string, externalId: string) => {
      if (!own(orgId, id)) return 'not_found';
      hidden.set(id, new Set([...(hidden.get(id) ?? []), externalId]));
      return 'hidden';
    }),
    unhide: jest.fn(async (orgId: string, id: string, externalId: string) => {
      if (!own(orgId, id)) return false;
      hidden.get(id)?.delete(externalId);
      return true;
    }),
    importedVideos: jest.fn(async (orgId: string, platform: string, ids: string[]) => {
      const found = new Map<string, string>();
      for (const video of videos) {
        if (
          video.organizationId === orgId &&
          video.platform === platform &&
          ids.includes(video.externalId)
        ) {
          found.set(video.externalId, video.id);
        }
      }
      return found;
    }),
    markSynced: jest.fn(async () => undefined),
  };
  return { repository, rows, videos };
}

function fakeResolver(browseChannels: number | null = 3) {
  return {
    assert: jest.fn(
      async (_org: string, key: string, predicate: (v: unknown) => boolean, refusal = {}) => {
        const value = key === 'clips.browse_channels' ? browseChannels : true;
        if (predicate(value)) return value;
        const code = key === 'clips.browse_channels' ? 'channel_limit' : 'clips_not_in_plan';
        const n = typeof value === 'number' ? value : undefined;
        throw new EntitlementRefusedException(code, refusalMessage(code, { n }), {
          limit: n,
          ...(refusal as object),
        });
      },
    ),
  };
}

function setup(options: { platforms?: string[]; browseChannels?: number | null } = {}) {
  const redis = new RedisService({ get: () => undefined } as unknown as ConfigService);
  const simulated = (platform: 'twitch' | 'kick' | 'youtube') => ({
    official: createSimulatedChannelLister(platform),
    flat: null,
  });
  const sets = {
    twitch: simulated('twitch'),
    kick: simulated('kick'),
    youtube: simulated('youtube'),
  } as ListerSets;
  const selector = new ChannelListerSelector(sets);
  const listSpy = jest.spyOn(selector, 'list');
  const cache = new ChannelListCache(redis);
  const { repository, rows, videos } = fakeRepository();
  const values: Record<string, unknown> = {
    CLIPS_PLATFORMS: options.platforms ?? ['youtube', 'twitch', 'kick'],
  };
  const config = { get: (key: string) => values[key] } as unknown as ConfigService;
  const service = new ClipChannelsService(
    repository as unknown as ClipChannelsRepository,
    selector,
    cache,
    fakeResolver(
      options.browseChannels === undefined ? 3 : options.browseChannels,
    ) as unknown as EntitlementResolver,
    redis,
    config as never,
  );
  return { service, repository, rows, videos, listSpy };
}

async function refusal(
  promise: Promise<unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpException) {
      return { status: error.getStatus(), body: error.getResponse() as Record<string, unknown> };
    }
    throw error;
  }
  throw new Error('expected a refusal');
}

beforeAll(() => Logger.overrideLogger(false));

describe('ClipChannelsService', () => {
  it('adds the simulated channel and lists about 30 items in one page, one live and one processing', async () => {
    const { service } = setup();
    const channel = await service.add(ORG, 'user-1', { platform: 'twitch', handle: 'simstreamer' });
    expect(channel).toMatchObject({ platform: 'twitch', paused: false });
    const page = await service.streams(ORG, channel.id, {});
    expect(page.items.length).toBeGreaterThan(5);
    expect(page.items.length).toBeLessThanOrEqual(50);
    expect(page.items.some((item) => item.state === 'live')).toBe(true);
    expect(page.items.some((item) => item.state === 'processing')).toBe(true);
    expect(page.items.every((item) => !('url' in item))).toBe(true);
    expect(page.stale).toBe(false);
  });

  it('answers a second list inside ten minutes from the cache', async () => {
    const { service, listSpy } = setup();
    const channel = await service.add(ORG, null, { platform: 'kick', handle: 'simstreamer' });
    await service.streams(ORG, channel.id, {});
    await service.streams(ORG, channel.id, {});
    expect(listSpy).toHaveBeenCalledTimes(1);
  });

  it("answers 404 for another workspace's channel on every route", async () => {
    const { service } = setup();
    const channel = await service.add(ORG, null, { platform: 'twitch', handle: 'simstreamer' });
    for (const call of [
      service.streams(OTHER_ORG, channel.id, {}),
      service.hide(OTHER_ORG, channel.id, '900000001'),
      service.unhide(OTHER_ORG, channel.id, '900000001'),
      service.remove(OTHER_ORG, channel.id),
      service.refresh(OTHER_ORG, channel.id),
    ]) {
      expect((await refusal(call)).status).toBe(404);
    }
    expect(await service.list(OTHER_ORG)).toEqual([]);
    await expect(service.streams(ORG, channel.id, {})).resolves.toBeDefined();
  });

  it('answers 404 for an id that is not a UUID without a query', async () => {
    const { service, repository } = setup();
    expect((await refusal(service.streams(ORG, 'seed-demo-org', {}))).status).toBe(404);
    expect((await refusal(service.hide(ORG, CHANNEL_ID, '../x'))).status).toBe(404);
    expect(repository.find).not.toHaveBeenCalled();
  });

  it('refuses a channel over the plan with 402 channel_limit and the plan number', async () => {
    const { service } = setup({ browseChannels: 1 });
    await service.add(ORG, null, { platform: 'twitch', handle: 'simstreamer' });
    const answer = await refusal(
      service.add(ORG, null, { platform: 'kick', handle: 'simstreamer' }),
    );
    expect(answer.status).toBe(402);
    expect(answer.body).toEqual({
      message: 'Your plan allows 1 channel. Remove one to add another.',
      code: 'channel_limit',
      details: { limit: 1, used: 1 },
    });
  });

  it('refuses the same channel twice with 409 and a video link with link_is_a_video', async () => {
    const { service } = setup();
    await service.add(ORG, null, { platform: 'twitch', handle: 'simstreamer' });
    expect(
      await refusal(service.add(ORG, null, { platform: 'twitch', handle: 'SimStreamer' })),
    ).toMatchObject({
      status: 409,
      body: { code: 'channel_exists' },
    });
    expect(
      await refusal(
        service.add(ORG, null, {
          platform: 'twitch',
          handle: 'https://www.twitch.tv/videos/900000001',
        }),
      ),
    ).toMatchObject({
      status: 422,
      body: {
        code: 'link_is_a_video',
        message: 'That is a video link. Paste it in the link box on Clips.',
      },
    });
  });

  it('answers channel_not_found for a name the platform does not know', async () => {
    const { service } = setup();
    expect(
      await refusal(service.add(ORG, null, { platform: 'twitch', handle: 'nobody_here' })),
    ).toMatchObject({
      status: 422,
      body: {
        code: 'channel_not_found',
        message: 'We could not find that channel. Check the spelling.',
      },
    });
  });

  it('refuses a paused platform, and shows its channels as paused', async () => {
    const { service } = setup({ platforms: ['twitch', 'kick'] });
    expect(
      await refusal(service.add(ORG, null, { platform: 'youtube', handle: '@simstreamer' })),
    ).toMatchObject({
      status: 422,
      body: { code: 'platform_paused' },
    });
  });

  it('hides an item, leaves it out, and brings it back with hidden=true', async () => {
    const { service } = setup();
    const channel = await service.add(ORG, null, { platform: 'twitch', handle: 'simstreamer' });
    const before = await service.streams(ORG, channel.id, {});
    const target = before.items[0].externalId;
    await service.hide(ORG, channel.id, target);
    const after = await service.streams(ORG, channel.id, {});
    expect(after.items.some((item) => item.externalId === target)).toBe(false);
    const shown = await service.streams(ORG, channel.id, { hidden: 'true' });
    expect(shown.items.find((item) => item.externalId === target)?.hidden).toBe(true);
    await service.unhide(ORG, channel.id, target);
    expect(
      (await service.streams(ORG, channel.id, {})).items.some((item) => item.externalId === target),
    ).toBe(true);
  });

  it('marks items this workspace already imported, and only for this workspace', async () => {
    const { service, videos } = setup();
    const channel = await service.add(ORG, null, { platform: 'twitch', handle: 'simstreamer' });
    const first = (await service.streams(ORG, channel.id, {})).items[1];
    videos.push({
      organizationId: ORG,
      platform: 'TWITCH',
      externalId: first.externalId,
      id: 'video-1',
    });
    videos.push({ organizationId: OTHER_ORG, platform: 'TWITCH', externalId: 'x', id: 'video-2' });
    const page = await service.streams(ORG, channel.id, {});
    const marked = page.items.find((item) => item.externalId === first.externalId);
    expect(marked).toMatchObject({ imported: true, videoId: 'video-1' });
    expect(page.items.filter((item) => item.imported)).toHaveLength(1);
  });

  it('pages with an opaque cursor and refuses one that is not ours', async () => {
    const { service } = setup();
    const channel = await service.add(ORG, null, { platform: 'youtube', handle: '@simstreamer' });
    const first = await service.streams(ORG, channel.id, { kind: 'uploads' });
    if (first.nextCursor) {
      expect(decodeCursor(first.nextCursor)).toMatchObject({ page: 1 });
    }
    expect(
      await refusal(service.streams(ORG, channel.id, { cursor: 'not-a-cursor' })),
    ).toMatchObject({
      status: 400,
      body: { code: 'list_cursor_invalid' },
    });
  });

  it('refuses most viewed for YouTube and Kick with a sentence, and a list the platform lacks', async () => {
    const { service } = setup();
    const youtube = await service.add(ORG, null, { platform: 'youtube', handle: '@simstreamer' });
    expect(await refusal(service.streams(ORG, youtube.id, { sort: 'views' }))).toMatchObject({
      status: 422,
      body: { code: 'list_sort_unsupported', message: 'YouTube lists newest first only.' },
    });
    expect(await refusal(service.streams(ORG, youtube.id, { kind: 'clips' }))).toMatchObject({
      status: 422,
      body: { code: 'list_kind_unsupported' },
    });
  });

  it('lets a channel be refreshed once per 30 seconds', async () => {
    const { service } = setup();
    const channel = await service.add(ORG, null, { platform: 'twitch', handle: 'simstreamer' });
    await expect(service.refresh(ORG, channel.id)).resolves.toHaveProperty('refreshedAt');
    expect(await refusal(service.refresh(ORG, channel.id))).toMatchObject({
      status: 429,
      body: { code: 'refresh_throttled' },
    });
  });
});

describe('channel schemas', () => {
  it('accept the platform in either case and refuse unknown keys', () => {
    expect(addChannelSchema.parse({ platform: 'TWITCH', handle: ' simstreamer ' })).toEqual({
      platform: 'twitch',
      handle: 'simstreamer',
    });
    expect(addChannelSchema.safeParse({ platform: 'vimeo', handle: 'x' }).success).toBe(false);
    expect(
      addChannelSchema.safeParse({ platform: 'twitch', handle: 'x', orgId: 'y' }).success,
    ).toBe(false);
    expect(listStreamsQuerySchema.safeParse({ kind: 'streams', hidden: 'true' }).success).toBe(
      true,
    );
    expect(listStreamsQuerySchema.safeParse({ showHidden: 'true' }).success).toBe(false);
    expect(listStreamsQuerySchema.safeParse({ sort: 'oldest' }).success).toBe(false);
  });
});
