/**
 * The media library API.
 *
 * ## Membership, not admin
 *
 * `@Roles(ADMIN, USER)` at the class level makes an active membership mandatory
 * for every route — without it, a route resolves the workspace only
 * opportunistically — while leaving content work open to every member. Writing
 * posts and managing their images is what a `USER` is for; channel management
 * is where Sprint 3 drew the admin line, and that line stays there.
 *
 * ## The upload never reaches memory
 *
 * Multer streams to a temp file on disk, capped at the largest video accepted.
 * Holding a 250 MB video in a Buffer per concurrent upload is how an API falls
 * over under a handful of users. Guards run before interceptors in Nest, so an
 * unauthenticated request is refused before a single byte is written.
 */
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Role } from '@postgear/db';
import { diskStorage } from 'multer';
import { type ActiveOrg, CurrentOrg } from '../../common/decorators/current-org.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodQuery } from '../../common/pipes/zod-validation.pipe';
import { type ListMediaQuery, listMediaQuerySchema } from './dto/media.schema';
import { MAX_VIDEO_UPLOAD_BYTES, MEDIA_MESSAGES } from './media.messages';
import { MediaService, type UploadedFileInput } from './media.service';

const UPLOAD_OPTIONS = {
  storage: diskStorage({
    destination: join(tmpdir(), 'postgear-uploads'),
    // The temp name is random too — the original name is only ever display text.
    filename: (_request, _file, callback) => callback(null, randomBytes(16).toString('hex')),
  }),
  limits: {
    fileSize: MAX_VIDEO_UPLOAD_BYTES,
    files: 1,
    fields: 0,
    // No `parts` limit, deliberately. Busboy signals that limit when the count
    // *reaches* it rather than exceeds it, and Multer treats the signal as an
    // error — so `parts: 1` rejects the one file it was meant to allow. One
    // file and zero fields already bound the request.
  },
  // Browsers send UTF-8 filenames. Multer's Latin-1 default turns "café.jpg"
  // into "cafÃ©.jpg" in the library.
  defParamCharset: 'utf8',
};

@Controller('media')
@Roles(Role.ADMIN, Role.USER)
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('file', UPLOAD_OPTIONS))
  async upload(@CurrentOrg() org: ActiveOrg, @UploadedFile() file: UploadedFileInput | undefined) {
    return this.media.upload(org.id, file);
  }

  @Get()
  async list(
    @CurrentOrg() org: ActiveOrg,
    @Query(new ZodQuery(listMediaQuerySchema, 'media/list')) query: ListMediaQuery,
  ) {
    return this.media.list(org.id, query);
  }

  @Get(':id')
  async get(@CurrentOrg() org: ActiveOrg, @Param('id') id: string) {
    return { media: await this.media.get(org.id, id) };
  }

  /** What deleting would affect, so the confirmation can say it. */
  @Get(':id/usage')
  async usage(@CurrentOrg() org: ActiveOrg, @Param('id') id: string) {
    return this.media.usage(org.id, id);
  }

  @Delete(':id')
  async remove(@CurrentOrg() org: ActiveOrg, @Param('id') id: string) {
    await this.media.remove(org.id, id);
    return { message: MEDIA_MESSAGES.DELETED };
  }
}
