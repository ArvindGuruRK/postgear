/**
 * Who may call the competitor routes, read from the real route metadata through
 * the real guards, in the shape of `discover.routes.spec.ts`: any member may
 * list, add, edit, read, mark seen and research; only an admin may remove;
 * nothing is public; and a new route can only be added by adding it to this
 * table.
 *
 * Then what the simulated engine does with the addresses the hand check types,
 * because that is the one place a mistake would let simulation fetch something.
 */
import {
  ForbiddenException,
  RequestMethod,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { HTTP_CODE_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import type { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { JwtService } from '@nestjs/jwt';
import { Role } from '@postgear/db';
import { COMPETITOR_SAMPLE } from '@postgear/discover-engine';

jest.mock('@postgear/db', () => ({
  ...jest.requireActual('@postgear/db'),
  prisma: { userOrganization: { findFirst: jest.fn() }, user: { findUnique: jest.fn() } },
}));

import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import type { CompetitorResearchService } from './competitor-research.service';
import { CompetitorsController } from './competitors.controller';
import { createCompetitorEngine } from './competitors.engine';
import type { CompetitorsService } from './competitors.service';
import { MAX_COMPETITORS } from './dto/competitors.schema';

const { prisma } = jest.requireMock('@postgear/db') as {
  prisma: { userOrganization: { findFirst: jest.Mock } };
};

/** What any member may do. Module 10 added the unseen count, marking seen and Research. */
const MEMBER_ROUTES = [
  'list',
  'create',
  'discoverFeeds',
  'update',
  'items',
  'unseen',
  'seen',
  'research',
];
/** The one route that is an admin's. */
const REMOVE = 'remove';
const ROUTES = [...MEMBER_ROUTES, REMOVE];
const ORG_ID = 'org-1';
const user = { id: 'u1', email: 'a@x.com', isSuperAdmin: false, onboardingCompletedAt: null };
const config = { get: (_key: string, fallback: string) => fallback } as unknown as ConfigService;
const proto = CompetitorsController.prototype as unknown as Record<string, object>;

function contextFor(name: string, request: object) {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => proto[name],
    getClass: () => CompetitorsController,
  } as never;
}

function asMember(role: Role) {
  prisma.userOrganization.findFirst.mockResolvedValue({ organizationId: ORG_ID, role });
  return new RolesGuard(new Reflector(), config);
}

describe('Competitor routes', () => {
  it('lists every route in the table, and nothing that is not a route', () => {
    const routes = Object.getOwnPropertyNames(proto).filter(
      (name) =>
        name !== 'constructor' &&
        typeof proto[name] === 'function' &&
        Reflect.getMetadata(PATH_METADATA, proto[name]) !== undefined,
    );

    expect(routes.sort()).toEqual([...ROUTES].sort());
  });

  it('sits under /discover/competitors, with the verbs and paths the page calls', () => {
    const at = (name: string) => [
      RequestMethod[Reflect.getMetadata(METHOD_METADATA, proto[name])],
      Reflect.getMetadata(PATH_METADATA, proto[name]),
    ];

    expect(Reflect.getMetadata(PATH_METADATA, CompetitorsController)).toBe('discover/competitors');
    expect(at('list')).toEqual(['GET', '/']);
    expect(at('create')).toEqual(['POST', '/']);
    expect(at('discoverFeeds')).toEqual(['POST', 'discover-feeds']);
    expect(at('update')).toEqual(['PATCH', ':id']);
    expect(at('remove')).toEqual(['DELETE', ':id']);
    expect(at('items')).toEqual(['GET', ':id/items']);
    expect(at('unseen')).toEqual(['GET', 'unseen']);
    expect(at('seen')).toEqual(['POST', 'seen']);
    expect(at('research')).toEqual(['POST', ':id/research']);
    // A new competitor is 201; finding feeds, marking seen and a research create nothing, so 200.
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, proto.create)).toBe(201);
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, proto.discoverFeeds)).toBe(200);
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, proto.seen)).toBe(200);
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, proto.research)).toBe(200);
  });

  it.each(MEMBER_ROUTES)('lets a member call %s', async (name) => {
    const guard = asMember(Role.USER);

    await expect(
      guard.canActivate(contextFor(name, { user, cookies: { pg_org: ORG_ID } })),
    ).resolves.toBe(true);
  });

  it('refuses a member the remove, with a 403', async () => {
    const guard = asMember(Role.USER);

    await expect(
      guard.canActivate(contextFor(REMOVE, { user, cookies: { pg_org: ORG_ID } })),
    ).rejects.toThrow(ForbiddenException);
  });

  it.each([Role.ADMIN, Role.SUPERADMIN])('lets a workspace %s remove', async (role) => {
    const guard = asMember(role);

    await expect(
      guard.canActivate(contextFor(REMOVE, { user, cookies: { pg_org: ORG_ID } })),
    ).resolves.toBe(true);
  });

  it.each(ROUTES)('refuses %s to someone outside the workspace', async (name) => {
    prisma.userOrganization.findFirst.mockResolvedValue(null);
    const guard = new RolesGuard(new Reflector(), config);

    await expect(
      guard.canActivate(contextFor(name, { user, cookies: { pg_org: ORG_ID } })),
    ).rejects.toThrow(ForbiddenException);
  });

  it.each(ROUTES)('refuses %s with no session', async (name) => {
    const isPublic = new Reflector().getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      proto[name] as never,
      CompetitorsController,
    ]);
    expect(isPublic).not.toBe(true);

    const jwt = { verifyAsync: jest.fn() } as unknown as JwtService;
    const guard = new JwtAuthGuard(jwt, new Reflector(), config);

    await expect(guard.canActivate(contextFor(name, { cookies: {}, headers: {} }))).rejects.toThrow(
      UnauthorizedException,
    );
  });
});

describe('CompetitorsController', () => {
  const org = { id: ORG_ID, role: Role.USER };
  const SAVED = { id: 'c1', name: 'Acme' };

  function build(researcher?: { available: boolean; research: jest.Mock }) {
    const service = {
      list: jest.fn(async () => [SAVED]),
      create: jest.fn(async () => SAVED),
      update: jest.fn(async () => SAVED),
      remove: jest.fn(async () => undefined),
      discoverFeeds: jest.fn(async () => [
        { url: 'https://acme.example/feed', title: '', kind: 'rss' },
      ]),
      items: jest.fn(async () => ({ items: [], unavailable: [], notes: [] })),
      unseen: jest.fn(async () => ({ total: 0, competitors: {} })),
      markSeen: jest.fn(async () => undefined),
    };
    return {
      service,
      controller: new CompetitorsController(
        service as unknown as CompetitorsService,
        researcher as unknown as CompetitorResearchService | undefined,
      ),
    };
  }

  it("lists the active workspace's competitors with the limit, and no Research without AI", async () => {
    const { controller, service } = build();

    await expect(controller.list(org)).resolves.toEqual({
      competitors: [SAVED],
      limit: MAX_COMPETITORS,
      research: false,
    });
    expect(service.list).toHaveBeenCalledWith(ORG_ID);
  });

  it('offers Research when the instance has AI', async () => {
    const research = jest.fn(async () => ({ research: {}, cached: false, credits: 3 }));
    const { controller } = build({ available: true, research });

    await expect(controller.list(org)).resolves.toMatchObject({ research: true });
  });

  it('adds for the active workspace, noting who added it', async () => {
    const { controller, service } = build();

    await expect(controller.create(org, user, { name: 'Acme' })).resolves.toEqual({
      competitor: SAVED,
    });
    expect(service.create).toHaveBeenCalledWith(ORG_ID, 'u1', { name: 'Acme' });
  });

  it('scopes every route that names an id to the active workspace', async () => {
    const { controller, service } = build();

    await controller.update(org, 'c1', { name: 'Acme' });
    await controller.remove(org, 'c1');
    await controller.items(org, 'c1', user);
    await controller.discoverFeeds(org, { url: 'acme.example' });

    expect(service.update).toHaveBeenCalledWith(ORG_ID, 'c1', { name: 'Acme' });
    expect(service.remove).toHaveBeenCalledWith(ORG_ID, 'c1');
    // Module 10: the person asking rides along, for "new since you last looked".
    expect(service.items).toHaveBeenCalledWith(ORG_ID, 'c1', 'u1');
    expect(service.discoverFeeds).toHaveBeenCalledWith(ORG_ID, 'acme.example');
  });

  it('counts and marks what is seen for the active workspace and the person asking', async () => {
    const { controller, service } = build();

    await controller.unseen(org, user);
    await expect(controller.seen(org, user, { ids: ['c1'] })).resolves.toEqual({ ok: true });
    await controller.seen(org, user, {});

    expect(service.unseen).toHaveBeenCalledWith(ORG_ID, 'u1');
    expect(service.markSeen).toHaveBeenNthCalledWith(1, ORG_ID, 'u1', ['c1']);
    expect(service.markSeen).toHaveBeenNthCalledWith(2, ORG_ID, 'u1', undefined);
  });

  it('researches a competitor of the active workspace, and answers 503 with no AI on the instance', async () => {
    const research = jest.fn(async () => ({ research: {}, cached: false, credits: 3 }));
    const { controller } = build({ available: true, research });

    await controller.research(org, 'c1');
    expect(research).toHaveBeenCalledWith(ORG_ID, 'c1');

    expect(() => build().controller.research(org, 'c1')).toThrow(ServiceUnavailableException);
  });

  it('answers a removal with a sentence', async () => {
    await expect(build().controller.remove(org, 'c1')).resolves.toEqual({
      message: 'Competitor removed.',
    });
  });
});

describe('createCompetitorEngine', () => {
  const env = { DISCOVER_GEOCODER_USER_AGENT: 'PostGear/1.0 (test)' };
  const init = { accept: 'text/html', signal: AbortSignal.timeout(5_000), maxBytes: 1024 * 1024 };

  describe('under simulation', () => {
    const engine = createCompetitorEngine({ ...env, DISCOVER_SIMULATION: 'true' });

    it('serves the sample website and answers 404 for every other address', async () => {
      const page = await engine.fetch(COMPETITOR_SAMPLE.website, init);
      expect(page.status).toBe(200);
      expect(page.body).toContain('Sample: written by hand');

      for (const url of ['https://www.example.org/', 'https://acme.example/pricing']) {
        await expect(engine.fetch(url, init)).resolves.toMatchObject({ status: 404, body: '' });
      }
    });

    it.each([
      'http://127.0.0.1/',
      'http://10.0.0.1/',
      'http://192.168.1.1/',
      'http://169.254.169.254/',
      'http://[::1]/',
      'http://localhost/',
      'https://printer.local/',
    ])('still refuses %s', async (url) => {
      const verdict = await engine.guard(url);

      expect(verdict.ok).toBe(false);
      if (!verdict.ok) expect(['private_address', 'host_forbidden']).toContain(verdict.reason);
    });

    it('still refuses a port, a scheme that is not the web and credentials', async () => {
      const reasons = await Promise.all(
        ['https://acme.example:8443/', 'ftp://acme.example/', 'https://a:b@acme.example/'].map(
          async (url) => {
            const verdict = await engine.guard(url);
            return verdict.ok ? 'ok' : verdict.reason;
          },
        ),
      );

      expect(reasons).toEqual(['port', 'scheme', 'credentials']);
    });

    it('passes the sample website without looking its name up', async () => {
      // `.example` has no DNS at all, so a real lookup would fail closed.
      const verdict = await engine.guard(COMPETITOR_SAMPLE.website);

      expect(verdict.ok).toBe(true);
    });

    it('reads the sample feeds with no age limit, so they never run dry', async () => {
      const result = await engine.feeds.read(COMPETITOR_SAMPLE.blogFeed);

      expect(result.failed).toBeUndefined();
      expect(result.items.map((item) => item.title)).toContain(
        'How we started (an old sample post)',
      );
    });
  });

  describe('for real', () => {
    const engine = createCompetitorEngine({ ...env, DISCOVER_SIMULATION: 'false' });

    it('is not in simulation, and refuses private addresses with no lookup needed', async () => {
      expect(engine.simulation).toBe(false);

      for (const url of ['http://127.0.0.1/', 'http://10.0.0.1/', 'http://localhost:3000/']) {
        const verdict = await engine.guard(url);
        expect(verdict.ok).toBe(false);
      }
    });
  });
});
