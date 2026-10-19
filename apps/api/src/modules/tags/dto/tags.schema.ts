/**
 * Request schemas for post tags (2026-10-19, after Postiz's tags).
 *
 * `.strict()` like every schema in this API. A name is cleaned (control and
 * invisible characters out, runs of whitespace collapsed, ends trimmed) before
 * its length is judged, so "  Launch " and "Launch" are the same name and a
 * zero-width space cannot make two tags that look identical.
 *
 * The colour is a palette *name*, not a hex value: every colour in the app
 * comes from a theme token, and `TAG_COLORS` is the same list the web keeps in
 * `apps/web/src/types/tag.ts`. A value outside it is refused rather than
 * stored for the browser to guess at.
 */
import { z } from 'zod';
import { stripControlChars } from '../../../common/sanitize';

export const TAG_COLORS = ['violet', 'teal', 'green', 'yellow', 'orange', 'rose', 'cyan'] as const;
export type TagColor = (typeof TAG_COLORS)[number];

export const MAX_TAG_NAME_LENGTH = 40;

/**
 * Generous on purpose: it exists so a runaway script cannot fill the table,
 * not to ration a real workspace's labels.
 */
export const MAX_TAGS_PER_WORKSPACE = 200;

const nameText = z
  .string()
  // Room for padding that the cleanup removes; the real limit is after it.
  .max(MAX_TAG_NAME_LENGTH * 4)
  .transform((text) => stripControlChars(text).replace(/\s+/g, ' ').trim())
  .pipe(z.string().min(1).max(MAX_TAG_NAME_LENGTH));

const colorName = z.enum(TAG_COLORS);

export const createTagSchema = z.object({ name: nameText, color: colorName }).strict();

export const updateTagSchema = z
  .object({ name: nameText.optional(), color: colorName.optional() })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Nothing to update');

export type CreateTagInput = z.infer<typeof createTagSchema>;
export type UpdateTagInput = z.infer<typeof updateTagSchema>;
