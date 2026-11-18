/**
 * Videos and uploads (Sprint 12, Module 04).
 *
 * `@Roles(ADMIN, USER)`: any member of the workspace imports, watches and
 * removes videos. Every handler scopes on `@CurrentOrg()`; ids from the URL
 * are checked against the workspace in the service (another workspace's
 * video is a plain 404). Bodies are validated with `.strict()` Zod schemas.
 *
 * - `POST /clips/videos`: 201 `{ video, job, existing: false }`, or 200
 *   `{ video, job: null, existing: true }` when the workspace already has it.
 * - `GET /clips/videos?cursor&sort`: `{ videos, nextCursor, total }`.
 * - `GET /clips/videos/:videoId`: the video, signed addresses, job, clips.
 * - `POST /clips/videos/:videoId/retry` and `/cancel`, `DELETE /clips/videos/:videoId`.
 * - `POST /clips/videos/uploads`, `.../uploads/:uploadId/parts`, `.../uploads/:uploadId/complete`.
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
import { ClipUploadsService } from './clip-uploads.service';
import {
  type CompleteUploadInput,
  completeUploadSchema,
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
export class ClipVideosController {
  constructor(
    private readonly videos: ClipVideosService,
    private readonly uploads: ClipUploadsService,
  ) {}

  @Post()
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

  // --- One video ------------------------------------------------------------------

  @Get(':videoId')
  get(@CurrentOrg() org: ActiveOrg, @Param('videoId') videoId: string) {
    return this.videos.get(org.id, videoId);
  }

  @Post(':videoId/retry')
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

  @Delete(':videoId')
  @HttpCode(HttpStatus.OK)
  remove(@CurrentOrg() org: ActiveOrg, @Param('videoId') videoId: string) {
    return this.videos.remove(org.id, videoId);
  }
}
