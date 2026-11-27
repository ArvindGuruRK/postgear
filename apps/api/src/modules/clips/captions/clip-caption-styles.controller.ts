/**
 * Caption styles (Sprint 13, Module 03). `@Roles(ADMIN, USER, EDITOR)`, scoped on
 * `@CurrentOrg()`: another workspace's style is a plain 404.
 *
 * - `GET /clips/caption-styles`: `{ styles, defaultStyleId, own, limit }`.
 * - `POST /clips/caption-styles` `{ name, look }`: 201 `{ style }`;
 *   409 `caption_style_limit`.
 * - `PATCH /clips/caption-styles/:id` `{ name?, look? }`: `{ style }`.
 * - `DELETE /clips/caption-styles/:id`: `{ message }`.
 *
 * A word route under `/clips`, so its module is imported before
 * `ClipItemModule` (whose `GET /clips/:clipId` would otherwise take it).
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
  UseGuards,
} from '@nestjs/common';
import { Role } from '@postgear/db';
import { type ActiveOrg, CurrentOrg } from '../../../common/decorators/current-org.decorator';
import {
  type AuthenticatedUser,
  CurrentUser,
} from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { ZodBody } from '../../../common/pipes/zod-validation.pipe';
import { ClipsEnabledGuard } from '../limits/clips-enabled.guard';
import {
  type CreateCaptionStyleInput,
  createCaptionStyleSchema,
  type UpdateCaptionStyleInput,
  updateCaptionStyleSchema,
} from './clip-caption-styles.schema';
import { ClipCaptionStylesService } from './clip-caption-styles.service';

@Controller('clips/caption-styles')
@Roles(Role.ADMIN, Role.USER, Role.EDITOR)
@UseGuards(ClipsEnabledGuard)
export class ClipCaptionStylesController {
  constructor(private readonly styles: ClipCaptionStylesService) {}

  @Get()
  list(@CurrentOrg() org: ActiveOrg) {
    return this.styles.list(org.id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentOrg() org: ActiveOrg,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodBody(createCaptionStyleSchema, 'clips/caption-styles/create'))
    body: CreateCaptionStyleInput,
  ) {
    return this.styles.create(org.id, user.id, body);
  }

  @Patch(':id')
  update(
    @CurrentOrg() org: ActiveOrg,
    @Param('id') id: string,
    @Body(new ZodBody(updateCaptionStyleSchema, 'clips/caption-styles/update'))
    body: UpdateCaptionStyleInput,
  ) {
    return this.styles.update(org.id, id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  remove(@CurrentOrg() org: ActiveOrg, @Param('id') id: string) {
    return this.styles.remove(org.id, id);
  }
}
