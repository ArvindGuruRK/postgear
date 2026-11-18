/**
 * Saved layouts (Sprint 12, Module 10 section 6): bodies and the query.
 * `.strict()` like every schema in this API.
 *
 * The layout itself is the engine's `layoutSchema`, the very shape a clip
 * document carries, so a saved layout always applies cleanly. A name is
 * cleaned (control characters out, whitespace collapsed, trimmed) before
 * its length is judged.
 */
import { layoutSchema, RATIOS } from '@postgear/video-engine';
import { z } from 'zod';
import { stripControlChars } from '../../../common/sanitize';

export const MAX_LAYOUT_NAME_LENGTH = 60;
/** Per workspace; enough for a team's looks, small enough that a script cannot fill the table. */
export const MAX_SAVED_LAYOUTS = 50;

const layoutName = z
  .string()
  // Room for padding the cleanup removes; the real limit is after it.
  .max(MAX_LAYOUT_NAME_LENGTH * 4)
  .transform((text) => stripControlChars(text).replace(/\s+/g, ' ').trim())
  .pipe(z.string().min(1).max(MAX_LAYOUT_NAME_LENGTH));

const ratio = z.enum(RATIOS);

export const createLayoutSchema = z
  .object({ name: layoutName, ratio, layout: layoutSchema })
  .strict();
export type CreateLayoutInput = z.infer<typeof createLayoutSchema>;

export const renameLayoutSchema = z.object({ name: layoutName }).strict();
export type RenameLayoutInput = z.infer<typeof renameLayoutSchema>;

export const listLayoutsQuerySchema = z.object({ ratio: ratio.optional() }).strict();
export type ListLayoutsQuery = z.infer<typeof listLayoutsQuerySchema>;
