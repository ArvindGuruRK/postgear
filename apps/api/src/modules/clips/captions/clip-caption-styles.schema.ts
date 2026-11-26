/**
 * Request shapes for a workspace's own caption styles (Sprint 13, Module 03).
 * Strict; the look is the engine's `captionLookSchema`, so a style the export
 * cannot draw (an outline and a box at once) is refused here, with our words.
 */
import { captionLookSchema } from '@postgear/video-engine';
import { z } from 'zod';
import { stripControlChars } from '../../../common/sanitize';

export const MAX_CAPTION_STYLE_NAME_LENGTH = 40;

const styleName = z
  .string()
  // Room for padding the cleanup removes; the real limit is after it.
  .max(MAX_CAPTION_STYLE_NAME_LENGTH * 4)
  .transform((text) => stripControlChars(text).replace(/\s+/g, ' ').trim())
  .pipe(z.string().min(1).max(MAX_CAPTION_STYLE_NAME_LENGTH));

export const createCaptionStyleSchema = z
  .object({ name: styleName, look: captionLookSchema })
  .strict();
export type CreateCaptionStyleInput = z.infer<typeof createCaptionStyleSchema>;

/** A new name, a new look, or both. */
export const updateCaptionStyleSchema = z
  .object({ name: styleName.optional(), look: captionLookSchema.optional() })
  .strict()
  .refine((body) => body.name !== undefined || body.look !== undefined, 'Nothing to change');
export type UpdateCaptionStyleInput = z.infer<typeof updateCaptionStyleSchema>;
