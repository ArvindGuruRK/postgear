/**
 * Who reaches an operator route (Module 19 section 7): a superadmin, and in
 * production only one whose address is in `OPERATOR_EMAILS`. A workspace
 * ADMIN is not an operator.
 */
import { ForbiddenException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { AuthenticatedUser } from '../decorators/current-user.decorator';
import { PlatformAdminGuard } from './platform-admin.guard';

function guard(env: Record<string, unknown>) {
  return new PlatformAdminGuard({ get: (key: string) => env[key] } as unknown as ConfigService);
}

function context(user: Partial<AuthenticatedUser> | undefined) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        method: 'GET',
        path: '/operator/entitlements/plans',
        route: { path: '/operator/entitlements/plans' },
        user,
        // An org cookie for a workspace the caller administers changes nothing.
        cookies: { pg_org: 'seed-demo-org' },
        activeOrg: { id: 'seed-demo-org', role: 'ADMIN' },
      }),
    }),
  } as never;
}

const operator = { id: 'u-1', email: 'Demo@PostGear.local', isSuperAdmin: true };
const admin = { id: 'u-2', email: 'admin@postgear.local', isSuperAdmin: false };

describe('PlatformAdminGuard', () => {
  it('lets a superadmin through in development, with no allowlist', () => {
    expect(
      guard({ NODE_ENV: 'development', OPERATOR_EMAILS: [] }).canActivate(context(operator)),
    ).toBe(true);
  });

  it('refuses a workspace ADMIN or USER with 403, whatever the org cookie says', () => {
    expect(() => guard({ NODE_ENV: 'development' }).canActivate(context(admin))).toThrow(
      new ForbiddenException('You do not have permission to do that'),
    );
  });

  it('refuses a request with no user (a guard-order mistake) with 403', () => {
    expect(() => guard({ NODE_ENV: 'development' }).canActivate(context(undefined))).toThrow(
      ForbiddenException,
    );
  });

  it('in production, refuses a superadmin outside OPERATOR_EMAILS', () => {
    expect(() =>
      guard({ NODE_ENV: 'production', OPERATOR_EMAILS: ['owner@rkay.in'] }).canActivate(
        context(operator),
      ),
    ).toThrow(ForbiddenException);
  });

  it('in production, lets a listed superadmin through (the address compared without case)', () => {
    expect(
      guard({ NODE_ENV: 'production', OPERATOR_EMAILS: ['demo@postgear.local'] }).canActivate(
        context(operator),
      ),
    ).toBe(true);
    // The env may also arrive as a raw comma list.
    expect(
      guard({
        NODE_ENV: 'production',
        OPERATOR_EMAILS: 'x@rkay.in, demo@postgear.local',
      }).canActivate(context(operator)),
    ).toBe(true);
  });

  it('in production, an address on the list without the flag is still refused', () => {
    expect(() =>
      guard({ NODE_ENV: 'production', OPERATOR_EMAILS: ['admin@postgear.local'] }).canActivate(
        context(admin),
      ),
    ).toThrow(ForbiddenException);
  });
});
