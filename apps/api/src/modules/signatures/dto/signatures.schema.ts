/**
 * Request schemas for signatures (2026-10-19, after Postiz's).
 *
 * A signature is plain text that the composer inserts as paragraphs, so line
 * breaks are kept (Windows ones normalised) while control and invisible
 * characters go, and the ends are trimmed before the length is judged.
 */
import { z } from 'zod';
import { stripControlChars } from '../../../common/sanitize';

export const MAX_SIGNATURE_LENGTH = 2_000;

/** Generous; it exists so a runaway script cannot fill the table. */
export const MAX_SIGNATURES_PER_WORKSPACE = 50;

const contentText = z
  .string()
  .max(MAX_SIGNATURE_LENGTH * 2)
  .transform((text) => stripControlChars(text).replace(/\r\n?/g, '\n').trim())
  .pipe(z.string().min(1).max(MAX_SIGNATURE_LENGTH));

export const createSignatureSchema = z
  .object({ content: contentText, autoAdd: z.boolean() })
  .strict();

export const updateSignatureSchema = z
  .object({ content: contentText.optional(), autoAdd: z.boolean().optional() })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Nothing to update');

export type CreateSignatureInput = z.infer<typeof createSignatureSchema>;
export type UpdateSignatureInput = z.infer<typeof updateSignatureSchema>;
