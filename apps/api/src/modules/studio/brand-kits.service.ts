/**
 * Brand kits, their logos, reading a brand off a website, and share links.
 *
 * Separate from `StudioService` because the two have almost nothing in
 * common: this one owns five colours, a logo and a throttled fetch of a
 * stranger's site; that one owns documents, revisions and exports.
 *
 * ## Extraction never saves anything
 *
 * `extract` returns candidates and stops. The logo the user picks on the
 * review screen is uploaded by the browser through `uploadLogo`, exactly like
 * a logo file chosen from disk, only when they press Save Brand Kit. So
 * leaving the review screen saves nothing, and every logo in the library
 * passed the same checks whichever way it arrived.
 *
 * ## The throttle is per workspace
 *
 * Five extractions a minute, counted in Redis like the API's other limits so
 * it holds across instances. The limit is on the workspace because the cost
 * being protected is outbound requests from PostGear's servers to someone
 * else's, and one person with five tabs is the same load as five people.
 */
import { createHash, randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BrandKitSource } from '@postgear/db';
import {
  type BrandColors,
  brandColorsSchema,
  brandFromTheme,
  DEFAULT_THEME_ID,
  themeById,
} from '@postgear/design-engine';
import {
  assertSafeUrl,
  type BrowserPool,
  isSeoCrawlError,
  normaliseUrl,
  type UrlRejectReason,
} from '@postgear/seo-engine';
import { BROWSER_POOL } from '../../common/browser/browser-pool.module';
import { securityLogger } from '../../common/logging/security-logger';
import type { Env } from '../../config/env';
import { MediaService, type MediaView } from '../media/media.service';
import { RedisService } from '../redis/redis.service';
import {
  defaultExtractDeps,
  type ExtractDeps,
  extractBrand,
  type RenderedPage,
} from './brand-extractor';
import {
  type LogoFile,
  LogoRejectedError,
  type LogoRejection,
  type PreparedLogo,
  prepareLogo,
} from './brand-logo';
import {
  type BrandKitBody,
  DEFAULT_SHARE_DAYS,
  MAX_ACTIVE_SHARES,
  MAX_SHARE_DAYS,
  MIN_SHARE_DAYS,
  type UpdateBrandKitInput,
} from './dto/studio.schema';
import { STUDIO_MESSAGES } from './studio.messages';
import {
  type BrandKitRow,
  type BrandKitWrite,
  type DesignShareRow,
  type SharedDesignRow,
  StudioRepository,
} from './studio.repository';
import type { BrandExtraction, BrandKitView, ShareView } from './studio.types';

/** Extractions one workspace may run in a minute. */
export const EXTRACT_LIMIT_PER_MINUTE = 5;
const EXTRACT_WINDOW_SECONDS = 60;

/** After the page is ready, how long the browser waits for it to settle. */
const RENDER_SETTLE_MS = 1_500;

/** A share token: 256 bits, URL-safe, shown once. */
const SHARE_TOKEN_BYTES = 32;
const SHARE_TOKEN = /^[A-Za-z0-9_-]{16,128}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Alt text for an uploaded logo, until the user writes their own in the library. */
const LOGO_ALT = 'Brand logo';

@Injectable()
export class BrandKitsService {
  private readonly logger = new Logger(BrandKitsService.name);
  private readonly webUrl: string;
  /** Swapped by the specs; production always uses the real, guarded fetchers. */
  extractDeps: ExtractDeps | undefined;

  constructor(
    private readonly repository: StudioRepository,
    private readonly media: MediaService,
    private readonly redis: RedisService,
    @Inject(BROWSER_POOL) private readonly pool: BrowserPool,
    config: ConfigService<Env, true>,
  ) {
    this.webUrl = config.get('WEB_URL', { infer: true }).replace(/\/+$/, '');
  }

  // -------------------------------------------------------------------------
  // Kits
  // -------------------------------------------------------------------------

  async list(orgId: string): Promise<BrandKitView[]> {
    const rows = await this.repository.listBrandKits(orgId);
    const logos = await this.logoViews(orgId, rows);

    return rows.map((row) => this.toView(row, logos));
  }

  async get(orgId: string, id: string): Promise<BrandKitView> {
    const row = await this.require(orgId, id);
    return this.toView(row, await this.logoViews(orgId, [row]));
  }

  async create(orgId: string, userId: string | null, body: BrandKitBody): Promise<BrandKitView> {
    const logoMediaId = await this.verifyLogo(orgId, body.logoMediaId ?? null);
    const websiteUrl = body.websiteUrl ? websiteOrThrow(body.websiteUrl) : null;

    const row = await this.repository.createBrandKit({
      orgId,
      name: body.name,
      description: body.description || null,
      websiteUrl,
      logoMediaId,
      colors: { ...body.colors },
      source: body.source === 'EXTRACTED' ? BrandKitSource.EXTRACTED : BrandKitSource.MANUAL,
      createdById: userId,
    });

    return this.toView(row, await this.logoViews(orgId, [row]));
  }

  async update(orgId: string, id: string, body: UpdateBrandKitInput): Promise<BrandKitView> {
    const data: BrandKitWrite = {};

    if (body.name !== undefined) data.name = body.name;
    if (body.description !== undefined) data.description = body.description || null;
    if (body.websiteUrl !== undefined) {
      data.websiteUrl = body.websiteUrl ? websiteOrThrow(body.websiteUrl) : null;
    }
    if (body.colors !== undefined) data.colors = { ...body.colors };
    if (body.source !== undefined) {
      data.source = body.source === 'EXTRACTED' ? BrandKitSource.EXTRACTED : BrandKitSource.MANUAL;
    }
    if (body.logoMediaId !== undefined) {
      data.logoMediaId = await this.verifyLogo(orgId, body.logoMediaId);
    }

    const saved = await this.repository.updateBrandKit(orgId, id, data);
    if (!saved) throw new NotFoundException(STUDIO_MESSAGES.BRAND_KIT_NOT_FOUND);

    return this.toView(saved, await this.logoViews(orgId, [saved]));
  }

  async remove(orgId: string, id: string): Promise<void> {
    const deleted = await this.repository.softDeleteBrandKit(orgId, id);
    if (!deleted) throw new NotFoundException(STUDIO_MESSAGES.BRAND_KIT_NOT_FOUND);
  }

  // -------------------------------------------------------------------------
  // Logos
  // -------------------------------------------------------------------------

  /**
   * Checks a logo and puts it in the media library.
   *
   * PNG, JPG and WebP go to the library as they are; an SVG is checked for
   * anything that could run or reach out and is drawn to a PNG first (see
   * `brand-logo.ts`), so no SVG is ever stored or served. The extraction
   * review screen uploads its chosen candidate through here too.
   */
  async uploadLogo(orgId: string, file: LogoFile | undefined): Promise<{ media: MediaView }> {
    if (!file || file.buffer.length === 0) {
      throw new BadRequestException(STUDIO_MESSAGES.LOGO_NO_FILE);
    }

    let prepared: PreparedLogo;

    try {
      prepared = await prepareLogo(file);
    } catch (error) {
      if (!(error instanceof LogoRejectedError)) throw error;

      securityLogger.log('studio.logo_rejected', { orgId, reason: error.reason });
      throw logoRejection(error.reason);
    }

    try {
      const media = await this.media.saveGenerated(orgId, {
        data: prepared.data,
        mimeType: prepared.mimeType,
        name: prepared.name,
        alt: LOGO_ALT,
        // A logo is flat colour and hard edges, where JPEG's ringing shows,
        // so it stays lossless even when it has no transparency. A JPEG
        // upload stays a JPEG: it has already lost what a PNG would keep.
        encode: prepared.mimeType === 'image/jpeg' ? undefined : { prefer: 'png' },
      });

      return { media };
    } catch (error) {
      // The library sniffs and decodes the file once more. One that passed
      // the checks above and still cannot be decoded is, to the person
      // uploading it, the same unreadable logo.
      if (error instanceof HttpException && error.getStatus() < 500) {
        throw new UnprocessableEntityException(STUDIO_MESSAGES.LOGO_UNREADABLE);
      }
      throw error;
    }
  }

  // -------------------------------------------------------------------------
  // Extraction
  // -------------------------------------------------------------------------

  /**
   * Reads a website and returns candidates.
   *
   * The address is checked here, before anything is fetched, so a private
   * address is answered with the sentence the stories ask for rather than an
   * error from inside the fetcher. The fetcher checks again on every hop,
   * which is what catches a public address that redirects into a private
   * network; that refusal gets the same sentence.
   */
  async extract(orgId: string, input: string): Promise<BrandExtraction> {
    const url = websiteAddress(input);
    if (!url) throw new BadRequestException(STUDIO_MESSAGES.WEBSITE_INVALID);

    await this.throttle(orgId);

    const verdict = await assertSafeUrl(url);
    if (!verdict.ok) throw this.refusal(orgId, verdict.reason);

    try {
      const deps = this.extractDeps ?? {
        ...defaultExtractDeps,
        renderPage: (address: string, options: { signal: AbortSignal; timeoutMs: number }) =>
          this.renderPage(address, options),
      };

      return await extractBrand(url, {
        ...deps,
        logger: { warn: (message) => this.logger.warn(message) },
      });
    } catch (error) {
      // A redirect into a private network is the same refusal as typing one.
      // Any other refusal mid-way (an odd port on the redirect) is a site
      // that cannot be read, not a typo in what the person entered.
      const reason =
        isSeoCrawlError(error) && error.kind === 'unsafe_url'
          ? (error.reason ?? 'private_address')
          : null;
      if (reason === 'private_address' || reason === 'host_forbidden') {
        throw this.refusal(orgId, reason);
      }

      this.logger.warn(`studio.extract_failed ${hostOf(url)}: ${messageOf(error)}`);
      throw new UnprocessableEntityException({
        message: STUDIO_MESSAGES.EXTRACT_FAILED,
        code: 'extract_failed',
      });
    }
  }

  /**
   * Loads a page in the shared browser, for a site whose HTML is an empty
   * JavaScript shell. The pool's pages run the address guard on every request
   * they make, so this reaches nothing the plain fetch could not. Aborting
   * the signal closes the page at once.
   */
  private async renderPage(
    url: string,
    options: { signal: AbortSignal; timeoutMs: number },
  ): Promise<RenderedPage> {
    if (!(await this.pool.available())) throw new Error('No browser is available.');

    const lease = await this.pool.acquire({ signal: options.signal });
    const close = () => {
      void lease.release();
    };
    options.signal.addEventListener('abort', close, { once: true });

    try {
      const startedAt = Date.now();
      const response = await lease.page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: Math.max(1_000, options.timeoutMs),
      });

      if (!response || response.status() >= 400) {
        throw new Error(`The page answered ${response?.status() ?? 'nothing'}.`);
      }

      const left = options.timeoutMs - (Date.now() - startedAt);
      if (left > 500) {
        await lease.page
          .waitForLoadState('networkidle', { timeout: Math.min(RENDER_SETTLE_MS, left - 250) })
          .catch(() => undefined);
      }

      return { html: await lease.page.content(), finalUrl: lease.page.url() };
    } finally {
      options.signal.removeEventListener('abort', close);
      await lease.release();
    }
  }

  private async throttle(orgId: string): Promise<void> {
    const count = await this.redis.incrementWithTtl(
      `studio:extract:${orgId}`,
      EXTRACT_WINDOW_SECONDS,
    );

    if (count > EXTRACT_LIMIT_PER_MINUTE) {
      throw new HttpException(
        { message: STUDIO_MESSAGES.EXTRACT_RATE_LIMITED, code: 'extract_rate_limited' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /** The answer for an address the guard refused, by why it refused it. */
  private refusal(orgId: string, reason: UrlRejectReason): HttpException {
    if (reason === 'private_address' || reason === 'host_forbidden') {
      securityLogger.warn('studio.unsafe_url', { orgId, reason });
      return new UnprocessableEntityException({
        message: STUDIO_MESSAGES.EXTRACT_PRIVATE,
        code: 'extract_private',
      });
    }

    // A name that does not resolve is a site that cannot be read, not a typo
    // in the address.
    if (reason === 'unresolvable') {
      return new UnprocessableEntityException({
        message: STUDIO_MESSAGES.EXTRACT_FAILED,
        code: 'extract_failed',
      });
    }

    return new BadRequestException(STUDIO_MESSAGES.WEBSITE_INVALID);
  }

  // -------------------------------------------------------------------------
  // Share links
  // -------------------------------------------------------------------------

  async listShares(orgId: string, designId: string): Promise<ShareView[]> {
    await this.requireDesign(orgId, designId);

    const rows = await this.repository.listActiveShares(orgId, designId, new Date());
    return rows.map(toShareView);
  }

  async createShare(
    orgId: string,
    designId: string,
    userId: string | null,
    expiresInDays: number,
  ): Promise<ShareView> {
    const design = await this.requireDesign(orgId, designId);
    const now = new Date();

    // A soft cap: two links made in the same instant can both pass it, which
    // costs nothing. It exists so a script cannot mint links without end.
    if ((await this.repository.countActiveShares(design.id, now)) >= MAX_ACTIVE_SHARES) {
      throw new ConflictException({
        message: STUDIO_MESSAGES.shareLimit(MAX_ACTIVE_SHARES),
        code: 'share_limit',
      });
    }

    const token = randomBytes(SHARE_TOKEN_BYTES).toString('base64url');
    const days = Math.min(
      MAX_SHARE_DAYS,
      Math.max(MIN_SHARE_DAYS, Math.trunc(expiresInDays || DEFAULT_SHARE_DAYS)),
    );

    const row = await this.repository.createShare({
      designId: design.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(now.getTime() + days * DAY_MS),
      createdById: userId,
    });

    return {
      ...toShareView(row),
      // The only moment the token exists outside the person's clipboard.
      token,
      url: `${this.webUrl}/share/design/${token}`,
    };
  }

  async revokeShare(orgId: string, designId: string, shareId: string): Promise<void> {
    const revoked = await this.repository.revokeShare(orgId, designId, shareId);
    if (!revoked) throw new NotFoundException(STUDIO_MESSAGES.SHARE_NOT_FOUND);
  }

  /**
   * Resolves a share token for the public page.
   *
   * Expired, revoked, deleted and never-existed all produce the same 404 with
   * the same sentence. Telling somebody who is not signed in which of the
   * four it was would say whether a design exists at that token, which is the
   * one thing a guessing attacker wants to know.
   */
  async resolveShare(token: string): Promise<SharedDesignRow> {
    if (!SHARE_TOKEN.test(token)) throw shareUnavailable();

    const row = await this.repository.findShareByHash(hashToken(token));
    const now = new Date();

    if (
      !row ||
      row.revokedAt !== null ||
      row.expiresAt.getTime() <= now.getTime() ||
      row.design.deletedAt !== null
    ) {
      throw shareUnavailable();
    }

    // Noting the view is bookkeeping; failing to note it never fails the view.
    await this.repository.touchShare(row.id, now).catch((error: unknown) => {
      this.logger.warn(`studio.share_touch_failed ${messageOf(error)}`);
    });

    return row;
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private async require(orgId: string, id: string): Promise<BrandKitRow> {
    const row = await this.repository.findBrandKit(orgId, id);
    if (!row) throw new NotFoundException(STUDIO_MESSAGES.BRAND_KIT_NOT_FOUND);

    return row;
  }

  private async requireDesign(orgId: string, id: string) {
    const design = await this.repository.findDesign(orgId, id);
    if (!design) throw new NotFoundException(STUDIO_MESSAGES.DESIGN_NOT_FOUND);

    return design;
  }

  /** A logo id, checked to be an image in this workspace's library. */
  private async verifyLogo(orgId: string, id: string | null): Promise<string | null> {
    if (!id) return null;

    const view = (await this.media.findViews(orgId, [id])).get(id);

    if (!view) throw new NotFoundException(STUDIO_MESSAGES.LOGO_NOT_FOUND);
    if (view.type !== 'image') throw new BadRequestException(STUDIO_MESSAGES.LOGO_REJECTED);

    return view.id;
  }

  /** Every kit's logo in one query. A logo deleted from the library is simply absent. */
  private async logoViews(orgId: string, rows: BrandKitRow[]): Promise<Map<string, MediaView>> {
    const ids = [...new Set(rows.flatMap((row) => (row.logoMediaId ? [row.logoMediaId] : [])))];
    return ids.length > 0 ? this.media.findViews(orgId, ids) : new Map();
  }

  private toView(row: BrandKitRow, logos: Map<string, MediaView>): BrandKitView {
    const logo = row.logoMediaId ? logos.get(row.logoMediaId) : undefined;

    return {
      id: row.id,
      name: row.name,
      description: row.description,
      websiteUrl: row.websiteUrl,
      logoMediaId: row.logoMediaId,
      logoUrl: logo?.type === 'image' ? logo.url : null,
      colors: this.readColors(row),
      source: row.source,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /**
   * A kit's colours as stored. Every write is validated, so a row that does
   * not parse was changed by hand; it is shown with the default theme's
   * colours rather than taking the whole Studio page down with it.
   */
  private readColors(row: BrandKitRow): BrandColors {
    const parsed = brandColorsSchema.safeParse(row.colors);
    if (parsed.success) return parsed.data;

    this.logger.warn(`studio.brand_kit_colors_unreadable ${row.id}`);
    return brandFromTheme(themeById(DEFAULT_THEME_ID));
  }
}

function toShareView(row: DesignShareRow): ShareView {
  return {
    id: row.id,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    lastViewedAt: row.lastViewedAt?.toISOString() ?? null,
  };
}

function shareUnavailable(): NotFoundException {
  return new NotFoundException(STUDIO_MESSAGES.SHARE_UNAVAILABLE);
}

/** One sentence for each reason a logo is refused, with the status that names it. */
function logoRejection(reason: LogoRejection): HttpException {
  switch (reason) {
    case 'empty':
      return new BadRequestException(STUDIO_MESSAGES.LOGO_NO_FILE);
    case 'too_large':
      return new HttpException(STUDIO_MESSAGES.LOGO_REJECTED, HttpStatus.PAYLOAD_TOO_LARGE);
    case 'type':
      return new HttpException(STUDIO_MESSAGES.LOGO_REJECTED, HttpStatus.UNSUPPORTED_MEDIA_TYPE);
    case 'unsafe_svg':
      return new UnprocessableEntityException(STUDIO_MESSAGES.LOGO_UNSAFE_SVG);
    case 'unreadable':
      return new UnprocessableEntityException(STUDIO_MESSAGES.LOGO_UNREADABLE);
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * A website as a person types it ("acme.com", "https://acme.com/about") as
 * the address to read, or null when it cannot be one. Only http and https,
 * never credentials: `javascript:` and data URIs never become a stored link.
 */
export function websiteAddress(input: string): string | null {
  const text = input.trim();
  if (!text) return null;

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;

  try {
    return normaliseUrl(withScheme);
  } catch {
    return null;
  }
}

function websiteOrThrow(input: string): string {
  const url = websiteAddress(input);
  if (!url) throw new BadRequestException(STUDIO_MESSAGES.WEBSITE_INVALID);

  return url;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'unknown';
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
