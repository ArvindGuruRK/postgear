/**
 * Tenancy on every Clips address (Sprint 12, Module 19 section 9).
 *
 * The workspace comes only from the session (`@CurrentOrg()`), never from a
 * route or a body, so the one way a member of workspace B could reach
 * workspace A's video, clip, job, download, layout, sound, sticker or channel
 * is a lookup that forgets the workspace. This spec runs the real services
 * and repositories behind every id route as workspace B, against a database
 * stand-in that records each query and finds nothing, and asserts two
 * things for every route:
 *
 * - the answer is 404 "not found" (never 403, which would say the row exists);
 * - every query it made on a workspace's table carried workspace B's id.
 *
 * The other half (a signed file address cannot be reused after expiry, or
 * pointed at another workspace's key) is in `files/clip-files.controller.spec.ts`.
 * The e2e suite (`e2e/clips.spec.ts`) repeats the 404s against the real API
 * and database with two workspaces.
 */
import { HttpException, type Type } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { RedisService } from '../redis/redis.service';
import { ClipChannelsRepository } from './channels/clip-channels.repository';
import { ClipChannelsService } from './channels/clip-channels.service';
import { ClipEditsService } from './clip/clip-edits.service';
import { ClipExportsService } from './clip/clip-exports.service';
import { ClipItemService } from './clip/clip-item.service';
import { ClipDownloadsRepository } from './downloads/clip-downloads.repository';
import { ClipDownloadsService } from './downloads/clip-downloads.service';
import { ClipHighlightsService } from './highlights/clip-highlights.service';
import { ClipJobsRepository } from './jobs/clip-jobs.repository';
import { ClipJobsService } from './jobs/clip-jobs.service';
import { ClipLayoutsRepository } from './layouts/clip-layouts.repository';
import { ClipLayoutsService } from './layouts/clip-layouts.service';
import { ClipSoundUploadsRepository } from './library/clip-sound-uploads.repository';
import { ClipSoundUploadsService } from './library/clip-sound-uploads.service';
import { ClipStickerUploadsRepository } from './library/clip-sticker-uploads.repository';
import { ClipStickerUploadsService } from './library/clip-sticker-uploads.service';
import { ClipVideosRepository } from './videos/clip-videos.repository';
import { ClipVideosService } from './videos/clip-videos.service';

interface RecordedQuery {
  model: string;
  op: string;
  args: unknown;
}

const mockQueries: RecordedQuery[] = [];

jest.mock('@postgear/db', () => {
  const actual = jest.requireActual('@postgear/db');
  /** What an empty database answers. */
  const empty = (op: string): unknown => {
    if (op === 'findMany' || op === 'groupBy') return [];
    if (op === 'count') return 0;
    if (op.endsWith('Many')) return { count: 0 };
    if (op === 'aggregate') return { _sum: {}, _count: {} };
    return null;
  };
  const model = (name: string) =>
    new Proxy(
      {},
      {
        get: (_target, op: string) => {
          if (op === 'fields') return new Proxy({}, { get: () => ({}) });
          return async (args: unknown) => {
            mockQueries.push({ model: name, op, args });
            return empty(op);
          };
        },
      },
    );
  const client: Record<string, unknown> = new Proxy(
    {},
    {
      get: (_target, name: string) => {
        if (name === 'then') return undefined;
        if (name === '$transaction') {
          return async (work: unknown) =>
            typeof work === 'function' ? work(client) : Promise.all(work as unknown[]);
        }
        if (name === '$queryRaw' || name === '$executeRaw') {
          return async (sql: unknown) => {
            mockQueries.push({ model: name, op: 'raw', args: sql });
            return name === '$queryRaw' ? [] : 0;
          };
        }
        return model(name);
      },
    },
  );
  return { ...actual, prisma: client };
});

const ORG_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
/** Workspace A's row, as if workspace B's member pasted its address. */
const ID_FROM_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

/**
 * Tables that belong to no workspace: the shared library and the global
 * deny list. Every other query must carry the workspace.
 */
const SHARED_TABLES = new Set([
  'clipSticker',
  'clipSound',
  'clipLibrarySource',
  'clipBlockedVideo',
]);

/** True when the query names workspace B anywhere in its filter (or raw SQL values). */
function carriesOrg(value: unknown, orgId: string, depth = 0): boolean {
  if (depth > 8 || value === null || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (record.organizationId === orgId || record.orgId === orgId) return true;
  if (Array.isArray(record.values) && record.values.includes(orgId)) return true;
  return Object.values(record).some((inner) => carriesOrg(inner, orgId, depth + 1));
}

/**
 * Anything outside the database (storage, Temporal, Redis, the resolver,
 * notifications) answers "nothing" quietly: the routes must reach their own
 * lookup and refuse there.
 */
function quietStub(): unknown {
  const fn = async () => undefined;
  return new Proxy(fn, {
    get: (_target, key) => (key === 'then' ? undefined : quietStub()),
    apply: async () => undefined,
  });
}

const SERVICES: Type<unknown>[] = [
  ClipVideosService,
  ClipItemService,
  ClipEditsService,
  ClipExportsService,
  ClipJobsService,
  ClipDownloadsService,
  ClipHighlightsService,
  ClipLayoutsService,
  ClipSoundUploadsService,
  ClipStickerUploadsService,
  ClipChannelsService,
];

const REPOSITORIES: Type<unknown>[] = [
  ClipVideosRepository,
  ClipJobsRepository,
  ClipDownloadsRepository,
  ClipLayoutsRepository,
  ClipSoundUploadsRepository,
  ClipStickerUploadsRepository,
  ClipChannelsRepository,
];

/** The settings the constructors read; anything else is unset. */
const SETTINGS: Record<string, unknown> = {
  CLIPS_SIMULATION: true,
  CLIPS_PLATFORMS: ['youtube', 'twitch', 'kick'],
  AI_SIMULATION: true,
  NODE_ENV: 'test',
};

let get: <T>(type: Type<T>) => T;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    providers: [
      ...SERVICES,
      ...REPOSITORIES,
      { provide: ConfigService, useValue: { get: (key: string) => SETTINGS[key] } },
      // Under every rate limit, so each route reaches its own lookup.
      {
        provide: RedisService,
        useValue: {
          incrementWithTtl: async () => 1,
          setIfAbsent: async () => true,
          get: async () => null,
          set: async () => undefined,
          delete: async () => undefined,
        },
      },
    ],
  })
    .useMocker(() => quietStub())
    .compile();
  get = <T>(type: Type<T>) => moduleRef.get(type);
});

beforeEach(() => {
  mockQueries.length = 0;
});

async function refusalOf(call: () => Promise<unknown>): Promise<number | string> {
  try {
    await call();
    return 'answered';
  } catch (error) {
    return error instanceof HttpException ? error.getStatus() : String(error);
  }
}

/** One row per id route: the label, then the call it makes as workspace B. */
const ROUTES: Array<[string, () => Promise<unknown>]> = [
  ['GET /clips/videos/:videoId', () => get(ClipVideosService).get(ORG_B, ID_FROM_A)],
  ['POST /clips/videos/:videoId/cancel', () => get(ClipVideosService).cancel(ORG_B, ID_FROM_A)],
  ['DELETE /clips/videos/:videoId', () => get(ClipVideosService).remove(ORG_B, ID_FROM_A)],
  [
    'GET /clips/videos/:videoId/highlights',
    () => get(ClipHighlightsService).latest(ORG_B, ID_FROM_A),
  ],
  ['GET /clips/:clipId', () => get(ClipItemService).get(ORG_B, ID_FROM_A)],
  [
    'PATCH /clips/:clipId',
    () => get(ClipEditsService).patch(ORG_B, ID_FROM_A, { revision: 1, title: 'Mine now' }),
  ],
  ['POST /clips/:clipId/open', () => get(ClipEditsService).open(ORG_B, ID_FROM_A)],
  ['DELETE /clips/:clipId', () => get(ClipEditsService).remove(ORG_B, ID_FROM_A)],
  ['GET /clips/:clipId/exports', () => get(ClipExportsService).history(ORG_B, ID_FROM_A)],
  [
    'GET /clips/:clipId/previews/latest',
    () => get(ClipExportsService).latestPreview(ORG_B, ID_FROM_A),
  ],
  ['GET /clips/jobs/:jobId', () => get(ClipJobsService).view(ORG_B, ID_FROM_A)],
  ['POST /clips/jobs/:jobId/cancel', () => get(ClipJobsService).cancel(ORG_B, ID_FROM_A)],
  ['GET /clips/downloads/:jobId/file', () => get(ClipDownloadsService).fileUrl(ORG_B, ID_FROM_A)],
  [
    'POST /clips/downloads/:jobId/save-to-media',
    () => get(ClipDownloadsService).saveToMedia(ORG_B, ID_FROM_A),
  ],
  ['DELETE /clips/downloads/:jobId', () => get(ClipDownloadsService).remove(ORG_B, ID_FROM_A)],
  [
    'PATCH /clips/layouts/:id',
    () => get(ClipLayoutsService).rename(ORG_B, ID_FROM_A, { name: 'Mine now' }),
  ],
  ['DELETE /clips/layouts/:id', () => get(ClipLayoutsService).remove(ORG_B, ID_FROM_A)],
  [
    'DELETE /clips/sounds/uploads/:assetId',
    () => get(ClipSoundUploadsService).remove(ORG_B, ID_FROM_A),
  ],
  [
    'DELETE /clips/stickers/uploads/:assetId',
    () => get(ClipStickerUploadsService).remove(ORG_B, ID_FROM_A),
  ],
  [
    'GET /clips/channels/:id/streams',
    () => get(ClipChannelsService).streams(ORG_B, ID_FROM_A, {} as never),
  ],
  ['POST /clips/channels/:id/refresh', () => get(ClipChannelsService).refresh(ORG_B, ID_FROM_A)],
  ['DELETE /clips/channels/:id', () => get(ClipChannelsService).remove(ORG_B, ID_FROM_A)],
];

describe('Clips tenancy: another workspace gets "not found" (Module 19)', () => {
  it.each(ROUTES)('%s', async (_label, call) => {
    expect(await refusalOf(call)).toBe(404);

    expect(mockQueries.length).toBeGreaterThan(0);
    const unscoped = mockQueries.filter(
      (query) => !SHARED_TABLES.has(query.model) && !carriesOrg(query.args, ORG_B),
    );
    expect(unscoped).toEqual([]);
  });

  it('covers videos, clips, jobs, downloads, layouts, sounds, stickers and channels', () => {
    const areas = new Set(ROUTES.map(([label]) => label.split('/')[2]?.replace(/^:.*/, 'clip')));
    for (const area of [
      'videos',
      'clip',
      'jobs',
      'downloads',
      'layouts',
      'sounds',
      'stickers',
      'channels',
    ]) {
      expect(areas).toContain(area);
    }
  });
});
