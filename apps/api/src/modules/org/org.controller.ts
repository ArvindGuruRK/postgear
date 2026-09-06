import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role } from '@postgear/db';
import type { CookieOptions, Response } from 'express';
import { type ActiveOrg, CurrentOrg } from '../../common/decorators/current-org.decorator';
import {
  type AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodBody } from '../../common/pipes/zod-validation.pipe';
import { changeRoleSchema, createOrgSchema, inviteMemberSchema } from './dto/org.schema';
import { OrgService } from './org.service';

/**
 * Workspace management.
 *
 * Note which routes carry `@Roles()` and which do not:
 *
 * - `POST /orgs` and `GET /orgs` have **no** role requirement, because a user
 *   with zero memberships must be able to create their first workspace and
 *   list an empty set. Requiring a role would make onboarding impossible.
 * - The member-management routes require `ADMIN`, and that is what the
 *   sprint's "a USER is blocked from an ADMIN-only route" check exercises.
 */
@Controller('orgs')
export class OrgController {
  private readonly orgCookie: string;
  private readonly isProduction: boolean;

  constructor(
    private readonly orgs: OrgService,
    config: ConfigService,
  ) {
    this.orgCookie = config.get<string>('ORG_COOKIE_NAME', 'pg_org');
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

    // Switch into the new workspace immediately — creating one and then not
    // being in it is a pointless extra step.
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
   * `@Roles(ADMIN)` resolves against the **active org cookie**, not the `:id`
   * path parameter — the guard cannot trust a value from the URL. So an admin
   * of workspace A cannot invite into workspace B by changing the path: the
   * guard sees their role in A, and `@CurrentOrg()` below is what the service
   * actually acts on.
   */
  @Post(':id/invites')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async invite(
    @CurrentOrg() org: ActiveOrg,
    @Body(new ZodBody(inviteMemberSchema, 'orgs/invite')) dto: { email: string; role: Role },
  ) {
    await this.orgs.invite(org.id, dto.email, dto.role);
    // Same body whether the invitee already had an account or was emailed an
    // invitation — otherwise this is an account-enumeration oracle usable by
    // anyone who can create a workspace.
    return { message: 'Invitation sent' };
  }

  @Patch(':id/members/:userId')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  async changeRole(
    @CurrentOrg() org: ActiveOrg,
    @Param('userId') targetUserId: string,
    @Body(new ZodBody(changeRoleSchema, 'orgs/change-role')) dto: { role: Role },
  ) {
    await this.orgs.changeRole(org.id, targetUserId, dto.role);
    return { message: 'Role updated' };
  }

  @Delete(':id/members/:userId')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  async removeMember(@CurrentOrg() org: ActiveOrg, @Param('userId') targetUserId: string) {
    await this.orgs.removeMember(org.id, targetUserId);
    return { message: 'Member removed' };
  }

  /** Readable by the frontend — see the note in `auth.controller.ts`. */
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
