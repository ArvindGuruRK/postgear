import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { type Role, prisma } from '@postgear/db';
import type { Request } from 'express';
import { AUTH_MESSAGES } from '../../modules/auth/auth.messages';
import type { ActiveOrg } from '../decorators/current-org.decorator';
import type { AuthenticatedUser } from '../decorators/current-user.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { securityLogger } from '../logging/security-logger';

/**
 * Role-based access control over the three roles in `UserOrganization.role`.
 *
 * Hand-rolled rather than CASL, per the sprint document's explicit risk note:
 * three roles and route-level checks do not justify an ability engine, and the
 * engine is the thing that is hard to remove later. If a real feature ever
 * needs attribute-level rules ("edit posts you authored"), that is the moment
 * to revisit — not before.
 *
 * ## Two responsibilities, one pass
 *
 * The guard resolves the active organization *and* checks the role, because
 * the two are inseparable: a role only means anything relative to a workspace.
 * The resolved membership is attached to the request for `@CurrentOrg()`.
 *
 * ## The rules
 *
 * | Situation | Outcome |
 * |---|---|
 * | Route is `@Public()` | Allowed; no org resolved |
 * | No `@Roles()` on the route | Allowed; org resolved *opportunistically* if the cookie is present and valid |
 * | `@Roles()` present, no active org cookie | 403 |
 * | `@Roles()` present, cookie names an org the caller is not in | 403 — same message as a wrong role, so the cookie cannot be used to probe which organizations exist |
 * | Membership exists but `disabled: true` | 403 |
 * | `User.isSuperAdmin` | Allowed, and treated as `SUPERADMIN` |
 * | Role not in the required list | 403 |
 *
 * The "no `@Roles()` still resolves the org" case is what lets a route like
 * `GET /posts` read `@CurrentOrg()` while routes like `/onboarding/*` — used
 * by a user who belongs to no organization yet — keep working.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  private readonly orgCookieName: string;

  constructor(
    private readonly reflector: Reflector,
    config: ConfigService,
  ) {
    this.orgCookieName = config.get<string>('ORG_COOKIE_NAME', 'pg_org');
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser; activeOrg?: ActiveOrg }>();
    const user = request.user;

    // JwtAuthGuard runs first and would already have thrown. This is a
    // belt-and-braces check against a future guard-ordering mistake.
    if (!user) {
      throw new ForbiddenException(AUTH_MESSAGES.FORBIDDEN);
    }

    const orgId = (request.cookies as Record<string, string> | undefined)?.[this.orgCookieName];
    const membership = orgId ? await this.loadMembership(user.id, orgId) : null;

    if (membership) {
      request.activeOrg = membership;
    } else if (orgId && user.isSuperAdmin) {
      // A superadmin may act in any workspace without holding a membership row.
      request.activeOrg = { id: orgId, role: 'SUPERADMIN' as Role };
    }

    // No role requirement: authentication was enough.
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    if (user.isSuperAdmin) {
      return true;
    }

    if (!request.activeOrg) {
      securityLogger.warn('rbac.denied', {
        userId: user.id,
        reason: orgId ? 'not-a-member' : 'no-active-org',
        orgId,
        required: requiredRoles,
      });
      // Deliberately the same exception for "you sent no org cookie" and "you
      // sent one for an org you are not in". Distinguishing them would let a
      // caller enumerate organization ids by watching the error change.
      throw new ForbiddenException(orgId ? AUTH_MESSAGES.FORBIDDEN : AUTH_MESSAGES.NO_ACTIVE_ORG);
    }

    if (!requiredRoles.includes(request.activeOrg.role)) {
      securityLogger.warn('rbac.denied', {
        userId: user.id,
        orgId: request.activeOrg.id,
        role: request.activeOrg.role,
        required: requiredRoles,
      });
      throw new ForbiddenException(AUTH_MESSAGES.FORBIDDEN);
    }

    return true;
  }

  /**
   * Loads a live membership.
   *
   * `disabled: false` is part of the `where`, not checked afterwards, so a
   * disabled membership reads as "not a member" throughout — including in the
   * superadmin fallback above, which is correct: disabling is meant to revoke
   * access without deleting the row and its audit trail.
   */
  private async loadMembership(userId: string, organizationId: string): Promise<ActiveOrg | null> {
    const membership = await prisma.userOrganization.findFirst({
      where: { userId, organizationId, disabled: false },
      select: { organizationId: true, role: true },
    });

    return membership ? { id: membership.organizationId, role: membership.role } : null;
  }
}
