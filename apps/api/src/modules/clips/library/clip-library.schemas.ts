/**
 * The library and upload routes' inputs (Modules 12 and 14), strict Zod.
 */
import {
  LIBRARY_PAGE_SIZE_DEFAULT,
  LIBRARY_PAGE_SIZE_MAX,
  SOUND_CATEGORIES,
  SOUND_KINDS,
  STICKER_CATEGORIES,
  STICKER_KINDS,
} from '@postgear/video-engine';
import { z } from 'zod';

/** The longest search kept, in characters. */
export const LIBRARY_QUERY_MAX = 80;
/** The most stickers one lookup reads. */
export const STICKER_LOOKUP_MAX = 60;

export const searchStickersQuerySchema = z
  .object({
    q: z.string().max(LIBRARY_QUERY_MAX).optional(),
    kind: z.enum(STICKER_KINDS).optional(),
    category: z.enum(STICKER_CATEGORIES).optional(),
    /** `true` lists the workspace's starred stickers only. */
    favourites: z.enum(['true', 'false']).optional(),
    page: z.coerce.number().int().min(1).max(1_000).default(1),
    pageSize: z.coerce
      .number()
      .int()
      .min(1)
      .max(LIBRARY_PAGE_SIZE_MAX)
      .default(LIBRARY_PAGE_SIZE_DEFAULT),
  })
  .strict();
export type SearchStickersQuery = z.infer<typeof searchStickersQuerySchema>;

/** `GET /clips/library/sounds` (Module 14): the Sound Effects, Music and Favourites tabs. */
export const searchSoundsQuerySchema = z
  .object({
    q: z.string().max(LIBRARY_QUERY_MAX).optional(),
    kind: z.enum(SOUND_KINDS).optional(),
    category: z.enum(SOUND_CATEGORIES).optional(),
    /** `true` lists the workspace's starred sounds only. */
    favourites: z.enum(['true', 'false']).optional(),
    page: z.coerce.number().int().min(1).max(1_000).default(1),
    pageSize: z.coerce
      .number()
      .int()
      .min(1)
      .max(LIBRARY_PAGE_SIZE_MAX)
      .default(LIBRARY_PAGE_SIZE_DEFAULT),
  })
  .strict();
export type SearchSoundsQuery = z.infer<typeof searchSoundsQuerySchema>;

/** Stickers by default; `type=sound` takes a sound kind (`sfx`, `music`). */
export const categoriesQuerySchema = z.union([
  z
    .object({
      type: z.literal('sticker').default('sticker'),
      kind: z.enum(STICKER_KINDS).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('sound'),
      kind: z.enum(SOUND_KINDS).optional(),
    })
    .strict(),
]);
export type CategoriesQuery = z.infer<typeof categoriesQuerySchema>;

/** What a favourite stars. */
export const LIBRARY_ITEM_TYPES = ['sticker', 'sound'] as const;
export type LibraryItemType = (typeof LIBRARY_ITEM_TYPES)[number];

export const favouriteBodySchema = z
  .object({
    type: z.enum(LIBRARY_ITEM_TYPES),
    itemId: z.string().uuid(),
  })
  .strict();
export type FavouriteBody = z.infer<typeof favouriteBodySchema>;

/** `library=a,b` or `library=a&library=b`: one list of distinct ids. */
const idList = z
  .union([
    z.string().max(STICKER_LOOKUP_MAX * 37),
    z.array(z.string().max(40)).max(STICKER_LOOKUP_MAX),
  ])
  .transform((value) => [
    ...new Set(
      (Array.isArray(value) ? value : [value]).flatMap((part) => part.split(',')).filter(Boolean),
    ),
  ])
  .pipe(z.array(z.string().uuid()).max(STICKER_LOOKUP_MAX));

/** `GET /clips/stickers/files?library=<ids>&asset=<ids>`: comma lists. */
export const stickerFilesQuerySchema = z
  .object({
    library: idList.optional(),
    asset: idList.optional(),
  })
  .strict();
export type StickerFilesQuery = z.infer<typeof stickerFilesQuerySchema>;

/** `GET /clips/sounds/files?library=<ids>&asset=<ids>` (Module 14): the same comma lists. */
export const soundFilesQuerySchema = z
  .object({
    library: idList.optional(),
    asset: idList.optional(),
  })
  .strict();
export type SoundFilesQuery = z.infer<typeof soundFilesQuerySchema>;
