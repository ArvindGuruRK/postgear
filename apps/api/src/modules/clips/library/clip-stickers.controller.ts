/**
 * A workspace's own stickers and the files of the stickers a clip has
 * (Module 12 section 5):
 *
 * - `POST /clips/stickers/uploads`: one PNG, GIF or WebP, at most 8 MB.
 * - `GET /clips/stickers/uploads`: the Uploaded tab.
 * - `DELETE /clips/stickers/uploads/:assetId`: 409 with the count when a clip uses it.
 * - `GET /clips/stickers/files?library=<ids>&asset=<ids>`: what the editor draws.
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
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Role } from '@postgear/db';
import { clipErrorMessage, STICKER_UPLOAD_MAX_BYTES } from '@postgear/video-engine';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { type ActiveOrg, CurrentOrg } from '../../../common/decorators/current-org.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { ZodQuery } from '../../../common/pipes/zod-validation.pipe';
import { type StickerFilesQuery, stickerFilesQuerySchema } from './clip-library.schemas';
import { ClipStickerUploadsService, type StickerUploadFile } from './clip-sticker-uploads.service';

const UPLOAD_OPTIONS = {
  // Held in memory: at most 8 MB, and the bytes are sniffed before anything is kept.
  storage: memoryStorage(),
  limits: { fileSize: STICKER_UPLOAD_MAX_BYTES, files: 1, fields: 0 },
  defParamCharset: 'utf8',
};

/**
 * Multer refuses a file over 8 MB before the service sees it, with its own
 * "File too large"; this answers with our sentence and code instead.
 */
@Catch(PayloadTooLargeException)
class StickerTooBigFilter implements ExceptionFilter {
  catch(_exception: PayloadTooLargeException, host: ArgumentsHost): void {
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(HttpStatus.PAYLOAD_TOO_LARGE)
      .json({
        error: clipErrorMessage('sticker_upload_too_big'),
        statusCode: HttpStatus.PAYLOAD_TOO_LARGE,
        code: 'sticker_upload_too_big',
      });
  }
}

@Controller('clips/stickers')
@Roles(Role.ADMIN, Role.USER)
export class ClipStickersController {
  constructor(private readonly uploads: ClipStickerUploadsService) {}

  /** 201 `{ sticker }`; 413 `sticker_upload_too_big`; 415 or 422 `sticker_unusable`, `sticker_too_large`. */
  @Post('uploads')
  @HttpCode(HttpStatus.CREATED)
  @UseFilters(StickerTooBigFilter)
  @UseInterceptors(FileInterceptor('file', UPLOAD_OPTIONS))
  upload(@CurrentOrg() org: ActiveOrg, @UploadedFile() file: StickerUploadFile | undefined) {
    return this.uploads.upload(org.id, file);
  }

  /** `{ stickers }`, newest first. */
  @Get('uploads')
  list(@CurrentOrg() org: ActiveOrg) {
    return this.uploads.list(org.id);
  }

  /** `{ message }`; 404 `sticker_not_found`; 409 `sticker_in_use`. */
  @Delete('uploads/:assetId')
  @HttpCode(HttpStatus.OK)
  remove(@CurrentOrg() org: ActiveOrg, @Param('assetId') assetId: string) {
    return this.uploads.remove(org.id, assetId);
  }

  /** `{ files }`, in the order asked, each ready or `missing`. */
  @Get('files')
  files(
    @CurrentOrg() org: ActiveOrg,
    @Query(new ZodQuery(stickerFilesQuerySchema, 'clips/stickers/files')) query: StickerFilesQuery,
  ) {
    return this.uploads.files(org.id, query);
  }
}
