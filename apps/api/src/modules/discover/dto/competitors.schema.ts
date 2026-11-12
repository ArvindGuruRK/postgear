/**
 * The bodies of the competitor routes (Module 07).
 *
 * `.strict()` like every schema in this API, and each value is held to the shape
 * it will be used in: a channel id is a channel id, a handle is a host name, an
 * account is `user@instance`. Three of these end up inside an address the server
 * asks, so a value that is not the shape never gets that far.
 *
 * What the schema cannot judge is where an address leads. The website and every
 * feed address are only checked here for being short, single-line text; the
 * service makes each a real address and runs the private-network guard on it,
 * and so on the Mastodon instance (`competitors.service.ts`).
 *
 * Null clears an optional field. A name is never cleared.
 */
import {
  blueskyHandle,
  instagramUsername,
  isYoutubeChannelId,
  mastodonAccount,
} from '@postgear/discover-engine';
import { z } from 'zod';
import { sanitizeText, stripControlChars } from '../../../common/sanitize';

/** How many competitors a workspace may follow. */
export const MAX_COMPETITORS = 20;
/** How many feed addresses one competitor may have. */
export const MAX_FEED_URLS = 5;

export const COMPETITOR_NAME_MAX = 80;
export const NEWS_QUERY_MIN = 2;
export const NEWS_QUERY_MAX = 80;
const ADDRESS_MAX = 2_048;

/** Text that ends up in a heading and in what is handed to the AI: no markup, no tricks. */
function cleanedText(min: number, max: number) {
  return (
    z
      .string()
      // Room for padding that the cleanup removes; the real limit is after it.
      .max(max * 4)
      .transform(sanitizeText)
      .pipe(z.string().min(min).max(max))
  );
}

/** An address as a person types it, with or without `https://`. One line, no spaces inside. */
const address = z
  .string()
  .max(ADDRESS_MAX * 2)
  .transform((text) => stripControlChars(text).trim())
  .pipe(z.string().min(1).max(ADDRESS_MAX).regex(/^\S+$/));

const youtubeChannelId = z
  .string()
  .max(64)
  .transform((text) => text.trim())
  .refine(isYoutubeChannelId);

/** `@Acme.bsky.social` is stored as `acme.bsky.social`. Anything that is not a host name is refused. */
const bluesky = z
  .string()
  .max(260)
  .transform((text) => blueskyHandle(text))
  .pipe(z.string());

/** `@acme@Mastodon.social` is stored as `acme@mastodon.social`. */
const mastodon = z
  .string()
  .max(330)
  .transform((text) => {
    const account = mastodonAccount(text);
    return account ? `${account.user}@${account.instance}` : null;
  })
  .pipe(z.string());

/** Module 10: `@acme`, `acme` or a profile address, kept as the bare name. */
const instagram = z
  .string()
  .max(120)
  .transform((text) => instagramUsername(text))
  .pipe(z.string());

const fields = {
  websiteUrl: address.nullable().optional(),
  // The whole list every time: a save replaces it.
  feedUrls: z.array(address).max(MAX_FEED_URLS).optional(),
  youtubeChannelId: youtubeChannelId.nullable().optional(),
  blueskyHandle: bluesky.nullable().optional(),
  mastodonAcct: mastodon.nullable().optional(),
  instagramUsername: instagram.nullable().optional(),
  // Null means "search for the name".
  newsQuery: cleanedText(NEWS_QUERY_MIN, NEWS_QUERY_MAX).nullable().optional(),
};

export const createCompetitorSchema = z
  .object({ name: cleanedText(1, COMPETITOR_NAME_MAX), ...fields })
  .strict();

export type CreateCompetitorInput = z.infer<typeof createCompetitorSchema>;

export const updateCompetitorSchema = z
  .object({ name: cleanedText(1, COMPETITOR_NAME_MAX).optional(), ...fields })
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: 'There is nothing to save.' });

export type UpdateCompetitorInput = z.infer<typeof updateCompetitorSchema>;

export const discoverFeedsSchema = z.object({ url: address }).strict();

export type DiscoverFeedsInput = z.infer<typeof discoverFeedsSchema>;
