/**
 * What Studio hands a browser.
 *
 * Mirrored by hand in `apps/web/src/types/studio.ts`, like every other
 * module: `@prisma/client` must never reach a browser bundle, and a view type
 * written out here is also the list of what is safe to send. A share token's
 * hash, a workspace id and a `deletedAt` are all absent on purpose.
 */
import type {
  BrandColors,
  DesignDocument,
  DesignIssueKind,
  FontId,
  FormatId,
} from '@postgear/design-engine';
import type { LengthMethod } from '@postgear/social-core';
import type { StudioStreamFailure } from './studio.messages';

export type DesignStatusView = 'DRAFT' | 'EXPORTED' | 'SENT';

export type ExportImageFormat = 'jpeg' | 'png';

/** 2 paints every slide at twice the format's pixels (Sprint 9b). */
export type ExportScale = 1 | 2;

/** What `GET /studio/access` answers: whether premium looks are open to this workspace. */
export interface StudioAccess {
  premium: boolean;
}

/** One design in the top bar's search (Sprint 9b), in the `designs` group of `GET /search`. */
export interface DesignSearchHit {
  id: string;
  title: string;
  format: FormatId;
  updatedAt: string;
  /** The first exported slide's thumbnail, while it is still in the library. */
  thumbnailUrl: string | null;
}

/**
 * A picture a design draws, as the browser loads it. Keyed by media id in
 * every map below; an id that is missing from a map is a picture that was
 * deleted, which the editor shows as an empty slot with its warning.
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
  /** The linked kit's name as it is now, for the card (Sprint 9b). Null without a live kit. */
  brandKitName: string | null;
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
   * The design with its first slide only: enough for the real renderer to
   * draw the thumbnail at card size. A stored image would go stale every time
   * a theme or a word changed; the renderer is always current. Null when the
   * stored document cannot be read by this version, which the card says.
   */
  cover: DesignDocument | null;
  /** The pictures the cover slide draws. */
  coverMedia: Record<string, StudioMediaRef>;
}

/** A platform frame Preview can draw. */
export type PreviewPlatformId = 'instagram' | 'facebook' | 'linkedin' | 'x';

/** One frame Preview offers, decided by `preview-platforms.ts`. */
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

/**
 * What an editor save answers: enough to carry on (the new revision to save
 * against next) without echoing back the document it just sent.
 */
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

export interface BrandKitView {
  id: string;
  name: string;
  description: string | null;
  websiteUrl: string | null;
  logoMediaId: string | null;
  /** Null when there is no logo, or when the media item behind it was deleted. */
  logoUrl: string | null;
  colors: BrandColors;
  /**
   * The kit's faces (Sprint 9b), copied into a design with its colours. Null
   * keeps the theme's, and so does a face the font library no longer has.
   */
  headingFont: FontId | null;
  bodyFont: FontId | null;
  /** Lock Brand Look: while this kit is applied, the editor hides what would change it. */
  lockLook: boolean;
  /** What a new design's closing slide starts with, and the link shown under it. */
  ctaText: string | null;
  ctaUrl: string | null;
  source: 'MANUAL' | 'EXTRACTED';
  createdAt: string;
  /** The editor compares this with a design's `brand.kitVersion` to offer Update From Kit. */
  updatedAt: string;
}

/** One logo found on a website, before anything is saved. */
export interface LogoCandidate {
  /** A `data:` URI, so the review screen shows it without a second request. */
  preview: string;
  /** Where it came from, for the "picked the wrong one" case. */
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

/** What `GET /public/design-shares/:token` answers. No workspace id, no design id. */
export interface SharedDesignView {
  title: string;
  workspaceName: string;
  format: FormatId;
  caption: string;
  document: DesignDocument;
  /** The pictures the slides draw, keyed by media id. */
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

/**
 * The events `POST /studio/designs/:id/export` and `.../send` stream, each
 * as an SSE event named by its `type`.
 *
 * `warning` never stops anything: the stories ask Export and Send to warn and
 * name the slide (DS-4.4), not to refuse. `error` is always the last event
 * of a stream that failed, and lists what was saved before it.
 */
export type StudioExportEvent =
  | {
      type: 'start';
      slides: number;
      format: FormatId;
      /** The pictures' own pixels: the format's size times `scale`. */
      width: number;
      height: number;
      imageFormat: ExportImageFormat;
      scale: ExportScale;
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
      /** The slide that failed, when one did. */
      slideIndex: number | null;
      savedMediaIds: string[];
    };
