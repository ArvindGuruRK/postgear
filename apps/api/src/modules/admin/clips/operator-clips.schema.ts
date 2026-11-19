/**
 * Bodies of the operator's Clips routes (Sprint 12, Module 19 section 5).
 * Strict: an unknown key is refused. A reason is required on every operator
 * write (at least 10 characters, cleaned of control characters first).
 */
import { z } from 'zod';
import { stripControlChars } from '../../../common/sanitize';

export const operatorReason = z
  .string()
  .transform((value) => stripControlChars(value).trim())
  .pipe(z.string().min(10).max(500));

export const removeVideoSchema = z.object({ reason: operatorReason }).strict();
export type RemoveVideoInput = z.infer<typeof removeVideoSchema>;
