/**
 * The one Studio route that answers without a session.
 *
 * Kept in its own controller rather than as a `@Public()` method on
 * `StudioController`, which carries a class-level `@Roles()`: a public route
 * inside an authenticated controller reads as a mistake even when it is
 * correct, and this way the whole file can be reviewed as "what a stranger
 * with a link can see".
 *
 * What a stranger with a link can see is: the workspace's name, the design's
 * name, its slides, its caption, the pictures it draws and when the link
 * stops working. Not the design's id, not the workspace's, not who made it,
 * not any other design. Expired, revoked, deleted and never-existed all
 * answer with the same 404 and the same sentence, because telling them apart
 * would say whether a design exists at a guessed token.
 */
import { Controller, Get, Header, Param } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { BrandKitsService } from './brand-kits.service';
import { StudioService } from './studio.service';
import type { SharedDesignView } from './studio.types';

@Controller('public/design-shares')
export class DesignSharesController {
  constructor(
    private readonly brandKits: BrandKitsService,
    private readonly studio: StudioService,
  ) {}

  /**
   * `X-Robots-Tag` as well as the page's own `noindex`: the API is a separate
   * origin, and a crawler that finds this JSON should not index it either.
   * `no-store` so an edit, a revocation or an expiry shows on the next load.
   */
  @Public()
  @Get(':token')
  @Header('Cache-Control', 'no-store')
  @Header('X-Robots-Tag', 'noindex, nofollow, noarchive')
  @Header('Referrer-Policy', 'no-referrer')
  async get(@Param('token') token: string): Promise<SharedDesignView> {
    const share = await this.brandKits.resolveShare(token);
    return this.studio.sharedView(share);
  }
}
