/**
 * The competitor routes (Module 07): who a workspace follows in Discover, and
 * what each of them published lately.
 *
 * Any member may list, add and edit: following a competitor is everyday work.
 * Removing one is an admin's call (story DC-7.3), so that one handler narrows the
 * roles, and the guard answers a member with its own 403. The page never offers a
 * member the button.
 *
 * Every handler scopes on `@CurrentOrg()`. The `:id` in a path is only the
 * competitor being acted on, and another workspace's id is a 404, the same as an
 * id that never existed.
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
} from '@nestjs/common';
import { Role } from '@postgear/db';
import { type ActiveOrg, CurrentOrg } from '../../common/decorators/current-org.decorator';
import {
  type AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodBody } from '../../common/pipes/zod-validation.pipe';
import { CompetitorsService } from './competitors.service';
import { DISCOVER_MESSAGES } from './discover.messages';
import {
  type CreateCompetitorInput,
  createCompetitorSchema,
  type DiscoverFeedsInput,
  discoverFeedsSchema,
  MAX_COMPETITORS,
  type UpdateCompetitorInput,
  updateCompetitorSchema,
} from './dto/competitors.schema';

@Controller('discover/competitors')
@Roles(Role.ADMIN, Role.USER)
export class CompetitorsController {
  constructor(private readonly competitors: CompetitorsService) {}

  @Get()
  async list(@CurrentOrg() org: ActiveOrg) {
    return { competitors: await this.competitors.list(org.id), limit: MAX_COMPETITORS };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentOrg() org: ActiveOrg,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodBody(createCompetitorSchema, 'discover/competitors/create'))
    body: CreateCompetitorInput,
  ) {
    return { competitor: await this.competitors.create(org.id, user.id, body) };
  }

  /** Declared before `:id` reads: a website's feeds, found before anything is saved. */
  @Post('discover-feeds')
  @HttpCode(HttpStatus.OK)
  async discoverFeeds(
    @CurrentOrg() org: ActiveOrg,
    @Body(new ZodBody(discoverFeedsSchema, 'discover/competitors/discover-feeds'))
    body: DiscoverFeedsInput,
  ) {
    return { feeds: await this.competitors.discoverFeeds(org.id, body.url) };
  }

  @Patch(':id')
  async update(
    @CurrentOrg() org: ActiveOrg,
    @Param('id') id: string,
    @Body(new ZodBody(updateCompetitorSchema, 'discover/competitors/update'))
    body: UpdateCompetitorInput,
  ) {
    return { competitor: await this.competitors.update(org.id, id, body) };
  }

  @Delete(':id')
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  async remove(@CurrentOrg() org: ActiveOrg, @Param('id') id: string) {
    await this.competitors.remove(org.id, id);
    return { message: DISCOVER_MESSAGES.competitorRemoved };
  }

  @Get(':id/items')
  items(@CurrentOrg() org: ActiveOrg, @Param('id') id: string) {
    return this.competitors.items(org.id, id);
  }
}
