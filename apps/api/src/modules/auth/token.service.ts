import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';

/**
 * Single-use tokens for activation links, password-reset links and the OAuth
 * `state` parameter.
 *
 * ## Only the hash is stored
 *
 * `issue()` returns a pair: the raw token, which goes in the email, and its
 * SHA-256 digest, which is what lands in `User.activationTokenHash` /
 * `passwordResetTokenHash`. A database leak therefore yields no usable links —
 * the attacker holds digests and cannot invert them.
 *
 * SHA-256 rather than argon2 here, deliberately. These tokens are 32 bytes of
 * CSPRNG output, so there is no dictionary to attack and no need for a slow
 * KDF; the reason to hash at all is to make the stored value useless, not to
 * resist guessing. Using argon2 would also make lookup impossible, since each
 * argon2 hash is salted differently and the column has to be searchable by
 * equality.
 *
 * ## Lookup by hash, not by user
 *
 * Because the digest is deterministic, `hash(rawToken)` can be used directly
 * in a `where` clause — which is why the columns carry a unique index. This is
 * the opposite of the `Integration.token` situation described in SCHEMA_NOTES,
 * where AES-GCM's random IV makes equality search impossible.
 */

/** 32 bytes → 43 base64url characters. Comfortably beyond brute force. */
const TOKEN_BYTES = 32;

export const ACTIVATION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
export const RESET_TTL_MS = 60 * 60 * 1000; // 1 hour
export const OAUTH_STATE_TTL_SECONDS = 10 * 60; // 10 minutes

export interface IssuedToken {
  /** Goes in the email link. Never stored. */
  raw: string;
  /** Goes in the database. Never emailed. */
  hash: string;
  expiresAt: Date;
}

@Injectable()
export class TokenService {
  /** Mints a token and its digest. */
  issue(ttlMs: number): IssuedToken {
    const raw = randomBytes(TOKEN_BYTES).toString('base64url');
    return {
      raw,
      hash: this.hash(raw),
      expiresAt: new Date(Date.now() + ttlMs),
    };
  }

  /**
   * Digests a raw token for lookup.
   *
   * No salt, on purpose — a salted digest could not be looked up, and there is
   * nothing to salt against when the input is already high-entropy random.
   */
  hash(raw: string): string {
    return createHash('sha256').update(raw, 'utf8').digest('hex');
  }

  /** True when the stored expiry has passed, or was never set. */
  isExpired(expiresAt: Date | null): boolean {
    return expiresAt === null || expiresAt.getTime() <= Date.now();
  }
}
