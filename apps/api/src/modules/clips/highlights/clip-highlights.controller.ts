/**
 * Find Clips (Sprint 12, Module 16).
 *
 * `@Roles(ADMIN, USER)`: any member who can open a video can look for clips
 * in it (and pays from the workspace's AI minutes). Scoped on
 * `@CurrentOrg()`: another workspace's video is a plain 404. No body.
 *
 * - `POST /clips/videos/:videoId/highlights`: 202 `{ run, job, meter }`;
 *   409 `video_not_ready` or `highlights_running`; 402
 *   `clips_ai_minutes_used` with the numbers.
 * - `GET /clips/videos/:videoId/highlights`: `{ price, noSound, run, job }`,
 *   the latest run (also inside `GET /clips/videos/:videoId`).
 *
 * A run is cancelled with the job's own `POST /clips/jobs/:jobId/cancel`.
 */
import { Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { Role } from '@postgear/db';
import { type ActiveOrg, CurrentOrg } from '../../../common/decorators/current-org.decorator';
import {
  type AuthenticatedUser,
  CurrentUser,
} from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { ClipHighlightsService } from './clip-highlights.service';

@Controller('clips/videos')
@Roles(Role.ADMIN, Role.USER)
export class ClipHighlightsController {
  constructor(private readonly highlights: ClipHighlightsService) {}

  @Post(':videoId/highlights')
  @HttpCode(HttpStatus.ACCEPTED)
  start(
    @CurrentOrg() org: ActiveOrg,
    @CurrentUser() user: AuthenticatedUser,
    @Param('videoId') videoId: string,
  ) {
    return this.highlights.start(org.id, user.id, videoId);
  }

  @Get(':videoId/highlights')
  latest(@CurrentOrg() org: ActiveOrg, @Param('videoId') videoId: string) {
    return this.highlights.latest(org.id, videoId);
  }
}
