import { ForbiddenException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Reflector } from '@nestjs/core';
import { Role } from '@postgear/db';
import { RolesGuard } from './roles.guard';

// The guard reads memberships through the shared Prisma singleton, so the
// module is mocked rather than a database being stood up. `Role` is re-exported
// from the same module and must survive the mock, hence requireActual.
jest.mock('@postgear/db', () => ({
  ...jest.requireActual('@postgear/db'),
  prisma: { userOrganization: { findFirst: jest.fn() } },
}));

const { prisma } = jest.requireMock('@postgear/db') as {
  prisma: { userOrganization: { findFirst: jest.Mock } };
};

const ORG_ID = 'org-1';

interface ContextOptions {
  user?: { id: string; email: string; isSuperAdmin: boolean; onboardingCompletedAt: Date | null };
  cookies?: Record<string, string>;
}

function makeContext({ user, cookies = {} }: ContextOptions) {
  const request: Record<string, unknown> = { user, cookies };
  return {
    request,
    context: {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => () => undefined,
      getClass: () => class {},
    },
  };
}

function makeGuard(options: { isPublic?: boolean; roles?: Role[] }): RolesGuard {
  const reflector = {
    getAllAndOverride: (key: string) =>
      key === 'auth:isPublic' ? options.isPublic : options.roles,
  } as unknown as Reflector;

  const config = { get: (_k: string, fallback: string) => fallback } as unknown as ConfigService;

  return new RolesGuard(reflector, config);
}

const admin = { id: 'u-admin', email: 'a@x.com', isSuperAdmin: false, onboardingCompletedAt: null };
const superadmin = { ...admin, id: 'u-super', isSuperAdmin: true };

describe('RolesGuard', () => {
  beforeEach(() => {
    prisma.userOrganization.findFirst.mockReset();
  });

  it('lets a public route through without touching the database', async () => {
    const guard = makeGuard({ isPublic: true });
    const { context } = makeContext({});

    await expect(guard.canActivate(context as never)).resolves.toBe(true);
    expect(prisma.userOrganization.findFirst).not.toHaveBeenCalled();
  });

  it('allows a route with no @Roles() and resolves the org opportunistically', async () => {
    // This is the case the whole onboarding flow depends on: authenticated,
    // no role requirement, and the org may or may not exist yet.
    prisma.userOrganization.findFirst.mockResolvedValue({
      organizationId: ORG_ID,
      role: Role.USER,
    });

    const guard = makeGuard({ roles: undefined });
    const { context, request } = makeContext({ user: admin, cookies: { pg_org: ORG_ID } });

    await expect(guard.canActivate(context as never)).resolves.toBe(true);
    expect(request.activeOrg).toEqual({ id: ORG_ID, role: Role.USER });
  });

  it('allows a route with no @Roles() for a user who belongs to no organization', async () => {
    prisma.userOrganization.findFirst.mockResolvedValue(null);

    const guard = makeGuard({ roles: undefined });
    const { context, request } = makeContext({ user: admin });

    await expect(guard.canActivate(context as never)).resolves.toBe(true);
    expect(request.activeOrg).toBeUndefined();
  });

  it('allows an ADMIN through an ADMIN-only route', async () => {
    prisma.userOrganization.findFirst.mockResolvedValue({
      organizationId: ORG_ID,
      role: Role.ADMIN,
    });

    const guard = makeGuard({ roles: [Role.ADMIN] });
    const { context } = makeContext({ user: admin, cookies: { pg_org: ORG_ID } });

    await expect(guard.canActivate(context as never)).resolves.toBe(true);
  });

  it('blocks a USER from an ADMIN-only route', async () => {
    // The sprint's Definition of Done, as a unit test.
    prisma.userOrganization.findFirst.mockResolvedValue({
      organizationId: ORG_ID,
      role: Role.USER,
    });

    const guard = makeGuard({ roles: [Role.ADMIN] });
    const { context } = makeContext({ user: admin, cookies: { pg_org: ORG_ID } });

    await expect(guard.canActivate(context as never)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('blocks a member whose membership is disabled', async () => {
    // `disabled: false` is part of the query, so a disabled row returns null
    // and reads as "not a member" everywhere.
    prisma.userOrganization.findFirst.mockResolvedValue(null);

    const guard = makeGuard({ roles: [Role.USER] });
    const { context } = makeContext({ user: admin, cookies: { pg_org: ORG_ID } });

    await expect(guard.canActivate(context as never)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('gives the same message for a foreign org as for a wrong role', async () => {
    // Otherwise the error text distinguishes "that org exists but you are not
    // in it" from "you are in it but lack the role", which is an enumeration
    // oracle over organization ids.
    prisma.userOrganization.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({
      organizationId: ORG_ID,
      role: Role.USER,
    });

    const guard = makeGuard({ roles: [Role.ADMIN] });

    const foreign = await guard
      .canActivate(makeContext({ user: admin, cookies: { pg_org: 'other' } }).context as never)
      .catch((error: ForbiddenException) => error.message);

    const wrongRole = await guard
      .canActivate(makeContext({ user: admin, cookies: { pg_org: ORG_ID } }).context as never)
      .catch((error: ForbiddenException) => error.message);

    expect(foreign).toBe(wrongRole);
  });

  it('blocks a role-guarded route when no workspace is selected', async () => {
    const guard = makeGuard({ roles: [Role.ADMIN] });
    const { context } = makeContext({ user: admin });

    await expect(guard.canActivate(context as never)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lets a superadmin through any role check without a membership row', async () => {
    prisma.userOrganization.findFirst.mockResolvedValue(null);

    const guard = makeGuard({ roles: [Role.ADMIN] });
    const { context, request } = makeContext({
      user: superadmin,
      cookies: { pg_org: ORG_ID },
    });

    await expect(guard.canActivate(context as never)).resolves.toBe(true);
    expect(request.activeOrg).toEqual({ id: ORG_ID, role: Role.SUPERADMIN });
  });

  it('rejects when no authenticated user was attached', async () => {
    // Defensive: JwtAuthGuard runs first and would have thrown. This guards
    // against a future change to guard ordering silently opening a route.
    const guard = makeGuard({ roles: [Role.ADMIN] });
    const { context } = makeContext({});

    await expect(guard.canActivate(context as never)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('accepts any of several listed roles', async () => {
    prisma.userOrganization.findFirst.mockResolvedValue({
      organizationId: ORG_ID,
      role: Role.USER,
    });

    const guard = makeGuard({ roles: [Role.ADMIN, Role.USER] });
    const { context } = makeContext({ user: admin, cookies: { pg_org: ORG_ID } });

    await expect(guard.canActivate(context as never)).resolves.toBe(true);
  });
});
