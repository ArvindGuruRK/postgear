import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@postgear/db';
import type { CookieOptions, Request, Response } from 'express';
import { type ActiveOrg, CurrentOrg } from '../../common/decorators/current-org.decorator';
import {
  type AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodBody } from '../../common/pipes/zod-validation.pipe';
import {
  acceptInviteSchema,
  changeRoleSchema,
  createOrgSchema,
  type InviteMemberBody,
  inviteMemberSchema,
} from './dto/org.schema';
import { OrgService } from './org.service';

/**
 * Workspace management.
 *
 * Note which routes carry `@Roles()` and which do not:
 *
 * - `POST /orgs` and `GET /orgs` have **no** role requirement, because a user
 *   with zero memberships must be able to create their first workspace and
 *   list an empty set. Requiring a role would make onboarding impossible.
 * - The invitation routes (Settings > Team, 2026-10-19) have none either:
 *   the preview is `@Public()` so a signed-out visitor sees which workspace
 *   invited them, and accepting is done by someone who is not a member yet.
 *   Leaving needs only a membership of the workspace being left.
 * - The member-management routes require `ADMIN`, and that is what the
 *   sprint's "a USER is blocked from an ADMIN-only route" check exercises.
 *
 * ## Route order
 *
 * The `invites/...` routes are declared before every `:id/...` route. They
 * cannot collide today (no `:id` route has `accept` or a token as its second
 * segment), but Express matches in declaration order, and a later
 * `GET :id/:something` would otherwise swallow `invites/<token>` silently.
 */
@Controller('orgs')
export class OrgController {
  private readonly orgCookie: string;
  private readonly authCookie: string;
  private readonly isProduction: boolean;

  constructor(
    private readonly orgs: OrgService,
    private readonly jwt: JwtService,
    config: ConfigService,
  ) {
    this.orgCookie = config.get<string>('ORG_COOKIE_NAME', 'pg_org');
    this.authCookie = config.get<string>('AUTH_COOKIE_NAME', 'pg_session');
    this.isProduction = config.get<string>('NODE_ENV') === 'production';
  }

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser) {
    return { organizations: await this.orgs.listForUser(user.id) };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodBody(createOrgSchema, 'orgs/create')) dto: { name: string },
    @Res({ passthrough: true }) response: Response,
  ) {
    const organization = await this.orgs.create(user.id, dto.name);

    // Switch into the new workspace immediately: creating one and then not
    // being in it is a pointless extra step.
    response.cookie(this.orgCookie, organization.id, this.cookieOptions());

    return { organization };
  }

  /**
   * The accept page's preview: workspace name, role, expiry, and the address
   * the link is for. Invalid answers 404, expired or used 410, each with a
   * message written for the person holding the link.
   *
   * Public, so the global guard never reads the session here. When one came
   * with the request anyway, it is verified on the spot (see `viewerId`) so
   * the page can tell a member they are in already. Throttled per address
   * like every route; a token is 16 random bytes plus a MAC, so the throttle
   * is not what keeps them unguessable.
   */
  @Public()
  @Get('invites/:token')
  async previewInvite(@Param('token') token: string, @Req() request: Request) {
    return this.orgs.previewInvite(token, await this.viewerId(request));
  }

  /**
   * Accepts an invitation and switches into the workspace, setting the
   * active-workspace cookie exactly as `:id/switch` does, so the next page
   * the person sees is the workspace they just joined.
   */
  @Post('invites/accept')
  @HttpCode(HttpStatus.OK)
  async acceptInvite(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodBody(acceptInviteSchema, 'orgs/accept-invite')) dto: { token: string },
    @Res({ passthrough: true }) response: Response,
  ) {
    const organization = await this.orgs.acceptInvite(dto.token, user);
    response.cookie(this.orgCookie, organization.id, this.cookieOptions());
    return { organization };
  }

  /**
   * Switches the active workspace.
   *
   * The cookie is only set after membership is confirmed, so this endpoint
   * cannot be used to plant an arbitrary org id.
   */
  @Post(':id/switch')
  @HttpCode(HttpStatus.OK)
  async switch(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const organization = await this.orgs.assertMembership(user.id, id);
    response.cookie(this.orgCookie, organization.id, this.cookieOptions());
    return { organization };
  }

  @Get(':id/members')
  async members(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return { members: await this.orgs.listMembers(user.id, id) };
  }

  /**
   * Leaves a workspace. No `@Roles()`: the service checks the caller's own
   * membership of `:id`, and touches nothing but that row. The active-workspace
   * cookie is cleared when it pointed here, so the next request does not
   * carry the id of a workspace the caller just left.
   */
  @Post(':id/leave')
  @HttpCode(HttpStatus.OK)
  async leave(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.orgs.leave(user.id, id);

    if ((request.cookies as Record<string, string> | undefined)?.[this.orgCookie] === id) {
      response.clearCookie(this.orgCookie, this.cookieOptions());
    }

    return { message: 'You left the workspace' };
  }

  /**
   * `@Roles(ADMIN)` resolves against the **active org cookie**, not the `:id`
   * path parameter: the guard cannot trust a value from the URL. So an admin
   * of workspace A cannot invite into workspace B by changing the path: the
   * guard sees their role in A, and `@CurrentOrg()` below is what the service
   * actually acts on.
   *
   * Returns the link either way: with `sendEmail` it has also been mailed,
   * without it the admin copies it. The body is the same whoever the address
   * belongs to, because the address is never looked up.
   */
  @Post(':id/invites')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async invite(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentOrg() org: ActiveOrg,
    @Param('id') id: string,
    @Body(new ZodBody(inviteMemberSchema, 'orgs/invite')) dto: InviteMemberBody,
  ) {
    this.assertPathIsActive(id, org);
    return this.orgs.createInvite(org.id, user.id, dto);
  }

  @Patch(':id/members/:userId')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  async changeRole(
    @CurrentOrg() org: ActiveOrg,
    @Param('id') id: string,
    @Param('userId') targetUserId: string,
    @Body(new ZodBody(changeRoleSchema, 'orgs/change-role')) dto: { role: Role },
  ) {
    this.assertPathIsActive(id, org);
    await this.orgs.changeRole(org.id, targetUserId, dto.role);
    return { message: 'Role updated' };
  }

  @Delete(':id/members/:userId')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  async removeMember(
    @CurrentOrg() org: ActiveOrg,
    @Param('id') id: string,
    @Param('userId') targetUserId: string,
  ) {
    this.assertPathIsActive(id, org);
    await this.orgs.removeMember(org.id, targetUserId);
    return { message: 'Member removed' };
  }

  /**
   * The admin routes act on the cookie's workspace, which is the safe choice;
   * this makes sure it is also the one the caller meant. Someone with two
   * workspaces open in two tabs has one cookie, and without the check an
   * invitation created on workspace A's Team page would quietly be a link to
   * workspace B. Refusing tells them to reload instead.
   */
  private assertPathIsActive(id: string, org: ActiveOrg): void {
    if (id !== org.id) {
      throw new ConflictException(
        'That workspace is not the one you have open. Reload the page and try again.',
      );
    }
  }

  /**
   * The signed-in caller of a public route, or null.
   *
   * Only for the invitation preview's "already a member" hint, which reveals
   * nothing beyond the caller's own membership: a forged or expired token
   * reads as signed out, never as an error.
   */
  private async viewerId(request: Request): Promise<string | null> {
    const token = (request.cookies as Record<string, string> | undefined)?.[this.authCookie];

    if (!token) {
      return null;
    }

    try {
      const payload = await this.jwt.verifyAsync<{ sub?: unknown }>(token);
      return typeof payload.sub === 'string' ? payload.sub : null;
    } catch {
      return null;
    }
  }

  /** Readable by the frontend: see the note in `auth.controller.ts`. */
  private cookieOptions(): CookieOptions {
    return {
      httpOnly: false,
      sameSite: 'lax',
      secure: this.isProduction,
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    };
  }
}
