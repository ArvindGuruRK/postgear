/**
 * `POST /clips/montages` (Sprint 13, Module 11): the clips in order, the
 * shape, how the clips meet and an optional opening title.
 *
 * - `clipIds` is bounded loosely here (1 to 50, each once) so the real rule,
 *   2 to 15 clips, is the engine's and answers as a coded 422
 *   (`montage_too_few`, `montage_too_many`) with its sentence, never as
 *   "Invalid input".
 * - `titleCard` is one plain line, cleaned like a clip title (emoji are
 *   stickers, never card text), within the card's own cap; an empty or blank
 *   line means no card.
 */
import { CARD_TEXT_MAX, RATIOS, stripEmoji } from '@postgear/video-engine';
import { z } from 'zod';
import { stripControlChars } from '../../../common/sanitize';

/** The most ids one montage request takes (the bulk routes' cap). */
export const MONTAGE_REQUEST_MAX_IDS = 50;

const titleCard = z
  .string()
  // Room for padding the cleanup removes; the real limit is after it.
  .max(CARD_TEXT_MAX * 4)
  .transform((text) => stripEmoji(stripControlChars(text)).replace(/\s+/g, ' ').trim())
  .pipe(z.string().max(CARD_TEXT_MAX))
  .transform((text) => (text.length > 0 ? text : null));

export const createMontageSchema = z
  .object({
    clipIds: z
      .array(z.string().uuid())
      .min(1)
      .max(MONTAGE_REQUEST_MAX_IDS)
      .refine((ids) => new Set(ids).size === ids.length, 'A clip is listed twice'),
    ratio: z.enum(RATIOS).optional(),
    transition: z.enum(['cut', 'fade']),
    titleCard: titleCard.nullable().optional(),
  })
  .strict();
export type CreateMontageInput = z.infer<typeof createMontageSchema>;
