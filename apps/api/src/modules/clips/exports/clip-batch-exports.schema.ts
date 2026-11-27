/**
 * Export All's bodies and queries (Sprint 13, Module 11). `.strict()`
 * objects, as every Clips route.
 *
 * - `POST /clips/exports` takes 1 to 30 distinct clip ids and the quality
 *   asked for. A repeated id is refused (the dialog never sends one), so a
 *   batch's list has one row per clip.
 * - `GET /clips/exports/batches` lists the person's open batches; `open=1`
 *   is the only listing there is, so the flag may also be left out.
 */
import { EXPORT_QUALITIES } from '@postgear/video-engine';
import { z } from 'zod';

/** The most clips one Export All may take. */
export const BATCH_EXPORT_MAX_CLIPS = 30;

export const batchExportSchema = z
  .object({
    clipIds: z
      .array(z.string().uuid())
      .min(1)
      .max(BATCH_EXPORT_MAX_CLIPS)
      .refine((ids) => new Set(ids).size === ids.length),
    quality: z.enum(EXPORT_QUALITIES),
  })
  .strict();
export type BatchExportInput = z.infer<typeof batchExportSchema>;

export const listBatchesQuerySchema = z.object({ open: z.enum(['1']).optional() }).strict();
export type ListBatchesQuery = z.infer<typeof listBatchesQuerySchema>;
