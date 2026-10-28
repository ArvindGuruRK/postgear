/**
 * Design Studio: designs, export and send.
 *
 * ## The rules this service enforces
 *
 * - **A design is a copy.** `create` builds the document from the preset on
 *   the server; the client never posts one. So "choosing a template never
 *   changes the template" is not a rule anyone has to remember, it is the
 *   only path that exists.
 * - **A save is checked against the revision it was made from.** The
 *   repository matches on the revision inside the write, so two tabs cannot
 *   both win; the loser is told to reload rather than quietly overwritten.
 * - **Nothing crosses a workspace.** Every id is resolved through a query
 *   that carries `organizationId`, so another workspace's design, kit, media
 *   or channel is a 404 (or simply absent) rather than something to check
 *   afterwards.
 * - **Every stored document parses.** A new one is built by the engine and
 *   checked before it is written; a saved one passed the engine's schema in
 *   the request pipe. One that still fails to parse on the way out (a newer
 *   PostGear wrote it) is a 422 with a sentence, never a 500.
 *
 * ## Export and send
 *
 * Both stream. An export renders one slide at a time and saves each as it
 * goes, so a failure on slide 6 keeps slides 1 to 5 in the library and names
 * the one that failed. Problems in the design itself (a deleted picture, text
 * too long for its space) are streamed as warnings and never stop it: the
 * stories ask Export to warn and name the slide, not to refuse. Send then
 * creates an ordinary draft post through `PostsService`, the same door the AI
 * copilot uses: Studio makes pictures, the composer posts them.
 */
import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { type Design, DesignStatus, type Prisma } from '@postgear/db';
import {
  BLANK_PRESET_ID,
  brandColorsSchema,
  type DesignBrand,
  type DesignDocument,
  type DesignIssue,
  designMediaIds,
  documentFromPreset,
  findDesignIssues,
  findLayout,
  formatSpec,
  issueMessage,
  presetById,
  presetFormats,
  safeParseDesignDocument,
  slideId,
  slideMediaIds,
  slotText,
} from '@postgear/design-engine';
import type { BrowserPool } from '@postgear/seo-engine';
import { documentFromText } from '@postgear/social-core';
import { BROWSER_POOL } from '../../common/browser/browser-pool.module';
import { securityLogger } from '../../common/logging/security-logger';
import {
  MIN_SEARCH_LENGTH,
  matchesAllTerms,
  searchTerms,
  selectiveTerm,
} from '../../common/search-terms';
import type { SseStream } from '../../common/sse';
import { ChannelsService } from '../channels/channels.service';
import { MediaService, type MediaView } from '../media/media.service';
import { createPostSchema, postDocumentSchema } from '../posts/dto/posts.schema';
import { PostsService } from '../posts/posts.service';
import {
  type ArchiveEntry,
  archiveFileName,
  archiveNames,
  type DesignArchive,
} from './design-archive';
import {
  DesignExport,
  ExportCancelledError,
  INSTALL_HINT,
  SlideRenderError,
} from './design-exporter';
import {
  COLUMN_TO_FORMAT,
  type CreateDesignInput,
  DESIGNS_PAGE_SIZE,
  type ExportDesignInput,
  FORMAT_TO_COLUMN,
  type ListDesignsQuery,
  MAX_TITLE_LENGTH,
  type SendDesignInput,
  type UpdateDesignInput,
} from './dto/studio.schema';
import { previewPlatforms } from './preview-platforms';
import { SLIDE_FAILURE_REASONS, STUDIO_MESSAGES } from './studio.messages';
import {
  type DesignFilters,
  type DesignWrite,
  type SharedDesignRow,
  StudioRepository,
} from './studio.repository';
import type {
  DesignDetail,
  DesignPage,
  DesignSaveResult,
  DesignStatusView,
  DesignSummary,
  ExportImageFormat,
  SharedDesignView,
  StudioExportEvent,
  StudioMediaRef,
} from './studio.types';

/** How many of the newest title matches a search looks through. */
const SEARCH_CANDIDATES = 200;

/** JPEG quality for an exported slide: higher than the library's own 82, as the sprint fixed. */
export const EXPORT_JPEG_QUALITY = 92;

/** A streaming route's work, once everything that can be an HTTP error has been checked. */
export type StudioRun = (stream: SseStream) => Promise<void>;

/** A slide rendered fine but could not be written to the library. */
class SlideSaveError extends Error {
  constructor(
    readonly slideIndex: number,
    options: { cause: unknown },
  ) {
    super(`Slide ${slideIndex + 1} could not be saved.`, options);
    this.name = 'SlideSaveError';
  }
}

@Injectable()
export class StudioService {
  private readonly logger = new Logger(StudioService.name);
  /** Printed once, not on every refused export. */
  private warnedAboutBrowser = false;
  /** Designs with an export in flight in this process, so two tabs cannot render one twice. */
  private readonly exporting = new Set<string>();

  constructor(
    private readonly repository: StudioRepository,
    private readonly media: MediaService,
    private readonly posts: PostsService,
    private readonly channels: ChannelsService,
    @Inject(BROWSER_POOL) private readonly pool: BrowserPool,
  ) {}

  // -------------------------------------------------------------------------
  // Designs
  // -------------------------------------------------------------------------

  async list(orgId: string, query: ListDesignsQuery): Promise<DesignPage> {
    const filters: DesignFilters = {
      format: query.format ? FORMAT_TO_COLUMN[query.format] : undefined,
      status: query.status,
    };
    const search = query.search ?? '';
    const terms = search.length >= MIN_SEARCH_LENGTH ? searchTerms(search) : [];
    const page = query.page;
    const skip = (page - 1) * DESIGNS_PAGE_SIZE;

    let rows: Design[];
    let total: number;

    if (terms.length > 0) {
      // The database narrows by the most selective word; every word is then
      // checked here, the way the media and post searches do it.
      const candidates = await this.repository.searchDesigns(
        orgId,
        selectiveTerm(terms),
        filters,
        SEARCH_CANDIDATES,
      );
      const matched = candidates.filter((row) => matchesAllTerms(row.title, terms));

      rows = matched.slice(skip, skip + DESIGNS_PAGE_SIZE);
      total = matched.length;
    } else {
      const result = await this.repository.listDesigns(orgId, filters, {
        skip,
        take: DESIGNS_PAGE_SIZE,
      });

      rows = result.items;
      total = result.total;
    }

    return {
      designs: await this.summaries(orgId, rows),
      page,
      pageCount: Math.max(1, Math.ceil(total / DESIGNS_PAGE_SIZE)),
      total,
    };
  }

  async get(orgId: string, id: string): Promise<DesignDetail> {
    return this.detail(orgId, await this.require(orgId, id));
  }

  /**
   * Creates a design from a preset, or the blank one.
   *
   * The brand kit, if one was chosen, is copied into the document here: the
   * five colours, the logo, the name and the kit's `updatedAt`. That last one
   * is what later lets the editor offer Update Colours when the kit changes,
   * without ever changing a design on its own.
   */
  async create(
    orgId: string,
    userId: string | null,
    input: CreateDesignInput,
  ): Promise<DesignDetail> {
    const blank = input.presetId === BLANK_PRESET_ID;
    const preset = blank ? null : presetById(input.presetId);

    if (!blank && !preset) throw new NotFoundException(STUDIO_MESSAGES.TEMPLATE_NOT_FOUND);
    if (preset && !presetFormats(preset).includes(input.format)) {
      throw new UnprocessableEntityException(STUDIO_MESSAGES.TEMPLATE_WRONG_FORMAT);
    }

    const kit = input.brandKitId ? await this.requireKit(orgId, input.brandKitId) : null;
    const brand = kit ? await this.brandFromKit(orgId, kit) : null;

    const document = this.checked(
      documentFromPreset({ presetId: preset?.id ?? BLANK_PRESET_ID, format: input.format, brand }),
    );

    const row = await this.repository.createDesign({
      orgId,
      title: input.title || preset?.name || 'Untitled Design',
      format: FORMAT_TO_COLUMN[input.format],
      presetId: document.presetId,
      brandKitId: kit?.id ?? null,
      document: toJson(document),
      createdById: userId,
    });

    return this.detail(orgId, row);
  }

  async update(orgId: string, id: string, input: UpdateDesignInput): Promise<DesignSaveResult> {
    const data: DesignWrite = {};

    if (input.title !== undefined) data.title = input.title;
    if (input.lastSlideIndex !== undefined) data.lastSlideIndex = input.lastSlideIndex;

    if (input.document !== undefined) {
      const document = input.document;

      data.document = toJson(document);
      // The format and preset live on the row as well as in the document, and
      // the row is what the gallery filters on: a document that disagreed with
      // its row would hide a design from its own format filter.
      data.format = FORMAT_TO_COLUMN[document.format];
      data.presetId = document.presetId;
      data.brandKitId = await this.linkableKit(orgId, document.brand.kitId);

      if (data.lastSlideIndex !== undefined) {
        data.lastSlideIndex = Math.min(data.lastSlideIndex, document.slides.length - 1);
      }
    }

    const saved = await this.repository.updateDesign(orgId, id, input.revision, data);

    if (!saved) {
      // Nothing matched: either the design is gone, or the revision is not the
      // one this editor loaded because somebody else saved first.
      if (!(await this.repository.findDesign(orgId, id))) {
        throw new NotFoundException(STUDIO_MESSAGES.DESIGN_NOT_FOUND);
      }

      throw new ConflictException({
        message: STUDIO_MESSAGES.DESIGN_CONFLICT,
        code: 'design_conflict',
      });
    }

    const document = readDocument(saved);

    return {
      id: saved.id,
      title: saved.title,
      revision: saved.revision,
      status: saved.status,
      exportStale: saved.lastExportedRevision !== saved.revision,
      lastSlideIndex: clampSlideIndex(saved.lastSlideIndex, document),
      updatedAt: saved.updatedAt.toISOString(),
    };
  }

  async duplicate(orgId: string, userId: string | null, id: string): Promise<DesignDetail> {
    const source = await this.require(orgId, id);
    const document = this.documentOf(source);

    const row = await this.repository.createDesign({
      orgId,
      title: copyTitle(source.title),
      format: source.format,
      presetId: source.presetId,
      brandKitId: source.brandKitId,
      // Fresh slide ids, so nothing that identifies a slide of one design can
      // ever address a slide of the other.
      document: toJson({
        ...document,
        slides: document.slides.map((slide) => ({ ...slide, id: slideId() })),
      }),
      createdById: userId,
    });

    return this.detail(orgId, row);
  }

  async remove(orgId: string, id: string): Promise<void> {
    if (!(await this.repository.softDeleteDesign(orgId, id))) {
      throw new NotFoundException(STUDIO_MESSAGES.DESIGN_NOT_FOUND);
    }
  }

  /**
   * Download All (DS-8.3): the last export's slides, in slide order, for
   * `design-archive.ts` to zip.
   *
   * Everything that can be refused is checked here, before the first byte of
   * the zip: that there is an export, and that every slide of it is still an
   * image in the library. Once the archive streams, a refusal can no longer
   * be a status code, only a cut connection.
   */
  async prepareArchive(orgId: string, id: string): Promise<DesignArchive> {
    const design = await this.require(orgId, id);
    const ids = [...design.exportedMediaIds];

    if (ids.length === 0) {
      throw new ConflictException({
        message: STUDIO_MESSAGES.DOWNLOAD_NOTHING,
        code: 'download_nothing',
      });
    }

    const views = await this.media.findViews(orgId, ids);

    if (ids.some((mediaId) => views.get(mediaId)?.type !== 'image')) {
      throw new ConflictException({
        message: STUDIO_MESSAGES.DOWNLOAD_MISSING,
        code: 'download_missing',
      });
    }

    const names = archiveNames(
      ids.map((mediaId) => {
        const view = views.get(mediaId) as MediaView;
        return { name: view.name, mimeType: view.mimeType };
      }),
    );
    const media = this.media;

    async function* entries(): AsyncGenerator<ArchiveEntry> {
      for (const [index, mediaId] of ids.entries()) {
        const file = await media.readImageBytes(orgId, mediaId);

        // Checked above a moment ago; a slide deleted since then fails the
        // download rather than leaving a gap in it.
        if (!file) throw new Error(`Exported slide ${index + 1} is no longer readable.`);

        yield { name: names[index], bytes: file.bytes };
      }
    }

    return { fileName: archiveFileName(design.title), entries: entries() };
  }

  // -------------------------------------------------------------------------
  // Favourite templates
  // -------------------------------------------------------------------------

  /** The workspace's favourite templates, oldest first. */
  async favourites(orgId: string): Promise<{ presetIds: string[] }> {
    const ids = await this.repository.listFavourites(orgId);

    // A template retired in a later release leaves its favourite row behind;
    // the gallery is never offered an id it cannot draw.
    return { presetIds: ids.filter((id) => presetById(id) !== null) };
  }

  async addFavourite(
    orgId: string,
    userId: string | null,
    presetId: string,
  ): Promise<{ presetIds: string[] }> {
    if (!presetById(presetId)) throw new NotFoundException(STUDIO_MESSAGES.TEMPLATE_NOT_FOUND);

    await this.repository.addFavourite(orgId, presetId, userId);
    return this.favourites(orgId);
  }

  /** Idempotent: removing a favourite that is not there is not an error. */
  async removeFavourite(orgId: string, presetId: string): Promise<{ presetIds: string[] }> {
    await this.repository.removeFavourite(orgId, presetId);
    return this.favourites(orgId);
  }

  // -------------------------------------------------------------------------
  // Share links
  // -------------------------------------------------------------------------

  /**
   * What the public share page shows for a link `BrandKitsService` resolved:
   * the design as it is now (an edit shows on the link straight away), its
   * caption, and the pictures its slides draw. The brand kit's id and version
   * are cleared, because someone holding a link has no use for either.
   */
  async sharedView(share: SharedDesignRow): Promise<SharedDesignView> {
    const { design } = share;
    const document = readDocument(design);

    // A design this version cannot read is, to someone holding the link, a
    // link that does not work.
    if (!document) throw new NotFoundException(STUDIO_MESSAGES.SHARE_UNAVAILABLE);

    const media = await this.mediaRefs(design.organizationId, designMediaIds(document));

    return {
      title: design.title,
      workspaceName: design.organization.name,
      format: document.format,
      caption: document.caption,
      document: { ...document, brand: { ...document.brand, kitId: null, kitVersion: null } },
      media: Object.fromEntries(media),
      platforms: previewPlatforms(document.format, this.channels.listProviders()),
      expiresAt: share.expiresAt.toISOString(),
    };
  }

  // -------------------------------------------------------------------------
  // Export and send
  // -------------------------------------------------------------------------

  /**
   * Checks everything that can fail before a byte is written, then returns
   * the run.
   *
   * The split is the one the SEO analyzer uses: anything that should be an
   * ordinary HTTP error (404, 409, 422, 503) is raised here, before the
   * stream opens; once the status line has been sent, a failure can only be
   * an `error` event.
   */
  async prepareExport(orgId: string, id: string, input: ExportDesignInput): Promise<StudioRun> {
    const design = await this.require(orgId, id);
    const document = this.documentOf(design);

    await this.assertBrowser();
    this.assertNotExporting(design.id);

    return async (stream) => {
      await this.runExport(orgId, design, document, input.imageFormat, stream);
    };
  }

  /**
   * Send To Composer: export if the design changed since the last export,
   * then create a draft post holding every slide in order and the caption,
   * for the composer to open.
   */
  async prepareSend(orgId: string, id: string, input: SendDesignInput): Promise<StudioRun> {
    const design = await this.require(orgId, id);
    const document = this.documentOf(design);

    const content = documentFromText(input.caption ?? document.caption);
    if (!postDocumentSchema.safeParse(content).success) {
      throw new BadRequestException(STUDIO_MESSAGES.SEND_CAPTION_INVALID);
    }

    await this.assertChannels(orgId, input.channelIds);

    const reusable = await this.reusableExport(orgId, design, document, input.imageFormat);

    if (!reusable) {
      await this.assertBrowser();
      this.assertNotExporting(design.id);
    }

    return async (stream) => {
      let mediaIds = reusable;

      if (mediaIds) {
        this.send(stream, {
          type: 'done',
          mediaIds,
          status: design.status,
          revision: design.revision,
          reused: true,
        });
      } else {
        mediaIds = await this.runExport(orgId, design, document, input.imageFormat, stream);
        if (!mediaIds) return;
      }

      // Nobody is waiting to open the composer: a draft made now would be one
      // the person never sees, so none is made.
      if (stream.signal.aborted) return;

      try {
        const post = await this.posts.create(
          orgId,
          createPostSchema.parse({
            state: 'DRAFT',
            publishDate: nextFullHour().toISOString(),
            shared: [{ content, media: mediaIds.map((mediaId) => ({ id: mediaId })) }],
            channels: input.channelIds.map((channelId) => ({ channelId, customized: false })),
          }),
        );

        await this.repository.setDesignStatus(orgId, design.id, DesignStatus.SENT);
        this.send(stream, { type: 'sent', group: post.group, mediaIds });
      } catch (error) {
        this.logger.warn(`studio.send_failed design=${design.id}: ${messageOf(error)}`);
        this.send(stream, {
          type: 'error',
          code: 'send_failed',
          // The posts module's refusals are already written for a person
          // (a channel that went away, a plan limit) and are passed through.
          message:
            error instanceof HttpException
              ? (httpMessage(error) ?? STUDIO_MESSAGES.EXPORT_FAILED)
              : STUDIO_MESSAGES.EXPORT_FAILED,
          slideIndex: null,
          savedMediaIds: mediaIds,
        });
      }
    };
  }

  /**
   * Renders every slide and saves each one as it finishes.
   *
   * Returns the media ids in slide order on success, or null when it stopped,
   * having already said why on the stream. The busy check is repeated here,
   * synchronously with marking the design busy, because two requests can
   * both pass the check in `prepare*` before either run starts.
   */
  private async runExport(
    orgId: string,
    design: Design,
    document: DesignDocument,
    imageFormat: ExportImageFormat,
    stream: SseStream,
  ): Promise<string[] | null> {
    if (this.exporting.has(design.id)) {
      this.send(stream, {
        type: 'error',
        code: 'render_failed',
        message: STUDIO_MESSAGES.EXPORT_BUSY,
        slideIndex: null,
        savedMediaIds: [],
      });
      return null;
    }

    this.exporting.add(design.id);
    const saved: string[] = [];

    try {
      const spec = formatSpec(document.format);
      const total = document.slides.length;

      this.send(stream, {
        type: 'start',
        slides: total,
        format: document.format,
        width: spec.width,
        height: spec.height,
        imageFormat,
      });

      // Everything that can be found without drawing: deleted or empty
      // pictures, colours that do not read, photos too light for text.
      const library = await this.media.findViews(orgId, designMediaIds(document));
      const reported = new Set<string>();

      for (const issue of findDesignIssues(document, (mediaId) => isImage(library.get(mediaId)))) {
        this.warn(stream, document, issue, reported);
      }

      const exporter = new DesignExport(document, {
        pool: this.pool,
        loadPicture: (mediaId) => this.media.readImageBytes(orgId, mediaId),
      });

      for (let index = 0; index < total; index++) {
        this.send(stream, {
          type: 'slide',
          index,
          total,
          label: STUDIO_MESSAGES.rendering(index, total),
        });

        const slide = await exporter.renderSlide(index, stream.signal);

        // What only drawing can tell: text still too long at the smallest
        // size, and a picture deleted since the check above.
        for (const slot of slide.overflowing) {
          this.warn(stream, document, { kind: 'overflow', slideIndex: index, slot }, reported);
        }

        if (slide.missingPictures.length > 0) {
          const gone = new Set(slide.missingPictures);

          for (const issue of findDesignIssues(document, (mediaId) => !gone.has(mediaId))) {
            if (issue.slideIndex === index && issue.kind === 'missingPicture') {
              this.warn(stream, document, issue, reported);
            }
          }
        }

        let media: MediaView;

        try {
          media = await this.media.saveGenerated(orgId, {
            data: slide.png,
            mimeType: 'image/png',
            name: exportFileName(design.title, index, imageFormat),
            alt: altFor(document, index, design.title),
            encode: { prefer: imageFormat, quality: EXPORT_JPEG_QUALITY },
          });
        } catch (error) {
          throw new SlideSaveError(index, { cause: error });
        }

        saved.push(media.id);
        this.send(stream, {
          type: 'saved',
          index,
          total,
          media: {
            id: media.id,
            name: media.name,
            url: media.url,
            thumbnailUrl: media.thumbnailUrl,
          },
        });
      }

      // A design already sent stays Sent: the status is how far it has got.
      const status: DesignStatusView =
        design.status === DesignStatus.SENT ? DesignStatus.SENT : DesignStatus.EXPORTED;

      await this.repository.recordExport(orgId, design.id, {
        mediaIds: saved,
        revision: design.revision,
        status,
      });

      this.send(stream, {
        type: 'done',
        mediaIds: saved,
        status,
        revision: design.revision,
        reused: false,
      });

      return saved;
    } catch (error) {
      this.reportFailure(stream, design.id, error, saved);
      return null;
    } finally {
      this.exporting.delete(design.id);
    }
  }

  /**
   * Turns whatever stopped an export into its `error` event.
   *
   * The slides already saved stay in the library and are listed: they are
   * real files the user can use, and throwing them away to make the failure
   * tidy would be the wrong trade. The design row is not told about a partial
   * export, so Send never mistakes one for a finished set.
   */
  private reportFailure(stream: SseStream, designId: string, error: unknown, saved: string[]) {
    if (error instanceof ExportCancelledError || stream.signal.aborted) {
      this.logger.log(`studio.export_cancelled design=${designId} saved=${saved.length}`);
      return;
    }

    if (error instanceof SlideRenderError) {
      if (error.noBrowser) this.warnAboutBrowser();

      this.logger.warn(
        `studio.slide_failed design=${designId} slide=${error.slideIndex + 1} reason=${error.reason}: ${messageOf(error.cause)}`,
      );
      this.send(stream, {
        type: 'error',
        code: error.noBrowser ? 'no_browser' : 'render_failed',
        message: error.noBrowser
          ? STUDIO_MESSAGES.EXPORT_UNAVAILABLE
          : STUDIO_MESSAGES.slideFailed(error.slideIndex, SLIDE_FAILURE_REASONS[error.reason]),
        slideIndex: error.slideIndex,
        savedMediaIds: saved,
      });
      return;
    }

    if (error instanceof SlideSaveError) {
      this.logger.error(
        `studio.slide_not_saved design=${designId} slide=${error.slideIndex + 1}: ${messageOf(error.cause)}`,
      );
      this.send(stream, {
        type: 'error',
        code: 'save_failed',
        message: STUDIO_MESSAGES.slideNotSaved(error.slideIndex),
        slideIndex: error.slideIndex,
        savedMediaIds: saved,
      });
      return;
    }

    this.logger.error(
      `studio.export_failed design=${designId}: ${messageOf(error)}`,
      error instanceof Error ? error.stack : undefined,
    );
    this.send(stream, {
      type: 'error',
      code: 'unexpected',
      message: STUDIO_MESSAGES.EXPORT_FAILED,
      slideIndex: null,
      savedMediaIds: saved,
    });
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private async require(orgId: string, id: string): Promise<Design> {
    const row = await this.repository.findDesign(orgId, id);
    if (!row) throw new NotFoundException(STUDIO_MESSAGES.DESIGN_NOT_FOUND);

    return row;
  }

  private async requireKit(orgId: string, id: string) {
    const kit = await this.repository.findBrandKit(orgId, id);
    if (!kit) throw new NotFoundException(STUDIO_MESSAGES.BRAND_KIT_NOT_FOUND);

    return kit;
  }

  /** A kit's colours, logo, name and version, as a design copies them. */
  private async brandFromKit(
    orgId: string,
    kit: {
      id: string;
      name: string;
      colors: Prisma.JsonValue;
      logoMediaId: string | null;
      updatedAt: Date;
    },
  ): Promise<DesignBrand> {
    const colors = brandColorsSchema.safeParse(kit.colors);
    const logo = kit.logoMediaId
      ? (await this.media.findViews(orgId, [kit.logoMediaId])).get(kit.logoMediaId)
      : undefined;

    return {
      kitId: kit.id,
      colors: colors.success ? colors.data : null,
      // A logo deleted from the library is not copied in as a broken picture.
      logoMediaId: isImage(logo) ? kit.logoMediaId : null,
      name: kit.name,
      kitVersion: kit.updatedAt.toISOString(),
    };
  }

  /**
   * The kit a saved document may be linked to on its row.
   *
   * A document keeps naming its kit after the kit is deleted, which is how
   * the editor knows to say "This brand kit was deleted.", so the save goes
   * through and only the link is dropped. A kit this workspace never had is
   * a crafted request: recorded, and not linked.
   */
  private async linkableKit(orgId: string, kitId: string | null): Promise<string | null> {
    if (!kitId) return null;

    const state = await this.repository.brandKitState(orgId, kitId);

    if (state === 'unknown') {
      securityLogger.warn('studio.foreign_reference', { orgId, kind: 'brand_kit' });
    }

    return state === 'live' ? kitId : null;
  }

  private async assertChannels(orgId: string, channelIds: string[]): Promise<void> {
    const available = new Set((await this.channels.list(orgId)).map((channel) => channel.id));

    if (channelIds.some((id) => !available.has(id))) {
      securityLogger.warn('studio.foreign_reference', { orgId, kind: 'channel' });
      throw new BadRequestException(STUDIO_MESSAGES.CHANNEL_UNAVAILABLE);
    }
  }

  /**
   * The last export's pictures, when Send can use them as they are: drawn
   * from this very revision, one per slide, still in the library, and in the
   * format asked for (a PNG set must not reach an Instagram draft).
   */
  private async reusableExport(
    orgId: string,
    design: Design,
    document: DesignDocument,
    imageFormat: ExportImageFormat,
  ): Promise<string[] | null> {
    const ids = design.exportedMediaIds;

    if (design.lastExportedRevision !== design.revision) return null;
    if (ids.length === 0 || ids.length !== document.slides.length) return null;

    const mimeType = imageFormat === 'png' ? 'image/png' : 'image/jpeg';
    const views = await this.media.findViews(orgId, ids);

    return ids.every((id) => views.get(id)?.mimeType === mimeType) ? [...ids] : null;
  }

  private async assertBrowser(): Promise<void> {
    if (await this.pool.available()) return;

    this.warnAboutBrowser();
    throw new ServiceUnavailableException({
      message: STUDIO_MESSAGES.EXPORT_UNAVAILABLE,
      code: 'export_unavailable',
    });
  }

  private assertNotExporting(designId: string): void {
    if (this.exporting.has(designId)) {
      throw new ConflictException({ message: STUDIO_MESSAGES.EXPORT_BUSY, code: 'export_busy' });
    }
  }

  /**
   * Parses a stored document, upgrading it on the way.
   *
   * A row that cannot be parsed is a 422 rather than a 500: the design is
   * real, something about it is not readable by this version, and the editor
   * can say so.
   */
  private documentOf(row: Design): DesignDocument {
    const document = readDocument(row);

    if (!document) {
      this.logger.error(`studio.unreadable_document design=${row.id}`);
      throw new UnprocessableEntityException({
        message: STUDIO_MESSAGES.DESIGN_UNREADABLE,
        code: 'design_unreadable',
      });
    }

    return document;
  }

  /**
   * A document the engine just built, checked against its own schema before
   * it is stored. A failure here is a bug in the template library, never the
   * user's doing, so it is a plain error: logged in full, generic to them.
   */
  private checked(document: DesignDocument): DesignDocument {
    const parsed = safeParseDesignDocument(document);

    if (!parsed.ok) {
      throw new Error(`The engine built a document its schema refuses: ${parsed.error.message}`);
    }

    return parsed.document;
  }

  /** Library items by id, images only, as the browser loads them. */
  private async mediaRefs(orgId: string, ids: string[]): Promise<Map<string, StudioMediaRef>> {
    if (ids.length === 0) return new Map();

    const views = await this.media.findViews(orgId, ids);
    const refs = new Map<string, StudioMediaRef>();

    for (const [id, view] of views) {
      if (!isImage(view)) continue;

      refs.set(id, {
        url: view.url,
        thumbnailUrl: view.thumbnailUrl,
        name: view.name,
        width: view.width,
        height: view.height,
      });
    }

    return refs;
  }

  private async summaries(orgId: string, rows: Design[]): Promise<DesignSummary[]> {
    const parsed = rows.map((row) => ({ row, document: readDocument(row) }));
    const media = await this.mediaRefs(
      orgId,
      parsed.flatMap(({ document }) => (document ? slideMediaIds(document, 0) : [])),
    );

    return parsed.map(({ row, document }) => {
      // The first slide only: a grid of twenty-four cards should not carry
      // twenty-four whole carousels.
      const cover = document ? { ...document, slides: document.slides.slice(0, 1) } : null;

      return {
        ...baseView(row, document),
        cover,
        coverMedia: pick(media, cover ? slideMediaIds(cover, 0) : []),
      };
    });
  }

  private async detail(orgId: string, row: Design): Promise<DesignDetail> {
    const document = this.documentOf(row);
    const ids = designMediaIds(document);
    if (document.brand.logoMediaId) ids.push(document.brand.logoMediaId);

    const media = await this.mediaRefs(orgId, ids);

    return {
      ...baseView(row, document),
      document,
      media: pick(media, ids),
      platforms: previewPlatforms(document.format, this.channels.listProviders()),
    };
  }

  private warn(
    stream: SseStream,
    document: DesignDocument,
    issue: DesignIssue,
    reported: Set<string>,
  ): void {
    const key = `${issue.kind}:${issue.slideIndex}:${issue.slot ?? ''}`;
    if (reported.has(key)) return;

    reported.add(key);
    this.send(stream, {
      type: 'warning',
      kind: issue.kind,
      slideIndex: issue.slideIndex,
      message: issueMessage(document, issue),
    });
  }

  private warnAboutBrowser(): void {
    if (this.warnedAboutBrowser) return;

    this.warnedAboutBrowser = true;
    this.logger.error(INSTALL_HINT);
  }

  private send(stream: SseStream, event: StudioExportEvent): void {
    stream.send(event.type, event);
  }
}

/** A stored document, or null when this version cannot read it. */
function readDocument(row: Design): DesignDocument | null {
  const parsed = safeParseDesignDocument(row.document);
  return parsed.ok ? parsed.document : null;
}

/** What a card and a detail share. `document` is null for one that cannot be read. */
function baseView(row: Design, document: DesignDocument | null) {
  return {
    id: row.id,
    title: row.title,
    format: COLUMN_TO_FORMAT[row.format],
    presetId: row.presetId,
    themeId: document?.themeId ?? null,
    brandKitId: row.brandKitId,
    status: row.status,
    slideCount: document?.slides.length ?? 0,
    revision: row.revision,
    lastSlideIndex: clampSlideIndex(row.lastSlideIndex, document),
    exportStale: row.lastExportedRevision !== row.revision,
    exportedMediaIds: row.exportedMediaIds,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** A slide index that exists, even after slides were deleted in another tab. */
function clampSlideIndex(index: number, document: DesignDocument | null): number {
  const last = document ? document.slides.length - 1 : 0;
  return Math.max(0, Math.min(index, last));
}

function pick(
  media: Map<string, StudioMediaRef>,
  ids: Iterable<string>,
): Record<string, StudioMediaRef> {
  const picked: Record<string, StudioMediaRef> = {};

  for (const id of ids) {
    const ref = media.get(id);
    if (ref) picked[id] = ref;
  }

  return picked;
}

function isImage(view: MediaView | undefined): view is MediaView {
  return view?.type === 'image';
}

function toJson(document: DesignDocument): Prisma.InputJsonValue {
  return document as unknown as Prisma.InputJsonValue;
}

/** "Spring Sale (Copy)", kept inside the title limit by shortening the original. */
function copyTitle(title: string): string {
  const suffix = ' (Copy)';
  return `${title.slice(0, MAX_TITLE_LENGTH - suffix.length).trimEnd()}${suffix}`;
}

/**
 * `{design title} {nn}.{ext}`, as the sprint names exported slides. A slash
 * in a title would otherwise be read as a folder by the library, which keeps
 * only the last part of a path.
 */
function exportFileName(title: string, index: number, format: ExportImageFormat): string {
  const safe = title.replace(/[\\/]+/g, '-').trim() || 'Design';
  return `${safe} ${String(index + 1).padStart(2, '0')}.${format === 'png' ? 'png' : 'jpg'}`;
}

/**
 * Alt text for an exported slide: the words on it, in reading order.
 *
 * That is the one honest description of what the picture says; a generic
 * "Slide 2" helps nobody using a screen reader. The handle, the slide number
 * and the brand name are left out as noise. A slide with no words at all
 * falls back to the design's title and its position.
 */
function altFor(document: DesignDocument, index: number, title: string): string {
  const slide = document.slides[index];
  const layout = slide ? findLayout(slide.layoutId) : null;
  const words: string[] = [];

  if (slide && layout) {
    for (const slot of layout.slots) {
      const state = slide.elements[slot.id];
      if (state?.hidden || slot.bind) continue;

      if (slot.kind === 'list') words.push(...(state?.items ?? []));
      else if (slot.kind === 'text') words.push(slotText(document, index, slot));
    }
  }

  const text = words
    .map((word) => word.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('. ')
    .slice(0, 300)
    .trim();

  return text || `${title}, slide ${index + 1}`;
}

/** Where a Studio draft is parked: the top of the next hour, like a copilot draft. */
function nextFullHour(now: Date = new Date()): Date {
  const date = new Date(now);
  date.setUTCMinutes(0, 0, 0);
  date.setUTCHours(date.getUTCHours() + 1);

  return date;
}

/** An HttpException's own sentence, read the way the global filter reads it. */
function httpMessage(error: HttpException): string | null {
  const body = error.getResponse();
  if (typeof body === 'string') return body;

  const message = (body as { message?: unknown }).message;
  return typeof message === 'string' ? message : null;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
