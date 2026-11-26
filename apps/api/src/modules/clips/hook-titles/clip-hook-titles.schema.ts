/**
 * `POST /clips/:clipId/hook-titles` (Sprint 13, Module 09): the words are the
 * clip's own, read on the server, never sent by the browser. The one key is
 * `attempt` (0 to 50, default 0): Try Again counts up, so the title writer
 * answers three new titles. Strict, so any other key is refused; no body at
 * all is fine too.
 */
import { z } from 'zod';

/** The highest Try Again count the route takes. */
export const HOOK_TITLES_MAX_ATTEMPT = 50;

export const hookTitlesBodySchema = z
  .object({ attempt: z.number().int().min(0).max(HOOK_TITLES_MAX_ATTEMPT).optional() })
  .strict()
  .optional();
export type HookTitlesBody = z.infer<typeof hookTitlesBodySchema>;
