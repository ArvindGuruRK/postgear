import { type ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard, type ThrottlerLimitDetail } from '@nestjs/throttler';
import type { Request } from 'express';
import { securityLogger } from '../logging/security-logger';

/**
 * The per-client-address ceiling on every route (Sprint 8, PRD 5.12).
 *
 * `@nestjs/throttler`'s guard with two changes:
 *
 * - **The tracker is `request.ip`**, which `trust proxy` in `main.ts` has
 *   already resolved to the left-most untrusted hop — so a load balancer's
 *   address never becomes one shared bucket for every user, and a client
 *   cannot rotate `X-Forwarded-For` to escape it.
 * - **A trip is a security event.** The default guard throws silently; a run
 *   of 429s from one address is the signal that tells a scan from a busy
 *   user, so it goes to the security log by route and address.
 *
 * Registered as a global guard by `ThrottlingModule`. Opt a route out with
 * `@SkipThrottle()` — the Stripe webhook (Stripe retries, and a replay is
 * already harmless) and the notification stream (one long request).
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(request: Record<string, unknown>): Promise<string> {
    const typed = request as unknown as Request;
    return typed.ip ?? typed.socket?.remoteAddress ?? 'unknown';
  }

  protected async throwThrottlingException(
    context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    const request = context.switchToHttp().getRequest<Request>();

    securityLogger.warn('api.throttled', {
      scope: 'ip',
      ip: detail.tracker,
      route: `${request.method} ${request.path}`,
      limit: detail.limit,
      hits: detail.totalHits,
    });

    return super.throwThrottlingException(context, detail);
  }
}
