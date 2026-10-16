/**
 * `@ApiKeyAuth()` — the one decorator every `/v1` controller carries.
 *
 * Three things in one, so a public-API controller cannot get two of them
 * and forget the third:
 *
 * 1. `@Public()` for the global session guards. Without it, `JwtAuthGuard`
 *    would demand a session cookie before `ApiKeyGuard` ever ran.
 * 2. `ApiKeyGuard`, which authenticates the key and sets `request.activeOrg`
 *    and `request.apiKey`.
 * 3. `ApiKeyThrottlerGuard`, which reads `request.apiKey.id` — so it has to
 *    run *after* the key guard, which `UseGuards`' argument order guarantees.
 *
 * Applied at class level in the contract (§5.3); applying it per handler
 * would work too, but then one new handler without it is an open route, and
 * that is exactly the failure mode `@Public()`'s closed-by-default exists
 * to prevent.
 */
import {
  applyDecorators,
  createParamDecorator,
  type ExecutionContext,
  SetMetadata,
  UseGuards,
} from '@nestjs/common';
import { IS_PUBLIC_KEY } from '../../../common/decorators/public.decorator';
import { ApiKeyThrottlerGuard } from './api-key-throttler.guard';
import { type ApiKeyPrincipal, type ApiKeyRequest, ApiKeyGuard } from './api-key.guard';

export const ApiKeyAuth = () =>
  applyDecorators(SetMetadata(IS_PUBLIC_KEY, true), UseGuards(ApiKeyGuard, ApiKeyThrottlerGuard));

/** The key that authenticated this request, as `ApiKeyGuard` attached it. */
export const CurrentApiKey = createParamDecorator(
  (_data: unknown, context: ExecutionContext): ApiKeyPrincipal => {
    const request = context.switchToHttp().getRequest<ApiKeyRequest>();

    if (!request.apiKey) {
      // Only reachable if a handler used this decorator without
      // `@ApiKeyAuth()`. Loud, because the alternative is a handler reading
      // `undefined.id` three lines later with a less helpful stack.
      throw new Error('@CurrentApiKey() used on a route without @ApiKeyAuth()');
    }

    return request.apiKey;
  },
);
