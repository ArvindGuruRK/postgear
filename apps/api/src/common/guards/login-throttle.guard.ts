import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AUTH_MESSAGES } from '../../modules/auth/auth.messages';
import { RedisService } from '../../modules/redis/redis.service';
import { securityLogger } from '../logging/security-logger';

/**
 * Per-IP request throttling on the unauthenticated auth endpoints.
 *
 * Distinct from account lockout, and both are needed:
 *
 * - **This guard** bounds how fast one *source* can hit an endpoint at all. It
 *   is what stops a credential-stuffing run from working through a leaked
 *   password list, since that attack touches thousands of different accounts
 *   and never trips any single account's lockout.
 * - **Lockout** bounds how many times one *account* can be guessed at, which
 *   is what stops a slow distributed attack on one high-value user.
 *
 * A fixed window rather than a sliding one: at this scale the burst a fixed
 * window permits at a boundary (up to 2x the limit across two adjacent
 * windows) is not worth the extra Redis round-trips, and the progressive delay
 * absorbs it anyway.
 */

const THROTTLE_KEY = 'throttle:limit';
const WINDOW_SECONDS = 60;

/**
 * Overrides the default limit for one route.
 *
 * Used to give `/auth/password/reset-request` a tighter budget than login:
 * every call sends an email, so an unthrottled reset endpoint is a free
 * mail-bombing relay pointed at any address the attacker chooses.
 */
export const ThrottleLimit = (perMinute: number) => SetMetadata(THROTTLE_KEY, perMinute);

@Injectable()
export class LoginThrottleGuard implements CanActivate {
  private readonly defaultLimit: number;

  constructor(
    private readonly redis: RedisService,
    private readonly reflector: Reflector,
    config: ConfigService,
  ) {
    this.defaultLimit = config.get<number>('LOGIN_RATE_LIMIT_PER_MIN', 10);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const limit =
      this.reflector.getAllAndOverride<number>(THROTTLE_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? this.defaultLimit;

    const ip = clientIp(request);
    const key = `throttle:${context.getClass().name}:${context.getHandler().name}:${ip}`;
    const count = await this.redis.incrementWithTtl(key, WINDOW_SECONDS);

    if (count > limit) {
      securityLogger.warn('login.throttled', {
        ip,
        route: `${request.method} ${request.path}`,
        count,
        limit,
      });

      // 429 with no Retry-After. Telling the client exactly when the window
      // resets hands an attacker a free scheduling hint; a fixed generic
      // message costs a legitimate user nothing they cannot solve by waiting.
      throw new HttpException(AUTH_MESSAGES.TOO_MANY_REQUESTS, HttpStatus.TOO_MANY_REQUESTS);
    }

    return true;
  }
}

/**
 * Resolves the client address.
 *
 * `X-Forwarded-For` is only consulted because Express's `trust proxy` is set
 * in `main.ts`; with that flag on, `req.ip` is already the left-most
 * untrusted hop and the header does not need to be parsed by hand. Reading
 * the raw header without `trust proxy` would let any client spoof its own IP
 * and bypass this guard entirely by rotating the value.
 */
function clientIp(request: Request): string {
  return request.ip ?? request.socket.remoteAddress ?? 'unknown';
}
