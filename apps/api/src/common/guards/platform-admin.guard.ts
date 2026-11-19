/**
 * Platform operators only (Sprint 12, Module 19 section 7): the operator
 * screens (plans, overrides, usage, the Change Log, the library) and a rights
 * request removal.
 *
 * `RolesGuard` cannot guard these routes: it is about a workspace, and an
 * operator route is about the whole platform. So this guard reads only the
 * signed-in user, never the org cookie, and operator routes take the
 * workspace id from the path, so an operator never acts on the wrong
 * workspace because of whichever one was open in another tab.
 *
 * | Situation | Outcome |
 * |---|---|
 * | No session | 401 (from `JwtAuthGuard`, which runs first) |
 * | `User.isSuperAdmin` false (any workspace role, ADMIN included) | 403 |
 * | Production, the address is not in `OPERATOR_EMAILS` | 403, even with the flag |
 * | Otherwise | Allowed |
 *
 * The production allowlist means a stray database edit alone cannot open
 * the screens. In development and staging the flag alone is enough, so the
 * seeded `demo@postgear.local` superadmin can test them. `isSuperAdmin` is
 * read fresh from the database on every request by `JwtAuthGuard`, so
 * `npm run operator:revoke` takes effect on the next request.
 *
 * The 403 is the generic "You do not have permission to do that", the same
 * as any other refusal, and the web answers a non-operator with its 404 page,
 * so the screens never announce themselves.
 */
import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { AUTH_MESSAGES } from '../../modules/auth/auth.messages';
import type { AuthenticatedUser } from '../decorators/current-user.decorator';
import { securityLogger } from '../logging/security-logger';

@Injectable()
export class PlatformAdminGuard implements CanActivate {
  private readonly production: boolean;
  private readonly allowlist: ReadonlySet<string>;

  constructor(config: ConfigService) {
    this.production = config.get<string>('NODE_ENV') === 'production';
    const emails = config.get<string[] | string>('OPERATOR_EMAILS') ?? [];
    const list = Array.isArray(emails) ? emails : String(emails).split(',');
    this.allowlist = new Set(list.map((email) => email.trim().toLowerCase()).filter(Boolean));
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const user = request.user;
    const route = `${request.method} ${request.route?.path ?? request.path}`;

    if (!user?.isSuperAdmin) {
      securityLogger.warn('operator.denied', {
        userId: user?.id ?? null,
        route,
        reason: 'not-operator',
      });
      throw new ForbiddenException(AUTH_MESSAGES.FORBIDDEN);
    }
    if (this.production && !this.allowlist.has(user.email.trim().toLowerCase())) {
      securityLogger.warn('operator.denied', { userId: user.id, route, reason: 'not-allowlisted' });
      throw new ForbiddenException(AUTH_MESSAGES.FORBIDDEN);
    }
    return true;
  }
}
