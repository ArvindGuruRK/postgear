/**
 * One clip (Sprint 12, Module 05): `POST /clips`, `GET /clips/:clipId`,
 * `POST /clips/:clipId/exports`.
 *
 * ## Route order matters here
 *
 * `GET /clips/:clipId` has the same shape as `GET /clips/status`,
 * `GET /clips/videos` and `GET /clips/channels`. Express tries routes in the
 * order they were registered and stops at the first match, so this
 * controller must be registered after every other `/clips/<word>` route.
 * Nest registers each module's controllers in the order modules were first
 * scanned, and a module is scanned before its own imports: that is why this
 * controller lives in `ClipItemModule`, imported LAST by `ClipsModule`, and
 * not in `ClipsModule.controllers` (which would come before the imported
 * `ClipChannelsModule` and `ClipLinksModule`). `:clipId` is also checked as
 * a UUID in the service, so a word that slipped through is a 404, never a
 * query. `clips-routes.spec.ts` pins the order.
 */
import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { Role } from '@postgear/db';
import { type ActiveOrg, CurrentOrg } from '../../../common/decorators/current-org.decorator';
import {
  type AuthenticatedUser,
  CurrentUser,
} from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { ZodBody } from '../../../common/pipes/zod-validation.pipe';
import {
  type CreateClipInput,
  createClipSchema,
  type ExportClipInput,
  exportClipSchema,
} from './clip-item.schema';
import { ClipItemService } from './clip-item.service';

@Controller('clips')
@Roles(Role.ADMIN, Role.USER)
export class ClipItemController {
  constructor(private readonly clips: ClipItemService) {}

  /** 201 `{ clip, job }`; 409 `video_not_ready`; 422 `clip_range_invalid`. */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentOrg() org: ActiveOrg,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodBody(createClipSchema, 'clips/create')) body: CreateClipInput,
  ) {
    return this.clips.create(org.id, user.id, body);
  }

  /** `{ clip, video, playback, sharp }`. */
  @Get(':clipId')
  get(@CurrentOrg() org: ActiveOrg, @Param('clipId') clipId: string) {
    return this.clips.get(org.id, clipId);
  }

  /** 202 `{ job }`; 409 `export_running`. */
  @Post(':clipId/exports')
  @HttpCode(HttpStatus.ACCEPTED)
  export(
    @CurrentOrg() org: ActiveOrg,
    @CurrentUser() user: AuthenticatedUser,
    @Param('clipId') clipId: string,
    @Body(new ZodBody(exportClipSchema, 'clips/export')) body: ExportClipInput,
  ) {
    return this.clips.export(org.id, user.id, clipId, body);
  }
}
