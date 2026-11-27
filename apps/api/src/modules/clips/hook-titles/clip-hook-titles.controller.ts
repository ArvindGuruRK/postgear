/**
 * Add Hook Title (Sprint 13, Module 09). `@Roles(ADMIN, USER, EDITOR)`, the
 * workspace from the org cookie, Clips in the plan; another workspace's
 * clip is a plain 404.
 *
 * - `POST /clips/:clipId/hook-titles` `{ attempt? }` (0 to 50; Try Again
 *   counts up for new titles): 200 `{ titles: [a, b, c] }`.
 *   Free. 422 `hook_titles_no_words`, 429 `hook_titles_throttled` (ten a
 *   minute per workspace), 502 `hook_titles_failed`, 503 `hook_titles_off`.
 *
 * Nothing is written: the editor adds the chosen title to the document
 * (`addHookTitle`) and saves, one step of its undo history. Its route is
 * deeper than `/clips/:clipId`, so it sits in `ClipItemModule` beside the
 * captions and faces routes, whose `ClipCaptionsService` it reads the words
 * through.
 */
import { Body, Controller, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { Role } from '@postgear/db';
import { type ActiveOrg, CurrentOrg } from '../../../common/decorators/current-org.decorator';
import {
  type AuthenticatedUser,
  CurrentUser,
} from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { ZodBody } from '../../../common/pipes/zod-validation.pipe';
import { ClipsEnabledGuard } from '../limits/clips-enabled.guard';
import { type HookTitlesBody, hookTitlesBodySchema } from './clip-hook-titles.schema';
import { ClipHookTitlesService } from './clip-hook-titles.service';

@Controller('clips')
@Roles(Role.ADMIN, Role.USER, Role.EDITOR)
@UseGuards(ClipsEnabledGuard)
export class ClipHookTitlesController {
  constructor(private readonly hookTitles: ClipHookTitlesService) {}

  @Post(':clipId/hook-titles')
  @HttpCode(HttpStatus.OK)
  suggest(
    @CurrentOrg() org: ActiveOrg,
    @CurrentUser() user: AuthenticatedUser,
    @Param('clipId') clipId: string,
    @Body(new ZodBody(hookTitlesBodySchema, 'clips/hook-titles')) body: HookTitlesBody,
  ) {
    return this.hookTitles.suggest(org.id, user.id, clipId, body?.attempt ?? 0);
  }
}
