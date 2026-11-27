/**
 * `/clips/links` (Module 03): the probe and the probe answer's picture.
 *
 * `@Roles(ADMIN, USER, EDITOR)`: any member of the workspace may check a link. The
 * workspace comes from `@CurrentOrg()`, never from the body.
 *
 * - `POST /clips/links/probe` `{ url }`: 200 `{ probe }`. The answer never
 *   holds the platform's picture address: `info.thumbnailUrl` is our signed
 *   `GET /clips/links/thumbnail?u=...` link (or null). Refusals: 400 for a
 *   malformed body, 422 for the link (`link_*`, `platform_paused`), 402 for
 *   the plan (`clips_not_in_plan`, `clips_video_too_long`), 429
 *   `probe_throttled`, 503 `platform_resting` or `tools_offline`, 502
 *   `tool_failed`.
 * - `GET /clips/links/thumbnail?u=<token>`: the picture bytes with the type
 *   we sniffed, `Cache-Control: private, max-age=3600`. 403 for a token that
 *   is not ours or has expired, 404 when the platform dropped it, 502 for
 *   anything else. Authenticated like the rest: an `<img>` on the web app
 *   sends our cookies, since both apps are on the same site.
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Query,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@postgear/db';
import type { Response } from 'express';
import { type ActiveOrg, CurrentOrg } from '../../../common/decorators/current-org.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { ZodBody, ZodQuery } from '../../../common/pipes/zod-validation.pipe';
import {
  type ProbeLinkInput,
  probeLinkSchema,
  type ThumbnailQuery,
  thumbnailQuerySchema,
} from './clip-links.schemas';
import { CLIP_LINK_PROBER, type ClipLinkProber, type ClipProbeResult } from './clip-links.types';
import { ClipThumbnailsService } from './clip-thumbnails.service';
import { ClipsEnabledGuard } from '../limits/clips-enabled.guard';

@Controller('clips/links')
@Roles(Role.ADMIN, Role.USER, Role.EDITOR)
// Module 19: `clips.enabled` on every route, through the resolver.
@UseGuards(ClipsEnabledGuard)
export class ClipLinksController {
  constructor(
    @Inject(CLIP_LINK_PROBER) private readonly prober: ClipLinkProber,
    private readonly thumbnails: ClipThumbnailsService,
  ) {}

  @Post('probe')
  @HttpCode(HttpStatus.OK)
  async probe(
    @CurrentOrg() org: ActiveOrg,
    @Body(new ZodBody(probeLinkSchema, 'clips/links/probe')) body: ProbeLinkInput,
  ) {
    const result = await this.prober.probe(org.id, body.url);
    return { probe: this.view(result) };
  }

  @Get('thumbnail')
  async thumbnail(
    @Query(new ZodQuery(thumbnailQuerySchema, 'clips/links/thumbnail')) query: ThumbnailQuery,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    // The link card shows it with an <img> on the web app, another origin;
    // helmet's default `same-origin` would make the browser refuse it. Set
    // before the fetch so a refusal reaches the page as its real status, not
    // as a blocked response.
    response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', "default-src 'none'");
    const image = await this.thumbnails.fetch(query.u);
    // Only a picture is kept for the hour, never a refusal.
    response.setHeader('Cache-Control', 'private, max-age=3600');
    return new StreamableFile(image.body, { type: image.contentType, length: image.body.length });
  }

  /** The probe answer as the web reads it: the picture through our own link. */
  private view(result: ClipProbeResult) {
    return {
      link: result.link,
      info: { ...result.info, thumbnailUrl: this.thumbnails.linkFor(result.info.thumbnailUrl) },
      existingVideoId: result.existingVideoId,
    };
  }
}
