/**
 * Bodies for one clip's routes (Sprint 12, Module 05). `.strict()` objects;
 * the range's real rules (3 seconds to 30 minutes, inside the video) are the
 * engine's and the service's, answered as 422 `clip_range_invalid`.
 */
import { EXPORT_QUALITIES } from '@postgear/video-engine';
import { z } from 'zod';

/** Whole milliseconds, up to a day: no video is longer. */
const ms = z
  .number()
  .int()
  .min(0)
  .max(24 * 60 * 60_000);

export const createClipSchema = z
  .object({
    videoId: z.string().uuid(),
    fromMs: ms,
    toMs: ms,
  })
  .strict();
export type CreateClipInput = z.infer<typeof createClipSchema>;

export const exportClipSchema = z.object({ quality: z.enum(EXPORT_QUALITIES) }).strict();
export type ExportClipInput = z.infer<typeof exportClipSchema>;
