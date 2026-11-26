/** Request shapes for a clip's captions routes (Sprint 13, Module 03). Strict, like every Clips body. */
import { z } from 'zod';

const language = z.string().regex(/^(?:auto|[a-z]{2,3})$/, 'A language is "auto" or a short code');
/** A built-in style's name or one of the workspace's own (a UUID). */
const styleId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/i, 'A style id');

/** `POST /clips/:clipId/captions`. */
export const addCaptionsSchema = z
  .object({ styleId: styleId.optional(), language: language.optional() })
  .strict();
export type AddCaptionsInput = z.infer<typeof addCaptionsSchema>;

/** The text fields beside the file of `POST /clips/:clipId/captions/from-file`. */
export const captionsFileFieldsSchema = z
  .object({ styleId: styleId.optional(), language: language.optional() })
  .strict();
export type CaptionsFileFields = z.infer<typeof captionsFileFieldsSchema>;

/** `POST /clips/:clipId/captions/translate`. */
export const translateCaptionsSchema = z
  .object({ language: z.string().regex(/^[a-z]{2,3}$/, 'A language is a short code') })
  .strict();
export type TranslateCaptionsInput = z.infer<typeof translateCaptionsSchema>;
