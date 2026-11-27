/**
 * Downloads (Sprint 12, Module 18). Inside the signed-in app only: there is
 * no public downloader route or page, and none may be added (research 07,
 * "What We Never Do").
 *
 * `@Roles(ADMIN, USER, EDITOR)`: any member of the workspace downloads. Every
 * handler scopes on `@CurrentOrg()`; a job id from the URL is checked
 * against the workspace and the kind in the service, so another
 * workspace's download, or a job of another kind, is a plain 404.
 *
 * - `POST /clips/downloads` `{ url, formatId, rightsConfirmed }`: 202
 *   `{ job, download, existing: false }`, or 200 with `existing: true` when
 *   the same file is already being prepared or ready.
 * - `GET /clips/downloads`: `{ downloads }`, the last two days, newest first.
 * - `GET /clips/downloads/:jobId/file`: `{ url }`, a five minute signed
 *   address named after the video (409 not ready, 410 expired, 404
 *   otherwise). JSON rather than a redirect, so a refusal reaches the row as
 *   its sentence; the page then sends the browser to the address, which
 *   saves the file itself.
 * - `POST /clips/downloads/:jobId/save-to-media`: 202 `{ download }`.
 * - `DELETE /clips/downloads/:jobId`: `{ message }`.
 * - `POST /clips/videos/:videoId/download-original` lives on the videos
 *   controller, beside the video's other actions.
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
import { ZodBody } from '../../../common/pipes/zod-validation.pipe';
import { ClipStart } from '../limits/clips-create.guard';
import { ClipsEnabledGuard } from '../limits/clips-enabled.guard';
import { type StartDownloadInput, startDownloadSchema } from './clip-downloads.schema';
import { ClipDownloadsService } from './clip-downloads.service';

@Controller('clips/downloads')
@Roles(Role.ADMIN, Role.USER, Role.EDITOR)
// Module 19: `clips.enabled` on every route, through the resolver.
@UseGuards(ClipsEnabledGuard)
export class ClipDownloadsController {
  constructor(private readonly downloads: ClipDownloadsService) {}

  @Post()
  @ClipStart()
  async start(
    @CurrentOrg() org: ActiveOrg,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodBody(startDownloadSchema, 'clips/downloads/start')) body: StartDownloadInput,
    @Res({ passthrough: true }) response: Response,
  ) {
    const outcome = await this.downloads.start(org.id, user.id, body);
    response.status(outcome.existing ? HttpStatus.OK : HttpStatus.ACCEPTED);
    return outcome;
  }

  @Get()
  list(@CurrentOrg() org: ActiveOrg) {
    return this.downloads.list(org.id);
  }

  @Get(':jobId/file')
  async file(
    @CurrentOrg() org: ActiveOrg,
    @Param('jobId') jobId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ url: string }> {
    const url = await this.downloads.fileUrl(org.id, jobId);
    // The address is short-lived and personal: never cached on the way.
    response.setHeader('Cache-Control', 'no-store');
    return { url };
  }

  @Post(':jobId/save-to-media')
  @ClipStart()
  @HttpCode(HttpStatus.ACCEPTED)
  saveToMedia(@CurrentOrg() org: ActiveOrg, @Param('jobId') jobId: string) {
    return this.downloads.saveToMedia(org.id, jobId);
  }

  @Delete(':jobId')
  @HttpCode(HttpStatus.OK)
  remove(@CurrentOrg() org: ActiveOrg, @Param('jobId') jobId: string) {
    return this.downloads.remove(org.id, jobId);
  }
}
