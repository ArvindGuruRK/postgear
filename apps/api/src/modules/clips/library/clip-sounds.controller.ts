/**
 * A workspace's own sounds and the files of the sounds a clip has (Module 14
 * section 4):
 *
 * - `POST /clips/sounds/uploads`: one MP3, WAV, M4A or AAC, at most 20 MB.
 * - `GET /clips/sounds/uploads`: the Uploaded tab.
 * - `DELETE /clips/sounds/uploads/:assetId`: 409 with the count when a clip uses it.
 * - `GET /clips/sounds/files?library=<ids>&asset=<ids>`: what the editor plays.
 *
 * Registered before `ClipItemModule`'s `GET /clips/:clipId` (see `clips.module.ts`).
 */
import {
  type ArgumentsHost,
  Catch,
  Controller,
  Delete,
  type ExceptionFilter,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  PayloadTooLargeException,
  Post,
  Query,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Role } from '@postgear/db';
import { clipErrorMessage, SOUND_UPLOAD_MAX_BYTES } from '@postgear/video-engine';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { type ActiveOrg, CurrentOrg } from '../../../common/decorators/current-org.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { ZodQuery } from '../../../common/pipes/zod-validation.pipe';
import { type SoundFilesQuery, soundFilesQuerySchema } from './clip-library.schemas';
import { ClipSoundUploadsService, type SoundUploadFile } from './clip-sound-uploads.service';
import { ClipsEnabledGuard } from '../limits/clips-enabled.guard';

const UPLOAD_OPTIONS = {
  // Held in memory: at most 20 MB, and the bytes are sniffed before anything is kept.
  storage: memoryStorage(),
  limits: { fileSize: SOUND_UPLOAD_MAX_BYTES, files: 1, fields: 0 },
  defParamCharset: 'utf8',
};

/**
 * Multer refuses a file over 20 MB before the service sees it, with its own
 * "File too large"; this answers with our sentence and code instead.
 */
@Catch(PayloadTooLargeException)
class SoundTooBigFilter implements ExceptionFilter {
  catch(_exception: PayloadTooLargeException, host: ArgumentsHost): void {
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(HttpStatus.PAYLOAD_TOO_LARGE)
      .json({
        error: clipErrorMessage('sound_upload_too_big'),
        statusCode: HttpStatus.PAYLOAD_TOO_LARGE,
        code: 'sound_upload_too_big',
      });
  }
}

@Controller('clips/sounds')
@Roles(Role.ADMIN, Role.USER, Role.EDITOR)
// Module 19: `clips.enabled` on every route, through the resolver.
@UseGuards(ClipsEnabledGuard)
export class ClipSoundsController {
  constructor(private readonly uploads: ClipSoundUploadsService) {}

  /** 201 `{ sound }`; 413 `sound_upload_too_big`; 415 or 422 `sound_unusable`, `sound_too_long`. */
  @Post('uploads')
  @HttpCode(HttpStatus.CREATED)
  @UseFilters(SoundTooBigFilter)
  @UseInterceptors(FileInterceptor('file', UPLOAD_OPTIONS))
  upload(@CurrentOrg() org: ActiveOrg, @UploadedFile() file: SoundUploadFile | undefined) {
    return this.uploads.upload(org.id, file);
  }

  /** `{ sounds }`, newest first. */
  @Get('uploads')
  list(@CurrentOrg() org: ActiveOrg) {
    return this.uploads.list(org.id);
  }

  /** `{ message }`; 404 `sound_not_found`; 409 `sound_in_use`. */
  @Delete('uploads/:assetId')
  @HttpCode(HttpStatus.OK)
  remove(@CurrentOrg() org: ActiveOrg, @Param('assetId') assetId: string) {
    return this.uploads.remove(org.id, assetId);
  }

  /** `{ files }`, in the order asked, each ready or `missing`. */
  @Get('files')
  files(
    @CurrentOrg() org: ActiveOrg,
    @Query(new ZodQuery(soundFilesQuerySchema, 'clips/sounds/files')) query: SoundFilesQuery,
  ) {
    return this.uploads.files(org.id, query);
  }
}
