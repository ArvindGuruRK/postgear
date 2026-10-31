/**
 * The worker's key to the internal step gateway (Sprint 10, Module 10).
 *
 * Gateway routes are `@Public()` (no user session: the worker calls them)
 * and carry this guard instead. It compares `X-PostGear-Internal` with
 * `AUTOMATION_INTERNAL_TOKEN` in constant time. With no token configured
 * every call is refused, so a deployment that forgot it fails closed.
 *
 * The token alone writes nothing: every route also binds the call to a live
 * run of the workspace it names (`GatewayBindingService.bind`).
 */
import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { safeCompare } from '@postgear/db';
import type { Request } from 'express';
import type { Env } from '../../../config/env';

export const INTERNAL_TOKEN_HEADER = 'x-postgear-internal';

@Injectable()
export class InternalTokenGuard implements CanActivate {
  private readonly logger = new Logger('AutomationGateway');

  constructor(private readonly config: ConfigService<Env, true>) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const expected = this.config.get('AUTOMATION_INTERNAL_TOKEN', { infer: true });
    const sent = request.headers[INTERNAL_TOKEN_HEADER];

    if (typeof expected === 'string' && typeof sent === 'string' && safeCompare(sent, expected)) {
      return true;
    }

    this.logger.warn(
      JSON.stringify({
        event: 'automation.gateway_refused',
        path: request.path,
        reason: expected ? (sent ? 'wrong_token' : 'no_token') : 'not_configured',
      }),
    );
    throw new UnauthorizedException();
  }
}
