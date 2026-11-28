/**
 * Security sweep, Secrets (Sprint 12, Module 20), the API's half.
 *
 * What must hold: `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, the Twitch app
 * token, `CLIPS_YOUTUBE_API_KEY`, `CLIPS_URL_SECRET`, the S3 keys, the yt-dlp
 * proxy and the cookies file never appear in a log line, an error or an
 * answer; the cookies file is read by the worker alone.
 *
 * The channel routes are run for real (the factory, both official listers,
 * the selector, the flat fallback, the service and the global exception
 * filter) with secret-looking keys, against platforms that misbehave on
 * purpose: they echo the key and the token back in their error bodies, and
 * the network error names the full address with the key in it. Everything
 * the process prints is captured and searched for every secret.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import * as path from 'node:path';
import { HttpException, Logger, type LoggerService } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { ChannelRef } from '@postgear/video-engine';
import { HttpExceptionFilter } from '../../common/filters/http-exception.filter';
import { redact, securityLogger } from '../../common/logging/security-logger';
import { validateEnv } from '../../config/env';
import type { EntitlementResolver } from '../entitlements/entitlement-resolver';
import { RedisService } from '../redis/redis.service';
import type { SchedulingService } from '../scheduling/scheduling.service';
import { ChannelListCache } from './channels/channel-list.cache';
import { ChannelListerSelector } from './channels/channel-lister.selector';
import { createListerSets } from './channels/channel-listers.factory';
import type { ChannelRow, ClipChannelsRepository } from './channels/clip-channels.repository';
import { ClipChannelsService } from './channels/clip-channels.service';
import {
  createListerHttp,
  type ListerHttp,
  type ListerHttpRequest,
} from './channels/listers/lister-http';
import { ClipPlatformBreaker } from './links/platform-breaker';
import { ThumbnailSigner } from './links/thumbnail-signer';

const ORG = 'seed-demo-org';

const CLIENT_ID = 'twitch-client-id-7f3a9c1e5b2d';
const CLIENT_SECRET = 'twitch-client-secret-4e8b0d6a2c9f';
const APP_TOKEN = 'twitch-app-token-8d2f6b0e4a1c';
const YOUTUBE_KEY = 'AIzaYoutubeKeyExample-1c5e9a3b7d0f';
const URL_SECRET = 'clips-url-secret-0123456789abcdef0123456789';
const S3_ACCESS = 'AKIAEXAMPLEACCESS0042';
const S3_SECRET = 's3-secret-key-5f4e3d2c1b0a99887766';
const PROXY = 'http://proxyuser42:proxy-pass-9a8b7c6d@10.9.8.7:3128';
const COOKIES = '/run/secrets/operator-youtube-cookies.txt';

const SECRETS = [
  CLIENT_ID,
  CLIENT_SECRET,
  APP_TOKEN,
  YOUTUBE_KEY,
  URL_SECRET,
  S3_ACCESS,
  S3_SECRET,
  PROXY,
  'proxy-pass-9a8b7c6d',
  COOKIES,
];

/** Every secret in `text`, as is or as an address would encode it. */
function leaks(text: string): string[] {
  return SECRETS.filter(
    (secret) => text.includes(secret) || text.includes(encodeURIComponent(secret)),
  );
}

// --- Everything the process prints ---------------------------------------------

let printed: string[] = [];

function asText(value: unknown): string {
  if (value instanceof Error) return `${value.stack ?? value.message}`;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

const sink = (...args: unknown[]) => {
  printed.push(args.map(asText).join(' '));
};
const capture: LoggerService = {
  log: sink,
  error: sink,
  warn: sink,
  debug: sink,
  verbose: sink,
  fatal: sink,
};

beforeAll(() => Logger.overrideLogger(capture));

beforeEach(() => {
  printed = [];
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    jest.spyOn(console, method).mockImplementation(sink);
  }
  for (const stream of [process.stdout, process.stderr]) {
    jest.spyOn(stream, 'write').mockImplementation((chunk: unknown) => {
      printed.push(String(chunk));
      return true;
    });
  }
});

afterEach(() => jest.restoreAllMocks());

// --- A platform that repeats every secret it is given ---------------------------

type Mode = 'echo' | 'answer';

function echoingHttp(mode: Mode) {
  const requests: ListerHttpRequest[] = [];
  const reply = (status: number, json: unknown) => ({
    status,
    header: () => null,
    json,
  });
  const http: ListerHttp = async (request) => {
    requests.push(request);
    const url = new URL(request.url);
    if (url.origin === 'https://id.twitch.tv') {
      return reply(200, { access_token: APP_TOKEN, expires_in: 5_000_000 });
    }
    if (url.origin === 'https://api.twitch.tv') {
      if (mode === 'echo') {
        return reply(401, {
          status: 401,
          message: `Invalid OAuth token ${APP_TOKEN} for client ${CLIENT_ID} (${CLIENT_SECRET})`,
        });
      }
      if (url.pathname.endsWith('/users')) {
        return reply(200, {
          data: [{ id: '12345', login: 'somestreamer', display_name: 'Some Streamer' }],
        });
      }
      if (url.pathname.endsWith('/streams')) return reply(200, { data: [] });
      return reply(200, {
        data: [
          {
            id: '777',
            stream_id: null,
            title: 'A Past Stream',
            created_at: '2026-11-01T10:00:00Z',
            thumbnail_url: 'https://static-cdn.jtvnw.net/x-%{width}x%{height}.jpg',
            view_count: 10,
            duration: '1h2m3s',
          },
        ],
        pagination: {},
      });
    }
    return reply(403, {
      error: {
        code: 403,
        message: `API key not valid: ${YOUTUBE_KEY} at ${request.url}`,
        errors: [{ reason: 'keyInvalid', message: `key=${YOUTUBE_KEY}` }],
      },
    });
  };
  return { http, requests };
}

/** The worker's flat list fails with every operator secret in its text. */
function leakyScheduling() {
  const runClipQuery = jest.fn(async () => ({
    outcome: 'failed' as const,
    error: new Error(`yt-dlp --proxy ${PROXY} --cookies ${COOKIES} failed for key=${YOUTUBE_KEY}`),
  }));
  return { runClipQuery } as unknown as SchedulingService;
}

function fakeRepository() {
  const rows = new Map<string, ChannelRow>();
  return {
    findByHandle: jest.fn(async () => null),
    findByExternalId: jest.fn(async () => null),
    count: jest.fn(async () => rows.size),
    create: jest.fn(async (_org: string, _user: unknown, platform: string, ref: ChannelRef) => {
      const row: ChannelRow = {
        id: `0b5e7c1a-2f3d-4e5f-8a9b-${String(rows.size + 1).padStart(12, '0')}`,
        platform: platform as ChannelRow['platform'],
        handle: ref.handle,
        externalId: ref.externalId,
        displayName: ref.displayName,
        avatarUrl: ref.avatarUrl,
        uploadsListId: ref.uploadsListId ?? null,
        broadcasterType: ref.broadcasterType ?? null,
        lastSyncedAt: null,
        error: null,
        createdAt: new Date('2026-11-19T00:00:00Z'),
      };
      rows.set(row.id, row);
      return { outcome: 'created' as const, channel: row };
    }),
    find: jest.fn(async (_org: string, id: string) => rows.get(id) ?? null),
    hiddenIds: jest.fn(async () => new Set<string>()),
    importedVideos: jest.fn(async () => new Map<string, string>()),
    markSynced: jest.fn(async () => undefined),
  };
}

function setup(http: ListerHttp) {
  const values: Record<string, unknown> = {
    NODE_ENV: 'production',
    CLIPS_SIMULATION: 'false',
    CLIPS_PLATFORMS: ['youtube', 'twitch', 'kick'],
    TWITCH_CLIENT_ID: CLIENT_ID,
    TWITCH_CLIENT_SECRET: CLIENT_SECRET,
    CLIPS_YOUTUBE_API_KEY: YOUTUBE_KEY,
    CLIPS_URL_SECRET: URL_SECRET,
    S3_ACCESS_KEY: S3_ACCESS,
    S3_SECRET_KEY: S3_SECRET,
  };
  const config = { get: (key: string) => values[key] } as unknown as ConfigService;
  const redis = new RedisService({ get: () => undefined } as unknown as ConfigService);
  const sets = createListerSets({
    config: config as never,
    scheduling: leakyScheduling(),
    redis,
    breaker: new ClipPlatformBreaker(redis),
    http,
  });
  const resolver = {
    assert: jest.fn(async (_org: string, key: string, predicate: (value: unknown) => boolean) => {
      const value = key === 'clips.browse_channels' ? null : true;
      if (!predicate(value)) throw new Error('refused');
      return value;
    }),
  } as unknown as EntitlementResolver;
  const service = new ClipChannelsService(
    fakeRepository() as unknown as ClipChannelsRepository,
    new ChannelListerSelector(sets),
    new ChannelListCache(redis, Date.now, async () => undefined),
    resolver,
    redis,
    config as never,
  );
  return { service };
}

/** What the browser receives for a thrown error: the global filter's answer. */
function answerFor(exception: unknown): { status: number; body: unknown } {
  let status = 0;
  let body: unknown = null;
  const response = {
    status(code: number) {
      status = code;
      return response;
    },
    json(value: unknown) {
      body = value;
    },
  };
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({ method: 'POST', url: '/clips/channels' }),
    }),
  };
  new HttpExceptionFilter().catch(exception, host as never);
  return { status, body };
}

async function thrown(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected a refusal');
}

/** The thrown error, its answer and everything printed, all free of every secret. */
function expectNoLeak(error: unknown): { status: number; body: unknown } {
  expect(error).toBeInstanceOf(HttpException);
  // The refusal carries no cause: the platform's text stays inside the binding.
  expect((error as { cause?: unknown }).cause).toBeUndefined();
  expect(leaks(asText(error))).toEqual([]);
  expect(leaks(JSON.stringify((error as HttpException).getResponse()))).toEqual([]);
  const answer = answerFor(error);
  expect(leaks(JSON.stringify(answer.body))).toEqual([]);
  expect(leaks(printed.join('\n'))).toEqual([]);
  return answer;
}

describe('the channel routes with platforms that repeat the keys', () => {
  it('Twitch: a 401 naming the token and the client, then a flat list that names the proxy', async () => {
    const { http, requests } = echoingHttp('echo');
    const { service } = setup(http);
    const error = await thrown(
      service.add(ORG, 'user-1', { platform: 'twitch', handle: 'somestreamer' }),
    );
    const answer = expectNoLeak(error);
    expect(answer.status).toBe(503);
    expect(answer.body).toMatchObject({ code: 'channel_listing_failed' });
    // The binding really ran: a token, then Helix twice (one retry on the 401).
    expect(requests.map((request) => new URL(request.url).origin)).toEqual([
      'https://id.twitch.tv',
      'https://api.twitch.tv',
      'https://id.twitch.tv',
      'https://api.twitch.tv',
    ]);
    // It did log, by code: the log is useful without the secrets.
    expect(printed.join('\n')).toContain('clips.channels.fallback');
  });

  it('YouTube: a 403 whose body repeats the key and the address carrying it', async () => {
    const { http, requests } = echoingHttp('echo');
    const { service } = setup(http);
    const error = await thrown(service.check(ORG, { platform: 'youtube', handle: '@somechannel' }));
    expectNoLeak(error);
    // The key rode in the query string, as the Data API asks: only to Google.
    expect(
      requests.every((request) => new URL(request.url).origin === 'https://www.googleapis.com'),
    ).toBe(true);
  });

  it('a network error that names the address with the key in it', async () => {
    const fetchImpl = jest.fn(async (input: unknown, init?: { body?: unknown }) => {
      throw new TypeError(`fetch failed: ${String(input)} ${String(init?.body ?? '')}`);
    }) as unknown as typeof fetch;
    const { service } = setup(createListerHttp({ fetchImpl }));
    for (const platform of ['youtube', 'twitch'] as const) {
      const handle = platform === 'youtube' ? '@somechannel' : 'somestreamer';
      expectNoLeak(await thrown(service.add(ORG, null, { platform, handle })));
    }
    expect(fetchImpl).toHaveBeenCalled();
  });

  it('a listing that works answers with no key, token or address of ours', async () => {
    const { http } = echoingHttp('answer');
    const { service } = setup(http);
    const channel = await service.add(ORG, 'user-1', {
      platform: 'twitch',
      handle: 'somestreamer',
    });
    const page = await service.streams(ORG, channel.id, {});
    expect(page.items).toHaveLength(1);
    expect(leaks(JSON.stringify({ channel, page }))).toEqual([]);
    expect(leaks(printed.join('\n'))).toEqual([]);
  });
});

describe('the security log', () => {
  it('redacts every Clips secret by its name, however it is nested', () => {
    const context = {
      TWITCH_CLIENT_ID: CLIENT_ID,
      TWITCH_CLIENT_SECRET: CLIENT_SECRET,
      CLIPS_YOUTUBE_API_KEY: YOUTUBE_KEY,
      CLIPS_URL_SECRET: URL_SECRET,
      YTDLP_PROXY: PROXY,
      YTDLP_COOKIES_FILE: COOKIES,
      S3_ACCESS_KEY: S3_ACCESS,
      S3_SECRET_KEY: S3_SECRET,
      helix: { headers: { 'Client-Id': CLIENT_ID, Authorization: `Bearer ${APP_TOKEN}` } },
      twitch: { clientId: CLIENT_ID, appToken: APP_TOKEN, accessKeyId: S3_ACCESS },
    };
    expect(leaks(JSON.stringify(redact(context)))).toEqual([]);
    securityLogger.warn('clips.throttled', context);
    securityLogger.log('entitlement.refused', { nested: [context] });
    expect(printed.join('\n')).toContain('clips.throttled');
    expect(leaks(printed.join('\n'))).toEqual([]);
  });

  it("redacts the media service's internal token header (Sprint 13)", () => {
    const token = 'media-internal-token-value-0001';
    const out = JSON.stringify(
      redact({
        request: { headers: { 'X-PostGear-Internal': token, 'x-postgear-internal': token } },
      }),
    );
    expect(out).not.toContain(token);
    expect(out).toContain('[REDACTED]');
  });
});

describe('boot refusals', () => {
  const base = {
    DATABASE_URL: 'postgresql://localhost/db',
    JWT_SECRET: 'x'.repeat(32),
    ENCRYPTION_KEY_AES256: 'a'.repeat(64),
  };

  function bootMessage(env: Record<string, string>): string {
    try {
      validateEnv({ ...base, ...env });
      return '';
    } catch (error) {
      return (error as Error).message;
    }
  }

  it('name the variable and never repeat its value', () => {
    const halfTwitch = bootMessage({ TWITCH_CLIENT_ID: CLIENT_ID });
    expect(halfTwitch).toContain('TWITCH_CLIENT_SECRET');
    const shortSecret = bootMessage({ CLIPS_URL_SECRET: 'short-url-secret-77' });
    expect(shortSecret).toContain('CLIPS_URL_SECRET');
    const halfS3 = bootMessage({
      STORAGE_PROVIDER: 's3',
      S3_BUCKET_NAME: 'postgear-media',
      S3_PUBLIC_URL: 'https://cdn.example.com',
      S3_ACCESS_KEY: S3_ACCESS,
    });
    expect(halfS3).toContain('S3_SECRET_KEY');
    const all = `${halfTwitch}\n${shortSecret}\n${halfS3}`;
    expect(leaks(all)).toEqual([]);
    expect(all).not.toContain('short-url-secret-77');
  });
});

describe('signed thumbnail links', () => {
  it('carry a signature, never CLIPS_URL_SECRET', () => {
    const signer = new ThumbnailSigner(URL_SECRET);
    const token = signer.sign('https://static-cdn.jtvnw.net/picture.jpg') as string;
    expect(token).toBeTruthy();
    const decoded = Buffer.from(token.split('.')[0] as string, 'base64url').toString('utf8');
    expect(leaks(`${token}\n${decoded}`)).toEqual([]);
    expect(signer.verify(token)).toEqual({
      ok: true,
      url: 'https://static-cdn.jtvnw.net/picture.jpg',
    });
  });
});

describe('the cookies file and the proxy', () => {
  const REPO = path.resolve(__dirname, '..', '..', '..', '..', '..');
  /** Built from parts, so this file does not name them itself. */
  const NAMES = [
    ['YTDLP', 'COOKIES', 'FILE'].join('_'),
    ['YTDLP', 'PROXY'].join('_'),
    'cookiesFile',
  ];
  const SKIP = new Set(['node_modules', 'dist', '.next', '.turbo', 'coverage']);

  function sources(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
      if (SKIP.has(name)) continue;
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) out.push(...sources(full));
      else if (/\.(ts|tsx)$/.test(name) && !/\.(spec|test)\.tsx?$/.test(name)) out.push(full);
    }
    return out;
  }

  it('are read by the worker alone: no API or web source names them', () => {
    const files = [
      ...sources(path.join(REPO, 'apps', 'api', 'src')),
      ...sources(path.join(REPO, 'apps', 'web', 'src')),
    ];
    expect(files.length).toBeGreaterThan(100);
    const offenders = files.filter((file) => {
      const text = readFileSync(file, 'utf8');
      return NAMES.some((name) => text.includes(name));
    });
    expect(offenders.map((file) => path.relative(REPO, file))).toEqual([]);
  });

  it('the API reaches media-tools only through its listing entry and the Drive door (Module 12)', () => {
    const files = sources(path.join(REPO, 'apps', 'api', 'src'));
    const imports = files.flatMap((file) =>
      [
        ...readFileSync(file, 'utf8').matchAll(/from\s+['"](@postgear\/media-tools[^'"]*)['"]/g),
      ].map((match) => match[1]),
    );
    expect(imports.length).toBeGreaterThan(0);
    expect([...new Set(imports)].sort()).toEqual([
      '@postgear/media-tools/drive',
      '@postgear/media-tools/listing',
    ]);
    // The Drive door never sees the cookies file or the proxy either.
    const drive = readFileSync(
      path.join(REPO, 'packages', 'media-tools', 'src', 'drive', 'drive.ts'),
      'utf8',
    );
    expect(NAMES.filter((name) => drive.includes(name))).toEqual([]);
  });
});
