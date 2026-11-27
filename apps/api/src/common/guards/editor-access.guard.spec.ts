/**
 * The route matrix, run through the real `RolesGuard` (Sprint 13, Module 14).
 *
 * `editor-access.spec.ts` proves the table matches the decorators; this one
 * proves the guard does what the table says. Every mounted route is put to
 * the guard with a real `Reflector` and the route's own handler and class,
 * once per role: an admin, a member, an Editor, a disabled Editor and a
 * platform superadmin with no membership. The database is the only thing
 * faked (the membership lookup).
 */
import { ForbiddenException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Role } from '@postgear/db';
import { securityLogger } from '../logging/security-logger';
import { loadAppRoutes, loadMatrix, type RouteInfo } from './editor-access.routes';
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

const ORG_ID = 'org-matrix';

type Caller = 'ADMIN' | 'USER' | 'EDITOR' | 'DISABLED_EDITOR' | 'SUPERADMIN';

function userFor(caller: Caller) {
  return {
    id: `u-${caller.toLowerCase()}`,
    email: `${caller.toLowerCase()}@example.test`,
    isSuperAdmin: caller === 'SUPERADMIN',
    onboardingCompletedAt: new Date(),
  };
}

/** What the membership lookup answers: a disabled row reads as no row (`disabled: false` is in the `where`). */
function membershipFor(caller: Caller) {
  if (caller === 'SUPERADMIN' || caller === 'DISABLED_EDITOR') return null;
  return { organizationId: ORG_ID, role: caller };
}

async function decide(guard: RolesGuard, route: RouteInfo, caller: Caller): Promise<boolean> {
  prisma.userOrganization.findFirst.mockResolvedValue(membershipFor(caller));
  const request: Record<string, unknown> = { user: userFor(caller), cookies: { pg_org: ORG_ID } };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => route.handler,
    getClass: () => route.controller,
  };
  try {
    return await guard.canActivate(context as never);
  } catch (error) {
    if (error instanceof ForbiddenException) return false;
    throw error;
  }
}

describe('RolesGuard against the route matrix', () => {
  const matrix = loadMatrix();
  const routes = loadAppRoutes().filter((route) => route.key in matrix.routes);
  const config = { get: (_key: string, fallback: string) => fallback } as unknown as ConfigService;
  const guard = new RolesGuard(new Reflector(), config);
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(securityLogger, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('answers an Editor exactly as the table says, on every route', async () => {
    const wrong: string[] = [];
    for (const route of routes) {
      const access = matrix.routes[route.key].access;
      const expected = access !== 'deny';
      const allowed = await decide(guard, route, 'EDITOR');
      if (allowed !== expected) wrong.push(`${route.key}: expected ${expected}, got ${allowed}`);
    }
    expect(wrong).toEqual([]);
    expect(routes.length).toBeGreaterThan(300);
  });

  it('logs rbac.denied for every refused Editor', async () => {
    const denied = routes.filter((route) => matrix.routes[route.key].access === 'deny');
    for (const route of denied) {
      await decide(guard, route, 'EDITOR');
    }
    const logged = warn.mock.calls.filter(
      ([event, context]) => event === 'rbac.denied' && context?.role === Role.EDITOR,
    );
    expect(denied.length).toBeGreaterThan(50);
    expect(logged).toHaveLength(denied.length);
  });

  it('leaves admins and members exactly where their decorators put them', async () => {
    const wrong: string[] = [];
    for (const route of routes) {
      for (const caller of ['ADMIN', 'USER'] as const) {
        const expected = route.isPublic || route.roles === null || route.roles.includes(caller);
        const allowed = await decide(guard, route, caller);
        if (allowed !== expected) wrong.push(`${caller} ${route.key}: ${allowed}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('refuses a disabled Editor on every route that needs a role', async () => {
    const leaks: string[] = [];
    for (const route of routes.filter((r) => r.roles !== null && !r.isPublic)) {
      if (await decide(guard, route, 'DISABLED_EDITOR')) leaks.push(route.key);
    }
    expect(leaks).toEqual([]);
  });

  it('keeps a superadmin unchanged: every route, inside any workspace', async () => {
    const refused: string[] = [];
    for (const route of routes) {
      if (!(await decide(guard, route, 'SUPERADMIN'))) refused.push(route.key);
    }
    expect(refused).toEqual([]);
  });
});
