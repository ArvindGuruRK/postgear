/**
 * What a browser may send to Studio.
 *
 * Every body is `.strict()`, like the rest of the API. The interesting one is
 * the design document: it is not re-described here, it is
 * `designDocumentSchema` from `@postgear/design-engine`, the same schema the
 * editor validates against. One definition, two users, no drift, and the
 * guarantee that a client cannot store an element the renderer never draws.
 *
 * The format enum is the one place the Prisma enum (`SQUARE`) and the
 * engine's ids (`square`) meet. Both directions are written out and
 * `studio.schema.spec.ts` asserts the mapping is total, so adding a fifth
 * format fails the build rather than a request.
 */

import { DesignFormat } from '@postgear/db';
import {
  brandColorsSchema,
  designDocumentSchema,
  FORMAT_IDS,
  type FormatId,
  fontIdSchema,
  MAX_CAPTION_LENGTH,
  MAX_SLIDES,
  upgrade,
} from '@postgear/design-engine';
import { z } from 'zod';
import { collapseWhitespace, stripControlChars } from '../../../common/sanitize';
import { MAX_SEARCH_LENGTH } from '../../../common/search-terms';
import { MAX_CHANNELS_PER_POST } from '../../posts/dto/posts.schema';
import { STUDIO_MESSAGES } from '../studio.messages';

// ---------------------------------------------------------------------------
// Format
// ---------------------------------------------------------------------------

export const FORMAT_TO_COLUMN: Record<FormatId, DesignFormat> = {
  square: DesignFormat.SQUARE,
  portrait: DesignFormat.PORTRAIT,
  story: DesignFormat.STORY,
  landscape: DesignFormat.LANDSCAPE,
};

export const COLUMN_TO_FORMAT: Record<DesignFormat, FormatId> = {
  [DesignFormat.SQUARE]: 'square',
  [DesignFormat.PORTRAIT]: 'portrait',
  [DesignFormat.STORY]: 'story',
  [DesignFormat.LANDSCAPE]: 'landscape',
};

const formatSchema = z.enum(FORMAT_IDS);

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

/**
 * A row id: a uuid, or one of the readable ids the seeds use. Never a path,
 * a URL or anything with a space, so an id can be logged and put in a URL
 * without a second thought.
 */
const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'Not a valid id');

/** A preset id: lower-case words joined by hyphens, like every id in the library. */
export const presetIdSchema = z.string().regex(/^[a-z0-9-]{1,80}$/, 'Not a valid template id');

/**
 * One line a person typed: control characters out, runs of whitespace (a
 * pasted newline included) as one space, ends trimmed. The raw length is
 * bounded before the cleanup so the cleanup itself cannot be made expensive.
 */
function oneLine(max: number, required?: string) {
  const cleaned = z
    .string()
    .max(max * 4)
    .transform((value) => collapseWhitespace(stripControlChars(value)));

  return required
    ? cleaned.pipe(z.string().min(1, required).max(max))
    : cleaned.pipe(z.string().max(max));
}

// ---------------------------------------------------------------------------
// Designs
// ---------------------------------------------------------------------------

export const MAX_TITLE_LENGTH = 120;
export const DESIGNS_PAGE_SIZE = 24;
export const MAX_DESIGN_PAGE = 500;

export const createDesignSchema = z
  .object({
    /**
     * A preset from the code-side library, or "blank". The server builds the
     * document from it: the client never posts a document on create, so a new
     * design is always a faithful copy of the template.
     */
    presetId: presetIdSchema,
    format: formatSchema,
    brandKitId: idSchema.nullable().optional(),
    /** Overrides the preset's own name. */
    title: oneLine(MAX_TITLE_LENGTH, STUDIO_MESSAGES.TITLE_REQUIRED).optional(),
  })
  .strict();

/**
 * A design as an editor sends it, brought up to the current schema version
 * first. An editor tab opened before a release still holds the older shape
 * and saves it every few seconds; reading a design already upgrades it
 * (`safeParseDesignDocument`), so a save does the same rather than refusing
 * the tab's work with a 400 until somebody reloads. A version this release
 * cannot read is left as it came, and the schema refuses it.
 */
const savedDocumentSchema = z.preprocess((value) => {
  try {
    return upgrade(value);
  } catch {
    return value;
  }
}, designDocumentSchema);

export const updateDesignSchema = z
  .object({
    /** The revision the editor loaded. A mismatch is a 409, never a merge. */
    revision: z.number().int().min(1),
    title: oneLine(MAX_TITLE_LENGTH, STUDIO_MESSAGES.TITLE_REQUIRED).optional(),
    document: savedDocumentSchema.optional(),
    /** Where the editor was, so reopening lands on the same slide. */
    lastSlideIndex: z
      .number()
      .int()
      .min(0)
      .max(MAX_SLIDES - 1)
      .optional(),
  })
  .strict()
  .refine(
    (body) =>
      body.title !== undefined || body.document !== undefined || body.lastSlideIndex !== undefined,
    STUDIO_MESSAGES.NOTHING_TO_SAVE,
  );

export const listDesignsQuerySchema = z
  .object({
    search: z
      .string()
      .max(MAX_SEARCH_LENGTH * 4)
      .transform((value) =>
        collapseWhitespace(stripControlChars(value)).slice(0, MAX_SEARCH_LENGTH),
      )
      .optional(),
    format: formatSchema.optional(),
    status: z.enum(['DRAFT', 'EXPORTED', 'SENT']).optional(),
    page: z.coerce.number().int().min(1).max(MAX_DESIGN_PAGE).default(1),
  })
  .strict();

/**
 * Duplicate, and Make A Story Version (Sprint 9b): an optional format for the
 * copy. The plain Duplicate sends no body at all, which Express 5 leaves as
 * `undefined`, so a missing body is read as an empty one.
 */
export const duplicateDesignSchema = z.preprocess(
  (value) => value ?? {},
  z.object({ format: formatSchema.optional() }).strict(),
);

const imageFormatSchema = z.enum(['jpeg', 'png']);

export const exportDesignSchema = z
  .object({
    /**
     * JPEG by default, because the composer's Instagram rule accepts JPEG
     * only. PNG is offered for everything else.
     */
    imageFormat: imageFormatSchema.default('jpeg'),
    /**
     * 2 draws every slide at twice the format's size (2160 x 2160 for a
     * square), for print and for screens that show more than the platforms
     * serve (Sprint 9b). The layout is the same either way: the page is laid
     * out at the format's size and only painted at twice the pixels.
     */
    scale: z.union([z.literal(1), z.literal(2)]).default(1),
  })
  .strict();

/**
 * Download All's choice of file (Sprint 9b): the zip of slides, or one PDF
 * with a page per slide.
 */
export const downloadQuerySchema = z
  .object({
    format: z.enum(['zip', 'pdf']).default('zip'),
  })
  .strict();

export const sendDesignSchema = z
  .object({
    /**
     * The channels the draft starts with. Posts need at least one; the
     * composer is still where they are changed, scheduled and checked
     * against each platform's rules, as for any other post.
     */
    channelIds: z
      .array(idSchema)
      .min(1, 'Choose at least one channel')
      .max(MAX_CHANNELS_PER_POST)
      .refine((ids) => new Set(ids).size === ids.length, 'A channel is listed twice'),
    /**
     * The caption as Preview last showed it. Sent with the request rather
     * than read from the stored design, so an autosave still in flight cannot
     * leave the draft with the caption from before the last keystroke.
     */
    caption: z
      .string()
      .max(MAX_CAPTION_LENGTH * 2)
      .transform((value) => stripControlChars(value).replace(/\r\n?/g, '\n').trim())
      .pipe(z.string().max(MAX_CAPTION_LENGTH))
      .optional(),
    imageFormat: imageFormatSchema.default('jpeg'),
  })
  .strict();

// ---------------------------------------------------------------------------
// Brand kits
// ---------------------------------------------------------------------------

export const MAX_KIT_NAME_LENGTH = 120;
export const MAX_KIT_DESCRIPTION_LENGTH = 500;
export const MAX_URL_LENGTH = 2_048;
/**
 * The call to action a kit fills into a new design's closing slide (Sprint
 * 9b). One line each: the closing layouts give the call to action about 36
 * characters before the fitter starts shrinking it, and the link about 22.
 */
export const MAX_CTA_TEXT_LENGTH = 60;
export const MAX_CTA_URL_LENGTH = 60;

/**
 * A website as a person types it, with or without `https://`. Only bounded
 * here: whether it is a web address at all is decided in the service, which
 * answers with a sentence rather than "Invalid input".
 */
const websiteText = z
  .string()
  .max(MAX_URL_LENGTH)
  .transform((value) => stripControlChars(value).trim());

export const brandKitBodySchema = z
  .object({
    name: oneLine(MAX_KIT_NAME_LENGTH, STUDIO_MESSAGES.BRAND_KIT_NAME_REQUIRED),
    description: z
      .string()
      .max(MAX_KIT_DESCRIPTION_LENGTH * 4)
      .transform((value) => collapseWhitespace(stripControlChars(value)))
      .pipe(z.string().max(MAX_KIT_DESCRIPTION_LENGTH))
      .nullable()
      .optional(),
    websiteUrl: websiteText.nullable().optional(),
    logoMediaId: idSchema.nullable().optional(),
    colors: brandColorsSchema,
    source: z.enum(['MANUAL', 'EXTRACTED']).optional(),
    /** The kit's faces, from the engine's library; null keeps the theme's. */
    headingFont: fontIdSchema.nullable().optional(),
    bodyFont: fontIdSchema.nullable().optional(),
    /** Lock Brand Look: while this kit is applied, the editor hides what would change it. */
    lockLook: z.boolean().optional(),
    ctaText: oneLine(MAX_CTA_TEXT_LENGTH).nullable().optional(),
    /**
     * Shown on the slide as text ("yourbrand.com/offer"), never followed, so
     * it is not checked as an address; only that it is one word, which the
     * service answers with a sentence.
     */
    ctaUrl: z
      .string()
      .max(MAX_CTA_URL_LENGTH * 4)
      .transform((value) => stripControlChars(value).trim())
      .pipe(z.string().max(MAX_CTA_URL_LENGTH))
      .nullable()
      .optional(),
  })
  .strict();

export const updateBrandKitSchema = brandKitBodySchema
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0, STUDIO_MESSAGES.NOTHING_TO_SAVE);

export const extractBrandSchema = z
  .object({
    url: websiteText.pipe(z.string().min(1, STUDIO_MESSAGES.WEBSITE_INVALID)),
  })
  .strict();

// ---------------------------------------------------------------------------
// Favourites and shares
// ---------------------------------------------------------------------------

export const favouriteSchema = z.object({ presetId: presetIdSchema }).strict();

export const MIN_SHARE_DAYS = 1;
export const MAX_SHARE_DAYS = 30;
export const DEFAULT_SHARE_DAYS = 7;
/** Working links one design may have at once; each is a door into the workspace. */
export const MAX_ACTIVE_SHARES = 20;

export const createShareSchema = z
  .object({
    expiresInDays: z
      .number()
      .int()
      .min(MIN_SHARE_DAYS)
      .max(MAX_SHARE_DAYS)
      .default(DEFAULT_SHARE_DAYS),
  })
  .strict();

export type CreateDesignInput = z.infer<typeof createDesignSchema>;
export type UpdateDesignInput = z.infer<typeof updateDesignSchema>;
export type ListDesignsQuery = z.infer<typeof listDesignsQuerySchema>;
export type DuplicateDesignInput = z.infer<typeof duplicateDesignSchema>;
export type ExportDesignInput = z.infer<typeof exportDesignSchema>;
export type DownloadQuery = z.infer<typeof downloadQuerySchema>;
export type SendDesignInput = z.infer<typeof sendDesignSchema>;
export type BrandKitBody = z.infer<typeof brandKitBodySchema>;
export type UpdateBrandKitInput = z.infer<typeof updateBrandKitSchema>;
export type ExtractBrandInput = z.infer<typeof extractBrandSchema>;
export type FavouriteInput = z.infer<typeof favouriteSchema>;
export type CreateShareInput = z.infer<typeof createShareSchema>;
