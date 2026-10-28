/**
 * Turning a design into images.
 *
 * ## Why it renders server-side, in a real browser
 *
 * The alternative, rendering in the user's own browser and uploading the
 * result, was considered and rejected: fonts, sub-pixel layout and colour
 * management differ between machines, so two people exporting the same design
 * would get different files, and nobody could reproduce a complaint. Here,
 * every export runs in the same Chromium, from the same bundled fonts, with
 * the network switched off.
 *
 * ## What makes the preview honest
 *
 * The page is `SlideView` in `export` mode, the component the editor's canvas
 * renders, serialised with `react-dom/server`. The one script it carries is
 * `fitSlots`, the same text fitter the editor runs. So the only difference
 * between what a user sees and what comes out is the scale the canvas happens
 * to be drawn at, and scale is a paint-time transform that cannot change a
 * line break.
 *
 * ## Nothing is fetched while it renders
 *
 * Fonts are inlined as `data:` URIs, pictures are read from storage and
 * inlined too, and the render context aborts every network request. A user's
 * picture therefore cannot make this browser reach anywhere, and a slow CDN
 * cannot produce a slide set in a fallback face. A face that still fails to
 * load fails the slide rather than shipping the fallback.
 *
 * ## One encode
 *
 * Every slide is shot as a lossless PNG and the media service encodes it once
 * into what the user chose (JPEG at quality 92, or PNG). Shooting a JPEG and
 * letting the library encode it again would compress every slide twice.
 */
import {
  buildExportPage,
  type DesignDocument,
  fontsOf,
  formatSpec,
  type InlineFont,
  SLOT_IDS,
  SlideView,
  type SlotId,
  slideMediaIds,
  themeById,
} from '@postgear/design-engine';
import type { BrowserPool, RenderResult } from '@postgear/seo-engine';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { inlineFonts } from './studio.fonts';
import type { SlideFailureReason } from './studio.messages';

/** One slide's render, each step of it: generous, since the first may include launching Chromium. */
export const SLIDE_TIMEOUT_MS = 30_000;

/**
 * What the export page's script leaves behind once it has fitted the text
 * (`fitScriptSource` in the engine): the overflowing slots, the faces that
 * did not load, and the fitter's own error if it threw.
 */
const PAGE_REPORT =
  '({ overflow: window.__pgOverflow, fontsMissing: window.__pgFontsMissing, fitError: window.__pgFitError || null })';

/** Picture types an export page may inline. The library stores nothing else as an image. */
const INLINE_TYPES: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
]);

const KNOWN_SLOTS: ReadonlySet<string> = new Set(SLOT_IDS);

export class SlideRenderError extends Error {
  constructor(
    /** Zero-based. */
    readonly slideIndex: number,
    readonly reason: SlideFailureReason,
    /** True when no browser could be started at all; the API console explains the fix. */
    readonly noBrowser: boolean,
    options?: { cause?: unknown },
  ) {
    super(`Slide ${slideIndex + 1} could not be rendered (${reason}).`, options);
    this.name = 'SlideRenderError';
  }
}

/** The person stopped the export: closed the dialog, the tab, or lost the connection. */
export class ExportCancelledError extends Error {
  constructor() {
    super('The export was cancelled.');
    this.name = 'ExportCancelledError';
  }
}

export interface ExportPicture {
  bytes: Buffer;
  mimeType: string;
}

export interface DesignExporterDeps {
  pool: BrowserPool;
  /**
   * Reads a picture for inlining. Null for one that is no longer in the
   * library, which the slide draws as an empty slot and the export warns
   * about; a throw for storage that could not be read, which fails the slide
   * instead of exporting a hole.
   */
  loadPicture: (mediaId: string) => Promise<ExportPicture | null>;
}

export interface RenderedSlide {
  index: number;
  /** A PNG at exactly the format's export size. */
  png: Buffer;
  /** Text slots still too long for their space at the smallest size. */
  overflowing: SlotId[];
  /** Media ids the slide draws that were not there to draw. */
  missingPictures: string[];
}

/**
 * One export of one design, rendered a slide at a time.
 *
 * The fonts are read and encoded once per export rather than once per
 * slide. Pictures are read when a slide first needs them and let go after
 * the last slide that draws them, so a twenty-slide carousel of photos never
 * holds more than the current slide's pictures (and the logo it shares with
 * every slide) in memory.
 */
export class DesignExport {
  private fontsLoad: Promise<InlineFont[]> | null = null;
  private readonly pictures = new Map<string, Promise<string | null>>();
  /** The last slide each picture is drawn on. */
  private readonly lastUse = new Map<string, number>();

  constructor(
    private readonly document: DesignDocument,
    private readonly deps: DesignExporterDeps,
  ) {
    for (let index = 0; index < document.slides.length; index++) {
      for (const id of slideMediaIds(document, index)) this.lastUse.set(id, index);
    }
  }

  async renderSlide(index: number, signal: AbortSignal): Promise<RenderedSlide> {
    if (signal.aborted) throw new ExportCancelledError();

    try {
      const spec = formatSpec(this.document.format);
      const fonts = await this.fonts(index);
      const { sources, missing } = await this.picturesFor(index);
      if (signal.aborted) throw new ExportCancelledError();

      const html = buildExportPage({
        markup: this.markup(index, sources),
        width: spec.width,
        height: spec.height,
        fonts,
      });

      let result: RenderResult;

      try {
        result = await this.deps.pool.render({
          html,
          width: spec.width,
          height: spec.height,
          type: 'png',
          // The fitter sets this once the faces are loaded, the pictures are
          // decoded and the text is fitted. A shot before it would catch the
          // text at its full size.
          waitForFunction: 'window.__pgFitDone === true',
          collect: PAGE_REPORT,
          timeoutMs: SLIDE_TIMEOUT_MS,
          signal,
        });
      } catch (error) {
        if (signal.aborted) throw new ExportCancelledError();
        throw new SlideRenderError(index, reasonFor(error), isLaunchFailure(error), {
          cause: error,
        });
      }

      const report = readReport(result.value);

      if (report.fontsMissing.length > 0) {
        throw new SlideRenderError(index, 'fonts', false, {
          cause: new Error(`Faces that did not load: ${report.fontsMissing.join(', ')}`),
        });
      }

      if (report.fitError !== null || report.overflow === null) {
        throw new SlideRenderError(index, 'unknown', false, {
          cause: new Error(`The text fitter failed: ${report.fitError ?? 'no report'}`),
        });
      }

      return { index, png: result.image, overflowing: report.overflow, missingPictures: missing };
    } finally {
      this.release(index);
    }
  }

  private markup(index: number, sources: Map<string, string>): string {
    try {
      return renderToStaticMarkup(
        createElement(SlideView, {
          design: this.document,
          index,
          mode: 'export',
          resolveMedia: (mediaId: string) => sources.get(mediaId) ?? null,
        }),
      );
    } catch (error) {
      throw new SlideRenderError(index, 'unknown', false, { cause: error });
    }
  }

  private async fonts(index: number): Promise<InlineFont[]> {
    this.fontsLoad ??= inlineFonts(fontsOf(themeById(this.document.themeId)));

    try {
      return await this.fontsLoad;
    } catch (error) {
      throw new SlideRenderError(index, 'fonts', false, { cause: error });
    }
  }

  private async picturesFor(
    index: number,
  ): Promise<{ sources: Map<string, string>; missing: string[] }> {
    const sources = new Map<string, string>();
    const missing: string[] = [];

    for (const id of slideMediaIds(this.document, index)) {
      let load = this.pictures.get(id);

      if (!load) {
        load = this.deps
          .loadPicture(id)
          .then((picture) =>
            picture && INLINE_TYPES.has(picture.mimeType)
              ? `data:${picture.mimeType};base64,${picture.bytes.toString('base64')}`
              : null,
          );
        this.pictures.set(id, load);
      }

      let source: string | null;

      try {
        source = await load;
      } catch (error) {
        this.pictures.delete(id);
        throw new SlideRenderError(index, 'picture', false, { cause: error });
      }

      if (source) sources.set(id, source);
      else missing.push(id);
    }

    return { sources, missing };
  }

  /** Lets go of every picture no later slide draws. */
  private release(index: number): void {
    for (const [id, last] of this.lastUse) {
      if (last <= index) {
        this.pictures.delete(id);
        this.lastUse.delete(id);
      }
    }
  }
}

interface PageReport {
  /** Null when the page did not report a list at all, which only a fitter crash causes. */
  overflow: SlotId[] | null;
  fontsMissing: string[];
  fitError: string | null;
}

/** The page's report, read defensively: it crossed a process boundary as JSON. */
function readReport(value: unknown): PageReport {
  const report = (value !== null && typeof value === 'object' ? value : {}) as Record<
    string,
    unknown
  >;

  const overflow = Array.isArray(report.overflow)
    ? report.overflow.filter(
        (slot): slot is SlotId => typeof slot === 'string' && KNOWN_SLOTS.has(slot),
      )
    : null;
  const fontsMissing = Array.isArray(report.fontsMissing)
    ? report.fontsMissing.filter((spec): spec is string => typeof spec === 'string')
    : [];
  const fitError = typeof report.fitError === 'string' ? report.fitError : null;

  return { overflow, fontsMissing, fitError };
}

const LAUNCH_FAILURE =
  /Executable doesn't exist|browserType\.launch|Failed to launch|playwright install/i;

function isLaunchFailure(error: unknown): boolean {
  return LAUNCH_FAILURE.test(messageOf(error));
}

/**
 * A reason safe to put in front of a user.
 *
 * Playwright's own messages name file paths, flags and internal timeouts.
 * The ones a person can act on are "it took too long" and "the browser went
 * away"; everything else is one sentence that does not pretend to be more
 * specific than it is. The real message goes to the API log.
 */
function reasonFor(error: unknown): SlideFailureReason {
  const message = messageOf(error);

  if (
    (error as { name?: unknown } | null)?.name === 'TimeoutError' ||
    /Timeout \d+ms exceeded|timed out/i.test(message)
  ) {
    return 'timeout';
  }
  if (
    isLaunchFailure(error) ||
    /Target (page, context or browser )?(has been )?closed|crashed|disconnected/i.test(message)
  ) {
    return 'browser';
  }

  return 'unknown';
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** What the API console prints the first time a browser turns out to be missing. */
export const INSTALL_HINT =
  "The Design Studio export needs Playwright's Chromium. Install it with: npx playwright install chromium";
