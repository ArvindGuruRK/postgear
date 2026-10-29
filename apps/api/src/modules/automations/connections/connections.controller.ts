/**
 * Connections (Sprint 10, Module 04): the outside apps any workflow can use.
 *
 * Members see the list and pick connections in their steps; every change is
 * `@Roles(Role.ADMIN)`, including Reconnect and starting OAuth, because a
 * connection acts for the whole workspace. Every handler scopes on
 * `@CurrentOrg()`.
 *
 * The fixed `oauth/...` paths come before `:id`. The callback is public: the
 * app redirects the browser there, and the single-use state is what ties it
 * to a workspace and an admin.
 */
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
  Query,
  Res,
} from '@nestjs/common';
import { Role } from '@postgear/db';
import type { Response } from 'express';
import { type ActiveOrg, CurrentOrg } from '../../../common/decorators/current-org.decorator';
import {
  type AuthenticatedUser,
  CurrentUser,
} from '../../../common/decorators/current-user.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { ZodBody, ZodQuery } from '../../../common/pipes/zod-validation.pipe';
import { ConnectionOAuthService } from './connection-oauth.service';
import { CONNECTION_MESSAGES } from './connections.messages';
import { ConnectionsService } from './connections.service';
import {
  type CreateConnectionInput,
  createConnectionSchema,
  type OAuthStartQuery,
  oauthStartQuerySchema,
  type UpdateConnectionInput,
  updateConnectionSchema,
} from './dto/connections.schema';

@Controller('automation-connections')
@Roles(Role.ADMIN, Role.USER)
export class ConnectionsController {
  constructor(
    private readonly connections: ConnectionsService,
    private readonly oauth: ConnectionOAuthService,
  ) {}

  @Get()
  async list(@CurrentOrg() org: ActiveOrg) {
    return { connections: await this.connections.list(org.id) };
  }

  @Get('oauth/:provider/start')
  @Roles(Role.ADMIN)
  async start(
    @CurrentOrg() org: ActiveOrg,
    @CurrentUser() user: AuthenticatedUser,
    @Param('provider') provider: string,
    @Query(new ZodQuery(oauthStartQuerySchema, 'automation-connections/oauth-start'))
    query: OAuthStartQuery,
    @Res() response: Response,
  ) {
    return response.redirect(await this.oauth.start(org.id, user.id, provider, query));
  }

  @Public()
  @Get('oauth/:provider/callback')
  async callback(
    @Param('provider') provider: string,
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Res() response: Response,
  ) {
    return response.redirect(await this.oauth.finish(provider, code, state));
  }

  @Post()
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentOrg() org: ActiveOrg,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodBody(createConnectionSchema, 'automation-connections/create'))
    dto: CreateConnectionInput,
  ) {
    return { connection: await this.connections.create(org.id, user.id, dto) };
  }

  /** Rename, or Reconnect with new details. */
  @Patch(':id')
  @Roles(Role.ADMIN)
  async update(
    @CurrentOrg() org: ActiveOrg,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodBody(updateConnectionSchema, 'automation-connections/update'))
    dto: UpdateConnectionInput,
  ) {
    return { connection: await this.connections.update(org.id, user.id, id, dto) };
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  async remove(@CurrentOrg() org: ActiveOrg, @Param('id') id: string) {
    await this.connections.remove(org.id, id);
    return { message: CONNECTION_MESSAGES.DELETED };
  }

  @Post(':id/check')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  check(
    @CurrentOrg() org: ActiveOrg,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.connections.check(org.id, user.id, id);
  }
}
