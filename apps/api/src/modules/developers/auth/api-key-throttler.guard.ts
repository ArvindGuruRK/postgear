/**
 * The per-API-key ceiling on `/v1` (Sprint 8, PRD 5.12).
 *
 * The same `ThrottlerGuard` the global per-address limit is built on, with
 * the same Redis-backed store (the throttler module is global and exports
 * it), so a key's budget is shared across every API instance. Four changes:
 *
 * - **Its own throttler.** `onModuleInit` replaces the module's `default`
 *   (per-address) throttler with one named `apiKey`, so this guard counts
 *   against `API_RATE_LIMIT_PER_MIN` and the global guard keeps counting
 *   against `RATE_LIMIT_PER_MIN`. The two are independent: a key can be
 *   throttled while its address is fine, and vice versa.
 * - **The tracker is the key id**, which `ApiKeyGuard` attached a moment
 *   earlier. Not the address — one integrator's server is one address and
 *   many keys, and one key may call from many addresses.
 * - **One bucket per key, across every route.** The base guard keys its
 *   counter by controller and handler as well, which would give each key
 *   sixty calls a minute *per endpoint*. The contract promises sixty a
 *   minute, full stop.
 * - **A trip is logged, and `Retry-After` is set plainly.** The base guard
 *   sets `Retry-After-apiKey` (suffixed by throttler name); standard clients
 *   read the unsuffixed header, so that is set too, before throwing.
 */
import { type ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerGuard,
  type ThrottlerLimitDetail,
  type ThrottlerModuleOptions,
  type ThrottlerStorage,
} from '@nestjs/throttler';
import type { Request } from 'express';
import { securityLogger } from '../../../common/logging/security-logger';
import { THROTTLE_WINDOW_MS } from '../../../common/throttling/throttling.module';
import type { Env } from '../../../config/env';
import { DEVELOPERS_MESSAGES } from '../developers.messages';
import type { ApiKeyRequest } from './api-key.guard';

export const API_KEY_THROTTLER = 'apiKey';

@Injectable()
export class ApiKeyThrottlerGuard extends ThrottlerGuard {
  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storage: ThrottlerStorage,
    reflector: Reflector,
    private readonly config: ConfigService<Env, true>,
  ) {
    super(options, storage, reflector);
  }

  async onModuleInit(): Promise<void> {
    // The base implementation reads the module options (the store, the
    // common options) and sets `this.throttlers` to the module's list. Only
    // the list is replaced.
    await super.onModuleInit();

    this.throttlers = [
      {
        name: API_KEY_THROTTLER,
        ttl: THROTTLE_WINDOW_MS,
        limit: this.config.get('API_RATE_LIMIT_PER_MIN', { infer: true }),
      },
    ];
  }

  protected async getTracker(request: Record<string, unknown>): Promise<string> {
    const typed = request as unknown as ApiKeyRequest;

    // Only reachable without a key if the guard order in `@ApiKeyAuth()` is
    // ever changed. Falling back to the address keeps the ceiling in place
    // rather than pooling every anonymous call into one bucket.
    return typed.apiKey?.id ?? typed.ip ?? typed.socket?.remoteAddress ?? 'unknown';
  }

  protected generateKey(_context: ExecutionContext, tracker: string, name: string): string {
    return `${name}:${tracker}`;
  }

  protected async getErrorMessage(): Promise<string> {
    return DEVELOPERS_MESSAGES.RATE_LIMITED;
  }

  protected async throwThrottlingException(
    context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    const { req, res } = this.getRequestResponse(context);
    const request = req as unknown as Request;

    securityLogger.warn('api.throttled', {
      scope: 'apiKey',
      keyId: detail.tracker,
      route: `${request.method} ${request.path}`,
      limit: detail.limit,
      hits: detail.totalHits,
    });

    // Seconds until the window clears — the same value the base guard put in
    // the suffixed header a moment ago.
    this.setResponseHeader(res, 'Retry-After', Math.max(1, Math.ceil(detail.timeToBlockExpire)));

    return super.throwThrottlingException(context, detail);
  }
}
