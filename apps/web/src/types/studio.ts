/**
 * Design Studio shapes, mirroring what `/studio/*` and
 * `/public/design-shares/:token` return and stream (Sprint 9).
 *
 * The API's `studio.types.ts` is the source; keep the two in step. Unlike the
 * SEO and AI engines, `@postgear/design-engine` is browser-safe by design (the
 * editor draws slides with it), so the document's own types are imported from
 * it rather than copied: a copy would drift the first time a slot is added.
 */
import type {
  BrandColors,
  DesignDocument,
  DesignIssueKind,
  FormatId,
} from '@postgear/design-engine';
import type { LengthMethod } from '@postgear/social-core/composer';

export type DesignStatusView = 'DRAFT' | 'EXPORTED' | 'SENT';

export type ExportImageFormat = 'jpeg' | 'png';

/**
 * A picture a design draws, as the browser loads it. Keyed by media id in
 * every map below; an id missing from a map is a picture that was deleted,
 * which the editor shows as an empty slot with its warning.
 */
export interface StudioMediaRef {
  url: string;
  thumbnailUrl: string | null;
  name: string;
  width: number | null;
  height: number | null;
}

/** A card in the Recent Designs grid. */
export interface DesignSummary {
  id: string;
  title: string;
  format: FormatId;
  presetId: string;
  themeId: string | null;
  brandKitId: string | null;
  status: DesignStatusView;
  slideCount: number;
  revision: number;
  lastSlideIndex: number;
  /** True when the design has never been fully exported at its current revision. */
  exportStale: boolean;
  exportedMediaIds: string[];
  createdAt: string;
  updatedAt: string;
  /**
   * The design with its first slide only, for the real renderer to draw the
   * card's thumbnail. Null when this version cannot read the stored document.
   */
  cover: DesignDocument | null;
  /** The pictures the cover slide draws. */
  coverMedia: Record<string, StudioMediaRef>;
}

/** A platform frame Preview can draw. */
export type PreviewPlatformId = 'instagram' | 'facebook' | 'linkedin' | 'x';

/**
 * One frame Preview offers. The API decides which (only platforms whose
 * composer rules take an image of the design's shape), so the editor and the
 * share page never disagree with what Send will accept.
 */
export interface PreviewPlatform {
  id: PreviewPlatformId;
  /** Title Case, as the platform switch shows it. */
  name: string;
  /** The caption limit the composer applies on this platform, and how it counts. */
  maxLength: number;
  lengthMethod: LengthMethod;
}

export interface DesignDetail extends Omit<DesignSummary, 'cover' | 'coverMedia'> {
  document: DesignDocument;
  /** Every picture the design draws, plus the brand logo. */
  media: Record<string, StudioMediaRef>;
  /** The frames Preview offers for this design's format. */
  platforms: PreviewPlatform[];
}

/** What an editor save answers: the new revision to save against next. */
export interface DesignSaveResult {
  id: string;
  title: string;
  revision: number;
  status: DesignStatusView;
  exportStale: boolean;
  lastSlideIndex: number;
  updatedAt: string;
}

export interface DesignPage {
  designs: DesignSummary[];
  page: number;
  pageCount: number;
  total: number;
}

export type BrandKitSource = 'MANUAL' | 'EXTRACTED';

export interface BrandKitView {
  id: string;
  name: string;
  description: string | null;
  websiteUrl: string | null;
  logoMediaId: string | null;
  /** Null when there is no logo, or when the media item behind it was deleted. */
  logoUrl: string | null;
  colors: BrandColors;
  source: BrandKitSource;
  createdAt: string;
  /** Compared with a design's `brand.kitVersion` to offer Update Colours. */
  updatedAt: string;
}

/** What `POST` and `PATCH /studio/brand-kits` take. */
export interface BrandKitBody {
  name: string;
  description?: string | null;
  websiteUrl?: string | null;
  logoMediaId?: string | null;
  colors: BrandColors;
  source?: BrandKitSource;
}

/** One logo found on a website, before anything is saved. */
export interface LogoCandidate {
  /** A `data:` URI, so the review screen shows it without a second request. */
  preview: string;
  sourceUrl: string;
  width: number | null;
  height: number | null;
  mimeType: string;
  bytes: number;
}

export interface ColorCandidate {
  hex: string;
  /** Which brand role this colour looks like. The user may reassign it. */
  suggestedRole: keyof BrandColors;
  /** How strongly the site uses it, as a rough rank. */
  weight: number;
}

export interface BrandExtraction {
  url: string;
  finalUrl: string;
  name: string | null;
  description: string | null;
  logos: LogoCandidate[];
  colors: ColorCandidate[];
  /** True when the page was an empty JavaScript shell and had to be rendered. */
  usedBrowser: boolean;
}

/** An active share link. Revoked and expired links are not listed. */
export interface ShareView {
  id: string;
  /** Only on creation. Afterwards nobody, PostGear included, can read it again. */
  token?: string;
  url?: string;
  expiresAt: string;
  createdAt: string;
  lastViewedAt: string | null;
}

/** What `GET /public/design-shares/:token` answers. */
export interface SharedDesignView {
  title: string;
  workspaceName: string;
  format: FormatId;
  caption: string;
  document: DesignDocument;
  media: Record<string, StudioMediaRef>;
  /** The frames the page offers, the same ones the editor's Preview does. */
  platforms: PreviewPlatform[];
  expiresAt: string;
}

/** One exported slide, as the export dialog lists it. */
export interface ExportedSlideView {
  id: string;
  name: string;
  url: string;
  thumbnailUrl: string | null;
}

export type StudioStreamFailure =
  | 'no_browser'
  | 'render_failed'
  | 'save_failed'
  | 'send_failed'
  | 'unexpected';

/**
 * The events `POST /studio/designs/:id/export` and `.../send` stream. A
 * `warning` never stops anything; `error` is always the last event of a
 * stream that failed and lists what was saved before it.
 */
export type StudioExportEvent =
  | {
      type: 'start';
      slides: number;
      format: FormatId;
      width: number;
      height: number;
      imageFormat: ExportImageFormat;
    }
  | { type: 'warning'; kind: DesignIssueKind; slideIndex: number; message: string }
  | { type: 'slide'; index: number; total: number; label: string }
  | { type: 'saved'; index: number; total: number; media: ExportedSlideView }
  | {
      type: 'done';
      mediaIds: string[];
      status: DesignStatusView;
      revision: number;
      /** True when Send used the pictures of an export that was still current. */
      reused: boolean;
    }
  | { type: 'sent'; group: string; mediaIds: string[] }
  | {
      type: 'error';
      code: StudioStreamFailure;
      message: string;
      slideIndex: number | null;
      savedMediaIds: string[];
    };
