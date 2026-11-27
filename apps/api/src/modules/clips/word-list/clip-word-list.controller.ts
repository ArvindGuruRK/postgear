/**
 * The workspace's own bleep words (Sprint 13, Module 09). `@Roles(ADMIN,
 * USER)`, the workspace from the org cookie, Clips in the plan.
 *
 * - `GET /clips/word-list`: `{ words }` (empty until saved).
 * - `PUT /clips/word-list` `{ words: string[] }`: 200 `{ words }`, trimmed,
 *   lower-cased and without repeats. 422 `word_list_word_too_long` (over 40
 *   characters), `word_list_one_word` (a space inside) or `word_list_full`
 *   (over 200 words), each with a sentence naming the limit.
 *
 * `/clips/word-list` is a word route: its module must be imported before
 * `ClipItemModule`, or `GET /clips/:clipId` would answer it.
 */
import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { Role } from '@postgear/db';
import { type ActiveOrg, CurrentOrg } from '../../../common/decorators/current-org.decorator';
import {
  type AuthenticatedUser,
  CurrentUser,
} from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { ZodBody } from '../../../common/pipes/zod-validation.pipe';
import { ClipsEnabledGuard } from '../limits/clips-enabled.guard';
import { type PutWordListInput, putWordListSchema } from './clip-word-list.schema';
import { ClipWordListService } from './clip-word-list.service';

@Controller('clips/word-list')
@Roles(Role.ADMIN, Role.USER, Role.EDITOR)
@UseGuards(ClipsEnabledGuard)
export class ClipWordListController {
  constructor(private readonly wordList: ClipWordListService) {}

  @Get()
  read(@CurrentOrg() org: ActiveOrg) {
    return this.wordList.read(org.id);
  }

  @Put()
  replace(
    @CurrentOrg() org: ActiveOrg,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodBody(putWordListSchema, 'clips/word-list/put')) body: PutWordListInput,
  ) {
    return this.wordList.replace(org.id, user.id, body.words);
  }
}
