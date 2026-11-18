/**
 * The official listers against recorded-shape answers through a fake
 * `ListerHttp` (no network): Helix users, past streams with null
 * `muted_segments`, a clips page with a cursor, an empty channel, a 401 that
 * gets a new token, a 429 that pauses Twitch; YouTube's `forHandle` miss, the
 * quota 403, the Clips day budget, and the three lists over one uploads list.
 * Both produce the same item shape the simulated and flat listers do.
 */
import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { RedisService } from '../../../redis/redis.service';
import type { ListerHttp, ListerHttpRequest, ListerHttpResponse } from './lister-http';
import { TwitchHelixLister } from './twitch-helix.lister';
import { YOUTUBE_DAILY_UNITS, YouTubeDataLister } from './youtube-data.lister';

type Route = (request: ListerHttpRequest) => {
  status?: number;
  json?: unknown;
  headers?: Record<string, string>;
};

function fakeHttp(route: Route): jest.MockedFunction<ListerHttp> {
  return jest.fn(async (request: ListerHttpRequest): Promise<ListerHttpResponse> => {
    const answer = route(request);
    const headers = Object.fromEntries(
      Object.entries(answer.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
    );
    return {
      status: answer.status ?? 200,
      json: answer.json ?? null,
      header: (name) => headers[name.toLowerCase()] ?? null,
    };
  });
}

function redis(): RedisService {
  return new RedisService({ get: () => undefined } as unknown as ConfigService);
}

const NOW = Date.parse('2026-11-18T12:00:00.000Z');
const TOKEN = { access_token: 'app-token-1', expires_in: 5_000_000, token_type: 'bearer' };
const USER = {
  id: '141981764',
  login: 'acme',
  display_name: 'Acme',
  broadcaster_type: 'affiliate',
  profile_image_url: 'https://static-cdn.example/acme.png',
};
const VIDEO = {
  id: '900000001',
  stream_id: '5551',
  user_id: '141981764',
  title: 'Friday stream',
  created_at: '2026-11-15T18:00:00Z',
  published_at: '2026-11-15T18:00:00Z',
  url: 'https://www.twitch.tv/videos/900000001',
  thumbnail_url: 'https://static-cdn.example/cf_vods/x/thumb0-%{width}x%{height}.jpg',
  viewable: 'public',
  view_count: 1_204,
  type: 'archive',
  duration: '3h2m10s',
  muted_segments: null,
};

beforeAll(() => Logger.overrideLogger(false));

describe('TwitchHelixLister', () => {
  function helix(route: Route) {
    const http = fakeHttp((request) => {
      if (request.url.startsWith('https://id.twitch.tv/')) return { json: TOKEN };
      return route(request);
    });
    const store = redis();
    const lister = new TwitchHelixLister({
      clientId: 'client',
      clientSecret: 'secret',
      http,
      redis: store,
      now: () => NOW,
    });
    return { lister, http, store };
  }

  it('resolves a login with an app token, sent as a form and cached', async () => {
    const { lister, http } = helix(() => ({ json: { data: [USER] } }));
    const channel = await lister.resolve('Acme');
    expect(channel).toEqual({
      platform: 'twitch',
      handle: 'acme',
      externalId: '141981764',
      displayName: 'Acme',
      avatarUrl: 'https://static-cdn.example/acme.png',
      broadcasterType: 'affiliate',
    });
    await lister.resolve('acme');
    const tokenCalls = http.mock.calls.filter(([request]) =>
      request.url.startsWith('https://id.twitch.tv/'),
    );
    expect(tokenCalls).toHaveLength(1);
    expect(tokenCalls[0][0]).toMatchObject({
      method: 'POST',
      form: { grant_type: 'client_credentials' },
    });
    const usersCall = http.mock.calls.find(([request]) => request.url.includes('/helix/users'));
    expect(usersCall?.[0].headers).toMatchObject({
      'Client-Id': 'client',
      Authorization: 'Bearer app-token-1',
    });
  });

  it('answers channel_not_found for an unknown or malformed name', async () => {
    const { lister, http } = helix(() => ({ json: { data: [] } }));
    await expect(lister.resolve('nobody_here')).rejects.toMatchObject({
      code: 'channel_not_found',
    });
    await expect(lister.resolve('a b')).rejects.toMatchObject({ code: 'channel_not_found' });
    expect(http.mock.calls.filter(([r]) => r.url.includes('login=a'))).toHaveLength(0);
  });

  it('lists past streams: sized pictures, parsed lengths, expiry, the live one, and the cursor', async () => {
    const { lister } = helix((request) => {
      if (request.url.includes('/helix/streams')) return { json: { data: [{ id: '5551' }] } };
      return {
        json: {
          data: [
            VIDEO,
            { ...VIDEO, id: '900000002', stream_id: '5550', thumbnail_url: '', duration: '45m0s' },
          ],
          pagination: { cursor: 'eyJiIjp7fX0' },
        },
      };
    });
    const page = await lister.list(
      {
        platform: 'twitch',
        handle: 'acme',
        externalId: '141981764',
        displayName: 'Acme',
        avatarUrl: null,
        broadcasterType: 'affiliate',
      },
      { kind: 'streams', limit: 50 },
    );
    expect(page.nextCursor).toBe('eyJiIjp7fX0');
    expect(page.items[0]).toEqual({
      externalId: '900000001',
      kind: 'vod',
      title: 'Friday stream',
      publishedAt: '2026-11-15T18:00:00Z',
      durationSec: 10_930,
      viewCount: 1_204,
      thumbnailUrl: 'https://static-cdn.example/cf_vods/x/thumb0-320x180.jpg',
      state: 'live',
      expiresAt: '2026-11-29T18:00:00.000Z',
    });
    expect(page.items[1]).toMatchObject({
      state: 'processing',
      thumbnailUrl: null,
      durationSec: 2_700,
    });
  });

  it('lists clips with the channel the canonical link needs, and ends on an empty page', async () => {
    const { lister, http } = helix(() => ({
      json: {
        data: [
          {
            id: 'AwkwardHelplessSalamanderSwiftRage',
            url: 'https://clips.twitch.tv/x',
            title: 'The play',
            view_count: 99,
            created_at: '2026-11-16T10:00:00Z',
            thumbnail_url: 'https://clips-media.example/x-preview.jpg',
            duration: 28.4,
            vod_offset: null,
          },
        ],
        pagination: {},
      },
    }));
    const page = await lister.list(
      {
        platform: 'twitch',
        handle: 'acme',
        externalId: '141981764',
        displayName: 'Acme',
        avatarUrl: null,
      },
      { kind: 'clips', limit: 50, period: 'week' },
    );
    expect(page.items[0]).toMatchObject({
      kind: 'clip',
      durationSec: 28.4,
      channel: 'acme',
      state: 'ready',
    });
    expect(page.nextCursor).toBeUndefined();
    const call = http.mock.calls.find(([r]) => r.url.includes('/helix/clips'))?.[0].url ?? '';
    expect(call).toContain('started_at=2026-11-11T12%3A00%3A00.000Z');
  });

  it('fetches a new token once on a 401', async () => {
    let first = true;
    const { lister, http } = helix(() => {
      if (first) {
        first = false;
        return { status: 401 };
      }
      return { json: { data: [USER] } };
    });
    await expect(lister.resolve('acme')).resolves.toMatchObject({ externalId: '141981764' });
    expect(http.mock.calls.filter(([r]) => r.url.startsWith('https://id.twitch.tv/'))).toHaveLength(
      2,
    );
  });

  it('pauses Twitch on a 429 and when 80 percent of the bucket is used', async () => {
    const limited = helix(() => ({
      status: 429,
      headers: { 'Ratelimit-Reset': String(NOW / 1000 + 30) },
    }));
    await expect(limited.lister.resolve('acme')).rejects.toMatchObject({
      code: 'platform_rate_limited',
    });
    const before = limited.http.mock.calls.length;
    await expect(limited.lister.resolve('acme')).rejects.toMatchObject({
      code: 'platform_rate_limited',
    });
    expect(limited.http.mock.calls.length).toBe(before);

    const nearly = helix(() => ({
      json: { data: [USER] },
      headers: {
        'Ratelimit-Limit': '800',
        'Ratelimit-Remaining': '150',
        'Ratelimit-Reset': String(NOW / 1000 + 20),
      },
    }));
    await expect(nearly.lister.resolve('acme')).resolves.toBeDefined();
    await expect(nearly.lister.resolve('acme')).rejects.toMatchObject({
      code: 'platform_rate_limited',
    });
  });

  it('reads bad keys as lister_unconfigured, so the selector can fall back', async () => {
    const http = fakeHttp(() => ({
      status: 403,
      json: { status: 403, message: 'invalid client secret' },
    }));
    const lister = new TwitchHelixLister({
      clientId: 'client',
      clientSecret: 'wrong',
      http,
      redis: redis(),
    });
    await expect(lister.resolve('acme')).rejects.toMatchObject({ code: 'lister_unconfigured' });
  });
});

describe('YouTubeDataLister', () => {
  const CHANNEL = {
    id: 'UCabcdefghijklmnopqrstuv',
    snippet: {
      title: 'Acme',
      customUrl: '@acme',
      thumbnails: { default: { url: 'https://yt.example/a.jpg' } },
    },
    contentDetails: { relatedPlaylists: { uploads: 'UUabcdefghijklmnopqrstuv' } },
  };
  const video = (id: string, duration: string, extra: Record<string, unknown> = {}) => ({
    id,
    snippet: {
      title: `Video ${id}`,
      publishedAt: '2026-11-10T10:00:00Z',
      liveBroadcastContent: 'none',
      thumbnails: { medium: { url: `https://i.ytimg.example/${id}.jpg` } },
    },
    contentDetails: { duration },
    statistics: { viewCount: '1500' },
    ...extra,
  });

  function youtube(route: Route, now = NOW) {
    const http = fakeHttp(route);
    const store = redis();
    return {
      lister: new YouTubeDataLister({ apiKey: 'yt-key', http, redis: store, now: () => now }),
      http,
      store,
    };
  }

  it('resolves a handle with forHandle and never calls search', async () => {
    const { lister, http } = youtube(() => ({ json: { items: [CHANNEL] } }));
    const channel = await lister.resolve('acme');
    expect(channel).toMatchObject({
      externalId: 'UCabcdefghijklmnopqrstuv',
      handle: '@acme',
      uploadsListId: 'UUabcdefghijklmnopqrstuv',
    });
    const url = http.mock.calls[0][0].url;
    expect(url).toContain('/youtube/v3/channels?');
    expect(url).toContain('forHandle=%40acme');
    expect(http.mock.calls.some(([r]) => r.url.includes('/search'))).toBe(false);
  });

  it('answers channel_not_found when forHandle finds nothing', async () => {
    const { lister } = youtube(() => ({
      json: { kind: 'youtube#channelListResponse', items: [] },
    }));
    await expect(lister.resolve('@nobody')).rejects.toMatchObject({ code: 'channel_not_found' });
  });

  it('splits the uploads list into videos, streams and Shorts', async () => {
    const { lister } = youtube((request) => {
      if (request.url.includes('/playlistItems')) {
        return {
          json: {
            nextPageToken: 'CDIQAA',
            items: ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc'].map((videoId) => ({
              contentDetails: { videoId },
            })),
          },
        };
      }
      return {
        json: {
          items: [
            video('aaaaaaaaaaa', 'PT12M3S'),
            video('bbbbbbbbbbb', 'PT45S'),
            video('ccccccccccc', 'PT2H1M', {
              liveStreamingDetails: { actualStartTime: '2026-11-09T20:00:00Z' },
            }),
          ],
        },
      };
    });
    const ref = {
      platform: 'youtube' as const,
      handle: '@acme',
      externalId: 'UCabcdefghijklmnopqrstuv',
      displayName: 'Acme',
      avatarUrl: null,
    };
    const uploads = await lister.list(ref, { kind: 'uploads', limit: 50 });
    expect(uploads.items.map((item) => [item.externalId, item.kind, item.durationSec])).toEqual([
      ['aaaaaaaaaaa', 'upload', 723],
    ]);
    expect(uploads.nextCursor).toBe('CDIQAA');
    expect(
      (await lister.list(ref, { kind: 'shorts', limit: 50 })).items.map((i) => i.externalId),
    ).toEqual(['bbbbbbbbbbb']);
    const streams = await lister.list(ref, { kind: 'streams', limit: 50 });
    expect(streams.items[0]).toMatchObject({
      externalId: 'ccccccccccc',
      kind: 'vod',
      publishedAt: '2026-11-09T20:00:00Z',
    });
    await expect(
      lister.list(ref, { kind: 'uploads', limit: 50, sort: 'views' }),
    ).rejects.toMatchObject({
      code: 'list_sort_unsupported',
    });
  });

  it('reads the quota 403 as quota_exhausted and stops asking until the Pacific midnight', async () => {
    const { lister, http } = youtube(() => ({
      status: 403,
      json: {
        error: { code: 403, errors: [{ reason: 'quotaExceeded', domain: 'youtube.quota' }] },
      },
    }));
    await expect(lister.resolve('@acme')).rejects.toMatchObject({ code: 'quota_exhausted' });
    await expect(lister.resolve('@acme')).rejects.toMatchObject({ code: 'quota_exhausted' });
    expect(http).toHaveBeenCalledTimes(1);
  });

  it('stops at the Clips day budget before calling YouTube', async () => {
    const { lister, http, store } = youtube(() => ({ json: { items: [CHANNEL] } }));
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(
      new Date(NOW),
    );
    for (let index = 0; index < YOUTUBE_DAILY_UNITS; index++) {
      await store.incrementWithTtl(`clips:youtube:units:${day}`, 60);
    }
    await expect(lister.resolve('@acme')).rejects.toMatchObject({ code: 'quota_exhausted' });
    expect(http).not.toHaveBeenCalled();
  });

  it('reads a key YouTube refuses as lister_unconfigured', async () => {
    const { lister } = youtube(() => ({
      status: 400,
      json: { error: { errors: [{ reason: 'keyInvalid' }] } },
    }));
    await expect(lister.resolve('@acme')).rejects.toMatchObject({ code: 'lister_unconfigured' });
  });
});
