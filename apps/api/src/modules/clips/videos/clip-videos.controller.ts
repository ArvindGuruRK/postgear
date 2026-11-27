/**
 * Videos and uploads (Sprint 12, Module 04).
 *
 * `@Roles(ADMIN, USER)`: any member of the workspace imports, watches and
 * removes videos. Every handler scopes on `@CurrentOrg()`; ids from the URL
 * are checked against the workspace in the service (another workspace's
 * video is a plain 404). Bodies are validated with `.strict()` Zod schemas.
 *
 * - `POST /clips/videos`: `{ url, rightsConfirmed }` or (Try A Sample,
 *   Module 06) `{ sample: true }`. 201 `{ video, job, existing: false }`, or
 *   200 `{ video, job: null, existing: true }` (plus `message` for the
 *   sample) when the workspace already has it; 404 `sample_unavailable`.
 * - `GET /clips/videos?cursor&sort`: `{ videos, nextCursor, total }`, each
 *   card with `clipCount` (Module 06).
 * - `GET /clips/videos/:videoId`: the video, signed addresses, job, clips
 *   (each with `state` and `range`, Module 07).
 * - `POST /clips/videos/:videoId/retry` and `/cancel`, `DELETE /clips/videos/:videoId`.
 * - `POST /clips/videos/:videoId/download-original` (Module 18): `{ url }`, a
 *   five minute signed address for an uploaded video's own file; uploads only.
 * - `POST /clips/videos/uploads`, `.../uploads/:uploadId/parts`, `.../uploads/:uploadId/complete`.
 * - `POST /clips/videos/drive` (Sprint 13 Module 12): `{ fileId, accessToken }`
 *   from Google's picker; 201 `{ video, job }`. 404 when Drive is not offered.
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@postgear/db';
import type { Response } from 'express';
import { type ActiveOrg, CurrentOrg } from '../../../common/decorators/current-org.decorator';
import {
  type AuthenticatedUser,
  CurrentUser,
} from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { ZodBody, ZodQuery } from '../../../common/pipes/zod-validation.pipe';
import { ClipDownloadsService } from '../downloads/clip-downloads.service';
import { ClipStart } from '../limits/clips-create.guard';
import { ClipsEnabledGuard } from '../limits/clips-enabled.guard';
import { ClipUploadsService } from './clip-uploads.service';
import {
  type CompleteUploadInput,
  completeUploadSchema,
  type DriveImportInput,
  driveImportSchema,
  type ImportVideoInput,
  importVideoSchema,
  type ListVideosQuery,
  listVideosQuerySchema,
  type SignPartsInput,
  type StartUploadInput,
  signPartsSchema,
  startUploadSchema,
} from './clip-videos.schema';
import { ClipVideosService } from './clip-videos.service';

@Controller('clips/videos')
@Roles(Role.ADMIN, Role.USER)
// Module 19: `clips.enabled` on every route, through the resolver.
@UseGuards(ClipsEnabledGuard)
export class ClipVideosController {
  constructor(
    private readonly videos: ClipVideosService,
    private readonly uploads: ClipUploadsService,
    private readonly downloads: ClipDownloadsService,
  ) {}

  @Post()
  @ClipStart()
  async import(
    @CurrentOrg() org: ActiveOrg,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodBody(importVideoSchema, 'clips/videos/import')) body: ImportVideoInput,
    @Res({ passthrough: true }) response: Response,
  ) {
    const outcome = await this.videos.importLink(org.id, user.id, body);
    response.status(outcome.existing ? HttpStatus.OK : HttpStatus.CREATED);
    return outcome;
  }

  @Get()
  list(
    @CurrentOrg() org: ActiveOrg,
    @Query(new ZodQuery(listVideosQuerySchema, 'clips/videos/list')) query: ListVideosQuery,
  ) {
    return this.videos.list(org.id, query);
  }

  // --- Uploads (declared before `:videoId`, though the shapes never meet) ------

  @Post('uploads')
  @ClipStart()
  @HttpCode(HttpStatus.CREATED)
  startUpload(
    @CurrentOrg() org: ActiveOrg,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodBody(startUploadSchema, 'clips/uploads/start')) body: StartUploadInput,
  ) {
    return this.uploads.start(org.id, user.id, body);
  }

  @Post('uploads/:uploadId/parts')
  @HttpCode(HttpStatus.OK)
  signParts(
    @CurrentOrg() org: ActiveOrg,
    @Param('uploadId') uploadId: string,
    @Body(new ZodBody(signPartsSchema, 'clips/uploads/parts')) body: SignPartsInput,
  ) {
    return this.uploads.signParts(org.id, uploadId, body);
  }

  @Post('uploads/:uploadId/complete')
  @HttpCode(HttpStatus.OK)
  completeUpload(
    @CurrentOrg() org: ActiveOrg,
    @CurrentUser() user: AuthenticatedUser,
    @Param('uploadId') uploadId: string,
    @Body(new ZodBody(completeUploadSchema, 'clips/uploads/complete')) body: CompleteUploadInput,
  ) {
    return this.uploads.complete(org.id, user.id, uploadId, body);
  }

  /** Module 12 (D13-09): a file picked in Google Drive. 404 when Drive is not offered. */
  @Post('drive')
  @ClipStart()
  @HttpCode(HttpStatus.CREATED)
  importFromDrive(
    @CurrentOrg() org: ActiveOrg,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodBody(driveImportSchema, 'clips/videos/drive')) body: DriveImportInput,
  ) {
    return this.uploads.startFromDrive(org.id, user.id, body);
  }

  // --- One video ------------------------------------------------------------------

  @Get(':videoId')
  get(@CurrentOrg() org: ActiveOrg, @Param('videoId') videoId: string) {
    return this.videos.get(org.id, videoId);
  }

  @Post(':videoId/retry')
  @ClipStart()
  @HttpCode(HttpStatus.OK)
  retry(
    @CurrentOrg() org: ActiveOrg,
    @CurrentUser() user: AuthenticatedUser,
    @Param('videoId') videoId: string,
  ) {
    return this.videos.retry(org.id, user.id, videoId);
  }

  @Post(':videoId/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(@CurrentOrg() org: ActiveOrg, @Param('videoId') videoId: string) {
    return this.videos.cancel(org.id, videoId);
  }

  @Post(':videoId/download-original')
  @ClipStart()
  @HttpCode(HttpStatus.OK)
  downloadOriginal(@CurrentOrg() org: ActiveOrg, @Param('videoId') videoId: string) {
    return this.downloads.downloadOriginal(org.id, videoId);
  }

  @Delete(':videoId')
  @HttpCode(HttpStatus.OK)
  remove(@CurrentOrg() org: ActiveOrg, @Param('videoId') videoId: string) {
    return this.videos.remove(org.id, videoId);
  }
}
