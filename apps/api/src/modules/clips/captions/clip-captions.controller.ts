/**
 * A clip's captions (Sprint 13, Module 03). `@Roles(ADMIN, USER, EDITOR)`, scoped on
 * `@CurrentOrg()`: another workspace's clip is a plain 404.
 *
 * - `POST /clips/:clipId/captions` `{ styleId?, language? }`: 202
 *   `{ covered: false, job, price, ranges, meter }` while the clip's part of
 *   the video is listened to; 200 `{ covered: true, track, transcript }` once
 *   it has been. 402 `clips_ai_minutes_used`, 404 `caption_style_not_found`,
 *   409 `video_not_ready`, 422 `no_speech` or `language_unsupported`,
 *   503 `captions_off`.
 * - `POST /clips/:clipId/captions/from-file` (multipart `file`, SRT or VTT,
 *   and optional `language`, `styleId`): 201 `{ track, transcript, skipped,
 *   note }`. Free. 413 `captions_file_too_big`, 422
 *   `captions_file_unreadable` or `captions_file_outside`.
 * - `GET /clips/:clipId/words?source=captions|spoken`: `{ transcript, ranges,
 *   missing, price }`. `spoken` (Module 04) always answers the video's own
 *   listened words, never a file or a translation.
 * - `POST /clips/:clipId/captions/translate` `{ language }`: 201
 *   `{ track, transcript, price, reused, meter? }`. 402, 409 `captions_first`
 *   or `captions_missing`, 422 `translate_same_language`, 502
 *   `translate_failed` (the minutes are given back), 503 `translate_off`.
 *
 * None of these writes the clip document: the editor adds the answered
 * `track` itself and saves, so the change is one step of its undo history.
 */
import {
  type ArgumentsHost,
  Body,
  Catch,
  Controller,
  type ExceptionFilter,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  PayloadTooLargeException,
  Post,
  Query,
  Res,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Role } from '@postgear/db';
import { clipErrorMessage, SUBTITLE_FILE_MAX_BYTES } from '@postgear/video-engine';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
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
  type AddCaptionsInput,
  addCaptionsSchema,
  type CaptionsFileFields,
  type ClipWordsQuery,
  captionsFileFieldsSchema,
  clipWordsQuerySchema,
  type TranslateCaptionsInput,
  translateCaptionsSchema,
} from './clip-captions.schema';
import { type CaptionsFile, ClipCaptionsService } from './clip-captions.service';

const UPLOAD_OPTIONS = {
  // Held in memory: at most 2 MB of text, read once and never kept as it came.
  storage: memoryStorage(),
  limits: { fileSize: SUBTITLE_FILE_MAX_BYTES, files: 1, fields: 2, fieldSize: 100 },
  defParamCharset: 'utf8',
};

/** Multer refuses a larger file with its own words; this answers with our sentence and code. */
@Catch(PayloadTooLargeException)
class CaptionsFileTooBigFilter implements ExceptionFilter {
  catch(_exception: PayloadTooLargeException, host: ArgumentsHost): void {
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(HttpStatus.PAYLOAD_TOO_LARGE)
      .json({
        error: clipErrorMessage('captions_file_too_big'),
        statusCode: HttpStatus.PAYLOAD_TOO_LARGE,
        code: 'captions_file_too_big',
      });
  }
}

@Controller('clips')
@Roles(Role.ADMIN, Role.USER, Role.EDITOR)
@UseGuards(ClipsEnabledGuard)
export class ClipCaptionsController {
  constructor(private readonly captions: ClipCaptionsService) {}

  @Post(':clipId/captions')
  @ClipStart()
  async add(
    @CurrentOrg() org: ActiveOrg,
    @CurrentUser() user: AuthenticatedUser,
    @Param('clipId') clipId: string,
    @Body(new ZodBody(addCaptionsSchema, 'clips/captions/add')) body: AddCaptionsInput,
    @Res({ passthrough: true }) response: Response,
  ) {
    const outcome = await this.captions.add(org.id, user.id, clipId, body);
    response.status(outcome.covered ? HttpStatus.OK : HttpStatus.ACCEPTED);
    return outcome;
  }

  @Post(':clipId/captions/from-file')
  @HttpCode(HttpStatus.CREATED)
  @UseFilters(CaptionsFileTooBigFilter)
  @UseInterceptors(FileInterceptor('file', UPLOAD_OPTIONS))
  fromFile(
    @CurrentOrg() org: ActiveOrg,
    @Param('clipId') clipId: string,
    @UploadedFile() file: CaptionsFile | undefined,
    @Body(new ZodBody(captionsFileFieldsSchema, 'clips/captions/from-file'))
    fields: CaptionsFileFields,
  ) {
    return this.captions.fromFile(org.id, clipId, file, fields);
  }

  @Get(':clipId/words')
  words(
    @CurrentOrg() org: ActiveOrg,
    @Param('clipId') clipId: string,
    @Query(new ZodQuery(clipWordsQuerySchema, 'clips/words')) query: ClipWordsQuery,
  ) {
    return this.captions.words(org.id, clipId, query.source ?? 'captions');
  }

  @Post(':clipId/captions/translate')
  @HttpCode(HttpStatus.CREATED)
  @ClipStart()
  translate(
    @CurrentOrg() org: ActiveOrg,
    @CurrentUser() user: AuthenticatedUser,
    @Param('clipId') clipId: string,
    @Body(new ZodBody(translateCaptionsSchema, 'clips/captions/translate'))
    body: TranslateCaptionsInput,
  ) {
    return this.captions.translate(org.id, user.id, clipId, body);
  }
}
