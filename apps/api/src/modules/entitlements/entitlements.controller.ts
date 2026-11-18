/**
 * `GET /entitlements/me` (Sprint 12): what the active workspace's plan
 * allows, for drawing locks, meters and chips.
 *
 * Any member of the workspace (`@Roles(ADMIN, USER)`); the workspace comes
 * from the org cookie, so no other workspace can be named. Presentation
 * only: every route re-resolves on the server and never trusts a value sent
 * back. `Cache-Control: private, max-age=15` with an ETag, so a page that
 * asks again within the cache age costs a 304.
 */
import { createHash } from 'node:crypto';
import { Controller, Get, Req, Res } from '@nestjs/common';
import { Role } from '@postgear/db';
import type { Request, Response } from 'express';
import { type ActiveOrg, CurrentOrg } from '../../common/decorators/current-org.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { EntitlementResolver } from './entitlement-resolver';

@Controller('entitlements')
@Roles(Role.ADMIN, Role.USER)
export class EntitlementsController {
  constructor(private readonly resolver: EntitlementResolver) {}

  @Get('me')
  async me(
    @CurrentOrg() org: ActiveOrg,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const snapshot = await this.resolver.snapshot(org.id);
    const body = {
      tier: snapshot.tier,
      status: snapshot.status,
      trialEndsAt: snapshot.trialEndsAt?.toISOString() ?? null,
      values: snapshot.values,
      meters: Object.fromEntries(
        Object.entries(snapshot.meters).map(([key, meter]) => [
          key,
          {
            used: meter.used,
            limit: meter.limit,
            remaining: meter.remaining,
            cycleStart: meter.cycleStart.toISOString(),
            cycleEnd: meter.cycleEnd.toISOString(),
          },
        ]),
      ),
    };

    // The org id is in the tag so two workspaces never share a cached answer.
    const etag = `W/"${createHash('sha256').update(org.id).update(JSON.stringify(body)).digest('base64url').slice(0, 27)}"`;
    response.setHeader('Cache-Control', 'private, max-age=15');
    response.setHeader('ETag', etag);
    response.setHeader('Vary', 'Cookie');
    if (request.headers['if-none-match'] === etag) {
      response.status(304);
      return undefined;
    }
    return body;
  }
}
