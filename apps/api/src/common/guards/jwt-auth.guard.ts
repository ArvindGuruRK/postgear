import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { prisma } from '@postgear/db';
import type { Request } from 'express';
import { AUTH_MESSAGES } from '../../modules/auth/auth.messages';
import type { AuthenticatedUser } from '../decorators/current-user.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * Verifies the session JWT and attaches the caller to the request.
 *
 * Registered globally in `app.module.ts`, so every route is protected unless
 * it carries `@Public()`. See that decorator for why the default is closed.
 *
 * ## The token is read from a cookie, not a header
 *
 * An httpOnly cookie is unreadable by JavaScript, so an XSS bug on the
 * frontend cannot exfiltrate the session the way it could a token kept in
 * `localStorage`. The cost is CSRF exposure, which is handled by
 * `sameSite: 'lax'` on the cookie (see `auth.controller.ts`) — that blocks the
 * cross-site POST an attacker would need, while still allowing the top-level
 * GET navigations that OAuth callbacks rely on.
 *
 * An `Authorization: Bearer` header is also accepted, for curl and for the
 * public API in Sprint 8.
 *
 * ## Why it re-reads the user on every request
 *
 * The JWT carries only `sub` and `email`. Everything else — superadmin status,
 * onboarding state — is loaded fresh, so a change takes effect immediately
 * rather than at token expiry. That is one indexed primary-key lookup per
 * request, which is the right price for not having stale authorization data.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly cookieName: string;

  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    config: ConfigService,
  ) {
    this.cookieName = config.get<string>('AUTH_COOKIE_NAME', 'pg_session');
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const token = this.extractToken(request);

    if (!token) {
      throw new UnauthorizedException(AUTH_MESSAGES.SESSION_EXPIRED);
    }

    let subject: string;
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string }>(token);
      subject = payload.sub;
    } catch {
      // Expired, wrong signature, malformed — all one message. Distinguishing
      // them tells an attacker whether their forged token was structurally
      // valid, which is a free oracle on the signing scheme.
      throw new UnauthorizedException(AUTH_MESSAGES.SESSION_EXPIRED);
    }

    const user = await prisma.user.findUnique({
      where: { id: subject },
      select: {
        id: true,
        email: true,
        isSuperAdmin: true,
        onboardingCompletedAt: true,
        activated: true,
      },
    });

    // A token for a deleted or deactivated account is treated exactly like an
    // expired one.
    if (!user?.activated) {
      throw new UnauthorizedException(AUTH_MESSAGES.SESSION_EXPIRED);
    }

    request.user = {
      id: user.id,
      email: user.email,
      isSuperAdmin: user.isSuperAdmin,
      onboardingCompletedAt: user.onboardingCompletedAt,
    };

    return true;
  }

  private extractToken(request: Request): string | null {
    const fromCookie = (request.cookies as Record<string, string> | undefined)?.[this.cookieName];
    if (fromCookie) {
      return fromCookie;
    }

    const header = request.headers.authorization;
    if (header?.startsWith('Bearer ')) {
      return header.slice('Bearer '.length);
    }

    return null;
  }
}
