/**
 * The API-key secret: how it is made, how it is stored, how it is recognised.
 *
 * ## Shape
 *
 * `pg_` + 40 base64url characters from 30 random bytes: 240 bits of entropy,
 * well past anything brute force reaches, and a fixed length so a glance at a
 * log line or a config file tells a PostGear key from a stray token. The
 * first eleven characters (`pg_` + 8) are the *prefix*, stored in the clear
 * so a key can be identified in the UI and the security log without ever
 * being usable from either.
 *
 * ## Storage and lookup
 *
 * Only `sha256(secret)` is stored. The guard hashes what the caller presents
 * and looks the digest up with `findUnique` on the unique `keyHash` column.
 * That lookup *is* the comparison, and it does not need `safeCompare`: a
 * timing side channel is a concern when application code compares a secret
 * the attacker controls against a stored one byte by byte. Here the attacker
 * controls the preimage, the database compares a 256-bit digest against an
 * index, and no amount of timing on that lookup narrows the preimage: the
 * hash function's whole job is to make the digest tell you nothing about it.
 * A plain SHA-256 (no salt, no slow KDF) is also deliberate: unlike a
 * password, the secret is high-entropy and never chosen by a person, so a
 * leaked digest cannot be dictionary-attacked, and the lookup has to be an
 * equality query to stay O(1).
 */
import { createHash, randomBytes } from 'node:crypto';

export const API_KEY_PREFIX = 'pg_';

/** 30 bytes → exactly 40 base64url characters, no padding. */
const API_KEY_RANDOM_BYTES = 30;

/** `pg_` + 40. */
export const API_KEY_SECRET_LENGTH = 43;

/** `pg_` + 8: the part stored and shown in the clear. */
export const API_KEY_VISIBLE_PREFIX_LENGTH = 11;

const API_KEY_PATTERN = /^pg_[A-Za-z0-9_-]{40}$/;

export interface GeneratedApiKey {
  /** The full secret. Returned to the caller exactly once; never stored. */
  secret: string;
  prefix: string;
  keyHash: string;
}

export function generateApiKey(): GeneratedApiKey {
  const secret = `${API_KEY_PREFIX}${randomBytes(API_KEY_RANDOM_BYTES).toString('base64url')}`;

  return { secret, prefix: visiblePrefix(secret), keyHash: hashApiKey(secret) };
}

/** SHA-256 hex of the full secret: the only form that is ever stored. */
export function hashApiKey(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

export function visiblePrefix(secret: string): string {
  return secret.slice(0, API_KEY_VISIBLE_PREFIX_LENGTH);
}

/**
 * Whether a presented value has the shape of a PostGear key.
 *
 * Checked before the database is asked, so a stray session JWT or a random
 * string sent as a bearer token is refused without a query, and so the
 * security log can record a prefix only when there is a plausible one.
 */
export function looksLikeApiKey(value: string): boolean {
  return API_KEY_PATTERN.test(value);
}
