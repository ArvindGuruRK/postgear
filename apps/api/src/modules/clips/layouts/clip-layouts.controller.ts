/**
 * Saved layouts (Sprint 12, Module 10 section 6): `GET`, `POST
 * /clips/layouts`, `PATCH` and `DELETE /clips/layouts/:id`.
 *
 * `@Roles(ADMIN, USER, EDITOR)`: any member saves, renames and deletes; the
 * workspace comes from `@CurrentOrg()` and another workspace's id is a 404.
 * Registered before `ClipItemModule`'s `GET /clips/:clipId` (see
 * `clips.module.ts`), which would otherwise take `GET /clips/layouts`.
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
  UseGuards,
} from '@nestjs/common';
import { Role } from '@postgear/db';
import { type ActiveOrg, CurrentOrg } from '../../../common/decorators/current-org.decorator';
import {
  type AuthenticatedUser,
  CurrentUser,
} from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { ZodBody, ZodQuery } from '../../../common/pipes/zod-validation.pipe';
import {
  type CreateLayoutInput,
  createLayoutSchema,
  type ListLayoutsQuery,
  listLayoutsQuerySchema,
  type RenameLayoutInput,
  renameLayoutSchema,
} from './clip-layouts.schema';
import { ClipLayoutsService } from './clip-layouts.service';
import { ClipsEnabledGuard } from '../limits/clips-enabled.guard';

@Controller('clips/layouts')
@Roles(Role.ADMIN, Role.USER, Role.EDITOR)
// Module 19: `clips.enabled` on every route, through the resolver.
@UseGuards(ClipsEnabledGuard)
export class ClipLayoutsController {
  constructor(private readonly layouts: ClipLayoutsService) {}

  /** `{ layouts }`, newest first. */
  @Get()
  list(
    @CurrentOrg() org: ActiveOrg,
    @Query(new ZodQuery(listLayoutsQuerySchema, 'clips/layouts/list')) query: ListLayoutsQuery,
  ) {
    return this.layouts.list(org.id, query);
  }

  /** 201 `{ layout }`; 409 `layout_limit`. */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentOrg() org: ActiveOrg,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodBody(createLayoutSchema, 'clips/layouts/create')) body: CreateLayoutInput,
  ) {
    return this.layouts.create(org.id, user.id, body);
  }

  /** `{ layout }`; 404 `layout_not_found`. */
  @Patch(':id')
  rename(
    @CurrentOrg() org: ActiveOrg,
    @Param('id') id: string,
    @Body(new ZodBody(renameLayoutSchema, 'clips/layouts/rename')) body: RenameLayoutInput,
  ) {
    return this.layouts.rename(org.id, id, body);
  }

  /** `{ message }`; 404 `layout_not_found`. */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  remove(@CurrentOrg() org: ActiveOrg, @Param('id') id: string) {
    return this.layouts.remove(org.id, id);
  }
}
