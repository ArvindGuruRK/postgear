/**
 * Request shapes for Auto-Edit Video (Sprint 13, Module 10). Strict, like
 * every Clips body. The recipe is a starter id or a uuid (checked again by
 * the service against the workspace); the range is video time, and only
 * matters for a video longer than Auto-Edit takes at once.
 */
import { DEFAULT_AUTO_EDIT_RECIPE, recipeIdSchema } from '@postgear/video-engine';
import { z } from 'zod';

/** No real video is longer than this; a bigger number is a broken request. */
const MAX_VIDEO_MS = 24 * 60 * 60_000;

const rangeSchema = z
  .object({
    fromMs: z.number().int().min(0).max(MAX_VIDEO_MS),
    toMs: z.number().int().min(1).max(MAX_VIDEO_MS),
  })
  .strict()
  .refine((range) => range.fromMs < range.toMs, 'A range must end after it starts');

/** `POST /clips/videos/:videoId/auto-edit` and `.../auto-edit/price`. */
export const autoEditSchema = z
  .object({
    recipeId: recipeIdSchema.default(DEFAULT_AUTO_EDIT_RECIPE),
    range: rangeSchema.optional(),
  })
  .strict();
export type AutoEditBody = z.infer<typeof autoEditSchema>;
