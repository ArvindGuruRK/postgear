/**
 * Find Clips (Sprint 12, Module 16).
 *
 * `@Roles(ADMIN, USER, EDITOR)`: any member who can open a video can look for clips
 * in it (and pays from the workspace's AI minutes). Scoped on
 * `@CurrentOrg()`: another workspace's video is a plain 404.
 *
 * Sprint 13, Module 05: `{ setup }` (Clip Setup) makes the run listen and
 * read too; no body is Sprint 12's one-press run (Quick Find).
 * `POST /clips/videos/:videoId/setup/price` `{ setup }`: the price lines in
 * AI minutes and what is left; never a charge. Editors are added with the
 * role itself in Module 14.
 *
 * - `POST /clips/videos/:videoId/highlights`: 202 `{ run, job, meter }`;
 *   409 `video_not_ready` or `highlights_running`; 402
 *   `clips_ai_minutes_used` with the numbers.
 * - `GET /clips/videos/:videoId/highlights`: `{ price, noSound, run, job }`,
 *   the latest run (also inside `GET /clips/videos/:videoId`).
 *
 * A run is cancelled with the job's own `POST /clips/jobs/:jobId/cancel`.
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
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
import { ClipStart } from '../limits/clips-create.guard';
import { ClipsEnabledGuard } from '../limits/clips-enabled.guard';
import {
  type SetupPriceInput,
  type StartHighlightsInput,
  setupPriceSchema,
  startHighlightsSchema,
} from './clip-highlights.schema';
import { ClipHighlightsService } from './clip-highlights.service';

@Controller('clips/videos')
@Roles(Role.ADMIN, Role.USER, Role.EDITOR)
// Module 19: `clips.enabled` on every route, through the resolver.
@UseGuards(ClipsEnabledGuard)
export class ClipHighlightsController {
  constructor(private readonly highlights: ClipHighlightsService) {}

  @Post(':videoId/highlights')
  @ClipStart()
  @HttpCode(HttpStatus.ACCEPTED)
  start(
    @CurrentOrg() org: ActiveOrg,
    @CurrentUser() user: AuthenticatedUser,
    @Param('videoId') videoId: string,
    @Body(new ZodBody(startHighlightsSchema, 'clips/highlights/start')) body: StartHighlightsInput,
  ) {
    return this.highlights.start(org.id, user.id, videoId, body?.setup);
  }

  @Post(':videoId/setup/price')
  @HttpCode(HttpStatus.OK)
  price(
    @CurrentOrg() org: ActiveOrg,
    @Param('videoId') videoId: string,
    @Body(new ZodBody(setupPriceSchema, 'clips/setup/price')) body: SetupPriceInput,
  ) {
    return this.highlights.price(org.id, videoId, body.setup);
  }

  @Get(':videoId/highlights')
  latest(@CurrentOrg() org: ActiveOrg, @Param('videoId') videoId: string) {
    return this.highlights.latest(org.id, videoId);
  }
}
