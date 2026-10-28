/**
 * The Design Studio routes.
 *
 * `@Roles(ADMIN, USER)` on the class: an active membership is required, and
 * every member of a workspace may design, like posting and analysing. The
 * routes that answer without a session (the share page's data and the design
 * fonts) live in `design-shares.controller.ts` and
 * `studio-fonts.controller.ts` instead, because a `@Public()` route inside a
 * class-level `@Roles()` controller reads as a mistake even when it is not.
 *
 * Two routes answer with server-sent events (`export` and `send`) and follow
 * the shape `seo.controller.ts` set: a `prepare` call first, which may throw
 * an ordinary JSON error (404, 409, 422, 503) because no byte has been
 * written, then the stream, in which a failure can only be an `error` event.
 * `@HttpCode(200)` is stated because a `@Post()` would otherwise answer 201,
 * which a stream is not.
 *
 * Answers are wrapped in a named key (`{ design }`, `{ brandKits }`), the
 * way every other module answers. A page of designs is `{ designs, page,
 * pageCount, total }`, like a page of media.
 */
import {
  type ArgumentsHost,
  Body,
  Catch,
  Controller,
  Delete,
  type ExceptionFilter,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  PayloadTooLargeException,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Role } from '@postgear/db';
import type { Request, Response } from 'express';
import { memoryStorage } from 'multer';
import { type ActiveOrg, CurrentOrg } from '../../common/decorators/current-org.decorator';
import {
  type AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodBody, ZodQuery } from '../../common/pipes/zod-validation.pipe';
import { openSseStream } from '../../common/sse';
import { BrandKitsService } from './brand-kits.service';
import { type LogoFile, MAX_LOGO_BYTES } from './brand-logo';
import { sendArchive } from './design-archive';
import { sendPdf } from './design-pdf';
import {
  type BrandKitBody,
  brandKitBodySchema,
  type CreateDesignInput,
  type CreateShareInput,
  createDesignSchema,
  createShareSchema,
  type DownloadQuery,
  type DuplicateDesignInput,
  downloadQuerySchema,
  duplicateDesignSchema,
  type ExportDesignInput,
  type ExtractBrandInput,
  exportDesignSchema,
  extractBrandSchema,
  type FavouriteInput,
  favouriteSchema,
  type ListDesignsQuery,
  listDesignsQuerySchema,
  type SendDesignInput,
  sendDesignSchema,
  type UpdateBrandKitInput,
  type UpdateDesignInput,
  updateBrandKitSchema,
  updateDesignSchema,
} from './dto/studio.schema';
import { STUDIO_MESSAGES } from './studio.messages';
import { type StudioRun, StudioService } from './studio.service';

/**
 * In memory, like avatars: a logo is at most 5 MB and is decoded straight
 * away, so a temp file would only add a write, a read and a cleanup path.
 */
const LOGO_UPLOAD_OPTIONS = {
  storage: memoryStorage(),
  limits: { fileSize: MAX_LOGO_BYTES, files: 1, fields: 0 },
  // Browsers send UTF-8 file names; the library shows this one.
  defParamCharset: 'utf8',
};

/**
 * Multer refuses an oversized logo before the service sees it, with its own
 * "File too large". This answers with the stories' sentence instead, in the
 * global filter's `{ error, statusCode }` shape.
 */
@Catch(PayloadTooLargeException)
class LogoTooLargeFilter implements ExceptionFilter {
  catch(_exception: PayloadTooLargeException, host: ArgumentsHost): void {
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(HttpStatus.PAYLOAD_TOO_LARGE)
      .json({ error: STUDIO_MESSAGES.LOGO_REJECTED, statusCode: HttpStatus.PAYLOAD_TOO_LARGE });
  }
}

@Controller('studio')
@Roles(Role.ADMIN, Role.USER)
export class StudioController {
  constructor(
    private readonly studio: StudioService,
    private readonly brandKits: BrandKitsService,
  ) {}

  /**
   * Whether premium looks are open to this workspace (Sprint 9b), so the
   * gallery and the Design tab can show their locks before anything is
   * chosen. The API enforces the same rule on create and save regardless.
   */
  @Get('access')
  access(@CurrentOrg() org: ActiveOrg) {
    return this.studio.access(org.id);
  }

  // -------------------------------------------------------------------------
  // Designs
  // -------------------------------------------------------------------------

  @Get('designs')
  list(
    @CurrentOrg() org: ActiveOrg,
    @Query(new ZodQuery(listDesignsQuerySchema, 'studio/designs')) query: ListDesignsQuery,
  ) {
    return this.studio.list(org.id, query);
  }

  @Post('designs')
  async create(
    @CurrentOrg() org: ActiveOrg,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodBody(createDesignSchema, 'studio/designs')) dto: CreateDesignInput,
  ) {
    return { design: await this.studio.create(org.id, user.id, dto) };
  }

  @Get('designs/:id')
  async get(@CurrentOrg() org: ActiveOrg, @Param('id') id: string) {
    return { design: await this.studio.get(org.id, id) };
  }

  /** The editor's autosave. Answers the new revision, not the document it just sent. */
  @Patch('designs/:id')
  async update(
    @CurrentOrg() org: ActiveOrg,
    @Param('id') id: string,
    @Body(new ZodBody(updateDesignSchema, 'studio/designs/update')) dto: UpdateDesignInput,
  ) {
    return { design: await this.studio.update(org.id, id, dto) };
  }

  /** Duplicate, or Make A Story Version with `{ format: 'story' }` (Sprint 9b). */
  @Post('designs/:id/duplicate')
  async duplicate(
    @CurrentOrg() org: ActiveOrg,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodBody(duplicateDesignSchema, 'studio/designs/duplicate')) dto: DuplicateDesignInput,
  ) {
    return { design: await this.studio.duplicate(org.id, user.id, id, dto) };
  }

  @Delete('designs/:id')
  async remove(@CurrentOrg() org: ActiveOrg, @Param('id') id: string) {
    await this.studio.remove(org.id, id);
    return { message: STUDIO_MESSAGES.DESIGN_DELETED };
  }

  @Post('designs/:id/export')
  @HttpCode(HttpStatus.OK)
  async export(
    @CurrentOrg() org: ActiveOrg,
    @Param('id') id: string,
    @Body(new ZodBody(exportDesignSchema, 'studio/designs/export')) dto: ExportDesignInput,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    await stream(await this.studio.prepareExport(org.id, id, dto), request, response);
  }

  /**
   * Download All: the last export as one zip, slides in order, or with
   * `?format=pdf` as one PDF, a page per slide (Sprint 9b). Fetched by the
   * export dialog rather than opened as a link, so a refusal ("Export this
   * design first") arrives as a sentence the dialog can show.
   *
   * The PDF is printed before a byte is sent; a browser that goes away while
   * it prints stops the print rather than leaving it to finish for nobody.
   */
  @Get('designs/:id/download')
  async download(
    @CurrentOrg() org: ActiveOrg,
    @Param('id') id: string,
    @Query(new ZodQuery(downloadQuerySchema, 'studio/designs/download')) query: DownloadQuery,
    @Res() response: Response,
  ): Promise<void> {
    if (query.format === 'zip') {
      await sendArchive(await this.studio.prepareArchive(org.id, id), response);
      return;
    }

    const gone = new AbortController();
    // `close` also fires after a response that ended normally; only an
    // unfinished one means the browser left.
    const leave = () => {
      if (!response.writableFinished) gone.abort();
    };
    response.on('close', leave);

    try {
      const pdf = await this.studio.printPdf(org.id, id, gone.signal);
      if (pdf) sendPdf(pdf, response);
    } finally {
      response.off('close', leave);
    }
  }

  @Post('designs/:id/send')
  @HttpCode(HttpStatus.OK)
  async send(
    @CurrentOrg() org: ActiveOrg,
    @Param('id') id: string,
    @Body(new ZodBody(sendDesignSchema, 'studio/designs/send')) dto: SendDesignInput,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    await stream(await this.studio.prepareSend(org.id, id, dto), request, response);
  }

  // -------------------------------------------------------------------------
  // Share links
  // -------------------------------------------------------------------------

  @Get('designs/:id/shares')
  async listShares(@CurrentOrg() org: ActiveOrg, @Param('id') id: string) {
    return { shares: await this.brandKits.listShares(org.id, id) };
  }

  @Post('designs/:id/shares')
  async createShare(
    @CurrentOrg() org: ActiveOrg,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodBody(createShareSchema, 'studio/designs/shares')) dto: CreateShareInput,
  ) {
    return { share: await this.brandKits.createShare(org.id, id, user.id, dto.expiresInDays) };
  }

  @Delete('designs/:id/shares/:shareId')
  async revokeShare(
    @CurrentOrg() org: ActiveOrg,
    @Param('id') id: string,
    @Param('shareId') shareId: string,
  ) {
    await this.brandKits.revokeShare(org.id, id, shareId);
    return { message: STUDIO_MESSAGES.SHARE_REVOKED };
  }

  // -------------------------------------------------------------------------
  // Brand kits
  // -------------------------------------------------------------------------

  @Get('brand-kits')
  async listKits(@CurrentOrg() org: ActiveOrg) {
    return { brandKits: await this.brandKits.list(org.id) };
  }

  @Post('brand-kits')
  async createKit(
    @CurrentOrg() org: ActiveOrg,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodBody(brandKitBodySchema, 'studio/brand-kits')) dto: BrandKitBody,
  ) {
    return { brandKit: await this.brandKits.create(org.id, user.id, dto) };
  }

  /**
   * Puts a logo in the media library and answers `{ media }`; the kit form
   * then saves its id. A file from disk and a candidate the extraction review
   * screen found both arrive here, so both meet the same checks.
   */
  @Post('brand-kits/logo')
  @UseFilters(LogoTooLargeFilter)
  @UseInterceptors(FileInterceptor('file', LOGO_UPLOAD_OPTIONS))
  uploadLogo(@CurrentOrg() org: ActiveOrg, @UploadedFile() file: LogoFile | undefined) {
    return this.brandKits.uploadLogo(org.id, file);
  }

  /**
   * Reads a website and answers with candidates. Saves nothing, ever.
   *
   * A `@Post()` rather than a `@Get()` because it is a side-effecting
   * outbound request with a body, and because a URL in a query string would
   * end up in access logs.
   */
  @Post('brand-kits/extract')
  @HttpCode(HttpStatus.OK)
  async extract(
    @CurrentOrg() org: ActiveOrg,
    @Body(new ZodBody(extractBrandSchema, 'studio/brand-kits/extract')) dto: ExtractBrandInput,
  ) {
    return { extraction: await this.brandKits.extract(org.id, dto.url) };
  }

  @Get('brand-kits/:id')
  async getKit(@CurrentOrg() org: ActiveOrg, @Param('id') id: string) {
    return { brandKit: await this.brandKits.get(org.id, id) };
  }

  @Patch('brand-kits/:id')
  async updateKit(
    @CurrentOrg() org: ActiveOrg,
    @Param('id') id: string,
    @Body(new ZodBody(updateBrandKitSchema, 'studio/brand-kits/update')) dto: UpdateBrandKitInput,
  ) {
    return { brandKit: await this.brandKits.update(org.id, id, dto) };
  }

  /** Duplicate on a kit card (Sprint 9b): everything but the id, named "Name (Copy)". */
  @Post('brand-kits/:id/duplicate')
  async duplicateKit(
    @CurrentOrg() org: ActiveOrg,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return { brandKit: await this.brandKits.duplicate(org.id, user.id, id) };
  }

  @Delete('brand-kits/:id')
  async removeKit(@CurrentOrg() org: ActiveOrg, @Param('id') id: string) {
    await this.brandKits.remove(org.id, id);
    return { message: STUDIO_MESSAGES.BRAND_KIT_DELETED };
  }

  // -------------------------------------------------------------------------
  // Favourite templates
  // -------------------------------------------------------------------------

  @Get('favourites')
  favourites(@CurrentOrg() org: ActiveOrg) {
    return this.studio.favourites(org.id);
  }

  @Post('favourites')
  @HttpCode(HttpStatus.OK)
  addFavourite(
    @CurrentOrg() org: ActiveOrg,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodBody(favouriteSchema, 'studio/favourites')) dto: FavouriteInput,
  ) {
    return this.studio.addFavourite(org.id, user.id, dto.presetId);
  }

  @Delete('favourites/:presetId')
  removeFavourite(@CurrentOrg() org: ActiveOrg, @Param('presetId') presetId: string) {
    return this.studio.removeFavourite(org.id, presetId);
  }
}

/** Opens the event stream only once `prepare` has passed, and always closes it. */
async function stream(run: StudioRun, request: Request, response: Response): Promise<void> {
  const events = openSseStream(request, response);

  try {
    await run(events);
  } finally {
    events.close();
  }
}
