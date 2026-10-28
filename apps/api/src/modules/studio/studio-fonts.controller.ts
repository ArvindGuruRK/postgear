/**
 * The design fonts, for the editor and the public share page.
 *
 * Public because the share page has no session, and harmless because the
 * route can only ever answer with one of the files the design engine ships:
 * `file` is matched against the engine's own table before anything is
 * opened, so there is no path to traverse and nothing else to reach.
 *
 * Cached for a week rather than for ever: the file names are not content
 * hashes, so a font updated in a release has to reach browsers that cached
 * the old one. Express adds an ETag, so revalidating after the week is a 304.
 * `Cross-Origin-Resource-Policy: cross-origin` replaces helmet's
 * `same-origin`, which would stop the web app, another origin, using them;
 * CORS for that origin is already allowed globally.
 */
import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { isKnownFontFile, readFontFile } from './studio.fonts';
import { STUDIO_MESSAGES } from './studio.messages';

const FONT_CACHE = 'public, max-age=604800, stale-while-revalidate=86400';

@Controller('public/studio-fonts')
export class StudioFontsController {
  @Public()
  @Get(':file')
  async font(@Param('file') file: string, @Res() response: Response): Promise<void> {
    if (!isKnownFontFile(file)) throw new NotFoundException(STUDIO_MESSAGES.FONT_NOT_FOUND);

    // A known name whose file is missing is a broken deployment: it throws,
    // and the global filter logs it as the 500 it is.
    const bytes = await readFontFile(file);

    response.setHeader('Content-Type', 'font/woff2');
    response.setHeader('Cache-Control', FONT_CACHE);
    response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    response.send(bytes);
  }
}
