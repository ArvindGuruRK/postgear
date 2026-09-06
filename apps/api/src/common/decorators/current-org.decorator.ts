import { type ExecutionContext, createParamDecorator } from '@nestjs/common';
import type { Role } from '@postgear/db';
import type { Request } from 'express';

/**
 * The caller's active organization and their role in it, resolved per-request
 * by `RolesGuard` from the `pg_org` cookie.
 *
 * ## Why the org is not in the JWT
 *
 * Putting it there would mean re-issuing the token on every workspace switch,
 * and a token minted before a membership was revoked would keep working until
 * it expired. Resolving per request from a cookie keeps the JWT stable across
 * switches and makes revocation take effect on the very next request.
 *
 * ## This is the tenant-scoping chokepoint
 *
 * Every query against a tenant-scoped table must filter on the id this
 * decorator returns, never on an organization id taken from the request body
 * or a route parameter — those are attacker-controlled. `RolesGuard` has
 * already verified that the caller holds a non-disabled membership in this
 * organization by the time a handler can read it.
 */
export interface ActiveOrg {
  id: string;
  role: Role;
}

export const CurrentOrg = createParamDecorator(
  (_data: unknown, context: ExecutionContext): ActiveOrg => {
    const request = context.switchToHttp().getRequest<Request & { activeOrg: ActiveOrg }>();
    return request.activeOrg;
  },
);
