/** Request shapes for Find Clips (Sprint 13, Module 05 adds the setup). Strict, like every Clips body. */
import { clipSetupSchema } from '@postgear/video-engine';
import { z } from 'zod';

/**
 * `POST /clips/videos/:videoId/highlights`: no body (or no setup) is Sprint
 * 12's one-press run on sound, picture and chat; with a setup, the run also
 * listens and reads the transcript.
 */
export const startHighlightsSchema = z
  .object({ setup: clipSetupSchema.optional() })
  .strict()
  // No body at all is Quick Find, as Sprint 12's callers send it.
  .optional();
export type StartHighlightsInput = z.infer<typeof startHighlightsSchema>;

/** `POST /clips/videos/:videoId/setup/price`. */
export const setupPriceSchema = z.object({ setup: clipSetupSchema }).strict();
export type SetupPriceInput = z.infer<typeof setupPriceSchema>;
