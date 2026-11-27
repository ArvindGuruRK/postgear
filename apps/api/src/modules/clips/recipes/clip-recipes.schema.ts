/**
 * Recipe bodies (Sprint 13, Module 10). Strict, like every Clips body. The
 * settings are the engine's `recipeSettingsSchema` (versioned, every field
 * optional, strict), so a stored recipe always applies. A name is cleaned
 * (control characters out, whitespace collapsed, trimmed) before its length
 * is judged: 1 to `RECIPE_NAME_MAX`.
 */
import { RECIPE_NAME_MAX, recipeSettingsSchema } from '@postgear/video-engine';
import { z } from 'zod';
import { collapseWhitespace, stripControlChars } from '../../../common/sanitize';

export const recipeName = z
  .string()
  // Room for padding the cleanup removes; the real limit is after it.
  .max(RECIPE_NAME_MAX * 4)
  .transform((text) => collapseWhitespace(stripControlChars(text)))
  .pipe(z.string().min(1).max(RECIPE_NAME_MAX));

/** A starter id or a uuid; anything else is a 404 before a query. */
const recipeId = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/);

/** A Studio brand kit's id (a uuid, or a readable one for a kit seeded by hand). */
const brandKitIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/);

export const createRecipeSchema = z
  .object({
    name: recipeName,
    settings: recipeSettingsSchema,
    brandKitId: brandKitIdSchema.nullable().optional(),
  })
  .strict();
export type CreateRecipeInput = z.infer<typeof createRecipeSchema>;

export const updateRecipeSchema = z
  .object({
    name: recipeName.optional(),
    settings: recipeSettingsSchema.optional(),
    brandKitId: brandKitIdSchema.nullable().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, 'Nothing to save');
export type UpdateRecipeInput = z.infer<typeof updateRecipeSchema>;

/** `POST /clips/:clipId/apply-recipe`. */
export const applyRecipeSchema = z.object({ recipeId }).strict();
export type ApplyRecipeInput = z.infer<typeof applyRecipeSchema>;
