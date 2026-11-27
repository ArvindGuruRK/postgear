/**
 * Bodies and queries for the clip routes (Sprint 12, Modules 05 and 07 to
 * 09). `.strict()` objects; the range's real rules (3 seconds to 30
 * minutes, inside the video) are the engine's and the service's, answered as
 * 422 `clip_range_invalid`.
 *
 * - `POST /clips` takes exactly one of a range (`fromMs`, `toMs`) or
 *   `whole: true` (Edit Whole Video): two strict shapes, so a body with both
 *   matches neither and is refused.
 * - `PATCH /clips/:clipId` carries the revision it was made from and at
 *   least one change. `document` is checked here only as "a JSON object";
 *   the engine's `parseClipDocument` decides, in the service, so a refusal
 *   is our sentence (`clip_document_invalid`) and never Zod's text.
 * - `status` from a client is DRAFT or HIDDEN only: NEW is the AI's, and
 *   exported and scheduled are states, not statuses.
 */
import { MAX_CAPTION_LENGTH } from '@postgear/design-engine';
import { EXPORT_QUALITIES } from '@postgear/video-engine';
import { z } from 'zod';
import { collapseWhitespace, stripControlChars } from '../../../common/sanitize';
import { MAX_SEARCH_LENGTH } from '../../../common/search-terms';
import { MAX_CHANNELS_PER_POST } from '../../posts/dto/posts.schema';
import { CLIP_STATUS_FILTERS } from './clip-state';

/** Whole milliseconds, up to a day: no video is longer. */
const ms = z
  .number()
  .int()
  .min(0)
  .max(24 * 60 * 60_000);

const rangeClipSchema = z
  .object({
    videoId: z.string().uuid(),
    fromMs: ms,
    toMs: ms,
  })
  .strict();

const wholeClipSchema = z
  .object({
    videoId: z.string().uuid(),
    whole: z.literal(true),
  })
  .strict();

export const createClipSchema = z.union([rangeClipSchema, wholeClipSchema]);
export type CreateClipInput = z.infer<typeof createClipSchema>;

/**
 * Module 15: `revision` is the one the person is looking at; a newer one
 * saved elsewhere is 409 `clip_changed_elsewhere`. Without it the clip's
 * current revision is exported (the Module 05 shape still works).
 */
export const exportClipSchema = z
  .object({
    quality: z.enum(EXPORT_QUALITIES),
    revision: z.number().int().min(1).optional(),
  })
  .strict();
export type ExportClipInput = z.infer<typeof exportClipSchema>;

/** Preview Export (Module 15): only the revision; an empty body previews the current one. */
export const previewClipSchema = z
  .object({ revision: z.number().int().min(1).optional() })
  .strict()
  .default({});
export type PreviewClipInput = z.infer<typeof previewClipSchema>;

/** A clip's name: the same cap as the titles the server writes. */
export const MAX_CLIP_TITLE_LENGTH = 200;

const clipTitle = z
  .string()
  // Room for padding the cleanup removes; the real limit is after it.
  .max(MAX_CLIP_TITLE_LENGTH * 4)
  .transform((text) => stripControlChars(text).replace(/\s+/g, ' ').trim())
  .pipe(z.string().min(1).max(MAX_CLIP_TITLE_LENGTH));

export const patchClipSchema = z
  .object({
    revision: z.number().int().min(1),
    title: clipTitle.optional(),
    status: z.enum(['DRAFT', 'HIDDEN']).optional(),
    document: z.record(z.unknown()).optional(),
  })
  .strict()
  .refine(
    (body) => body.title !== undefined || body.status !== undefined || body.document !== undefined,
    'Nothing to change',
  );
export type PatchClipInput = z.infer<typeof patchClipSchema>;

/** Module 11: the most clips one bulk Hide, Unhide or Delete acts on. */
export const BULK_MAX_CLIPS = 50;

const bulkClipIds = z
  .array(z.string().uuid())
  .min(1)
  .max(BULK_MAX_CLIPS)
  .refine((ids) => new Set(ids).size === ids.length, 'A clip is listed twice');

/**
 * `PATCH /clips/bulk` (Module 11): Hide and Unhide on many clips, with the
 * same status field the single PATCH takes. No revision: a status says
 * nothing about the picture, so it never needs to win a save race.
 */
export const bulkPatchClipsSchema = z
  .object({ clipIds: bulkClipIds, status: z.enum(['DRAFT', 'HIDDEN']) })
  .strict();
export type BulkPatchClipsInput = z.infer<typeof bulkPatchClipsSchema>;

/** `DELETE /clips/bulk` (Module 11). */
export const bulkDeleteClipsSchema = z.object({ clipIds: bulkClipIds }).strict();
export type BulkDeleteClipsInput = z.infer<typeof bulkDeleteClipsSchema>;

export const moreVideoSchema = z
  .object({ fromMs: ms, toMs: ms })
  .strict()
  .refine((body) => body.fromMs < body.toMs, 'A range must end after it starts');
export type MoreVideoInput = z.infer<typeof moreVideoSchema>;

export const CLIP_SOURCES = ['youtube', 'twitch', 'kick', 'upload'] as const;
export type ClipSource = (typeof CLIP_SOURCES)[number];

export const CLIPS_PAGE_SIZE = 24;

/** `source=twitch&source=kick` or `source=twitch,kick`: one list of distinct sources. */
const sourcesParam = z
  .union([z.string().max(100), z.array(z.string().max(100)).max(8)])
  .transform((value) =>
    (Array.isArray(value) ? value : [value])
      .flatMap((part) => part.split(','))
      .map((part) => part.trim())
      .filter((part) => part.length > 0),
  )
  .pipe(z.array(z.enum(CLIP_SOURCES)).max(CLIP_SOURCES.length * 2))
  .transform((sources) => [...new Set(sources)]);

export const listClipsQuerySchema = z
  .object({
    status: z.enum(CLIP_STATUS_FILTERS).default('all'),
    videoId: z.string().uuid().optional(),
    source: sourcesParam.optional(),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    sort: z.enum(['newest', 'oldest']).default('newest'),
    /**
     * Module 17, the composer's Clips tab: only clips with an exported file
     * (whatever their state, so a scheduled clip or one changed since its
     * export is still offered), and hidden ones left out.
     */
    withExport: z.enum(['true', 'false']).optional(),
    /** Module 17: words of the clip's name, as the Media Library's search. */
    q: z
      .string()
      .max(MAX_SEARCH_LENGTH * 2)
      .transform((value) =>
        collapseWhitespace(stripControlChars(value)).slice(0, MAX_SEARCH_LENGTH),
      )
      .optional(),
  })
  .strict();
export type ListClipsQuery = z.infer<typeof listClipsQuerySchema>;

/**
 * `POST /clips/:clipId/send` (Module 17): the channels the draft starts
 * with (one to twenty, each once) and the caption every channel starts from
 * (cleaned as Studio's is; at most Studio's caption cap, and the composer
 * measures it per platform). `oldVersion` sends the last export of a clip
 * changed since, when the person chose Send The Old Version.
 */
export const sendClipSchema = z
  .object({
    channelIds: z
      .array(z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'Not a valid id'))
      .min(1, 'Choose at least one channel')
      .max(MAX_CHANNELS_PER_POST)
      .refine((ids) => new Set(ids).size === ids.length, 'A channel is listed twice'),
    caption: z
      .string()
      .max(MAX_CAPTION_LENGTH * 2)
      .transform((value) => stripControlChars(value).replace(/\r\n?/g, '\n').trim())
      .pipe(z.string().max(MAX_CAPTION_LENGTH))
      .default(''),
    oldVersion: z.boolean().optional(),
  })
  .strict();
export type SendClipInput = z.infer<typeof sendClipSchema>;
