/**
 * Queries and bodies of the operator's Library routes (Sprint 12, Module 19
 * section 9). Strict: an unknown key is refused. Nothing here takes a source
 * address: the ingest is a script on the media worker box, and these routes
 * only review and manage what it staged.
 */
import { z } from 'zod';
import { stripControlChars } from '../../../common/sanitize';
import { operatorReason } from '../clips/operator-clips.schema';

export const LIBRARY_ITEM_TYPES = ['sticker', 'sound'] as const;
export type OperatorLibraryItemType = (typeof LIBRARY_ITEM_TYPES)[number];

export const LIBRARY_STATUSES = ['STAGED', 'ACTIVE', 'HIDDEN', 'REMOVED'] as const;
export type LibraryStatus = (typeof LIBRARY_STATUSES)[number];

/** Items a page of the Library screen lists. */
export const LIBRARY_ITEMS_PAGE_SIZE = 25;

export const libraryItemsQuerySchema = z
  .object({
    type: z.enum(LIBRARY_ITEM_TYPES),
    status: z.enum(LIBRARY_STATUSES).optional(),
    /** `static` or `animated` for stickers, `sfx` or `music` for sounds. */
    kind: z.enum(['static', 'animated', 'sfx', 'music']).optional(),
    category: z
      .string()
      .regex(/^[a-z][a-z-]{0,39}$/)
      .optional(),
    /** The adapter an item came from (`kenney`, `openverse`...). */
    origin: z
      .string()
      .regex(/^[a-z][a-z0-9-]{0,39}$/)
      .optional(),
    q: z.string().max(100).optional(),
    runId: z.string().uuid().optional(),
    page: z.coerce.number().int().min(1).max(1000).default(1),
  })
  .strict();
export type LibraryItemsQuery = z.infer<typeof libraryItemsQuerySchema>;

export const libraryReasonSchema = z.object({ reason: operatorReason }).strict();
export type LibraryReasonInput = z.infer<typeof libraryReasonSchema>;

/** The Publish Run dialog's tick: "I listened to a sample and checked the licences." */
export const publishRunSchema = z.object({ reviewed: z.literal(true) }).strict();
export type PublishRunInput = z.infer<typeof publishRunSchema>;

/** Free text for the credits page: cleaned, trimmed, empty means none. */
function creditText(max: number) {
  return z
    .string()
    .transform((value) => stripControlChars(value).trim())
    .pipe(z.string().max(max))
    .transform((value) => (value === '' ? null : value))
    .nullable();
}

/** Only the words the credits page prints; the licence and the source's address never change here. */
export const patchSourceSchema = z
  .object({
    creditLine: creditText(500).optional(),
    changeNote: creditText(500).optional(),
    noticeText: creditText(5000).optional(),
    reason: operatorReason,
  })
  .strict()
  .refine(
    (body) =>
      body.creditLine !== undefined ||
      body.changeNote !== undefined ||
      body.noticeText !== undefined,
    { message: 'nothing to change' },
  );
export type PatchSourceInput = z.infer<typeof patchSourceSchema>;
