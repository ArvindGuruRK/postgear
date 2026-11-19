/**
 * The download request (Sprint 12, Module 18). `.strict()`: an unknown key
 * is refused, not ignored.
 *
 * `rightsConfirmed` is optional on purpose, as on an import: a missing tick
 * is not a malformed request but a refusal with its own sentence (422
 * `rights_required`), which the service raises. `formatId` is the probe's own
 * id (`h1080`, `h720`, `audio`), never a yt-dlp format string; the service
 * looks it up in a fresh probe, so an id that is not offered is `format_gone`.
 */
import { z } from 'zod';

export const startDownloadSchema = z
  .object({
    url: z.string().trim().min(1).max(2_048),
    formatId: z
      .string()
      .min(1)
      .max(32)
      .regex(/^[a-z0-9]+$/),
    rightsConfirmed: z.boolean().optional(),
  })
  .strict();
export type StartDownloadInput = z.infer<typeof startDownloadSchema>;
