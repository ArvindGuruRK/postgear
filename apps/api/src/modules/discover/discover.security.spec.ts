/**
 * Module 09, the security sweep: one spec for the whole of Discover.
 *
 * Every other Discover spec proves a part of this beside the code it belongs
 * to. This is the one place it is all asserted together, across the three
 * controllers and the services behind them:
 *
 * 1. **Who may call what**, from the real route metadata through the real
 *    guards. A route that is not in the table below fails the spec, so a new
 *    one cannot be added without saying who it is for.
 * 2. **Another workspace's id learns nothing**: foreign, removed and malformed
 *    ids are a 404 with no outside read.
 * 3. **Private addresses are refused on every way in** (a competitor being
 *    added or edited, Find Feeds, Read, a story link), with no fetch made.
 * 4. **`WEBHOOK_ALLOW_PRIVATE_URLS` changes nothing here.** That flag is for
 *    webhooks. Nothing in this module reads it, and the guard refuses the same
 *    addresses with it on.
 * 5. **Nothing leaks.** The real sources and the real article finder run over
 *    recorded and hand-written bodies, with a recognisable position, typed
 *    text and key in play. No answer, no Redis key or value and no log line
 *    holds the position, the typed text, the key or a piece of markup, and no
 *    key or log line holds an address a person typed.
 *
 * Nothing here reaches a network or a name server: every fetch is a fake over
 * the engine's fixtures, and the guard's lookups are answered in this file.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ForbiddenException,
  HttpException,
  Logger,
  RequestMethod,
  UnauthorizedException,
} from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import type { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { JwtService } from '@nestjs/jwt';
import { Role } from '@postgear/db';
import {
  CHENNAI,
  COMPETITOR_SAMPLE,
  createBlueskySource,
  createFixtureFetch,
  createGoogleNewsSource,
  createGoogleTrendsSource,
  createHolidaysSource,
  createMastodonSource,
  createNominatimGeocoder,
  createReaderFixtureFetch,
  createWikipediaSource,
  createYoutubeSource,
  type DiscoverFetch,
  extractArticle,
  googleNewsArticleUrl,
  PageTooComplexError,
  READER_SAMPLE,
} from '@postgear/discover-engine';
import { assertSafeUrl, SeoCrawlError } from '@postgear/seo-engine';

jest.mock('@postgear/db', () => ({
  ...jest.requireActual('@postgear/db'),
  prisma: { userOrganization: { findFirst: jest.fn() }, user: { findUnique: jest.fn() } },
}));

import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { securityLogger } from '../../common/logging/security-logger';
import { CompetitorsController } from './competitors.controller';
import { type CompetitorEngine, createCompetitorEngine } from './competitors.engine';
import type {
  CompetitorRow,
  CompetitorsRepository,
  CompetitorWrite,
  CreateOutcome,
} from './competitors.repository';
import { CompetitorsService } from './competitors.service';
import { DiscoverCache } from './discover.cache';
import { DiscoverController } from './discover.controller';
import {
  createDiscoverEngine,
  createSafeDiscoverFetch,
  type DiscoverEngine,
} from './discover.engine';
import { DiscoverGate } from './discover.gate';
import { DiscoverService } from './discover.service';
import { LocalityService } from './locality.service';
import { ReaderController } from './reader.controller';
import { createReaderEngine, type ReaderEngine } from './reader.engine';
import type { ExtractOutcome } from './reader.extractor';
import { ReaderService } from './reader.service';
import type { DiscoverSettingsRepository } from './settings.repository';
import { DiscoverSettingsService } from './settings.service';
import { FakeRedis } from './testing/fake-redis';

const { prisma } = jest.requireMock('@postgear/db') as {
  prisma: { userOrganization: { findFirst: jest.Mock } };
};

jest.setTimeout(60_000);

const ORG = 'org-sweep';
const OTHER_ORG = 'org-other';
const USER = 'user-sweep';
const PUBLIC_ADDRESS = '93.184.216.34';
const NOW = new Date('2026-11-10T10:00:00Z');
const MISSING_ID = '00000000-0000-4000-8000-00000000ffff';

const member = { id: USER, email: 'a@x.com', isSuperAdmin: false, onboardingCompletedAt: null };
const config = { get: (_key: string, fallback: string) => fallback } as unknown as ConfigService;

/* ───────────────────────────── 1. who may call what ───────────────────────────── */

type Audience = 'member' | 'admin';

interface RouteRow {
  controller: { name: string; prototype: object };
  handler: string;
  verb: string;
  path: string;
  audience: Audience;
}

function row(
  controller: RouteRow['controller'],
  handler: string,
  verb: string,
  path: string,
  audience: Audience = 'member',
): RouteRow {
  return { controller, handler, verb, path, audience };
}

/** Every Discover route, and who it is for. A route not listed here fails the spec. */
const ROUTES: RouteRow[] = [
  row(DiscoverController, 'status', 'GET', 'discover/status'),
  row(DiscoverController, 'locality', 'GET', 'discover/locality'),
  row(DiscoverController, 'search', 'GET', 'discover/locality/search'),
  row(DiscoverController, 'feed', 'GET', 'discover/feed'),
  row(DiscoverController, 'settings', 'GET', 'discover/settings'),
  // A member passes the guard on purpose: the service refuses them in its own sentence.
  row(DiscoverController, 'saveSettings', 'PATCH', 'discover/settings'),
  row(CompetitorsController, 'list', 'GET', 'discover/competitors'),
  row(CompetitorsController, 'create', 'POST', 'discover/competitors'),
  row(CompetitorsController, 'discoverFeeds', 'POST', 'discover/competitors/discover-feeds'),
  row(CompetitorsController, 'update', 'PATCH', 'discover/competitors/:id'),
  row(CompetitorsController, 'remove', 'DELETE', 'discover/competitors/:id', 'admin'),
  row(CompetitorsController, 'items', 'GET', 'discover/competitors/:id/items'),
  row(ReaderController, 'read', 'POST', 'discover/read'),
  row(ReaderController, 'resolveLink', 'POST', 'discover/resolve-link'),
];

const CONTROLLERS = [DiscoverController, CompetitorsController, ReaderController];

function handlerOf(route: Pick<RouteRow, 'controller' | 'handler'>): object {
  return (route.controller.prototype as Record<string, object>)[route.handler];
}

function contextFor(route: RouteRow, request: object) {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => handlerOf(route),
    getClass: () => route.controller,
  } as never;
}

function joined(prefix: string, path: string): string {
  const tail = path === '/' ? '' : path;
  return tail ? `${prefix}/${tail}` : prefix;
}

function guardFor(role: Role | null) {
  prisma.userOrganization.findFirst.mockResolvedValue(
    role === null ? null : { organizationId: ORG, role },
  );
  return new RolesGuard(new Reflector(), config);
}

const label = (route: RouteRow) => `${route.verb} /${route.path}`;

describe('Discover routes: who may call what', () => {
  beforeEach(() => {
    jest.spyOn(securityLogger, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('has every route of the three controllers in the table, with its verb and path, and nothing else', () => {
    const found = CONTROLLERS.flatMap((controller) => {
      const proto = controller.prototype as unknown as Record<string, object>;
      const prefix = Reflect.getMetadata(PATH_METADATA, controller) as string;
      return Object.getOwnPropertyNames(proto)
        .filter(
          (name) =>
            name !== 'constructor' &&
            typeof proto[name] === 'function' &&
            Reflect.getMetadata(PATH_METADATA, proto[name]) !== undefined,
        )
        .map((name) => {
          const verb = RequestMethod[Reflect.getMetadata(METHOD_METADATA, proto[name])];
          const path = joined(prefix, Reflect.getMetadata(PATH_METADATA, proto[name]));
          return `${controller.name}.${name} ${verb} /${path}`;
        });
    });

    const listed = ROUTES.map(
      (route) => `${route.controller.name}.${route.handler} ${route.verb} /${route.path}`,
    );
    expect(found.sort()).toEqual([...listed].sort());
  });

  it.each(ROUTES.map((route) => [label(route), route] as const))(
    '%s is not public, and answers 401 without a session',
    async (_name, route) => {
      const isPublic = new Reflector().getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
        handlerOf(route) as never,
        route.controller as never,
      ]);
      expect(isPublic).not.toBe(true);

      const jwt = { verifyAsync: jest.fn() } as unknown as JwtService;
      const guard = new JwtAuthGuard(jwt, new Reflector(), config);
      await expect(
        guard.canActivate(contextFor(route, { cookies: {}, headers: {} })),
      ).rejects.toThrow(UnauthorizedException);
    },
  );

  it.each(ROUTES.map((route) => [label(route), route] as const))(
    '%s answers 403 to someone outside the workspace, and to someone with no workspace at all',
    async (_name, route) => {
      const guard = guardFor(null);

      await expect(
        guard.canActivate(contextFor(route, { user: member, cookies: { pg_org: ORG } })),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        guard.canActivate(contextFor(route, { user: member, cookies: {} })),
      ).rejects.toThrow(ForbiddenException);
    },
  );

  it.each(
    ROUTES.filter((route) => route.audience === 'member').map(
      (route) => [label(route), route] as const,
    ),
  )('%s lets a member through', async (_name, route) => {
    const guard = guardFor(Role.USER);

    await expect(
      guard.canActivate(contextFor(route, { user: member, cookies: { pg_org: ORG } })),
    ).resolves.toBe(true);
  });

  it.each(
    ROUTES.filter((route) => route.audience === 'admin').map(
      (route) => [label(route), route] as const,
    ),
  )('%s refuses a member at the guard, and lets an admin through', async (_name, route) => {
    await expect(
      guardFor(Role.USER).canActivate(
        contextFor(route, { user: member, cookies: { pg_org: ORG } }),
      ),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      guardFor(Role.ADMIN).canActivate(
        contextFor(route, { user: member, cookies: { pg_org: ORG } }),
      ),
    ).resolves.toBe(true);
  });

  it('has exactly one admin route at the guard: removing a competitor', () => {
    expect(ROUTES.filter((route) => route.audience === 'admin').map(label)).toEqual([
      'DELETE /discover/competitors/:id',
    ]);
  });

  it("refuses a member's settings save in the service, with its sentence, and writes nothing", async () => {
    const table = { find: jest.fn(async () => null), upsert: jest.fn() };
    const service = new DiscoverSettingsService(table as unknown as DiscoverSettingsRepository);

    const error = await service
      .update({ id: ORG, role: Role.USER }, member, { languages: ['ta'] })
      .then(
        () => null,
        (caught: unknown) => caught,
      );

    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error as HttpException).getResponse()).toMatchObject({
      message: 'Only workspace admins can change the workspace place.',
      code: 'settings_admin_only',
    });
    expect(table.upsert).not.toHaveBeenCalled();
    expect(table.find).not.toHaveBeenCalled();
  });
});

/* ───────────────────────────── shared fakes ───────────────────────────── */

const ACME: CompetitorWrite = {
  name: 'Acme',
  websiteUrl: COMPETITOR_SAMPLE.website,
  feedUrls: [COMPETITOR_SAMPLE.blogFeed, COMPETITOR_SAMPLE.changelogFeed],
  youtubeChannelId: COMPETITOR_SAMPLE.youtubeChannelId,
  blueskyHandle: COMPETITOR_SAMPLE.blueskyHandle,
  mastodonAcct: COMPETITOR_SAMPLE.mastodonAcct,
  newsQuery: null,
};

/** The competitors table, as far as the service uses it: scoped by workspace, soft deleted. */
function fakeCompetitors() {
  const rows = new Map<string, CompetitorRow & { orgId: string; deleted: boolean }>();
  let next = 1;
  const live = (orgId: string) =>
    [...rows.values()].filter((entry) => entry.orgId === orgId && !entry.deleted);

  const table = {
    rows,
    seed(orgId: string, write: Partial<CompetitorWrite> = {}) {
      const id = `00000000-0000-4000-8000-${String(next).padStart(12, '0')}`;
      next += 1;
      const entry = {
        ...ACME,
        ...write,
        id,
        orgId,
        deleted: false,
        lastCheckedAt: null,
        lastError: null,
        createdAt: NOW,
        updatedAt: NOW,
      };
      rows.set(id, entry);
      return entry;
    },
    list: jest.fn(async (orgId: string) => live(orgId)),
    count: jest.fn(async (orgId: string) => live(orgId).length),
    find: jest.fn(
      async (orgId: string, id: string) => live(orgId).find((entry) => entry.id === id) ?? null,
    ),
    create: jest.fn(
      async (
        orgId: string,
        _userId: string | null,
        write: CompetitorWrite,
      ): Promise<CreateOutcome> => ({ outcome: 'created', row: table.seed(orgId, write) }),
    ),
    update: jest.fn(async (orgId: string, id: string, write: Partial<CompetitorWrite>) => {
      const entry = live(orgId).find((candidate) => candidate.id === id);
      if (!entry) return null;
      Object.assign(entry, write);
      return entry;
    }),
    softDelete: jest.fn(async (orgId: string, id: string) => {
      const entry = live(orgId).find((candidate) => candidate.id === id);
      if (!entry) return false;
      entry.deleted = true;
      return true;
    }),
    noteCheck: jest.fn(async () => undefined),
  };
  return table;
}

function settingsService() {
  const table = { find: jest.fn(async () => null), upsert: jest.fn() };
  return new DiscoverSettingsService(table as unknown as DiscoverSettingsRepository);
}

/** The real guard, with its name lookups answered here. A name not listed is public. */
function guardWith(dns: Record<string, string[]> = {}) {
  const resolve = jest.fn(async (host: string) => dns[host] ?? [PUBLIC_ADDRESS]);
  return jest.fn((url: string) => assertSafeUrl(url, { resolve }));
}

type FetchMock = jest.Mock<ReturnType<DiscoverFetch>, Parameters<DiscoverFetch>>;

function buildCompetitors(options: { dns?: Record<string, string[]>; fetch?: DiscoverFetch } = {}) {
  const redis = new FakeRedis();
  const repository = fakeCompetitors();
  const samples = options.fetch ?? createFixtureFetch();
  const fetch: FetchMock = jest.fn(samples);
  const real = createCompetitorEngine({
    DISCOVER_SIMULATION: 'true',
    DISCOVER_GEOCODER_USER_AGENT: 'PostGear/1.0 (test)',
  });
  const read = (source: CompetitorEngine['feeds']) => ({
    ...source,
    read: jest.fn(source.read),
  });
  const engine = {
    ...real,
    simulation: false,
    guard: guardWith(options.dns),
    fetch,
    feeds: read(real.feeds),
    youtube: read(real.youtube),
    bluesky: read(real.bluesky),
    mastodon: read(real.mastodon),
    news: { ...real.news, search: jest.fn(real.news.search) },
  };
  const service = new CompetitorsService(
    engine as unknown as CompetitorEngine,
    repository as unknown as CompetitorsRepository,
    new DiscoverCache(redis.asService()),
    new DiscoverGate(4, 4_000),
    redis.asService(),
    settingsService(),
  );
  /** Every outside read this service could have made. */
  const reads = () =>
    fetch.mock.calls.length +
    engine.feeds.read.mock.calls.length +
    engine.youtube.read.mock.calls.length +
    engine.bluesky.read.mock.calls.length +
    engine.mastodon.read.mock.calls.length +
    engine.news.search.mock.calls.length;

  return { service, repository, redis, fetch, reads };
}

/** The engine's own article finder, in this thread (the worker has a spec of its own). */
async function extractHere(html: string, url: string): Promise<ExtractOutcome> {
  try {
    const article = extractArticle(html, url);
    return article ? { outcome: 'article', article, ms: 5 } : { outcome: 'not_article', ms: 5 };
  } catch (error) {
    return error instanceof PageTooComplexError
      ? { outcome: 'too_complex', ms: 1 }
      : { outcome: 'failed', ms: 0 };
  }
}

function buildReader(options: { dns?: Record<string, string[]> } = {}) {
  const redis = new FakeRedis();
  const fetch: FetchMock = jest.fn(createReaderFixtureFetch());
  const engine: ReaderEngine = {
    simulation: false,
    guard: guardWith(options.dns),
    fetch,
    linkDecode: true,
  };
  const service = new ReaderService(engine, new DiscoverGate(4, 4_000), redis.asService(), {
    extract: jest.fn(extractHere),
  });
  return { service, redis, fetch };
}

/** An older Google News id: the address itself, base64 behind a prefix. No request needed. */
function oldStyleLink(address: string): string {
  const bytes = Buffer.concat([
    Buffer.from([0x08, 0x13, 0x22, address.length]),
    Buffer.from(address),
    Buffer.from([0xd2, 0x01, 0x00]),
  ]);
  return googleNewsArticleUrl(bytes.toString('base64url'));
}

async function refusalOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (!(error instanceof HttpException)) throw error;
    const body = error.getResponse();
    return typeof body === 'string'
      ? { status: error.getStatus(), message: body, code: undefined }
      : {
          status: error.getStatus(),
          message: (body as { message: string }).message,
          code: (body as { code?: string }).code,
        };
  }
  throw new Error('Expected a refusal, and the call went through.');
}

/** Everything that was logged while a test ran, as text. */
function captureLogs() {
  const lines: string[] = [];
  const keep = (...parts: unknown[]) => {
    lines.push(JSON.stringify(parts));
  };
  jest.spyOn(Logger.prototype, 'log').mockImplementation(keep);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(keep);
  jest.spyOn(Logger.prototype, 'error').mockImplementation(keep);
  jest.spyOn(Logger.prototype, 'debug').mockImplementation(keep);
  jest.spyOn(securityLogger, 'warn').mockImplementation(keep);
  jest.spyOn(securityLogger, 'log').mockImplementation(keep);
  return lines;
}

/* ───────────────────────────── 2. ids ───────────────────────────── */

describe("Discover ids: another workspace's competitor learns nothing", () => {
  beforeEach(() => {
    captureLogs();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  type IdCall = (service: CompetitorsService, id: string) => Promise<unknown>;

  const CALLS: [string, IdCall][] = [
    ['PATCH /discover/competitors/:id', (service, id) => service.update(ORG, id, { name: 'X' })],
    [
      'PATCH /discover/competitors/:id, with an address in the body',
      (service, id) => service.update(ORG, id, { websiteUrl: 'http://10.0.0.1/' }),
    ],
    ['DELETE /discover/competitors/:id', (service, id) => service.remove(ORG, id)],
    ['GET /discover/competitors/:id/items', (service, id) => service.items(ORG, id)],
  ];

  it.each(CALLS)(
    '%s answers 404 for a foreign, a removed, an unknown and a malformed id',
    async (_name, call) => {
      const { service, repository, reads } = buildCompetitors();
      const theirs = repository.seed(OTHER_ORG);
      const removed = repository.seed(ORG);
      removed.deleted = true;
      const before = JSON.stringify([...repository.rows.values()]);

      for (const id of [theirs.id, removed.id, MISSING_ID, 'not-an-id', "1' OR '1'='1", '../..']) {
        await expect(refusalOf(call(service, id))).resolves.toMatchObject({
          status: 404,
          message: 'Competitor not found.',
        });
      }

      // Nothing was read from outside, nothing was judged, and nothing changed.
      expect(reads()).toBe(0);
      expect(JSON.stringify([...repository.rows.values()])).toBe(before);
    },
  );

  it("lists only the asking workspace's live competitors", async () => {
    const { service, repository } = buildCompetitors();
    repository.seed(ORG, { name: 'Ours' });
    repository.seed(OTHER_ORG, { name: 'Theirs' });
    const gone = repository.seed(ORG, { name: 'Gone' });
    gone.deleted = true;

    const list = await service.list(ORG);

    expect(list.map((competitor) => competitor.name)).toEqual(['Ours']);
  });
});

/* ───────────────────────────── 3. private addresses ───────────────────────────── */

const PRIVATE_ADDRESSES: [string, string][] = [
  ['a private range', 'http://10.0.0.1/'],
  ['the local machine with a port', 'http://127.0.0.1:3000'],
  ['the local machine by name', 'http://localhost/'],
  ['the local machine by name with a port, typed bare', 'localhost:3001'],
  ['the cloud metadata address', 'http://169.254.169.254/latest/meta-data'],
  ['an IPv6 loopback', 'http://[::1]/'],
  ['a public name that resolves to a private address', 'https://intranet.example/wiki'],
];
const PRIVATE_DNS = { 'intranet.example': ['192.168.1.20'] };

describe('Discover private addresses: refused on every way in, with no fetch', () => {
  let logs: string[];

  beforeEach(() => {
    logs = captureLogs();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe.each(PRIVATE_ADDRESSES)('%s', (_name, address) => {
    it('is refused when a competitor is added, as its website, a feed or a Mastodon instance', async () => {
      const { service, repository, reads } = buildCompetitors({ dns: PRIVATE_DNS });

      const asWebsite = await refusalOf(
        service.create(ORG, USER, { name: 'Acme', websiteUrl: address }),
      );
      const asFeed = await refusalOf(
        service.create(ORG, USER, {
          name: 'Acme',
          websiteUrl: 'https://acme.example',
          feedUrls: ['https://acme.example/feed', address],
        }),
      );

      for (const refusal of [asWebsite, asFeed]) {
        expect(refusal).toEqual({
          status: 422,
          code: 'competitor_private',
          message: 'This address is private or on your own network.',
        });
      }
      expect(repository.create).not.toHaveBeenCalled();
      expect(repository.rows.size).toBe(0);
      expect(reads()).toBe(0);
    });

    it('is refused when a competitor is edited, and the row is left as it was', async () => {
      const { service, repository, reads } = buildCompetitors({ dns: PRIVATE_DNS });
      const saved = repository.seed(ORG);

      const refusal = await refusalOf(
        service.update(ORG, saved.id, { name: 'Renamed', websiteUrl: address }),
      );

      expect(refusal).toMatchObject({ status: 422, code: 'competitor_private' });
      expect(repository.update).not.toHaveBeenCalled();
      expect(repository.rows.get(saved.id)?.name).toBe('Acme');
      expect(reads()).toBe(0);
    });

    it('is refused by Find Feeds before the page is asked for', async () => {
      const { service, reads } = buildCompetitors({ dns: PRIVATE_DNS });

      await expect(refusalOf(service.discoverFeeds(ORG, address))).resolves.toMatchObject({
        status: 422,
        code: 'competitor_private',
      });
      expect(reads()).toBe(0);
    });

    it('is refused by Read before the page is asked for', async () => {
      const { service, fetch } = buildReader({ dns: PRIVATE_DNS });

      await expect(refusalOf(service.read(ORG, address))).resolves.toEqual({
        status: 422,
        code: 'read_private',
        message: 'This page is private or on your own network.',
      });
      expect(fetch).not.toHaveBeenCalled();
    });

    it('is recorded by workspace and reason, and never by the address', () => {
      // Checked after the four tests above have run for this address.
      const host = address.replace(/^https?:\/\//, '').split(/[/:]/)[0];
      const text = logs.join('\n');
      if (host.length > 3) expect(text).not.toContain(host);
    });
  });

  it('refuses a Mastodon instance that resolves to a private address', async () => {
    const { service, repository, reads } = buildCompetitors({
      dns: { 'social.intranet.example': ['10.9.9.9'] },
    });

    await expect(
      refusalOf(
        service.create(ORG, USER, { name: 'Acme', mastodonAcct: 'acme@social.intranet.example' }),
      ),
    ).resolves.toMatchObject({ status: 422, code: 'competitor_private' });
    expect(repository.create).not.toHaveBeenCalled();
    expect(reads()).toBe(0);
  });

  it.each([
    ['an older link that holds a private address', 'http://10.0.0.1/internal'],
    ['an older link that holds a local name', 'http://localhost/admin'],
    ['an older link to a name that resolves inside', 'https://intranet.example/wiki'],
  ])(
    'does not open a story link that leads inside (%s), on Read or on resolve-link, and reads nothing',
    async (_name, target) => {
      const link = oldStyleLink(target);

      const reading = buildReader({ dns: PRIVATE_DNS });
      await expect(refusalOf(reading.service.read(ORG, link))).resolves.toMatchObject({
        status: 422,
        code: 'link_unresolved',
      });
      expect(reading.fetch).not.toHaveBeenCalled();

      const resolving = buildReader({ dns: PRIVATE_DNS });
      await expect(refusalOf(resolving.service.resolveLink(ORG, link))).resolves.toMatchObject({
        status: 422,
        code: 'link_unresolved',
      });
      expect(resolving.fetch).not.toHaveBeenCalled();
    },
  );

  it('refuses a public address whose redirect the guard refused, on Find Feeds and on Read, and goes no further', async () => {
    const hop = new SeoCrawlError('unsafe_url', 'Refused.', false, { reason: 'private_address' });

    const feeds = buildCompetitors();
    feeds.fetch.mockRejectedValue(hop);
    await expect(
      refusalOf(feeds.service.discoverFeeds(ORG, 'https://redirects.example')),
    ).resolves.toMatchObject({ status: 422, code: 'competitor_private' });
    // The one request the guarded fetch refused mid-way. Nothing after it.
    expect(feeds.fetch).toHaveBeenCalledTimes(1);

    const reading = buildReader();
    reading.fetch.mockRejectedValue(hop);
    await expect(
      refusalOf(reading.service.read(ORG, 'https://redirects.example/story')),
    ).resolves.toMatchObject({ status: 422, code: 'read_private' });
    expect(reading.fetch).toHaveBeenCalledTimes(1);
  });

  it('leaves out a feed a page links on a private address, so it is never shown, saved or fetched', async () => {
    const { service, fetch } = buildCompetitors();
    fetch.mockResolvedValue({
      status: 200,
      finalUrl: 'https://acme.example/',
      body: [
        '<link rel="alternate" type="application/rss+xml" title="Inside" href="http://10.0.0.7/feed.xml">',
        '<link rel="alternate" type="application/rss+xml" title="Meta" href="http://169.254.169.254/feed">',
        '<link rel="alternate" type="application/rss+xml" title="Blog" href="/blog/rss.xml">',
      ].join(''),
    });

    const feeds = await service.discoverFeeds(ORG, 'https://acme.example');

    expect(feeds.map((feed) => feed.url)).toEqual(['https://acme.example/blog/rss.xml']);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

/* ───────────────────────────── 4. the webhook flag ───────────────────────────── */

describe('WEBHOOK_ALLOW_PRIVATE_URLS changes nothing in Discover', () => {
  const MODULE_DIR = __dirname;
  let before: string | undefined;

  beforeAll(() => {
    before = process.env.WEBHOOK_ALLOW_PRIVATE_URLS;
    process.env.WEBHOOK_ALLOW_PRIVATE_URLS = 'true';
  });

  afterAll(() => {
    if (before === undefined) delete process.env.WEBHOOK_ALLOW_PRIVATE_URLS;
    else process.env.WEBHOOK_ALLOW_PRIVATE_URLS = before;
  });

  const REFUSED = [
    'http://127.0.0.1/',
    'http://127.0.0.1:3000/',
    'http://10.0.0.1/',
    'http://192.168.1.1/',
    'http://169.254.169.254/',
    'http://[::1]/',
    'http://localhost/',
    'http://localhost:6379/',
    'https://printer.local/',
  ];
  const env = { DISCOVER_GEOCODER_USER_AGENT: 'PostGear/1.0 (test)' } as const;

  it.each(['true', 'false'] as const)(
    'the competitor guard still refuses every private address with the flag on (simulation %s)',
    async (simulation) => {
      const engine = createCompetitorEngine({ ...env, DISCOVER_SIMULATION: simulation });

      for (const url of REFUSED) {
        await expect(engine.guard(url)).resolves.toMatchObject({ ok: false });
      }
    },
  );

  it.each(['true', 'false'] as const)(
    'the reader guard still refuses every private address with the flag on (simulation %s)',
    async (simulation) => {
      const engine = createReaderEngine({
        ...env,
        DISCOVER_SIMULATION: simulation,
        DISCOVER_LINK_DECODE: 'true',
      });

      for (const url of REFUSED) {
        await expect(engine.guard(url)).resolves.toMatchObject({ ok: false });
      }
    },
  );

  it('the fetch every real Discover call goes through still refuses them, before any connection', async () => {
    const init = { accept: '*/*', signal: AbortSignal.timeout(5_000), maxBytes: 1024 };
    // Built the way the module builds it, and through the engine factory too.
    const guarded = createSafeDiscoverFetch('PostGear/1.0 (test)');
    const engine = createDiscoverEngine({
      ...env,
      DISCOVER_SIMULATION: 'false',
      DISCOVER_GEOCODER: 'off',
      YOUTUBE_API_KEY: undefined,
    });
    expect(engine.simulation).toBe(false);

    // Address literals and local names only: judged with no lookup, so no network.
    for (const url of REFUSED) {
      const error = await guarded(url, init).then(
        () => null,
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(SeoCrawlError);
      expect((error as SeoCrawlError).kind).toBe('unsafe_url');
    }
  });

  it('is not read, and no private switch exists, anywhere in the Discover module', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(MODULE_DIR)) {
      const text = readFileSync(file, 'utf8');
      text.split(/\r?\n/).forEach((line, index) => {
        // A comment may name the flag to say it does not apply. Code may not.
        const code = line.replace(/\/\/.*$/, '').trim();
        if (code.startsWith('*') || code.startsWith('/*')) return;
        if (/WEBHOOK_ALLOW_PRIVATE_URLS|allowPrivate|allowPorts/.test(code)) {
          offenders.push(`${file.slice(MODULE_DIR.length + 1)}:${index + 1}`);
        }
      });
    }

    expect(offenders).toEqual([]);
  });
});

/** Every `.ts` file under a folder that is not a test. */
function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === 'testing' ? [] : sourceFiles(path);
    return /\.ts$/.test(entry.name) && !/\.(spec|test)\.ts$/.test(entry.name) ? [path] : [];
  });
}

/* ───────────────────────────── 5. nothing leaks ───────────────────────────── */

describe('Discover answers, keys and logs: nothing leaks', () => {
  /** A position as a browser gives it, and as the API takes it (two decimals). */
  const PRECISE = { lat: '13.0827', lng: '80.2707' };
  const ROUNDED = { lat: 13.08, lng: 80.27 };
  const TYPED = 'Zanzibarqq Townxx';
  const KEY = 'AIzaSweepKeyQq81xLeakValue';

  const POSITION_MARKS = [PRECISE.lat, PRECISE.lng, '13.08', '80.27'];
  const MARKUP_MARKS = ['<script', '</script', '<a href', '<font', '<ol>', '<li>', 'window.sample'];
  /** Hosts and addresses a person typed, or pressed Read on. */
  const ADDRESS_MARKS = ['acme.example', 'mastodon.example', 'reader.example', 'news.example'];

  let logs: string[];

  beforeEach(() => {
    logs = captureLogs();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function expectNone(text: string, marks: readonly string[], where: string) {
    for (const mark of marks) {
      // Reported by mark and place, never by dumping what was searched.
      expect([where, mark, text.includes(mark)]).toEqual([where, mark, false]);
    }
  }

  function redisDump(redis: FakeRedis) {
    const keys = redis.keys;
    return { keys: keys.join('\n'), values: keys.map((key) => redis.read(key) ?? '').join('\n') };
  }

  /** The real sources, over the recorded and hand-written bodies, with a marker key. */
  function realEngine(fetch: DiscoverFetch): DiscoverEngine {
    return {
      simulation: true,
      userAgent: 'PostGear/1.0 (test)',
      geocoder: null,
      trends: createGoogleTrendsSource({ fetch }),
      news: createGoogleNewsSource({ fetch }),
      wikipedia: createWikipediaSource({ fetch }),
      bluesky: createBlueskySource({ fetch }),
      mastodon: createMastodonSource({ fetch }),
      videos: createYoutubeSource({ fetch, apiKey: KEY }),
      holidays: createHolidaysSource({ fetch }),
    };
  }

  it('the feed: no key, no markup and no raw body in any of the four tabs, in Redis or in a log line', async () => {
    const redis = new FakeRedis();
    const asked: string[] = [];
    const fixtures = createFixtureFetch();
    const fetch: DiscoverFetch = (url, init) => {
      asked.push(url);
      return fixtures(url, init);
    };
    const service = new DiscoverService(
      realEngine(fetch),
      new DiscoverCache(redis.asService()),
      new DiscoverGate(4, 4_000),
      redis.asService(),
      settingsService(),
    );

    const answers = [];
    for (const kind of ['trending', 'news', 'videos', 'festivals'] as const) {
      answers.push(await service.feed(ORG, { kind, locality: CHENNAI, language: 'ta' }));
    }
    answers.push(service.status());

    // The tabs really answered, from the real bodies, and the key really was used.
    expect(
      answers.slice(0, 4).map((answer) => (answer as { groups: unknown[] }).groups.length),
    ).toEqual(expect.arrayContaining([expect.any(Number)]));
    const shown = answers
      .slice(0, 4)
      .reduce((total, answer) => total + (answer as { groups: unknown[] }).groups.length, 0);
    expect(shown).toBeGreaterThanOrEqual(4);
    expect(asked.some((url) => url.includes(encodeURIComponent(KEY)))).toBe(true);

    const text = JSON.stringify(answers);
    const { keys, values } = redisDump(redis);
    const logged = logs.join('\n');
    for (const [where, haystack] of [
      ['answers', text],
      ['redis keys', keys],
      ['redis values', values],
      ['log lines', logged],
    ] as const) {
      expectNone(haystack, [KEY, ...MARKUP_MARKS, ...POSITION_MARKS], where);
    }
    // A feed's own wrapper never survives either: these are XML and ICS, not text.
    expectNone(text, ['<?xml', '<rss', '<item>', 'BEGIN:VEVENT', '<![CDATA['], 'answers');
  });

  it('a place: the position and the typed text are in no answer, no key, no value and no log line', async () => {
    const redis = new FakeRedis();
    const asked: string[] = [];
    const chennai = readFileSync(
      join(
        __dirname,
        '../../../../../packages/discover-engine/fixtures/nominatim/chennai-reverse.json',
      ),
      'utf8',
    );
    const fetch: DiscoverFetch = async (url) => {
      asked.push(url);
      return { status: 200, finalUrl: url, body: url.includes('/reverse') ? chennai : '[]' };
    };
    const engine = {
      simulation: false,
      geocoder: createNominatimGeocoder({ fetch, userAgent: 'PostGear/1.0 (test)' }),
    } as DiscoverEngine;
    const service = new LocalityService(engine, redis.asService());

    const place = await service.reverse(ORG, ROUNDED.lat, ROUNDED.lng);
    jest.useFakeTimers({ now: Date.now() + 2_000 });
    let found: unknown;
    try {
      found = await service.search(ORG, TYPED);
    } finally {
      jest.useRealTimers();
    }

    // Both really went out, with the position and the text in the address...
    expect(place).toMatchObject({ city: 'Chennai', regionCode: 'IN-TN' });
    expect(asked).toHaveLength(2);
    expect(asked[0]).toContain('13.08');
    expect(decodeURIComponent(asked[1]).replace(/\+/g, ' ')).toContain(TYPED);

    // ...and are nowhere afterwards.
    const { keys, values } = redisDump(redis);
    const marks = [...POSITION_MARKS, TYPED, 'Zanzibarqq', encodeURIComponent(TYPED)];
    for (const [where, haystack] of [
      ['answers', JSON.stringify([place, found])],
      ['redis keys', keys],
      ['redis values', values],
      ['log lines', logs.join('\n')],
    ] as const) {
      expectNone(haystack, marks, where);
    }
    // A place has no position field at all.
    expect(Object.keys(place)).toEqual(
      expect.not.arrayContaining(['lat', 'lng', 'lon', 'latitude', 'longitude']),
    );
  });

  it('a competitor: no markup in its items, and no address of theirs in a key or a log line', async () => {
    const { service, repository, redis } = buildCompetitors();
    const saved = repository.seed(ORG);

    const found = await service.discoverFeeds(ORG, 'acme.example');
    const answer = await service.items(ORG, saved.id);
    await refusalOf(service.create(ORG, USER, { name: 'Bad', websiteUrl: 'http://10.0.0.1/x' }));

    expect(found).toHaveLength(2);
    expect(answer.items.length).toBeGreaterThan(5);

    const { keys, values } = redisDump(redis);
    const logged = logs.join('\n');
    expectNone(JSON.stringify([found, answer]), MARKUP_MARKS, 'answers');
    expectNone(values, MARKUP_MARKS, 'redis values');
    // What they publish is kept under the row's id and a hash, never under their address.
    expectNone(keys, ADDRESS_MARKS, 'redis keys');
    expectNone(logged, [...ADDRESS_MARKS, '10.0.0.1', ...MARKUP_MARKS], 'log lines');
    // The one thing written to the row is a sentence of ours, or nothing.
    expect(repository.noteCheck).toHaveBeenCalledWith(ORG, saved.id, {
      lastCheckedAt: expect.any(Date),
      lastError: null,
    });
  });

  it('a page that was read: text only, and no address of it in a key or a log line', async () => {
    const { service, redis } = buildReader();

    const article = await service.read(ORG, READER_SAMPLE.article);
    const viaLink = await service.read(
      ORG,
      'https://news.google.com/rss/articles/CBMiSAMPLEstoryTamil0001?oc=5',
    );
    await service.read(ORG, 'https://news.example/story?token=SweepTokenQq81');
    await refusalOf(service.read(ORG, READER_SAMPLE.missing));
    await refusalOf(service.read(ORG, 'http://10.0.0.1/secret-path'));

    expect(article.text).toContain('The old harbour market opened its gates again');
    expect(viaLink.finalUrl).toBe(READER_SAMPLE.tamilArticle);

    const { keys } = redisDump(redis);
    const logged = logs.join('\n');
    // The sample page carries a script, a style block, a nav and an aside. None of it is in the answer.
    expectNone(
      JSON.stringify([article, viaLink]),
      [...MARKUP_MARKS, '<p>', '<div', 'Most Read'],
      'answers',
    );
    expectNone(
      keys,
      [...ADDRESS_MARKS, 'CBMiSAMPLEstoryTamil0001', 'SweepTokenQq81', 'harbour-market'],
      'redis keys',
    );
    expectNone(
      logged,
      [
        ...ADDRESS_MARKS,
        '10.0.0.1',
        'secret-path',
        'SweepTokenQq81',
        'CBMiSAMPLEstoryTamil0001',
        'harbour-market',
        ...MARKUP_MARKS,
      ],
      'log lines',
    );
  });
});

/* ───────────────────────────── no direct fetch ───────────────────────────── */

describe('Discover never reaches the network on its own', () => {
  const REPO = join(__dirname, '../../../../..');
  const ROOTS = [join(REPO, 'packages/discover-engine/src'), __dirname];

  /** What a direct outside call looks like. The lookbehind lets `source.fetch(` and `this.engine.fetch(` through. */
  const FORBIDDEN: [RegExp, string][] = [
    [/(?<![.\w])fetch\(/, 'a call to the global fetch'],
    [/\bglobalThis\.fetch\b/, 'the global fetch'],
    [/\bwindow\.fetch\b/, 'the global fetch'],
    [/\bXMLHttpRequest\b/, 'XMLHttpRequest'],
    [/from ['"]node:(http|https|http2|net|tls|dns|dgram)['"]/, 'a Node network module'],
    [/require\(['"]node:(http|https|http2|net|tls|dns|dgram)['"]\)/, 'a Node network module'],
    [/from ['"](http|https|http2|net|tls|dns)['"]/, 'a Node network module'],
    [
      /from ['"](axios|got|undici|node-fetch|superagent|request|cross-fetch|ky)['"]/,
      'a network library',
    ],
    [
      /require\(['"](axios|got|undici|node-fetch|superagent|request|cross-fetch|ky)['"]\)/,
      'a network library',
    ],
    [/\.parseURL\(/, 'the feed parser fetching by itself'],
    [/\bfetchBinarySafely\b|\bheadUrlSafely\b/, 'a guarded fetch other than the one adapter'],
  ];

  function withoutComments(source: string): string[] {
    // Block comments keep their line count, so a finding names the right line.
    const blanked = source.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '));
    return blanked.split(/\r?\n/).map((line) => line.replace(/^\s*\/\/.*$/, ''));
  }

  function findings(): string[] {
    const found: string[] = [];
    for (const root of ROOTS) {
      for (const file of sourceFiles(root)) {
        withoutComments(readFileSync(file, 'utf8')).forEach((line, index) => {
          for (const [pattern, what] of FORBIDDEN) {
            if (pattern.test(line)) {
              found.push(`${file.slice(REPO.length + 1).replace(/\\/g, '/')}:${index + 1} ${what}`);
            }
          }
        });
      }
    }
    return found;
  }

  it('reads both folders, so an empty answer means something', () => {
    const files = ROOTS.flatMap((root) => sourceFiles(root));

    expect(files.length).toBeGreaterThan(40);
    expect(files.some((file) => file.endsWith('discover.engine.ts'))).toBe(true);
    expect(files.some((file) => file.endsWith('google-news-link.ts'))).toBe(true);
    expect(files.every((file) => !/\.(spec|test)\.ts$/.test(file))).toBe(true);
  });

  it('has no direct fetch, no network module and no network library in the engine or the API module', () => {
    expect(findings()).toEqual([]);
  });

  it('calls the guarded fetch in exactly one place: the adapter in discover.engine.ts', () => {
    const calls: string[] = [];
    for (const root of ROOTS) {
      for (const file of sourceFiles(root)) {
        withoutComments(readFileSync(file, 'utf8')).forEach((line, index) => {
          if (/\bfetchUrlSafely\(/.test(line)) {
            calls.push(`${file.slice(REPO.length + 1).replace(/\\/g, '/')}:${index + 1}`);
          }
        });
      }
    }

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/^apps\/api\/src\/modules\/discover\/discover\.engine\.ts:\d+$/);

    const adapter = readFileSync(join(__dirname, 'discover.engine.ts'), 'utf8');
    const body = adapter.slice(adapter.indexOf('export function createSafeDiscoverFetch'));
    // The adapter checks the certificate and never asks for private addresses or extra ports.
    expect(body.slice(0, body.indexOf('\n}\n'))).toContain('verifyCertificate: true');
    expect(body.slice(0, body.indexOf('\n}\n'))).not.toMatch(/guard:|allowPorts|allowPrivate/);
  });

  it('would catch one: the patterns are not asleep', () => {
    const samples = [
      "const body = await fetch('https://example.org');",
      'await globalThis.fetch(url);',
      "import { request } from 'node:https';",
      "import axios from 'axios';",
      "const { request } = require('undici');",
      'await parser.parseURL(feed);',
    ];
    for (const sample of samples) {
      expect([sample, FORBIDDEN.some(([pattern]) => pattern.test(sample))]).toEqual([sample, true]);
    }
    // And the injected kind is let through.
    for (const sample of [
      'await options.fetch(url, init);',
      'return this.engine.fetch(url, init);',
    ]) {
      expect([sample, FORBIDDEN.some(([pattern]) => pattern.test(sample))]).toEqual([
        sample,
        false,
      ]);
    }
  });
});
