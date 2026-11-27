/**
 * Text To Speech (Sprint 13, Module 09), behind `CLIPS_TTS`.
 * `@Roles(ADMIN, USER)` (Editors are Module 14's decision), scoped on
 * `@CurrentOrg()`: another workspace's clip is a plain 404.
 *
 * - `GET /clips/voices`: `{ enabled, voices: [{ id, name, languages, sampleUrl }] }`.
 *   A word route: `ClipItemModule` registers this controller before
 *   `GET /clips/:clipId` (`clips-routes.spec.ts` holds it).
 * - `POST /clips/:clipId/voice` `{ text, voiceId, revision }`: 202
 *   `{ job, price, reused, meter }`. 503 `voice_off`, 422 `voice_unknown` or `voice_language`,
 *   402 `clips_ai_minutes_used`. The same line and voice again answers the
 *   same job with no second charge.
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
import { type MakeVoiceInput, makeVoiceSchema } from './clip-voice.schema';
import { ClipVoiceService } from './clip-voice.service';

@Controller('clips')
@Roles(Role.ADMIN, Role.USER)
@UseGuards(ClipsEnabledGuard)
export class ClipVoiceController {
  constructor(private readonly voice: ClipVoiceService) {}

  @Get('voices')
  voices() {
    return this.voice.voices();
  }

  @Post(':clipId/voice')
  @HttpCode(HttpStatus.ACCEPTED)
  @ClipStart()
  make(
    @CurrentOrg() org: ActiveOrg,
    @CurrentUser() user: AuthenticatedUser,
    @Param('clipId') clipId: string,
    @Body(new ZodBody(makeVoiceSchema, 'clips/voice')) body: MakeVoiceInput,
  ) {
    return this.voice.make(org.id, user.id, clipId, body);
  }
}
