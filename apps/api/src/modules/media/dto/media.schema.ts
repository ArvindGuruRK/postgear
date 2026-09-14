/**
 * Query schema for the media library.
 *
 * `.strict()` like every other schema in the API: an unexpected query key is a
 * client bug or a probe, and either is better surfaced than ignored.
 */
import { z } from 'zod';

export const MEDIA_PAGE_SIZE = 24;

export const listMediaQuerySchema = z
  .object({
    search: z.string().trim().max(200).optional(),
    type: z.enum(['image', 'video']).optional(),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
  })
  .strict();

export type ListMediaQuery = z.infer<typeof listMediaQuerySchema>;
