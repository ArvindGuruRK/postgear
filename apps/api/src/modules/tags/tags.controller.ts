/**
 * Post tags.
 *
 * `@Roles(ADMIN, USER)`: any member, as in Postiz, since tags label posts and
 * every member writes posts. Every handler scopes on `@CurrentOrg()`; the
 * `:id` in a path is only the tag being acted on.
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
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodBody } from '../../common/pipes/zod-validation.pipe';
import {
  type CreateTagInput,
  createTagSchema,
  type UpdateTagInput,
  updateTagSchema,
} from './dto/tags.schema';
import { TAG_MESSAGES } from './tags.messages';
import { TagsService } from './tags.service';

@Controller('tags')
@Roles(Role.ADMIN, Role.USER)
export class TagsController {
  constructor(private readonly tags: TagsService) {}

  @Get()
  async list(@CurrentOrg() org: ActiveOrg) {
    return { tags: await this.tags.list(org.id) };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentOrg() org: ActiveOrg,
    @Body(new ZodBody(createTagSchema, 'tags/create')) dto: CreateTagInput,
  ) {
    return { tag: await this.tags.create(org.id, dto) };
  }

  @Patch(':id')
  async update(
    @CurrentOrg() org: ActiveOrg,
    @Param('id') id: string,
    @Body(new ZodBody(updateTagSchema, 'tags/update')) dto: UpdateTagInput,
  ) {
    return { tag: await this.tags.update(org.id, id, dto) };
  }

  /** Soft delete: the tag disappears from every post that carried it. */
  @Delete(':id')
  async remove(@CurrentOrg() org: ActiveOrg, @Param('id') id: string) {
    await this.tags.remove(org.id, id);
    return { message: TAG_MESSAGES.DELETED };
  }
}
