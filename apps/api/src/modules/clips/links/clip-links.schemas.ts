/**
 * Bodies and queries of the link routes. Strict: an unknown key is refused.
 * The link is only trimmed and bounded here; recognising it (and refusing
 * anything that is not a video on a platform we read) is the service's job,
 * so every refusal comes back as one of our sentences, not "Invalid input".
 */
import { LINK_MAX_LENGTH } from '@postgear/video-engine';
import { z } from 'zod';

export const probeLinkSchema = z
  .object({
    url: z.string().trim().min(1).max(LINK_MAX_LENGTH),
  })
  .strict();

export type ProbeLinkInput = z.infer<typeof probeLinkSchema>;

export const thumbnailQuerySchema = z
  .object({
    u: z.string().min(1).max(4_000),
  })
  .strict();

export type ThumbnailQuery = z.infer<typeof thumbnailQuerySchema>;
