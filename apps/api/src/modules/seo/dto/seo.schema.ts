/**
 * Request schemas for the SEO routes.
 *
 * `.strict()` like every schema in this API: an unknown key is refused, not
 * stripped. The URL is bounded and cleaned of control characters here, but
 * *not* parsed: whether it is a usable, safe address is the engine's URL
 * guard's call (`seo.service.ts`), which answers 400 or 422 with a reason.
 * A schema that rejected "not a URL" would say "Invalid input" and nothing
 * more, which is exactly the wrong amount of help for a typo in an address.
 */
import { z } from 'zod';
import { stripControlChars } from '../../../common/sanitize';

export const MAX_URL_LENGTH = 2_048;

export const SEO_LIST_DEFAULT_LIMIT = 20;
export const SEO_LIST_MAX_LIMIT = 100;

const urlText = z
  .string()
  .max(MAX_URL_LENGTH)
  .transform((text) => stripControlChars(text).trim())
  .pipe(z.string().min(1).max(MAX_URL_LENGTH));

export const analyzeSchema = z.object({ url: urlText }).strict();

export const listQuerySchema = z
  .object({
    url: urlText.optional(),
    limit: z.coerce.number().int().min(1).max(SEO_LIST_MAX_LIMIT).default(SEO_LIST_DEFAULT_LIMIT),
  })
  .strict();

export type AnalyzeInput = z.infer<typeof analyzeSchema>;
export type ListAuditsQuery = z.infer<typeof listQuerySchema>;
