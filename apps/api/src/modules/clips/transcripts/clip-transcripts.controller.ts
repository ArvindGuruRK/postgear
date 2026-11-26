/**
 * Transcripts (Sprint 13, Module 02).
 *
 * `@Roles(ADMIN, USER)`: any member who can open a video can have it listened
 * to (it spends the workspace's AI minutes), read its words and fix them.
 * Editors are added with the Editor role in Module 14 (they caption clips, so
 * these routes are theirs too). Scoped on `@CurrentOrg()`: another
 * workspace's video is a plain 404.
 *
 * - `POST /clips/videos/:videoId/transcript` `{ fromMs?, toMs?, language? }`:
 *   202 `{ covered: false, job, price, ranges, meter }` when listening
 *   started (or `joined: true` with the job already listening to it);
 *   200 `{ covered: true }` when every moment was listened to already.
 *   402 `clips_ai_minutes_used`, 409 `video_not_ready` or `no_speech`,
 *   422 `language_unsupported`, 503 `captions_off`.
 * - `POST /clips/videos/:videoId/transcript/quote`: the price, never a charge.
 * - `GET /clips/videos/:videoId/transcript?fromMs&toMs&language`:
 *   `{ transcript, complete, price }`, fixes applied.
 * - `PATCH /clips/videos/:videoId/transcript/words`: fixes, Replace
 *   Everywhere or taking fixes away; `{ changed, fixes }`.
 */
import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  Patch,
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
import { ClipStart } from '../limits/clips-create.guard';
import { ClipsEnabledGuard } from '../limits/clips-enabled.guard';
import {
  type EnsureTranscriptInput,
  ensureTranscriptSchema,
  type FixWordsInput,
  fixWordsSchema,
  type ReadTranscriptQuery,
  readTranscriptQuerySchema,
} from './clip-transcripts.schema';
import { ClipTranscriptsService } from './clip-transcripts.service';

@Controller('clips/videos')
@Roles(Role.ADMIN, Role.USER)
@UseGuards(ClipsEnabledGuard)
export class ClipTranscriptsController {
  constructor(private readonly transcripts: ClipTranscriptsService) {}

  @Post(':videoId/transcript')
  @ClipStart()
  async ensure(
    @CurrentOrg() org: ActiveOrg,
    @CurrentUser() user: AuthenticatedUser,
    @Param('videoId') videoId: string,
    @Body(new ZodBody(ensureTranscriptSchema, 'clips/transcript/ensure'))
    body: EnsureTranscriptInput,
    @Res({ passthrough: true }) response: Response,
  ) {
    const outcome = await this.transcripts.ensure(org.id, user.id, videoId, body);
    // 200 when nothing had to start, 202 when a job is (or already was) listening.
    response.status(outcome.covered ? HttpStatus.OK : HttpStatus.ACCEPTED);
    return outcome;
  }

  @Post(':videoId/transcript/quote')
  quote(
    @CurrentOrg() org: ActiveOrg,
    @Param('videoId') videoId: string,
    @Body(new ZodBody(ensureTranscriptSchema, 'clips/transcript/quote'))
    body: EnsureTranscriptInput,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.status(HttpStatus.OK);
    return this.transcripts.quote(org.id, videoId, body);
  }

  @Get(':videoId/transcript')
  read(
    @CurrentOrg() org: ActiveOrg,
    @Param('videoId') videoId: string,
    @Query(new ZodQuery(readTranscriptQuerySchema, 'clips/transcript/read'))
    query: ReadTranscriptQuery,
  ) {
    return this.transcripts.read(org.id, videoId, query);
  }

  @Patch(':videoId/transcript/words')
  fix(
    @CurrentOrg() org: ActiveOrg,
    @Param('videoId') videoId: string,
    @Body(new ZodBody(fixWordsSchema, 'clips/transcript/words')) body: FixWordsInput,
  ) {
    return this.transcripts.fix(org.id, videoId, body);
  }
}
