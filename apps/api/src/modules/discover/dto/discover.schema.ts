/**
 * The query strings of Discover's routes.
 *
 * `.strict()` like every schema in this API, and each value is held to the shape
 * it will be used in: a code is a real code, a language is a language tag, and
 * free text is cleaned before its length is judged. None of these ever reaches an
 * outside address unencoded, but a request that says nonsense should not cost an
 * outside call either.
 */
import {
  isCountryCode,
  isKnownCountry,
  isRegionCode,
  NEWS_TOPICS,
} from '@postgear/discover-engine';
import { z } from 'zod';
import { collapseWhitespace, sanitizeText, stripControlChars } from '../../../common/sanitize';

/** Two decimals, about a kilometre. More is refused rather than rounded: the browser must round. */
const ROUNDED_COORDINATE = /^-?\d{1,3}(\.\d{1,2})?$/;

function coordinate(limit: number) {
  return z.preprocess(
    (value) =>
      typeof value === 'string' && ROUNDED_COORDINATE.test(value) ? Number(value) : Number.NaN,
    z.number().min(-limit).max(limit),
  );
}

/** An IANA name is letters, digits and these. Enough to stop anything else reaching the lookup. */
const timeZone = z
  .string()
  .max(64)
  .regex(/^[A-Za-z0-9_+\-/]+$/);

export const localityQuerySchema = z.union([
  z.object({ lat: coordinate(90), lng: coordinate(180) }).strict(),
  z.object({ tz: timeZone }).strict(),
]);

export type LocalityQuery = z.infer<typeof localityQuerySchema>;

export const LOCALITY_SEARCH_MIN = 2;
export const LOCALITY_SEARCH_MAX = 80;

const searchText = z
  .string()
  // Room for padding that the cleanup removes; the real limit is after it.
  .max(LOCALITY_SEARCH_MAX * 4)
  .transform((text) => collapseWhitespace(stripControlChars(text)))
  .pipe(z.string().min(LOCALITY_SEARCH_MIN).max(LOCALITY_SEARCH_MAX));

export const localitySearchQuerySchema = z.object({ q: searchText }).strict();

export type LocalitySearchQuery = z.infer<typeof localitySearchQuerySchema>;

/** Text that ends up in a heading and in what is handed to the AI: no markup, no tricks. */
const placeName = z
  .string()
  .max(LOCALITY_SEARCH_MAX * 4)
  .transform(sanitizeText)
  .pipe(z.string().min(1).max(LOCALITY_SEARCH_MAX));

/** `ta`, `en-IN`, `es-419`, `zh-Hant`. */
const languageTag = z
  .string()
  .max(16)
  .regex(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/);

export const FEED_KINDS = ['trending', 'news', 'videos', 'festivals'] as const;

export const feedQuerySchema = z
  .object({
    kind: z.enum(FEED_KINDS),
    // Absent means Worldwide.
    country: z
      .string()
      .refine((code) => isCountryCode(code) && isKnownCountry(code))
      .optional(),
    region: z.string().refine(isRegionCode).optional(),
    // Display only, and never part of the cache key: only a heading changes with it.
    regionName: placeName.optional(),
    city: placeName.optional(),
    lang: languageTag.optional(),
    tz: timeZone.optional(),
    topic: z.enum(NEWS_TOPICS).optional(),
  })
  .strict()
  .refine((query) => query.country || (!query.region && !query.regionName && !query.city), {
    path: ['country'],
    message: 'A region or a city needs its country.',
  })
  .refine((query) => !query.region || query.region.startsWith(`${query.country}-`), {
    path: ['region'],
    message: 'The region is not in that country.',
  });

export type FeedQuery = z.infer<typeof feedQuerySchema>;
