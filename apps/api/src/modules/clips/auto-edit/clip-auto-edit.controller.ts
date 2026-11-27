/**
 * Auto-Edit Video (Sprint 13, Module 10).
 *
 * `@Roles(ADMIN, USER)`: any member who can open a video can auto-edit it
 * (and pays from the workspace's AI minutes). Scoped on `@CurrentOrg()`:
 * another workspace's video or recipe is a plain 404.
 *
 * - `POST /clips/videos/:videoId/auto-edit/price` `{ recipeId?, range? }`:
 *   200 `{ aiMinutes, range, needsRange, remaining, limit, cycleEnd }`; never a charge.
 * - `POST /clips/videos/:videoId/auto-edit` `{ recipeId?, range? }`: 202
 *   `{ clipId, job, aiMinutes, skipped: [], noSpeech: false }` when it must
 *   listen first (an AUTO_EDIT job: `listening`, then `applying`), 200 with
 *   `job: null` when the clip was made at once. 422 `auto_edit_too_long`,
 *   409 `auto_edit_running` or `video_not_ready`, 404 `recipe_not_found`,
 *   402 `clips_ai_minutes_used`.
 *
 * The job is cancelled with its own `POST /clips/jobs/:jobId/cancel`, which
 * cancels the listening it started too.
 */
import { Body, Controller, HttpStatus, Param, Post, Res, UseGuards } from '@nestjs/common';
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
import { type AutoEditBody, autoEditSchema } from './clip-auto-edit.schema';
import { ClipAutoEditService } from './clip-auto-edit.service';

@Controller('clips/videos')
@Roles(Role.ADMIN, Role.USER)
@UseGuards(ClipsEnabledGuard)
export class ClipAutoEditController {
  constructor(private readonly autoEdit: ClipAutoEditService) {}

  @Post(':videoId/auto-edit/price')
  price(
    @CurrentOrg() org: ActiveOrg,
    @Param('videoId') videoId: string,
    @Body(new ZodBody(autoEditSchema, 'clips/auto-edit/price')) body: AutoEditBody,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.status(HttpStatus.OK);
    return this.autoEdit.price(org.id, videoId, body);
  }

  @Post(':videoId/auto-edit')
  @ClipStart()
  async start(
    @CurrentOrg() org: ActiveOrg,
    @CurrentUser() user: AuthenticatedUser,
    @Param('videoId') videoId: string,
    @Body(new ZodBody(autoEditSchema, 'clips/auto-edit/start')) body: AutoEditBody,
    @Res({ passthrough: true }) response: Response,
  ) {
    const outcome = await this.autoEdit.start(org.id, user.id, videoId, body);
    // 202 while a job listens first, 200 when the clip was made at once.
    response.status(outcome.job ? HttpStatus.ACCEPTED : HttpStatus.OK);
    return outcome;
  }
}
