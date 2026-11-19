/**
 * Security sweep, "Links" (Sprint 12, Module 20 section 1), the API half.
 *
 * What must hold:
 * - only `canonicalUrl` values rebuilt from an id reach the worker (and so
 *   yt-dlp) for a probe, an import or a download; pasted noise never does;
 * - look-alike hosts, other schemes, credentials and very long input are
 *   refused before any tool runs;
 * - the thumbnail route fetches only through the guarded fetch;
 * - the channel listers reach only their fixed origins, with a name they
 *   checked, and no listing answer carries a download address.
 *
 * The downloader's own last gate is in
 * `packages/media-tools/src/downloader/links.security.test.ts`; the yt-dlp
 * channel page builder in `packages/media-tools/src/channels/flat-list.test.ts`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import * as path from 'node:path';
import { HttpException, Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import {
  type ChannelLister,
  type ChannelRef,
  canonicalLinkFor,
  type LinkInfo,
  type LinkRef,
} from '@postgear/video-engine';
import type { EntitlementResolver } from '../../entitlements/entitlement-resolver';
import { RedisService } from '../../redis/redis.service';
import type { SchedulingService } from '../../scheduling/scheduling.service';
import { ChannelListerSelector, type ListerSets } from '../channels/channel-lister.selector';
import {
  createListerHttp,
  LISTER_ORIGINS,
  type ListerHttpRequest,
} from '../channels/listers/lister-http';
import { TwitchHelixLister } from '../channels/listers/twitch-helix.lister';
import { YouTubeDataLister } from '../channels/listers/youtube-data.lister';
import type { ClipLinksRepository } from './clip-links.repository';
import { ClipLinksService } from './clip-links.service';
import { ClipThumbnailsService } from './clip-thumbnails.service';
import { ClipPlatformBreaker } from './platform-breaker';

const mockFetchBinarySafely = jest.fn();
jest.mock('@postgear/seo-engine', () => {
  const actual = jest.requireActual('@postgear/seo-engine');
  return { ...actual, fetchBinarySafely: (...args: unknown[]) => mockFetchBinarySafely(...args) };
});

const ORG = 'org-sweep';
const CLIPS_SRC = path.resolve(__dirname, '..');
const API_SRC = path.resolve(__dirname, '..', '..', '..');

beforeAll(() => Logger.overrideLogger(false));

function redis(): RedisService {
  return new RedisService({ get: () => undefined } as unknown as ConfigService);
}

function listSources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listSources(full));
    else if (/\.ts$/.test(name) && !/\.(spec|test)\.ts$/.test(name)) out.push(full);
  }
  return out;
}

/** The answer the worker gives for whatever link it was sent: the same video. */
function infoFor(link: LinkRef): LinkInfo {
  return {
    platform: link.platform,
    kind: link.kind,
    externalId: link.externalId,
    canonicalUrl: 'https://evil.example/not-the-canonical-one',
    title: 'A stream',
    channelName: 'Acme',
    durationMs: 60_000,
    live: false,
    thumbnailUrl: null,
    formats: [],
    ...(link.channel ? { channel: link.channel } : {}),
  } as LinkInfo;
}

function linkService() {
  const scheduling = {
    runClipQuery: jest.fn(async (request: { args: [LinkRef] }) => ({
      outcome: 'answered',
      value: infoFor(request.args[0]),
    })),
  };
  const store = redis();
  const resolver = { assert: jest.fn(async () => true) };
  const repository = {
    existingVideoId: jest.fn(async () => null),
    isBlocked: jest.fn(async () => false),
  };
  const config = { get: () => ['youtube', 'twitch', 'kick'] };
  const service = new ClipLinksService(
    scheduling as unknown as SchedulingService,
    resolver as unknown as EntitlementResolver,
    store,
    new ClipPlatformBreaker(store),
    repository as unknown as ClipLinksRepository,
    config as never,
  );
  return { service, scheduling };
}

describe('what reaches the worker from a pasted link', () => {
  const noisy = [
    'https://WWW.YOUTUBE.COM./watch?v=dQw4w9WgXcQ&list=PL590L5WQmH8fJ54F369BLDSqIwcs-TCfs&t=42s&sim=resting#x',
    'youtu.be/dQw4w9WgXcQ?si=abc&feature=share',
    'https://m.twitch.tv/videos/900000001?t=1h2m3s&filter=archives',
    'https://www.kick.com/Sim_Streamer/videos/0A1B2C3D-4E5F-4A6B-8C7D-9E0F1A2B3C4D?utm_source=x',
  ];

  it.each(noisy)('only the address rebuilt from the id: %s', async (pasted) => {
    const { service, scheduling } = linkService();
    const result = await service.probe(ORG, pasted);
    expect(scheduling.runClipQuery).toHaveBeenCalledTimes(1);
    const request = scheduling.runClipQuery.mock.calls[0]?.[0] as { args: [LinkRef] } | undefined;
    if (!request) throw new Error('the worker was not asked');
    const [sent] = request.args;
    expect(sent.canonicalUrl).toBe(canonicalLinkFor(sent));
    expect(JSON.stringify(sent)).not.toContain('list=');
    expect(JSON.stringify(sent)).not.toContain('sim=');
    expect(JSON.stringify(sent)).not.toContain('utm_');
    // The answer keeps the address recognition built, whatever the worker said.
    expect(result.info.canonicalUrl).toBe(sent.canonicalUrl);
    // What an import or a download is built from is that same recognised link.
    expect(result.link).toEqual(sent);
  });

  const hostile = [
    'https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ',
    'https://www.yоutube.com/watch?v=dQw4w9WgXcQ',
    'http://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'https://user:pass@www.twitch.tv/videos/900000001',
    'https://www.twitch.tv:8443/videos/900000001',
    'https://www.twitch.tv/videos/900000001\nhttps://evil.example',
    `https://www.youtube.com/watch?v=dQw4w9WgXcQ&pad=${'a'.repeat(10_000)}`,
    'x'.repeat(100_000),
    'https://www.youtube.com/playlist?list=PL590L5WQmH8fJ54F369BLDSqIwcs-TCfs',
    'https://www.twitch.tv/vikram/videos',
  ];

  it.each(hostile.map((pasted) => [pasted.slice(0, 60), pasted]))(
    'refuses %j before any tool',
    async (_label, pasted) => {
      const { service, scheduling } = linkService();
      const error = await service.probe(ORG, pasted).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(422);
      expect(scheduling.runClipQuery).not.toHaveBeenCalled();
    },
  );
});

describe('the thumbnail route', () => {
  const config = {
    get: (key: string) =>
      ({ CLIPS_URL_SECRET: 'x'.repeat(48), API_URL: 'http://localhost:3001' })[key],
  } as unknown as ConfigService;

  beforeEach(() => mockFetchBinarySafely.mockReset());

  it('fetches only through the guarded fetch, with its caps, and only a signed https address', async () => {
    const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    mockFetchBinarySafely.mockResolvedValue({ body: PNG, https: true });
    const service = new ClipThumbnailsService(config as never);
    const link = service.linkFor('https://static-cdn.example/thumb.jpg');
    expect(link).not.toBeNull();
    const token = new URL(link as string).searchParams.get('u');
    await service.fetch(token);
    expect(mockFetchBinarySafely).toHaveBeenCalledTimes(1);
    const [address, options] = mockFetchBinarySafely.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(address).toBe('https://static-cdn.example/thumb.jpg');
    expect(options).toMatchObject({ maxBytes: 2 * 1024 * 1024, verifyCertificate: true });
    expect(options.maxRedirects).toBeLessThanOrEqual(3);

    // Nothing that is not our own signed token is ever fetched.
    for (const bad of ['https://evil.example/a.png', `${token}x`, '', null, 42]) {
      await expect(service.fetch(bad)).rejects.toBeInstanceOf(HttpException);
    }
    expect(service.linkFor('http://static-cdn.example/thumb.jpg')).toBeNull();
    expect(service.linkFor('file:///etc/passwd')).toBeNull();
    expect(mockFetchBinarySafely).toHaveBeenCalledTimes(1);
  });

  it('is never handed another fetch by a module, and no Clips code calls fetch on its own', () => {
    const sources = listSources(API_SRC);
    const binders = sources.filter((file) =>
      /provide:\s*THUMBNAIL_FETCH/.test(readFileSync(file, 'utf8')),
    );
    expect(binders).toEqual([]);
    // Only the lister helper may call the global fetch, and it pins its origins.
    const callers = listSources(CLIPS_SRC)
      .filter((file) =>
        /\b(globalThis\.fetch|(?<![\w.])fetch)\s*\(/.test(readFileSync(file, 'utf8')),
      )
      .filter(
        (file) =>
          !/(clip-thumbnails\.service|channel-list\.cache|clip-links\.controller)\.ts$/.test(file),
      )
      .map((file) => path.relative(CLIPS_SRC, file).split(path.sep).join('/'));
    expect(callers).toEqual([]);
    const helper = readFileSync(
      path.join(CLIPS_SRC, 'channels', 'listers', 'lister-http.ts'),
      'utf8',
    );
    expect(helper).toContain("redirect: 'error'");
  });
});

describe('the channel listers', () => {
  const NOW = Date.parse('2026-11-18T12:00:00.000Z');

  function recordingHttp(seen: ListerHttpRequest[]) {
    return jest.fn(async (request: ListerHttpRequest) => {
      seen.push(request);
      const json = request.url.startsWith('https://id.twitch.tv/')
        ? { access_token: 'app-token', expires_in: 5_000_000, token_type: 'bearer' }
        : { data: [], items: [] };
      return { status: 200, json, header: () => null };
    });
  }

  const hostileNames = [
    'acme/videos',
    'acme?login=other',
    'acme#x',
    '../helix/users',
    'acme%2Fx',
    'a b',
    'x'.repeat(300),
    'https://evil.example/',
  ];

  it('Twitch: refuses a name that could change the address before asking anything', async () => {
    const seen: ListerHttpRequest[] = [];
    const lister = new TwitchHelixLister({
      clientId: 'client',
      clientSecret: 'secret',
      http: recordingHttp(seen),
      redis: redis(),
      now: () => NOW,
    });
    for (const name of hostileNames) {
      await expect(lister.resolve(name)).rejects.toMatchObject({ code: 'channel_not_found' });
    }
    expect(seen.filter((request) => request.url.includes('/helix/'))).toEqual([]);
  });

  it('YouTube: refuses a name that could change the address before asking anything', async () => {
    const seen: ListerHttpRequest[] = [];
    const lister = new YouTubeDataLister({
      apiKey: 'yt-key',
      http: recordingHttp(seen),
      redis: redis(),
      now: () => NOW,
    });
    for (const name of hostileNames) {
      await expect(lister.resolve(name)).rejects.toMatchObject({ code: 'channel_not_found' });
    }
    expect(seen).toEqual([]);
  });

  it('every request goes to a fixed origin, with the name only as an encoded value', async () => {
    const seen: ListerHttpRequest[] = [];
    const twitch = new TwitchHelixLister({
      clientId: 'client',
      clientSecret: 'secret',
      http: recordingHttp(seen),
      redis: redis(),
      now: () => NOW,
    });
    const youtube = new YouTubeDataLister({
      apiKey: 'yt-key',
      http: recordingHttp(seen),
      redis: redis(),
      now: () => NOW,
    });
    await twitch.resolve('acme_streams').catch(() => undefined);
    await youtube.resolve('acme.streams').catch(() => undefined);
    expect(seen.length).toBeGreaterThan(0);
    for (const request of seen) {
      expect(LISTER_ORIGINS).toContain(new URL(request.url).origin);
    }
  });

  it('the HTTP helper refuses any other origin before a request is made', async () => {
    const fetchImpl = jest.fn();
    const http = createListerHttp({ fetchImpl: fetchImpl as unknown as typeof fetch });
    for (const url of [
      'https://api.twitch.tv.evil.example/helix/users',
      'http://api.twitch.tv/helix/users',
      'https://api.twitch.tv:8443/helix/users',
      'https://user@api.twitch.tv/helix/users',
      'https://www.googleapis.com.evil.example/youtube/v3/channels',
      'https://evil.example/',
      'not a url',
    ]) {
      await expect(http({ url })).rejects.toMatchObject({ code: 'channel_listing_failed' });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('no listing answer carries a download address, whatever a binding sends', async () => {
    const channel: ChannelRef = {
      platform: 'twitch',
      handle: 'acme',
      externalId: '1234',
      displayName: 'Acme',
      avatarUrl: null,
    };
    const drifting = {
      platform: 'twitch',
      resolve: jest.fn(async () => channel),
      list: jest.fn(async () => ({
        items: [
          {
            externalId: '900000001',
            kind: 'vod',
            title: 'Friday',
            publishedAt: '2026-11-10T10:00:00.000Z',
            durationSec: 60,
            viewCount: 1,
            thumbnailUrl: 'https://static-cdn.example/a.jpg',
            state: 'ready',
            url: 'https://usher.ttvnw.net/vod/900000001.m3u8',
            downloadUrl: 'https://cdn.example/900000001.mp4',
            canonicalUrl: 'https://www.twitch.tv/videos/900000001',
            webpage_url: 'https://www.twitch.tv/videos/900000001',
            manifestUrl: 'https://cdn.example/master.m3u8',
            formats: [{ url: 'https://cdn.example/1080.m3u8' }],
          },
        ],
      })),
    } as unknown as ChannelLister;
    const sets = {
      twitch: { official: drifting, flat: null },
      youtube: { official: null, flat: null },
      kick: { official: null, flat: null },
    } as unknown as ListerSets;
    const { page } = await new ChannelListerSelector(sets).list(
      'twitch',
      channel,
      { kind: 'streams', limit: 50, sort: 'newest' },
      null,
    );
    expect(page.items).toHaveLength(1);
    expect(Object.keys(page.items[0] as object).sort()).toEqual(
      [
        'durationSec',
        'externalId',
        'kind',
        'publishedAt',
        'state',
        'thumbnailUrl',
        'title',
        'viewCount',
      ].sort(),
    );
    expect(JSON.stringify(page)).not.toMatch(/m3u8|\.mp4|webpage_url|formats/);
  });
});
