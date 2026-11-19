/**
 * "Is Clips in this workspace's plan?" on every Clips route, in one place
 * (Sprint 12, Module 19 section 3, the first row of the limits table).
 *
 * Runs after the global `JwtAuthGuard` and `RolesGuard`, so the workspace is
 * already resolved from the org cookie (`request.activeOrg`). It reads
 * `clips.enabled` through `EntitlementResolver` (never a constant) and lets
 * the resolver throw its typed 402 `clips_not_in_plan` with the plan sentence.
 *
 * Not applied to:
 * - `GET /clips/status`, which answers `enabled: false` so the page can say
 *   which plan unlocks Clips instead of failing;
 * - `@Public()` routes (the signed file route, the library credits), which
 *   have no workspace and carry their own authority;
 * - the worker's internal routes, guarded by the internal token.
 *
 * A route a plan turns off still refuses at once: the resolver's cache is
 * stamped on every plan or override edit.
 */
import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { ActiveOrg } from '../../../common/decorators/current-org.decorator';
import { IS_PUBLIC_KEY } from '../../../common/decorators/public.decorator';
import { EntitlementResolver } from '../../entitlements/entitlement-resolver';

@Injectable()
export class ClipsEnabledGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly resolver: EntitlementResolver,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request & { activeOrg?: ActiveOrg }>();
    const org = request.activeOrg;
    // RolesGuard already refused any Clips route without a workspace; nothing to check here.
    if (!org) return true;
    await this.resolver.assert(org.id, 'clips.enabled', (enabled) => enabled === true);
    return true;
  }
}
