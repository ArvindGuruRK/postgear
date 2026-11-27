/**
 * `PATCH /clips/brand-kits/:id` (Sprint 13, Module 10): the clip fields only
 * (Studio's own fields stay on Studio's routes). Strict, at least one field.
 */
import { z } from 'zod';
import { clipBrandFields } from './clip-brand-fields';

export const clipBrandKitPatchSchema = z
  .object(clipBrandFields)
  .strict()
  .refine((body) => Object.keys(body).length > 0, 'Nothing to save');
export type ClipBrandKitPatch = z.infer<typeof clipBrandKitPatchSchema>;
