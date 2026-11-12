/**
 * Saved Ideas (Sprint 11 Module 10, backlog #3): the workspace's shortlist.
 *
 * Any member may list, save, note and remove: it is the team's scratch list.
 * Every handler scopes on `@CurrentOrg()`; another workspace's id is a 404.
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
  Res,
} from '@nestjs/common';
import { Role } from '@postgear/db';
import type { Response } from 'express';
import { type ActiveOrg, CurrentOrg } from '../../common/decorators/current-org.decorator';
import {
  type AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodBody } from '../../common/pipes/zod-validation.pipe';
import { DISCOVER_MESSAGES } from './discover.messages';
import {
  type SaveIdeaInput,
  saveIdeaSchema,
  type UpdateIdeaInput,
  updateIdeaSchema,
} from './dto/ideas.schema';
import { DiscoverIdeasService } from './ideas.service';

@Controller('discover/ideas')
@Roles(Role.ADMIN, Role.USER)
export class DiscoverIdeasController {
  constructor(private readonly ideas: DiscoverIdeasService) {}

  @Get()
  list(@CurrentOrg() org: ActiveOrg) {
    return this.ideas.list(org.id);
  }

  /** 201 for a new idea, 200 when the card was already saved: either way the idea comes back. */
  @Post()
  async save(
    @CurrentOrg() org: ActiveOrg,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodBody(saveIdeaSchema, 'discover/ideas/save')) body: SaveIdeaInput,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { idea, created } = await this.ideas.save(org.id, user.id, body);
    response.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return { idea };
  }

  @Patch(':id')
  async update(
    @CurrentOrg() org: ActiveOrg,
    @Param('id') id: string,
    @Body(new ZodBody(updateIdeaSchema, 'discover/ideas/update')) body: UpdateIdeaInput,
  ) {
    return { idea: await this.ideas.updateNote(org.id, id, body.note) };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async remove(@CurrentOrg() org: ActiveOrg, @Param('id') id: string) {
    await this.ideas.remove(org.id, id);
    return { message: DISCOVER_MESSAGES.ideaRemoved };
  }
}
