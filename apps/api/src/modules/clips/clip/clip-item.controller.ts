/**
 * The clip routes (Sprint 12, Module 05; completed in Modules 07 to 09):
 * `GET /clips`, `POST /clips`, `GET`, `PATCH` and `DELETE /clips/:clipId`,
 * and `POST /clips/:clipId/open`, `/duplicate`, `/more-video`, `/exports`;
 * Module 15 adds `GET /clips/:clipId/exports`, `POST /clips/:clipId/previews`
 * and `GET /clips/:clipId/previews/latest` (`ClipExportsService`); Module 17
 * adds `GET /clips/coming-up` (declared before `:clipId`, see below) and
 * `POST /clips/:clipId/send` (`ClipSendService`).
 *
 * ## Route order matters here
 *
 * `GET /clips/:clipId` has the same shape as `GET /clips/status`,
 * `GET /clips/videos`, `GET /clips/channels` and `GET /clips/layouts`.
 * Express tries routes in the order they were registered and stops at the
 * first match, so this controller must be registered after every other
 * `/clips/<word>` route. Nest registers each module's controllers in the
 * order modules were first scanned, and a module is scanned before its own
 * imports: that is why this controller lives in `ClipItemModule`, imported
 * LAST by `ClipsModule`, and not in `ClipsModule.controllers` (which would
 * come before the imported `ClipChannelsModule`, `ClipLinksModule` and
 * `ClipLayoutsModule`). `:clipId` is also checked as a UUID in the service,
 * so a word that slipped through is a 404, never a query.
 * `clips-routes.spec.ts` pins the order.
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
} from '@nestjs/common';
import { Role } from '@postgear/db';
import { type ActiveOrg, CurrentOrg } from '../../../common/decorators/current-org.decorator';
import {
  type AuthenticatedUser,
  CurrentUser,
} from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { ZodBody, ZodQuery } from '../../../common/pipes/zod-validation.pipe';
import { ClipEditsService } from './clip-edits.service';
import { ClipExportsService } from './clip-exports.service';
import {
  type CreateClipInput,
  createClipSchema,
  type ExportClipInput,
  exportClipSchema,
  type ListClipsQuery,
  listClipsQuerySchema,
  type MoreVideoInput,
  moreVideoSchema,
  type PatchClipInput,
  type PreviewClipInput,
  patchClipSchema,
  previewClipSchema,
  type SendClipInput,
  sendClipSchema,
} from './clip-item.schema';
import { ClipItemService } from './clip-item.service';
import { ClipSendService } from './clip-send.service';
import { ClipsListService } from './clips-list.service';

@Controller('clips')
@Roles(Role.ADMIN, Role.USER)
export class ClipItemController {
  constructor(
    private readonly clips: ClipItemService,
    private readonly edits: ClipEditsService,
    private readonly library: ClipsListService,
    private readonly exports: ClipExportsService,
    private readonly sender: ClipSendService,
  ) {}

  /** `{ clips, counts, page, pageSize, total }`. */
  @Get()
  list(
    @CurrentOrg() org: ActiveOrg,
    @Query(new ZodQuery(listClipsQuerySchema, 'clips/list')) query: ListClipsQuery,
  ) {
    return this.library.list(org.id, query);
  }

  /**
   * 201 `{ clip, job }`; 409 `video_not_ready`; 422 `clip_range_invalid`,
   * `clip_too_long` (`whole: true` on a video over 30 minutes).
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentOrg() org: ActiveOrg,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodBody(createClipSchema, 'clips/create')) body: CreateClipInput,
  ) {
    return this.clips.create(org.id, user.id, body);
  }

  /**
   * Module 17: `{ items, total }`, the waiting posts in the next 14 days that
   * use a clip, soonest first, at most five. Declared before `:clipId`, so
   * Express matches this word first.
   */
  @Get('coming-up')
  comingUp(@CurrentOrg() org: ActiveOrg) {
    return this.library.comingUp(org.id);
  }

  /** `{ clip, video, playback, sharp, proxy, filmstrip, waveform }`. */
  @Get(':clipId')
  get(@CurrentOrg() org: ActiveOrg, @Param('clipId') clipId: string) {
    return this.clips.get(org.id, clipId);
  }

  /**
   * `{ clip }` with the new revision; 409 `clip_changed_elsewhere` (with
   * `details.revision`); 413 `clip_document_too_large`; 422 `clip_document_invalid`.
   */
  @Patch(':clipId')
  patch(
    @CurrentOrg() org: ActiveOrg,
    @Param('clipId') clipId: string,
    @Body(new ZodBody(patchClipSchema, 'clips/patch')) body: PatchClipInput,
  ) {
    return this.edits.patch(org.id, clipId, body);
  }

  /** `{ message }`. */
  @Delete(':clipId')
  @HttpCode(HttpStatus.OK)
  remove(@CurrentOrg() org: ActiveOrg, @Param('clipId') clipId: string) {
    return this.edits.remove(org.id, clipId);
  }

  /** The editor opened the clip: NEW becomes DRAFT. `{ clip }`. */
  @Post(':clipId/open')
  @HttpCode(HttpStatus.OK)
  open(@CurrentOrg() org: ActiveOrg, @Param('clipId') clipId: string) {
    return this.edits.open(org.id, clipId);
  }

  /** 201 `{ clip }`: a new DRAFT with the same document. */
  @Post(':clipId/duplicate')
  @HttpCode(HttpStatus.CREATED)
  duplicate(
    @CurrentOrg() org: ActiveOrg,
    @CurrentUser() user: AuthenticatedUser,
    @Param('clipId') clipId: string,
  ) {
    return this.edits.duplicate(org.id, user.id, clipId);
  }

  /** 202 `{ job, sharp }`; 409 `video_not_ready`; 422 `clip_range_invalid`; 429 `more_video_throttled`. */
  @Post(':clipId/more-video')
  @HttpCode(HttpStatus.ACCEPTED)
  moreVideo(
    @CurrentOrg() org: ActiveOrg,
    @CurrentUser() user: AuthenticatedUser,
    @Param('clipId') clipId: string,
    @Body(new ZodBody(moreVideoSchema, 'clips/more-video')) body: MoreVideoInput,
  ) {
    return this.clips.moreVideo(org.id, user.id, clipId, body);
  }

  /**
   * 202 `{ job }`; 402 `clips_quality_requires_plan`; 409 `export_running`,
   * `clip_changed_elsewhere` (with `details.revision`), `video_not_ready`.
   */
  @Post(':clipId/exports')
  @HttpCode(HttpStatus.ACCEPTED)
  export(
    @CurrentOrg() org: ActiveOrg,
    @CurrentUser() user: AuthenticatedUser,
    @Param('clipId') clipId: string,
    @Body(new ZodBody(exportClipSchema, 'clips/export')) body: ExportClipInput,
  ) {
    return this.exports.start(org.id, user.id, clipId, body);
  }

  /** `{ exports }`: the last five exports, newest first, any status. */
  @Get(':clipId/exports')
  exportHistory(@CurrentOrg() org: ActiveOrg, @Param('clipId') clipId: string) {
    return this.exports.history(org.id, clipId);
  }

  /**
   * 202 `{ job }`: a Preview Export, or the one already QUEUED or RUNNING;
   * 409 `clip_changed_elsewhere`, `video_not_ready`.
   */
  @Post(':clipId/previews')
  @HttpCode(HttpStatus.ACCEPTED)
  preview(
    @CurrentOrg() org: ActiveOrg,
    @CurrentUser() user: AuthenticatedUser,
    @Param('clipId') clipId: string,
    @Body(new ZodBody(previewClipSchema, 'clips/preview')) body: PreviewClipInput,
  ) {
    return this.exports.startPreview(org.id, user.id, clipId, body);
  }

  /**
   * Module 17, Send To Composer: 201 `{ group }`, a draft with the clip's
   * exported file on the chosen channels; 409 `clip_not_exported`,
   * `clip_export_outdated`; 422 `clip_does_not_fit`; 400 for a channel that
   * is not this workspace's.
   */
  @Post(':clipId/send')
  @HttpCode(HttpStatus.CREATED)
  send(
    @CurrentOrg() org: ActiveOrg,
    @Param('clipId') clipId: string,
    @Body(new ZodBody(sendClipSchema, 'clips/send')) body: SendClipInput,
  ) {
    return this.sender.send(org.id, clipId, body);
  }

  /** `{ preview }`: the newest preview with a signed address while its file is kept, or null. */
  @Get(':clipId/previews/latest')
  latestPreview(@CurrentOrg() org: ActiveOrg, @Param('clipId') clipId: string) {
    return this.exports.latestPreview(org.id, clipId);
  }
}
