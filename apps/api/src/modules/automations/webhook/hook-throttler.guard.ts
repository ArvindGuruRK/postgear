/**
 * Sixty calls a minute per workflow on the Webhook trigger's link (Module 13),
 * on top of the global per-address limit.
 *
 * Built like `ApiKeyThrottlerGuard`: the same Redis-backed store, its own
 * named throttler (so it never shares a count with the per-address one),
 * the workflow id from the path as the tracker, and one bucket per workflow
 * whatever the route.
 *
 * It runs before the secret is checked, so calls with a wrong secret count
 * too: that is what makes guessing slow. The per-address limit still stops
 * one caller from using up a workflow's minute on its own for long.
 */
import { type ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard, type ThrottlerLimitDetail } from '@nestjs/throttler';
import type { Request } from 'express';
import { securityLogger } from '../../../common/logging/security-logger';
import { THROTTLE_WINDOW_MS } from '../../../common/throttling/throttling.module';
import { WEBHOOK_MESSAGES } from '../automations.messages';

export const HOOK_THROTTLER = 'automationHook';
export const HOOK_CALLS_PER_MINUTE = 60;

@Injectable()
export class HookThrottlerGuard extends ThrottlerGuard {
  async onModuleInit(): Promise<void> {
    await super.onModuleInit();
    this.throttlers = [
      { name: HOOK_THROTTLER, ttl: THROTTLE_WINDOW_MS, limit: HOOK_CALLS_PER_MINUTE },
    ];
  }

  protected async getTracker(request: Record<string, unknown>): Promise<string> {
    const typed = request as unknown as Request;
    const id = typed.params?.id;
    return typeof id === 'string' && id !== '' ? id : (typed.ip ?? 'unknown');
  }

  protected generateKey(_context: ExecutionContext, tracker: string, name: string): string {
    return `${name}:${tracker}`;
  }

  protected async getErrorMessage(): Promise<string> {
    return WEBHOOK_MESSAGES.THROTTLED;
  }

  protected async throwThrottlingException(
    context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    const { req, res } = this.getRequestResponse(context);
    const request = req as unknown as Request;

    securityLogger.warn('api.throttled', {
      scope: 'automationHook',
      automationId: detail.tracker,
      route: `${request.method} ${request.path}`,
      limit: detail.limit,
      hits: detail.totalHits,
    });
    this.setResponseHeader(res, 'Retry-After', Math.max(1, Math.ceil(detail.timeToBlockExpire)));

    return super.throwThrottlingException(context, detail);
  }
}
