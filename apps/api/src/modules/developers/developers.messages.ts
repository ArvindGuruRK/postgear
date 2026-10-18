/**
 * User-facing strings for the developers module (Sprint 8).
 *
 * Two audiences, two registers. The session routes (`/developers/api-keys`)
 * are used by an authenticated admin editing their own workspace, so the
 * messages are specific, as in `posts.messages.ts`. The public API's
 * authentication failures are deliberately one string for every cause
 * (missing, malformed, unknown, revoked), because a caller probing with
 * guessed keys must not learn which of those it hit.
 */
export const DEVELOPERS_MESSAGES = {
  /** Every `/v1` authentication failure. One message, whatever the cause. */
  INVALID_API_KEY: 'Invalid API key',
  /** The per-key ceiling on `/v1`. The `Retry-After` header says when. */
  RATE_LIMITED: 'Rate limit exceeded',

  KEY_NOT_FOUND: 'API key not found',
  KEY_LIMIT: 'This workspace already has 10 live API keys. Revoke one before creating another.',
  KEY_REVOKED: 'This API key has been revoked and cannot be rotated. Create a new key instead.',

  /** `/v1/posts` text that is nothing but whitespace. */
  TEXT_EMPTY: 'text must contain at least one visible character.',
  /** Text that maps to more paragraphs or lines than a post document may hold. */
  TEXT_TOO_COMPLEX: 'text has too many paragraphs or lines for one post.',
  /** A public-API body or query that failed validation and no field could be named. */
  INVALID_INPUT: 'Invalid input',
} as const;
