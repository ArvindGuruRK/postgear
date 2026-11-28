/**
 * Security sweep, Sprint 13 Module 16: Editor seats over real HTTP.
 *
 * `editor-access.spec.ts` proves the route table matches the decorators and
 * `editor-access.guard.spec.ts` puts every route to the real `RolesGuard`.
 * This spec goes one step further, through Nest's own request pipeline (the
 * real guard as a global guard, the real Zod pipes, the real controllers, the
 * real `PostsService` rules), with hand-made bodies:
 * - every denied posts, channels, API keys, webhooks, billing, analytics and
 *   members route answers an Editor 403 before any service runs, whatever
 *   the body (a member gets past the same wall, so the 403 is the role);
 * - an Editor cannot schedule or publish by any route: `schedule`,
 *   `publish-now`, a create or update asking for the queue (with or without
 *   "post now" or a repeat), a move of a queued post, Next Available;
 * - a disabled Editor is refused on every route that needs a role, the
 *   membership lookup honouring `disabled` exactly as the database would;
 * - every route that can put a post in the queue or move it in time is
 *   `deny` or `draft-only` in the table, and every other path that creates a
 *   post on a person's behalf (Send To Composer, Studio, the Copilot) writes
 *   a literal draft;
 * - nothing re-enables a membership, so a re-enable can never skip the seat
 *   check (decision: the "re-enable re-check" holds because no such path
 *   exists; the day one is written, this test names it);
 * - an invite link signed in the old format (no address, ADMIN or USER)
 *   still verifies, frozen as literal tokens.
 */
import { readdirSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import {
  type CanActivate,
  type ExecutionContext,
  type INestApplication,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { Role, State } from '@postgear/db';
import { documentFromText } from '@postgear/social-core';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AnalyticsController } from '../../modules/analytics/analytics.controller';
import { BillingController } from '../../modules/billing/billing.controller';
import { ChannelsController } from '../../modules/channels/channels.controller';
import { ApiKeysController } from '../../modules/developers/api-keys/api-keys.controller';
import { InviteTokenService } from '../../modules/org/invite-token.service';
import { OrgController } from '../../modules/org/org.controller';
import { PostsController } from '../../modules/posts/posts.controller';
import { PostsRepository } from '../../modules/posts/posts.repository';
import { PostsService } from '../../modules/posts/posts.service';
import { WebhooksController } from '../../modules/webhooks/webhooks.controller';
import { securityLogger } from '../logging/security-logger';
import { loadAppRoutes, loadMatrix } from './editor-access.routes';
import { RolesGuard } from './roles.guard';

jest.mock('../../config/env', () => ({
  ...jest.requireActual('../../config/env'),
  validateEnv: (config: unknown) => config,
}));

jest.mock('@postgear/db', () => ({
  ...jest.requireActual('@postgear/db'),
  prisma: { userOrganization: { findFirst: jest.fn() } },
}));

const { prisma } = jest.requireMock('@postgear/db') as {
  prisma: { userOrganization: { findFirst: jest.Mock } };
};

const ORG_ID = 'org-http';
const GROUP = '0b8f3f3e-8a1f-4c55-9a55-2f1f5d1c9e11';
const ID = '6f1c2f7e-5d2b-4d0c-9a4e-3b8f0e2a1c11';

type Caller = 'admin' | 'member' | 'editor' | 'disabled-editor';

/** The membership table, read the way Postgres would read the guard's `where`. */
const MEMBERSHIPS: Array<{
  userId: string;
  organizationId: string;
  role: Role;
  disabled: boolean;
}> = [
  { userId: 'u-admin', organizationId: ORG_ID, role: Role.ADMIN, disabled: false },
  { userId: 'u-member', organizationId: ORG_ID, role: Role.USER, disabled: false },
  { userId: 'u-editor', organizationId: ORG_ID, role: Role.EDITOR, disabled: false },
  { userId: 'u-disabled-editor', organizationId: ORG_ID, role: Role.EDITOR, disabled: true },
];

prisma.userOrganization.findFirst.mockImplementation(
  async ({ where }: { where: Record<string, unknown> }) => {
    const row = MEMBERSHIPS.find(
      (entry) =>
        entry.userId === where.userId &&
        entry.organizationId === where.organizationId &&
        (where.disabled === undefined || entry.disabled === where.disabled),
    );
    return row ? { organizationId: row.organizationId, role: row.role } : null;
  },
);

/** Stands in for `JwtAuthGuard`: the caller is named by a header. */
@Injectable()
class TestAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const caller = req.headers['x-test-caller'] as Caller;
    req.user = {
      id: `u-${caller}`,
      email: `${caller}@example.test`,
      isSuperAdmin: false,
      onboardingCompletedAt: new Date(),
    };
    return true;
  }
}

/** Every service a controller holds: each call is recorded and answers `{ reached: true }`. */
const reached: string[] = [];
function recorder(name: string): unknown {
  return new Proxy(
    {},
    {
      get: (_target, prop) => {
        if (prop === 'then') return undefined;
        return (..._args: unknown[]) => {
          reached.push(`${name}.${String(prop)}`);
          return { reached: true };
        };
      },
    },
  );
}

/** The posts repository behind the real `PostsService`: the stored roots are set per test. */
let storedRoots: Array<{ state: State }> = [];
const postsRepository = new Proxy(
  {},
  {
    get: (_target, prop) => {
      if (prop === 'then') return undefined;
      return async () => {
        reached.push(`PostsRepository.${String(prop)}`);
        if (prop === 'findRoots') return storedRoots;
        if (prop === 'publishNow') return { outcome: 'not_found' };
        return [];
      };
    },
  },
);

let app: INestApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [
      PostsController,
      ChannelsController,
      ApiKeysController,
      WebhooksController,
      BillingController,
      AnalyticsController,
      OrgController,
    ],
    providers: [
      { provide: APP_GUARD, useClass: TestAuthGuard },
      { provide: APP_GUARD, useClass: RolesGuard },
      { provide: ConfigService, useValue: { get: (_key: string, fallback?: unknown) => fallback } },
      { provide: PostsRepository, useValue: postsRepository },
      {
        provide: PostsService,
        useFactory: (repository: PostsRepository) =>
          new PostsService(
            repository,
            recorder('ChannelsService') as never,
            recorder('MediaService') as never,
            recorder('SchedulingService') as never,
            recorder('TagsService') as never,
          ),
        inject: [PostsRepository],
      },
    ],
  })
    .useMocker((token) => recorder(typeof token === 'function' ? token.name : String(token)))
    .compile();

  app = moduleRef.createNestApplication({ logger: false });
  app.use(cookieParser());
  await app.init();
});

afterAll(async () => {
  await app?.close();
});

let denied: jest.SpyInstance;
beforeEach(() => {
  reached.length = 0;
  storedRoots = [];
  denied = jest.spyOn(securityLogger, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  denied.mockRestore();
});

function call(method: string, url: string, caller: Caller, body?: unknown) {
  const verb = method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete';
  const req = request(app.getHttpServer())
    [verb](url)
    .set('Cookie', `pg_org=${ORG_ID}`)
    .set('x-test-caller', caller);
  return body === undefined ? req : req.send(body as object);
}

/** A path with every parameter filled: the workspace for `/orgs/:id`, a UUID elsewhere. */
function urlOf(routePath: string): string {
  return routePath
    .replace(/^\/orgs\/:id/, `/orgs/${ORG_ID}`)
    .replace(/:group/g, GROUP)
    .replace(/:provider/g, 'linkedin')
    .replace(/:[A-Za-z]+/g, ID);
}

/** A body built to get past every check a body could fail, aimed at the route. */
const HAND_MADE = {
  state: 'QUEUE',
  publishNow: true,
  publishDate: '2026-12-01T10:00:00.000Z',
  intervalInDays: 7,
  role: 'ADMIN',
  email: 'editor@example.test',
  name: 'Mine',
  url: 'https://example.test/hook',
  events: ['post.published'],
  planId: 'pro',
  channelIds: ['a'],
};

const PREFIXES =
  /^[A-Z]+ \/(posts|channels|developers\/api-keys|webhooks|billing|analytics|orgs)(\/|$)/;
const matrix = loadMatrix();
const DENIED = Object.entries(matrix.routes)
  .filter(([key, entry]) => entry.access === 'deny' && PREFIXES.test(key))
  .map(([key]) => key);

describe('an Editor over HTTP', () => {
  it('covers the routes this sweep names', () => {
    for (const key of [
      'PUT /posts/:group/schedule',
      'POST /posts/:group/publish-now',
      'GET /channels/next-slot',
      'PATCH /channels/:id',
      'POST /developers/api-keys',
      'GET /webhooks',
      'GET /billing/status',
      'GET /analytics/overview',
      'POST /orgs/:id/invites',
      'PATCH /orgs/:id/members/:userId',
    ]) {
      expect(DENIED).toContain(key);
    }
  });

  it.each(DENIED)('%s: 403 before any service, even with a hand-made body', async (key) => {
    const [method, routePath] = key.split(' ') as [string, string];
    const response = await call(
      method,
      urlOf(routePath),
      'editor',
      method === 'GET' ? undefined : HAND_MADE,
    );
    expect(response.status).toBe(403);
    expect(reached).toEqual([]);
    expect(denied).toHaveBeenCalledWith(
      'rbac.denied',
      expect.objectContaining({ userId: 'u-editor', role: Role.EDITOR }),
    );
  });

  it.each([
    'PUT /posts/:group/schedule',
    'POST /posts/:group/publish-now',
    'GET /channels/next-slot',
    'POST /developers/api-keys',
    'GET /webhooks',
    'GET /billing/status',
    'GET /analytics/overview',
    'POST /orgs/:id/invites',
  ])('%s: an admin gets past the same wall', async (key) => {
    const [method, routePath] = key.split(' ') as [string, string];
    const response = await call(
      method,
      urlOf(routePath),
      'admin',
      method === 'GET' ? undefined : {},
    );
    expect(response.status).not.toBe(403);
  });
});

describe('an Editor and the posts wall, through the real PostsService', () => {
  const post = (overrides: Record<string, unknown> = {}) => ({
    state: 'DRAFT',
    publishDate: '2026-12-01T10:00:00.000Z',
    shared: [{ content: documentFromText('Hello'), media: [] }],
    channels: [{ channelId: 'channel-1', customized: false }],
    ...overrides,
  });
  const update = (overrides: Record<string, unknown> = {}) =>
    post({ expectedUpdatedAt: '2026-11-28T10:00:00.000Z', ...overrides });

  const expectEditorForbidden = (response: request.Response) => {
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ code: 'editor_forbidden' });
    // Refused before any channel, media or tag was looked up, and nothing written.
    expect(reached.filter((entry) => !entry.startsWith('PostsRepository.findRoots'))).toEqual([]);
  };

  it.each([
    ['the queue', { state: 'QUEUE' }],
    ['the queue, posted now', { state: 'QUEUE', publishNow: true }],
    ['the queue, repeating weekly', { state: 'QUEUE', intervalInDays: 7 }],
  ])('POST /posts asking for %s is 403 editor_forbidden', async (_name, overrides) => {
    expectEditorForbidden(await call('POST', '/posts', 'editor', post(overrides)));
  });

  it('POST /posts with "post now" on a draft is refused by the schema, never posted', async () => {
    const response = await call('POST', '/posts', 'editor', post({ publishNow: true }));
    expect(response.status).toBe(400);
    expect(reached).toEqual([]);
  });

  it.each([
    ['a draft into the queue', [State.DRAFT], { state: 'QUEUE' }],
    ['a queued post, even into a draft', [State.QUEUE], {}],
    [
      'a queued post to a new time (a calendar move)',
      [State.QUEUE],
      { publishDate: '2026-12-02T10:00:00.000Z' },
    ],
    ['a published post', [State.PUBLISHED], {}],
    ['a failed post', [State.ERROR], {}],
    [
      'a draft into a weekly repeat in the queue',
      [State.DRAFT],
      { state: 'QUEUE', intervalInDays: 7 },
    ],
  ])('PUT /posts/:group moving %s is 403 editor_forbidden', async (_name, roots, overrides) => {
    storedRoots = roots.map((state) => ({ state }));
    expectEditorForbidden(await call('PUT', `/posts/${GROUP}`, 'editor', update(overrides)));
  });

  it('DELETE /posts/:group of a queued post is 403 editor_forbidden', async () => {
    storedRoots = [{ state: State.QUEUE }];
    const response = await call('DELETE', `/posts/${GROUP}`, 'editor');
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ code: 'editor_forbidden' });
    expect(reached).toEqual(['PostsRepository.findRoots']);
  });

  it('a member asking for the queue goes on to resolve the post', async () => {
    await call('POST', '/posts', 'member', post({ state: 'QUEUE' }));
    expect(reached.some((entry) => entry.startsWith('ChannelsService.'))).toBe(true);
  });
});

describe('a disabled Editor', () => {
  const routes = loadAppRoutes().filter((route) => route.roles !== null && !route.isPublic);
  const SAMPLE = [
    'GET /posts',
    'POST /posts',
    'PUT /posts/:group',
    'GET /posts/calendar',
    'PUT /posts/:group/schedule',
    'GET /channels/next-slot',
    'GET /analytics/overview',
  ];

  it.each(SAMPLE)('%s: 403, as a member of nothing', async (key) => {
    const [method, routePath] = key.split(' ') as [string, string];
    const response = await call(
      method,
      urlOf(routePath),
      'disabled-editor',
      method === 'GET' ? undefined : HAND_MADE,
    );
    expect(response.status).toBe(403);
    expect(reached).toEqual([]);
    expect(denied).toHaveBeenCalledWith(
      'rbac.denied',
      expect.objectContaining({ userId: 'u-disabled-editor', reason: 'not-a-member' }),
    );
  });

  it('is refused on every route that needs a role, by the same lookup (the full set is in editor-access.guard.spec.ts)', () => {
    expect(routes.length).toBeGreaterThan(200);
    for (const key of SAMPLE) expect(routes.map((route) => route.key)).toContain(key);
  });

  it('gets no workspace from an open route either: the channel list is empty', async () => {
    const response = await call('GET', '/channels', 'disabled-editor');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ channels: [], limit: null });
    expect(reached).toEqual([]);
  });
});

// --- Source checks: no other way to schedule, and nothing re-enables ----------------

const API_SRC = path.resolve(__dirname, '../..');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.ts$/.test(entry.name) && !/\.(spec|test)\.ts$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** The text of each call `name(` in `text`, up to its balancing parenthesis. */
function callsOf(text: string, name: RegExp): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(name)) {
    const start = (match.index ?? 0) + match[0].length;
    let depth = 1;
    let at = start;
    while (at < text.length && depth > 0) {
      if (text[at] === '(') depth += 1;
      else if (text[at] === ')') depth -= 1;
      at += 1;
    }
    found.push(text.slice(start, at - 1));
  }
  return found;
}

describe('every way to put a post in the queue or move it in time', () => {
  it('is deny or draft-only for an Editor in the route table', () => {
    const writes = Object.entries(matrix.routes).filter(
      ([key]) =>
        /^(POST|PUT|PATCH|DELETE) \/posts(\/|$)/.test(key) ||
        /^[A-Z]+ \/channels\/next-slot$/.test(key) ||
        // An automation's run can queue or publish posts; its OAuth callback (a GET) only finishes a connection.
        /^(POST|PUT|PATCH|DELETE) \/(automations|automation-runs|automation-connections)(\/|$)/.test(
          key,
        ),
    );
    expect(writes.length).toBeGreaterThan(10);
    for (const [key, entry] of writes) {
      expect([key, ['deny', 'draft-only'].includes(entry.access)]).toEqual([key, true]);
    }
  });

  it('writes a literal draft wherever a post is made for a person outside the posts and automation routes', () => {
    const makers: string[] = [];
    for (const file of sourceFiles(path.join(API_SRC, 'modules'))) {
      const rel = path.relative(API_SRC, file);
      if (/^modules\/(posts|automations|developers\/v1)\//.test(rel.replace(/\\/g, '/'))) continue;
      const text = readFileSync(file, 'utf8');
      for (const body of callsOf(text, /\bposts\.create\(/g)) {
        makers.push(rel);
        expect([rel, /state:\s*'DRAFT'/.test(body)]).toEqual([rel, true]);
        expect([rel, /state:\s*'QUEUE'|publishNow|intervalInDays/.test(body)]).toEqual([
          rel,
          false,
        ]);
      }
      // Nothing outside the posts module moves a post in time or publishes it.
      expect([rel, /\bposts\.(reschedule|publishNow)\(/.test(text)]).toEqual([rel, false]);
    }
    // Send To Composer, Studio's send and the Copilot.
    expect(makers.sort()).toEqual(
      [
        'modules/ai/tools/copilot-tools.ts',
        'modules/clips/clip/clip-send.service.ts',
        'modules/studio/studio.service.ts',
      ].map((rel) => rel.split('/').join(path.sep)),
    );
  });
});

describe('a membership', () => {
  it('is never re-enabled by any write, so no Editor comes back without a seat check', () => {
    const writes: string[] = [];
    for (const file of sourceFiles(API_SRC)) {
      const text = readFileSync(file, 'utf8');
      for (const body of callsOf(
        text,
        /\buserOrganization\.(create|createMany|update|updateMany|upsert)\(/g,
      )) {
        writes.push(path.relative(API_SRC, file));
        expect([path.relative(API_SRC, file), /\bdisabled\b/.test(body)]).toEqual([
          path.relative(API_SRC, file),
          false,
        ]);
      }
    }
    // The membership writes there are: workspace create, invite accept, and the two role changes.
    expect(writes.length).toBe(4);
  });
});

describe('an invite link in the old format', () => {
  const SECRET = 'frozen-test-secret-for-old-invite-links-0123456789';
  const service = new InviteTokenService({ getOrThrow: () => SECRET } as unknown as ConfigService);
  // Signed before Module 14 had Editors: no address, ADMIN or USER, frozen here as text.
  const OLD_USER =
    'eyJ2IjoxLCJpZCI6IlptOXlMV0V0Wm5KdmVtVnVMV3hwYm1zIiwib3JnSWQiOiJzZWVkLWRlbW8tb3JnIiwicm9sZSI6IlVTRVIiLCJleHAiOjQxMDI0NDQ4MDAwMDB9.lIHNOvcKr0thipSFMUfj87kSPql7rkmhV9Aq8HokY4M';
  const OLD_ADMIN =
    'eyJ2IjoxLCJpZCI6IlptOXlMV0V0Wm5KdmVtVnVMV3hwYm1zIiwib3JnSWQiOiJzZWVkLWRlbW8tb3JnIiwicm9sZSI6IkFETUlOIiwiZXhwIjo0MTAyNDQ0ODAwMDAwfQ.2nLnDSlAWLBwhcCNW1578_bUaiZYcn_cqnF5I6JBoFM';

  it.each([
    ['USER', OLD_USER],
    ['ADMIN', OLD_ADMIN],
  ])('still verifies for %s, with no address bound', (role, token) => {
    expect(service.verify(token, Date.parse('2026-11-28T10:00:00Z'))).toEqual({
      ok: true,
      payload: { id: 'Zm9yLWEtZnJvemVuLWxpbms', orgId: 'seed-demo-org', role, exp: 4102444800000 },
    });
  });

  it('is refused once a letter is changed, and under another secret', () => {
    const tampered = `${OLD_USER.slice(0, 10)}x${OLD_USER.slice(11)}`;
    expect(service.verify(tampered).ok).toBe(false);
    const other = new InviteTokenService({
      getOrThrow: () => `${SECRET}-other`,
    } as unknown as ConfigService);
    expect(other.verify(OLD_USER).ok).toBe(false);
  });
});
