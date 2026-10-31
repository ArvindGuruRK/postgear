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
 *
 * Google (Module 13): the list also says whether simulation is on and
 * whether Google is set up; members may get a Picker token and use the three
 * Sheets helpers (reading tabs and the header row, creating a spreadsheet),
 * because picking or creating a file only grants PostGear access to it.
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
  type CreateSpreadsheetInput,
  createConnectionSchema,
  createSpreadsheetSchema,
  type OAuthStartQuery,
  oauthStartQuerySchema,
  type SheetHeaderQuery,
  type SpreadsheetParams,
  sheetHeaderQuerySchema,
  spreadsheetParamsSchema,
  type UpdateConnectionInput,
  updateConnectionSchema,
} from './dto/connections.schema';
import { GoogleSheetsService } from './google/google-sheets.service';

@Controller('automation-connections')
@Roles(Role.ADMIN, Role.USER)
export class ConnectionsController {
  constructor(
    private readonly connections: ConnectionsService,
    private readonly oauth: ConnectionOAuthService,
    private readonly google: GoogleSheetsService,
  ) {}

  @Get()
  async list(@CurrentOrg() org: ActiveOrg) {
    return {
      connections: await this.connections.list(org.id),
      simulation: this.connections.settings.simulation,
      googleReady: this.connections.settings.googleReady,
    };
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

  /** A short-lived Google access token for the file picker; never the refresh token. */
  @Get(':id/picker-token')
  pickerToken(@CurrentOrg() org: ActiveOrg, @Param('id') id: string) {
    return this.google.pickerToken(org.id, id);
  }

  /** The spreadsheet's name and link, and its tabs. */
  @Get(':id/google/spreadsheets/:spreadsheetId')
  spreadsheet(
    @CurrentOrg() org: ActiveOrg,
    @Param(new ZodQuery(spreadsheetParamsSchema, 'automation-connections/spreadsheet'))
    params: SpreadsheetParams,
  ) {
    return this.google.spreadsheet(org.id, params.id, params.spreadsheetId);
  }

  /** The first row of a tab: the column headings the step maps data to. */
  @Get(':id/google/spreadsheets/:spreadsheetId/header')
  header(
    @CurrentOrg() org: ActiveOrg,
    @Param(new ZodQuery(spreadsheetParamsSchema, 'automation-connections/header'))
    params: SpreadsheetParams,
    @Query(new ZodQuery(sheetHeaderQuerySchema, 'automation-connections/header'))
    query: SheetHeaderQuery,
  ) {
    return this.google.header(org.id, params.id, params.spreadsheetId, query.sheet);
  }

  /** Create A New Spreadsheet, with its header row filled in. */
  @Post(':id/google/spreadsheets')
  @HttpCode(HttpStatus.CREATED)
  createSpreadsheet(
    @CurrentOrg() org: ActiveOrg,
    @Param('id') id: string,
    @Body(new ZodBody(createSpreadsheetSchema, 'automation-connections/create-spreadsheet'))
    dto: CreateSpreadsheetInput,
  ) {
    return this.google.create(org.id, id, dto);
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
