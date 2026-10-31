/**
 * The worker's key to the step gateway (Module 10): no token, a wrong one,
 * or a deployment without one configured are all a 401; only the exact
 * token passes. The posts routes are public to the session guard and carry
 * this guard instead.
 */
import { UnauthorizedException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import type { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../../../common/decorators/public.decorator';
import { GatewayPostsController } from './gateway-posts.controller';
import { INTERNAL_TOKEN_HEADER, InternalTokenGuard } from './internal-token.guard';

const TOKEN = 'a'.repeat(64);

function guardWith(token: string | undefined): InternalTokenGuard {
  const config = { get: () => token } as unknown as ConfigService<never, true>;
  return new InternalTokenGuard(config as never);
}

function contextWith(headers: Record<string, string>) {
  const request = { headers, path: '/internal/automation/posts/draft' };
  return { switchToHttp: () => ({ getRequest: () => request }) } as never;
}

describe('InternalTokenGuard', () => {
  it('refuses a call with no token', () => {
    expect(() => guardWith(TOKEN).canActivate(contextWith({}))).toThrow(UnauthorizedException);
  });

  it('refuses a wrong token, including one of a different length', () => {
    for (const sent of ['b'.repeat(64), TOKEN.slice(1), `${TOKEN}0`]) {
      expect(() =>
        guardWith(TOKEN).canActivate(contextWith({ [INTERNAL_TOKEN_HEADER]: sent })),
      ).toThrow(UnauthorizedException);
    }
  });

  it('refuses everything when no token is configured', () => {
    expect(() =>
      guardWith(undefined).canActivate(contextWith({ [INTERNAL_TOKEN_HEADER]: TOKEN })),
    ).toThrow(UnauthorizedException);
  });

  it('lets the right token through', () => {
    expect(guardWith(TOKEN).canActivate(contextWith({ [INTERNAL_TOKEN_HEADER]: TOKEN }))).toBe(
      true,
    );
  });

  it('guards every posts route, which skips the session guard', () => {
    const reflector = new Reflector();
    for (const handler of ['draft', 'queue', 'publish', 'get'] as const) {
      const method = GatewayPostsController.prototype[handler];
      expect(reflector.get(IS_PUBLIC_KEY, method)).toBe(true);
      expect(Reflect.getMetadata(GUARDS_METADATA, method)).toEqual([InternalTokenGuard]);
    }
  });
});
