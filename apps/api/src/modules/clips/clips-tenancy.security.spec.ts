/**
 * Security sweep, Module 20: "Tenancy", the two answers the id-route spec
 * (`clips-tenancy.spec.ts`) does not reach because they take no id:
 * `GET /clips/coming-up` and `GET /entitlements/me`.
 *
 * For each: the route takes the workspace only from the session
 * (`@CurrentOrg()`), every query it makes carries that workspace, a row
 * planted to point across workspaces shows nothing, and a cached answer is
 * never shared between two workspaces.
 *
 * Existing tests this builds on: clips-tenancy.spec.ts (22 id routes, 404
 * and the workspace on every query) and clip/clips-list.service.spec.ts:414
 * (Coming Up shows another workspace only its own).
 */
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';
import { EntitlementResolver } from '../entitlements/entitlement-resolver';
import { EntitlementsController } from '../entitlements/entitlements.controller';
import { EntitlementsRepository, type OrgBilling } from '../entitlements/entitlements.repository';
import type { RedisService } from '../redis/redis.service';
import { ClipItemController } from './clip/clip-item.controller';
import { ClipPostsService } from './clip/clip-posts.service';
import { ClipsListService } from './clip/clips-list.service';
import { ClipSoundUploadsRepository } from './library/clip-sound-uploads.repository';
import { ClipSoundUploadsService } from './library/clip-sound-uploads.service';
import { ClipStickerUploadsRepository } from './library/clip-sticker-uploads.repository';
import { ClipStickerUploadsService } from './library/clip-sticker-uploads.service';
import {
  assetRow,
  clipRow,
  emptyTables,
  type FakeTables,
  fakeClipDb,
} from './testing/fake-clip-db';
import { TEST_ORG, videoRow } from './testing/rows';
import type { ClipPlaybackService } from './videos/clip-playback.service';

interface RecordedQuery {
  model: string;
  op: string;
  args: unknown;
}

const mockQueries: RecordedQuery[] = [];
let mockDb: Record<string, unknown> = {};

jest.mock('@postgear/db', () => {
  const actual = jest.requireActual('@postgear/db');
  return {
    ...actual,
    prisma: new Proxy(
      {},
      { get: (_target, key) => (mockDb as Record<string | symbol, unknown>)[key] },
    ),
  };
});

/** Wraps a database stand-in so every table call is written down before it runs. */
function recording(db: Record<string, unknown>): Record<string, unknown> {
  return new Proxy(db, {
    get(target, model: string) {
      const table = target[model];
      if (!table || typeof table !== 'object') return table;
      return new Proxy(table as Record<string, unknown>, {
        get(inner, op: string) {
          const fn = inner[op];
          if (typeof fn !== 'function') return fn;
          return (args: unknown) => {
            mockQueries.push({ model, op, args });
            return (fn as (a: unknown) => unknown)(args);
          };
        },
      });
    },
  });
}

/** True when the query names the workspace anywhere in its filter. */
function carriesOrg(value: unknown, orgId: string, depth = 0): boolean {
  if (depth > 8 || value === null || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (record.organizationId === orgId || record.orgId === orgId) return true;
  return Object.values(record).some((inner) => carriesOrg(inner, orgId, depth + 1));
}

/** The queries that forgot the workspace (the plan table belongs to no workspace). */
function unscoped(orgId: string): string[] {
  return mockQueries
    .filter((query) => query.model !== 'planEntitlement')
    .filter((query) => {
      if (query.model === 'organization') {
        return (query.args as { where?: { id?: string } })?.where?.id !== orgId;
      }
      return !carriesOrg(query.args, orgId);
    })
    .map((query) => `${query.model}.${query.op}`);
}

const ORG_A = TEST_ORG;
const ORG_B = 'seed-second-org';
const NOW = new Date('2026-10-30T10:00:00.000Z');

/** Workspace ids for the two workspaces' rows, told apart by their first letter. */
const A = {
  video: 'a0000000-0000-4000-8000-000000000001',
  clip: 'a1000000-0000-4000-8000-000000000001',
  media: 'a2000000-0000-4000-8000-000000000001',
};
const B = {
  video: 'b0000000-0000-4000-8000-000000000001',
  clip: 'b1000000-0000-4000-8000-000000000001',
  media: 'b2000000-0000-4000-8000-000000000001',
};

/** The same small workspace twice, plus two rows planted to cross between them. */
function seed(): FakeTables {
  const tables = emptyTables();
  tables.media = [];
  for (const [org, ids, group] of [
    [ORG_A, A, 'group-a'],
    [ORG_B, B, 'group-b'],
  ] as const) {
    tables.videos.push(
      videoRow({ id: ids.video, organizationId: org, status: 'READY', title: `Video ${org}` }),
    );
    tables.clips.push(
      clipRow({
        id: ids.clip,
        organizationId: org,
        videoId: ids.video,
        title: `Clip ${org}`,
        exportedMediaId: ids.media,
        revision: 2,
        lastExportedRevision: 2,
      }),
    );
    tables.clipPosts.push({
      id: `${ids.clip.slice(0, 2)}-post-link`,
      organizationId: org,
      clipId: ids.clip,
      postGroup: group,
      mediaId: ids.media,
      createdAt: NOW,
    } as never);
    tables.posts.push({
      id: `${group}-post`,
      organizationId: org,
      group,
      state: 'QUEUE',
      deletedAt: null,
    });
    tables.assets.push(
      assetRow({
        id: `${ids.video}-proxy`,
        organizationId: org,
        videoId: ids.video,
        kind: 'PROXY',
        key: `clips/${org}/proxy`,
      }),
      assetRow({
        id: `${ids.video}-poster`,
        organizationId: org,
        videoId: ids.video,
        kind: 'POSTER',
        key: `clips/${org}/poster`,
        meta: { atMs: 0, width: 1280, height: 720 },
      }),
    );
    tables.media.push({
      id: ids.media,
      organizationId: org,
      name: 'clip.mp4',
      path: 'x.mp4',
      thumbnail: null,
      fileSize: 1,
      width: 1080,
      height: 1920,
      durationMs: 30_000,
      deletedAt: null,
      createdAt: NOW,
    });
  }
  // Planted: a link in B that names A's clip, and A's waiting post in a group B links to.
  tables.clipPosts.push(
    {
      id: 'planted-1',
      organizationId: ORG_B,
      clipId: A.clip,
      postGroup: 'group-b',
      mediaId: A.media,
      createdAt: NOW,
    } as never,
    {
      id: 'planted-2',
      organizationId: ORG_B,
      clipId: B.clip,
      postGroup: 'group-shared',
      mediaId: B.media,
      createdAt: NOW,
    } as never,
  );
  tables.posts.push({
    id: 'shared-post',
    organizationId: ORG_A,
    group: 'group-shared',
    state: 'QUEUE',
    deletedAt: null,
  });
  return tables;
}

describe('Clips security: Tenancy (Coming Up)', () => {
  function service() {
    mockQueries.length = 0;
    mockDb = recording(fakeClipDb(seed()) as unknown as Record<string, unknown>);
    const playback = {
      address: async (key: string) => ({
        url: `https://signed/${key}`,
        expiresAt: '2026-11-18T18:00:00.000Z',
      }),
    };
    return new ClipsListService(playback as unknown as ClipPlaybackService, new ClipPostsService());
  }

  it("answers B only B's waiting clip, whatever rows point across", async () => {
    const answer = await service().comingUp(ORG_B, NOW);
    expect(answer.items.map((item) => [item.group, item.clip.id])).toEqual([['group-b', B.clip]]);
    const text = JSON.stringify(answer);
    for (const id of Object.values(A)) expect(text).not.toContain(id);
    expect(text).not.toContain('group-shared');
    expect(text).not.toContain(`clips/${ORG_A}`);
  });

  it('carries B on every query it makes, down to the cards', async () => {
    await service().comingUp(ORG_B, NOW);
    const models = new Set(mockQueries.map((query) => query.model));
    // The whole path ran: links, posts, clips, assets, exports and Media.
    for (const model of ['clipPost', 'post', 'clip', 'clipAsset', 'clipJob', 'media']) {
      expect(models).toContain(model);
    }
    expect(unscoped(ORG_B)).toEqual([]);
  });

  it('reads the workspace only from the session', () => {
    const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, ClipItemController, 'comingUp') as Record<
      string,
      { index: number; factory?: (data: unknown, context: unknown) => unknown }
    >;
    const entries = Object.entries(args);
    expect(entries).toHaveLength(1);
    const [key, arg] = entries[0] as [string, (typeof args)[string]];
    // A custom decorator (not a body, query, param or header), and it reads `activeOrg`.
    expect(key.includes('__customRouteArgs__')).toBe(true);
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({ activeOrg: { id: ORG_B }, query: { orgId: ORG_A } }),
      }),
    };
    expect(arg.factory?.(undefined, context)).toEqual({ id: ORG_B });

    const comingUp = jest.fn();
    ClipItemController.prototype.comingUp.call(
      { library: { comingUp } } as never,
      { id: ORG_B } as never,
    );
    expect(comingUp).toHaveBeenCalledWith(ORG_B);
  });
});

describe("Clips security: a saved document's stickers and sounds (Documents)", () => {
  // A save keeps an upload id it cannot see (an item whose file is gone must not block other
  // edits), so every reader resolves it inside the caller's workspace: here, the editor's files.
  const THEIR_STICKER = 'a3000000-0000-4000-8000-000000000001';
  const THEIR_SOUND = 'a4000000-0000-4000-8000-000000000001';

  /** A table that honours only the filters a query names: a forgotten workspace would leak. */
  function assetTable() {
    const rows = [
      assetRow({
        id: THEIR_STICKER,
        organizationId: ORG_A,
        kind: 'STICKER',
        key: `clips/${ORG_A}/library/a.png`,
      }),
      assetRow({
        id: THEIR_SOUND,
        organizationId: ORG_A,
        kind: 'AUDIO',
        key: `clips/${ORG_A}/library/a.m4a`,
      }),
    ];
    return {
      clipAsset: {
        findMany: async ({
          where,
        }: {
          where: { id?: { in: string[] }; organizationId?: string };
        }) =>
          rows.filter(
            (row) =>
              (!where.id || where.id.in.includes(row.id)) &&
              (where.organizationId === undefined || row.organizationId === where.organizationId),
          ),
      },
    };
  }

  function services() {
    mockQueries.length = 0;
    mockDb = recording(assetTable() as unknown as Record<string, unknown>);
    const library = { admit: async () => undefined };
    const playback = {
      address: async (key: string) => ({ url: `https://signed/${key}`, expiresAt: '' }),
    };
    const stickers = new ClipStickerUploadsService(
      new ClipStickerUploadsRepository(),
      library as never,
      {} as never,
      playback as never,
      {} as never,
      {} as never,
      { resolve: async () => [] } as never,
    );
    const sounds = new ClipSoundUploadsService(
      new ClipSoundUploadsRepository(),
      library as never,
      {} as never,
      playback as never,
      {} as never,
      {} as never,
      { resolve: async () => ({ sounds: [], removed: [] }) } as never,
    );
    return { stickers, sounds };
  }

  it("answers missing for another workspace's upload, with no address", async () => {
    const { stickers, sounds } = services();
    const stickerFiles = await stickers.files(ORG_B, { asset: [THEIR_STICKER] } as never);
    const soundFiles = await sounds.files(ORG_B, { asset: [THEIR_SOUND] } as never);
    expect(stickerFiles.files).toEqual([{ key: `asset:${THEIR_STICKER}`, missing: true }]);
    expect(soundFiles.files).toEqual([
      { key: `asset:${THEIR_SOUND}`, missing: true, removed: false },
    ]);
    expect(JSON.stringify([stickerFiles, soundFiles])).not.toContain('signed');
    expect(unscoped(ORG_B)).toEqual([]);
  });
});

describe('Clips security: Tenancy (GET /entitlements/me)', () => {
  const IMPORT = 'clips.import_minutes_per_month';
  const config = { get: () => 'db' } as unknown as ConfigService<Env, true>;
  const redis = { get: async () => null } as unknown as RedisService;

  /** A repository with a different workspace on each side: A has an override and usage. */
  function fakeRepository() {
    const asked: Array<[string, string]> = [];
    const billing: OrgBilling = {
      organizationCreatedAt: new Date('2026-01-01T00:00:00.000Z'),
      subscription: null,
    };
    const repository = {
      planRows: async () => [{ tier: 'FREE', key: IMPORT, value: 10 }],
      overrides: async (orgId: string) => {
        asked.push(['overrides', orgId]);
        return orgId === ORG_A
          ? [{ key: IMPORT, value: 999, expiresAt: new Date('2099-01-01T00:00:00.000Z') }]
          : [];
      },
      billing: async (orgId: string) => {
        asked.push(['billing', orgId]);
        return billing;
      },
      sumUnits: async (_client: unknown, orgId: string) => {
        asked.push(['sumUnits', orgId]);
        return orgId === ORG_A ? 7_000 : 0;
      },
    };
    return { repository: repository as unknown as EntitlementsRepository, asked };
  }

  it("never answers one workspace's values or usage for another, in either order", async () => {
    for (const order of [
      [ORG_A, ORG_B],
      [ORG_B, ORG_A],
    ]) {
      const { repository, asked } = fakeRepository();
      const resolver = new EntitlementResolver(repository, redis, config);
      const answers = new Map<string, Awaited<ReturnType<EntitlementResolver['snapshot']>>>();
      for (const org of order) answers.set(org as string, await resolver.snapshot(org as string));
      // Ask again, now from the cache.
      for (const org of order)
        expect(await resolver.snapshot(org as string)).toEqual(answers.get(org as string));

      const a = answers.get(ORG_A);
      const b = answers.get(ORG_B);
      expect(a?.values[IMPORT]).toBe(999);
      expect(a?.meters[IMPORT].used).toBe(7);
      expect(b?.values[IMPORT]).toBe(10);
      expect(b?.meters[IMPORT].used).toBe(0);
      expect(asked.filter(([, org]) => org !== ORG_A && org !== ORG_B)).toEqual([]);
    }
  });

  it('carries the workspace on every query the real repository makes', async () => {
    mockQueries.length = 0;
    const empty = new Proxy(
      {},
      {
        get: () =>
          new Proxy(
            {},
            {
              get: (_t, op: string) => async () =>
                op === 'aggregate' ? { _sum: { units: null } } : op === 'findMany' ? [] : null,
            },
          ),
      },
    );
    mockDb = recording(empty as Record<string, unknown>);
    const repository = new EntitlementsRepository();
    await repository.billing(ORG_B);
    await repository.overrides(ORG_B);
    await repository.sumUnits(mockDb as never, ORG_B, IMPORT, new Date());
    expect(mockQueries.map((query) => query.model).sort()).toEqual([
      'orgEntitlementOverride',
      'organization',
      'usageEntry',
    ]);
    expect(unscoped(ORG_B)).toEqual([]);
  });

  describe('the controller', () => {
    const body = {
      tier: 'FREE',
      status: 'none',
      trialEndsAt: null,
      values: { [IMPORT]: 10 },
      meters: {},
    };
    const resolver = { snapshot: jest.fn(async () => ({ ...body, trialEndsAt: null })) };
    const controller = new EntitlementsController(resolver as unknown as EntitlementResolver);

    function call(orgId: string, ifNoneMatch?: string) {
      const headers: Record<string, string> = {};
      const response = {
        statusCode: 200,
        setHeader: (name: string, value: string) => {
          headers[name] = value;
        },
        status(code: number) {
          this.statusCode = code;
          return this;
        },
      };
      const request = { headers: ifNoneMatch ? { 'if-none-match': ifNoneMatch } : {} };
      return controller
        .me({ id: orgId } as never, request as never, response as never)
        .then((answer) => ({ answer, headers, status: response.statusCode }));
    }

    it('asks for the session workspace only', async () => {
      resolver.snapshot.mockClear();
      await call(ORG_B);
      expect(resolver.snapshot).toHaveBeenCalledWith(ORG_B);
      const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, EntitlementsController, 'me') as Record<
        string,
        unknown
      >;
      const kinds = Object.keys(args).map((key) => key.split(':')[0]);
      // One custom decorator (the workspace), the request and the response; never a query, param or body.
      expect(kinds.filter((kind) => kind?.includes('__customRouteArgs__'))).toHaveLength(1);
      expect(kinds.filter((kind) => !kind?.includes('__customRouteArgs__')).sort()).toEqual([
        '0',
        '1',
      ]);
    });

    it('gives two workspaces different tags for the same answer, so a cache never shares one', async () => {
      const a = await call(ORG_A);
      const b = await call(ORG_B);
      expect(a.answer).toEqual(b.answer);
      expect(a.headers.ETag).not.toBe(b.headers.ETag);
      for (const answer of [a, b]) {
        expect(answer.headers['Cache-Control']).toBe('private, max-age=15');
        expect(answer.headers.Vary).toBe('Cookie');
      }
      // A's tag sent on B's request is not a match: B gets its full answer.
      const crossed = await call(ORG_B, a.headers.ETag);
      expect(crossed.status).toBe(200);
      expect(crossed.answer).toEqual(b.answer);
      const same = await call(ORG_B, b.headers.ETag);
      expect(same.status).toBe(304);
      expect(same.answer).toBeUndefined();
    });
  });
});
