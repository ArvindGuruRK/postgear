import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type User, prisma } from '@postgear/db';
import type { CookieOptions, Request, Response } from 'express';
import {
  type AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { LoginThrottleGuard, ThrottleLimit } from '../../common/guards/login-throttle.guard';
import { securityLogger } from '../../common/logging/security-logger';
import { ZodBody, ZodQuery } from '../../common/pipes/zod-validation.pipe';
import { AUTH_MESSAGES } from './auth.messages';
import { AuthService } from './auth.service';
import {
  activateSchema,
  changePasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  resetRequestSchema,
} from './dto/auth.schema';
import { OAuthError } from './providers/auth-provider.interface';
import { ProvidersManager } from './providers/providers.manager';

/**
 * The auth HTTP surface.
 *
 * ## Every response is deliberately uninformative
 *
 * Registration returns 201 whether or not the address was taken. Login returns
 * one 401 for five different causes. Reset returns 200 whether or not the
 * account exists. Validation returns 400 naming no field. The detail is in the
 * security log, not in the response — see `auth.messages.ts` for the full
 * catalogue and the reasoning.
 *
 * ## Cookie strategy
 *
 * The session JWT goes in an **httpOnly** cookie, so frontend XSS cannot read
 * it. `sameSite: 'lax'` blocks the cross-site POST that CSRF would need while
 * still allowing the top-level GET navigation an OAuth callback performs.
 *
 * The active organization goes in a **separate, readable** cookie. It is not a
 * credential — the server re-checks membership on every request — and the
 * frontend needs to read it to highlight the current workspace.
 */
@Controller('auth')
export class AuthController {
  private readonly authCookie: string;
  private readonly orgCookie: string;
  private readonly isProduction: boolean;
  private readonly webUrl: string;

  constructor(
    private readonly auth: AuthService,
    private readonly providers: ProvidersManager,
    config: ConfigService,
  ) {
    this.authCookie = config.get<string>('AUTH_COOKIE_NAME', 'pg_session');
    this.orgCookie = config.get<string>('ORG_COOKIE_NAME', 'pg_org');
    this.isProduction = config.get<string>('NODE_ENV') === 'production';
    this.webUrl = config.get<string>('WEB_URL', 'http://localhost:3000');
  }

  @Public()
  @Post('register')
  @UseGuards(LoginThrottleGuard)
  @ThrottleLimit(5)
  @HttpCode(HttpStatus.CREATED)
  async register(@Body(new ZodBody(registerSchema, 'auth/register')) dto: RegisterBody) {
    await this.auth.register(dto);
    // Identical body for "created" and "already existed". The caller cannot
    // distinguish them, which is the point.
    return { message: AUTH_MESSAGES.REGISTRATION_ACCEPTED };
  }

  @Public()
  @Get('activate')
  async activate(@Query(new ZodQuery(activateSchema, 'auth/activate')) query: { token: string }) {
    const activated = await this.auth.activate(query.token);

    if (!activated) {
      throw new BadRequestException(AUTH_MESSAGES.ACTIVATION_LINK_INVALID);
    }

    return { message: 'Your account is confirmed. You can sign in now.' };
  }

  @Public()
  @Post('login')
  @UseGuards(LoginThrottleGuard)
  @HttpCode(HttpStatus.OK)
  async login(
    @Body(new ZodBody(loginSchema, 'auth/login')) dto: LoginBody,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const user = await this.auth.login(dto, request.ip ?? 'unknown');
    await this.startSession(user, response);

    return { user: this.auth.toSessionUser(user) };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  logout(@Res({ passthrough: true }) response: Response) {
    // Cleared with the same options they were set with — a mismatched `path`
    // or `sameSite` leaves the original cookie in place in most browsers.
    response.clearCookie(this.authCookie, this.cookieOptions());
    response.clearCookie(this.orgCookie, this.cookieOptions(false));
    return { message: 'Signed out' };
  }

  /**
   * The session probe. Called by the web app's server components on every
   * protected navigation, so it is deliberately one indexed lookup.
   */
  @Get('me')
  async me(@CurrentUser() current: AuthenticatedUser) {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: current.id } });
    return { user: this.auth.toSessionUser(user) };
  }

  /** Which OAuth buttons the login screen should render. */
  @Public()
  @Get('providers')
  listProviders() {
    return { providers: this.providers.configuredNames() };
  }

  @Public()
  @Post('password/reset-request')
  @UseGuards(LoginThrottleGuard)
  // Tighter than login on purpose: each call sends an email, so an
  // unthrottled endpoint is a free mail-bombing relay aimed at any address.
  @ThrottleLimit(3)
  @HttpCode(HttpStatus.OK)
  async requestReset(
    @Body(new ZodBody(resetRequestSchema, 'auth/reset-request')) dto: { email: string },
  ) {
    await this.auth.requestPasswordReset(dto.email);
    return { message: AUTH_MESSAGES.PASSWORD_RESET_SENT };
  }

  @Public()
  @Post('password/reset')
  @UseGuards(LoginThrottleGuard)
  @HttpCode(HttpStatus.OK)
  async resetPassword(
    @Body(new ZodBody(resetPasswordSchema, 'auth/reset-password'))
    dto: { token: string; password: string },
  ) {
    const ok = await this.auth.resetPassword(dto.token, dto.password);

    if (!ok) {
      throw new BadRequestException(AUTH_MESSAGES.RESET_LINK_INVALID);
    }

    return { message: 'Your password has been changed. Sign in with it now.' };
  }

  @Post('password/change')
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @CurrentUser() current: AuthenticatedUser,
    @Body(new ZodBody(changePasswordSchema, 'auth/change-password'))
    dto: { currentPassword: string; newPassword: string },
  ) {
    const ok = await this.auth.changePassword(current.id, dto.currentPassword, dto.newPassword);

    if (!ok) {
      // Same message as a failed login: a "your current password is wrong"
      // response is fine here (the caller is already authenticated as this
      // user) but reusing the constant keeps one string to audit.
      throw new UnauthorizedException(AUTH_MESSAGES.INVALID_CREDENTIALS);
    }

    return { message: 'Password updated' };
  }

  // ---------------------------------------------------------------------
  // OAuth
  // ---------------------------------------------------------------------

  /**
   * Starts a handshake. Responds with a redirect the browser follows.
   */
  @Public()
  @Get('oauth/:provider')
  async oauthStart(@Param('provider') provider: string, @Res() response: Response) {
    try {
      const url = await this.providers.beginHandshake(provider);
      response.redirect(url);
    } catch (error) {
      securityLogger.warn('oauth.state_mismatch', {
        provider,
        reason: error instanceof Error ? error.message : 'unknown',
      });
      response.redirect(`${this.webUrl}/login?error=oauth`);
    }
  }

  /**
   * Completes a handshake and starts a session.
   *
   * Always ends in a redirect back to the web app rather than a JSON body —
   * the browser arrived here by navigation, not by fetch.
   */
  @Public()
  @Get('oauth/:provider/callback')
  async oauthCallback(
    @Param('provider') provider: string,
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Res() response: Response,
  ) {
    const fail = () => response.redirect(`${this.webUrl}/login?error=oauth`);

    // State is checked and consumed before the code is spent, so a replayed
    // or forged callback costs nothing and cannot mint a session.
    if (!code || !(await this.providers.consumeState(provider, state))) {
      securityLogger.warn('oauth.state_mismatch', { provider, hasCode: Boolean(code) });
      return fail();
    }

    try {
      const impl = this.providers.get(provider);
      const profile = await impl.handleCallback(code);
      const user = await this.auth.findOrCreateFromOAuth(profile, impl.name);

      await this.startSession(user, response);

      // Land on the app root and let the two route gates decide where this
      // user actually belongs — dashboard or onboarding. Deciding it here
      // would duplicate that logic in a second place.
      return response.redirect(`${this.webUrl}/`);
    } catch (error) {
      securityLogger.warn('oauth.state_mismatch', {
        provider,
        reason: error instanceof OAuthError ? error.message : 'callback-failed',
      });
      return fail();
    }
  }

  // ---------------------------------------------------------------------

  /**
   * Sets the session cookie, and pre-selects a workspace when there is an
   * obvious one.
   *
   * Pre-selecting matters for the common single-workspace case: without it the
   * user lands with no `pg_org` cookie and the first role-guarded request
   * fails until they interact with the switcher. Users with several
   * workspaces, or none, get no cookie and choose explicitly.
   */
  private async startSession(user: User, response: Response): Promise<void> {
    const token = await this.auth.issueToken(user);
    response.cookie(this.authCookie, token, this.cookieOptions());

    const memberships = await prisma.userOrganization.findMany({
      where: { userId: user.id, disabled: false },
      select: { organizationId: true },
      take: 2,
    });

    if (memberships.length === 1) {
      response.cookie(this.orgCookie, memberships[0].organizationId, this.cookieOptions(false));
    }
  }

  /**
   * @param httpOnly false for the org cookie, which the frontend reads to
   * highlight the active workspace. It is not a credential — membership is
   * re-verified server-side on every request — so exposing it costs nothing.
   */
  private cookieOptions(httpOnly = true): CookieOptions {
    return {
      httpOnly,
      // `lax`, not `strict`: `strict` would drop the cookie on the top-level
      // navigation back from an OAuth provider, so the user would complete the
      // handshake and still land signed out.
      sameSite: 'lax',
      secure: this.isProduction,
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    };
  }
}

// Local aliases so the decorator metadata does not need the Zod inference
// machinery inlined into every signature.
type RegisterBody = {
  email: string;
  password: string;
  name: string;
  lastName?: string;
  timezone?: number;
};
type LoginBody = { email: string; password: string };
