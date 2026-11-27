/**
 * Emote Maker (Sprint 13, Module 14). Inside the signed-in app only.
 *
 * `@Roles(ADMIN, USER, EDITOR)`: any member of the workspace, an editor seat
 * included, makes emotes. Every handler scopes on `@CurrentOrg()`; a job id
 * from the URL is checked against the workspace and the kind in the
 * service, so another workspace's emote, or a job of another kind, is a
 * plain 404.
 *
 * - `POST /clips/emotes/export` `{ videoId, platform, startMs, endMs, crop,
 *   key, flip, still, stillAtMs? }`: 200 `{ job, emote, finished: true }`
 *   when the job finished within 25 seconds (done, or failed with its
 *   sentence), else 202 `{ job, emote: null, finished: false }`. 422
 *   `emote_too_long` or `emote_range_invalid` before any charge; the typed
 *   402 past the day's downloads.
 * - `GET /clips/emotes/:jobId`: `{ job, emote }`, each kept file with a five
 *   minute signed address (none once the 24 hours are over).
 */
import { Body, Controller, Get, HttpStatus, Param, Post, Res, UseGuards } from '@nestjs/common';
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
import { type EmoteExportBody, emoteExportSchema } from './clip-emotes.schema';
import { ClipEmotesService } from './clip-emotes.service';

@Controller('clips/emotes')
@Roles(Role.ADMIN, Role.USER, Role.EDITOR)
// `clips.enabled` on every route, through the resolver.
@UseGuards(ClipsEnabledGuard)
export class ClipEmotesController {
  constructor(private readonly emotes: ClipEmotesService) {}

  @Post('export')
  @ClipStart()
  async export(
    @CurrentOrg() org: ActiveOrg,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodBody(emoteExportSchema, 'clips/emotes/export')) body: EmoteExportBody,
    @Res({ passthrough: true }) response: Response,
  ) {
    const outcome = await this.emotes.export(org.id, user.id, body);
    response.status(outcome.finished ? HttpStatus.OK : HttpStatus.ACCEPTED);
    // The answer can carry signed addresses: never cached on the way.
    response.setHeader('Cache-Control', 'no-store');
    return outcome;
  }

  @Get(':jobId')
  async get(
    @CurrentOrg() org: ActiveOrg,
    @Param('jobId') jobId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const view = await this.emotes.get(org.id, jobId);
    response.setHeader('Cache-Control', 'no-store');
    return view;
  }
}
