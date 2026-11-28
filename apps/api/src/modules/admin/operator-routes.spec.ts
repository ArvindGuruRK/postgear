/**
 * The operator routes behind the app's real global guards (Module 19
 * section 10, research 12 section 12): `JwtAuthGuard` then `RolesGuard` as
 * `APP_GUARD`s, in that order, and `@PlatformAdmin()` on every operator
 * controller. Only the services are fakes, so what is checked here is who
 * gets in, that the org cookie is ignored, and that the Change Log has no
 * route to edit or delete a row.
 */
import { type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { PLATFORM_ADMIN_KEY } from '../../common/decorators/platform-admin.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { RedisService } from '../redis/redis.service';
import { OperatorCostsController } from './costs/operator-costs.controller';
import { OperatorCostsService } from './costs/operator-costs.service';
import {
  OperatorChangesController,
  OperatorPlansController,
  OperatorWorkspacesController,
} from './entitlements/operator-entitlements.controller';
import { OperatorEntitlementsService } from './entitlements/operator-entitlements.service';
import { OperatorLibraryController } from './library/operator-library.controller';
import { OperatorLibraryService } from './library/operator-library.service';

const SECRET = 'operator-routes-test-secret';
const ORG_IN_PATH = 'org-in-path';

const users: Record<string, { email: string; isSuperAdmin: boolean }> = {
  operator: { email: 'demo@postgear.local', isSuperAdmin: true },
  admin: { email: 'admin@postgear.local', isSuperAdmin: false },
  member: { email: 'member@postgear.local', isSuperAdmin: false },
};

jest.mock('@postgear/db', () => ({
  ...jest.requireActual('@postgear/db'),
  prisma: {
    user: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => {
        const user = users[where.id];
        return user
          ? { id: where.id, ...user, onboardingCompletedAt: new Date(), activated: true }
          : null;
      }),
    },
    userOrganization: {
      // The admin is a workspace ADMIN of the cookie's workspace; it must not matter.
      findFirst: jest.fn(
        async ({ where }: { where: { userId: string; organizationId: string } }) =>
          where.userId === 'admin' ? { organizationId: where.organizationId, role: 'ADMIN' } : null,
      ),
    },
  },
}));

describe('operator routes', () => {
  let app: INestApplication;
  let jwt: JwtService;
  const entitlements = {
    plans: jest.fn(async () => ({ cells: [] })),
    workspaceEntitlements: jest.fn(async (orgId: string) => ({ orgId })),
    usageOf: jest.fn(async (orgId: string) => ({ orgId })),
    changes: jest.fn(async () => ({ changes: [] })),
    savePlans: jest.fn(async () => ({ saved: 1 })),
  };
  // Sprint 13, Module 15: the Clips costs read.
  const costs = { costs: jest.fn(async () => ({ byKind: [] })) };
  const library = {
    runs: jest.fn(async () => []),
    items: jest.fn(async () => ({ items: [] })),
    hideItem: jest.fn(async () => ({ status: 'HIDDEN' })),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: SECRET })],
      controllers: [
        OperatorPlansController,
        OperatorWorkspacesController,
        OperatorChangesController,
        OperatorLibraryController,
        OperatorCostsController,
      ],
      providers: [
        { provide: ConfigService, useValue: new ConfigService({ NODE_ENV: 'development' }) },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
        { provide: RedisService, useValue: { incrementWithTtl: jest.fn(async () => 1) } },
        { provide: OperatorEntitlementsService, useValue: entitlements },
        { provide: OperatorLibraryService, useValue: library },
        { provide: OperatorCostsService, useValue: costs },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
    jwt = moduleRef.get(JwtService);
  });

  afterAll(async () => {
    await app.close();
  });

  const session = (userId: string) => `pg_session=${jwt.sign({ sub: userId, email: 'x' })}`;
  const server = () => app.getHttpServer();

  it('answers 401 without a session', async () => {
    expect((await request(server()).get('/operator/entitlements/plans')).status).toBe(401);
    expect((await request(server()).get('/operator/library/runs')).status).toBe(401);
  });

  it('answers 403 to a workspace ADMIN and to a member, with an org cookie or without', async () => {
    for (const who of ['admin', 'member']) {
      const response = await request(server())
        .get('/operator/entitlements/plans')
        .set('Cookie', [session(who), 'pg_org=org-cookie']);
      expect(response.status).toBe(403);
      expect(
        (await request(server()).get('/operator/changes').set('Cookie', session(who))).status,
      ).toBe(403);
    }
  });

  it('lets an operator in', async () => {
    const response = await request(server())
      .get('/operator/entitlements/plans')
      .set('Cookie', session('operator'));
    expect(response.status).toBe(200);
    expect(
      (await request(server()).get('/operator/library/runs').set('Cookie', session('operator')))
        .status,
    ).toBe(200);
  });

  it('ignores the org cookie: the workspace is the path id', async () => {
    const response = await request(server())
      .get(`/operator/workspaces/${ORG_IN_PATH}/usage`)
      .set('Cookie', [session('operator'), 'pg_org=org-cookie']);
    expect(response.status).toBe(200);
    expect(entitlements.usageOf).toHaveBeenCalledWith(ORG_IN_PATH);
    expect(entitlements.usageOf).not.toHaveBeenCalledWith('org-cookie');
  });

  it('has no route to edit or delete a Change Log row', async () => {
    const cookie = session('operator');
    for (const method of ['put', 'patch', 'delete', 'post'] as const) {
      expect(
        (await request(server())[method]('/operator/changes').set('Cookie', cookie)).status,
      ).toBe(404);
      expect(
        (await request(server())[method]('/operator/changes/some-id').set('Cookie', cookie)).status,
      ).toBe(404);
    }
  });

  it('refuses a write body with an unknown key before the service sees it', async () => {
    const response = await request(server())
      .post(`/operator/library/items/sound/11111111-1111-4111-8111-111111111111/hide`)
      .set('Cookie', session('operator'))
      .send({ reason: 'A takedown request from the author.', url: 'https://example.com' });
    expect(response.status).toBe(400);
    expect(library.hideItem).not.toHaveBeenCalled();
  });

  it('lets only an operator read the Clips costs, and refuses a bad window first', async () => {
    expect((await request(server()).get('/operator/clips/costs')).status).toBe(401);
    for (const who of ['admin', 'member']) {
      const response = await request(server())
        .get('/operator/clips/costs')
        .set('Cookie', [session(who), 'pg_org=org-cookie']);
      expect(response.status).toBe(403);
    }
    expect(costs.costs).not.toHaveBeenCalled();

    const cookie = session('operator');
    const ok = await request(server())
      .get('/operator/clips/costs?from=2026-11-01&to=2026-12-01')
      .set('Cookie', cookie);
    expect(ok.status).toBe(200);
    expect(costs.costs).toHaveBeenCalledWith({ from: '2026-11-01', to: '2026-12-01' });

    for (const query of [
      'from=2026-09-01&to=2026-12-03',
      'from=2026-11-10&to=2026-11-01',
      'from=2026-11-01&orgId=org-cookie',
      'from=yesterday',
    ]) {
      expect(
        (await request(server()).get(`/operator/clips/costs?${query}`).set('Cookie', cookie))
          .status,
      ).toBe(400);
    }
    expect(costs.costs).toHaveBeenCalledTimes(1);
  });

  it('marks every operator controller with @PlatformAdmin()', () => {
    for (const controller of [
      OperatorPlansController,
      OperatorWorkspacesController,
      OperatorChangesController,
      OperatorLibraryController,
      OperatorCostsController,
    ]) {
      expect(Reflect.getMetadata(PLATFORM_ADMIN_KEY, controller)).toBe(true);
    }
  });
});
