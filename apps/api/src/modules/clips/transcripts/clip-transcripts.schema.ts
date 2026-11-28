/** Request shapes for the transcript routes (Sprint 13, Module 02). Strict, like every Clips body. */
import { z } from 'zod';
import { transcriptFormatSchema } from './transcript-download';

const ms = z.coerce
  .number()
  .int()
  .min(0)
  .max(24 * 60 * 60 * 1000);
const language = z.string().regex(/^(?:auto|[a-z]{2,3})$/, 'A language is "auto" or a short code');

/** `POST /clips/videos/:videoId/transcript`: the stretch to listen to (the whole video when absent). */
export const ensureTranscriptSchema = z
  .object({
    fromMs: ms.optional(),
    toMs: ms.optional(),
    language: language.optional(),
  })
  .strict()
  .refine(
    (body) => body.fromMs === undefined || body.toMs === undefined || body.fromMs < body.toMs,
    'A range must end after it starts',
  );
export type EnsureTranscriptInput = z.infer<typeof ensureTranscriptSchema>;

/** `GET /clips/videos/:videoId/transcript?fromMs&toMs&language`. */
export const readTranscriptQuerySchema = z
  .object({
    fromMs: ms.optional(),
    toMs: ms.optional(),
    language: language.optional(),
  })
  .strict();
export type ReadTranscriptQuery = z.infer<typeof readTranscriptQuerySchema>;

const fixText = z.string().trim().min(1).max(80);

/**
 * `PATCH /clips/videos/:videoId/transcript/words`: fixes by word index, or
 * Replace Everywhere, never both. An empty `text` is not a fix (hiding a word
 * in one clip is the clip's own caption edit).
 */
export const fixWordsSchema = z.union([
  z
    .object({
      language: language.optional(),
      fixes: z
        .array(z.object({ index: z.number().int().min(0), text: fixText }).strict())
        .min(1)
        .max(200),
    })
    .strict(),
  z
    .object({
      language: language.optional(),
      replace: z.object({ from: fixText, to: fixText }).strict(),
    })
    .strict(),
  z
    .object({
      language: language.optional(),
      /** Word indexes whose fix is taken away (the word reads as heard again). */
      restore: z.array(z.number().int().min(0)).min(1).max(200),
    })
    .strict(),
]);
export type FixWordsInput = z.infer<typeof fixWordsSchema>;

/** `GET /clips/videos/:videoId/transcript/download` (Module 17 item 10). */
export const transcriptDownloadQuerySchema = z
  .object({ format: transcriptFormatSchema, language: language.optional() })
  .strict();
export type TranscriptDownloadQuery = z.infer<typeof transcriptDownloadQuerySchema>;
