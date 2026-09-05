/**
 * AES-256-GCM encryption helper for secrets stored at rest.
 *
 * The immediate consumer is `Integration.token` / `Integration.refreshToken`
 * (OAuth credentials for connected social channels). Sprint 1 only has to make
 * this helper exist and be correct; Sprint 3 is where the Integration
 * repository actually wraps its reads/writes in it.
 *
 * The encryption boundary is the **repository layer**, deliberately:
 *   - callers above it (services, controllers) always see plaintext, so no
 *     module has to remember to decrypt;
 *   - the database only ever sees ciphertext, so a DB dump or a Prisma Studio
 *     session leaks nothing usable;
 *   - it is one place to change if the key ever rotates.
 *
 * GCM (not CBC) because it is authenticated: a tampered ciphertext fails to
 * decrypt loudly rather than yielding attacker-influenced plaintext.
 */
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32; // AES-256
const IV_BYTES = 12; // 96-bit nonce, the GCM-recommended size
const AUTH_TAG_BYTES = 16;

/**
 * Version marker on every payload. If the algorithm or key-derivation ever
 * changes, bump this and branch on it in `decrypt` — existing rows stay
 * readable instead of needing a big-bang migration.
 */
const PAYLOAD_VERSION = 'v1';
const PAYLOAD_SEPARATOR = ':';

const ENV_KEY_NAME = 'ENCRYPTION_KEY_AES256';

export class EncryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EncryptionError';
  }
}

/**
 * Reads and validates the AES key from the environment.
 *
 * Read on every call rather than cached at module load: caching would capture
 * whatever `process.env` held at import time, which in Jest (and in any
 * process that loads dotenv after its imports) is often nothing at all.
 */
function getKey(): Buffer {
  const raw = process.env[ENV_KEY_NAME];

  if (!raw) {
    throw new EncryptionError(
      `${ENV_KEY_NAME} is not set. Generate one with \`npm run generate:keys\` and put it in .env.`,
    );
  }

  if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new EncryptionError(
      `${ENV_KEY_NAME} must be exactly ${KEY_BYTES} bytes encoded as ${KEY_BYTES * 2} hex characters. ` +
        `Got ${raw.length} character(s). The .env.example placeholder is not a real key — ` +
        'generate one with `npm run generate:keys`.',
    );
  }

  return Buffer.from(raw, 'hex');
}

/**
 * Encrypts a UTF-8 string, returning `v1:<iv>:<authTag>:<ciphertext>` with each
 * part base64url-encoded.
 *
 * A fresh random IV per call is what makes this safe to use on the same value
 * twice; it also means the output is intentionally non-deterministic, so an
 * encrypted column can never be searched with a `WHERE token = ?` equality
 * match. Look rows up by `id`/`organizationId` instead.
 */
export function encrypt(plaintext: string): string {
  if (typeof plaintext !== 'string') {
    throw new EncryptionError('encrypt() expects a string.');
  }

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);

  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

  return [
    PAYLOAD_VERSION,
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url'),
  ].join(PAYLOAD_SEPARATOR);
}

/**
 * Reverses `encrypt`. Throws `EncryptionError` if the payload is malformed, was
 * produced under a different key, or has been tampered with — all three are
 * genuine "stop and investigate" conditions, never something to swallow.
 */
export function decrypt(payload: string): string {
  if (typeof payload !== 'string' || payload.length === 0) {
    throw new EncryptionError('decrypt() expects a non-empty string.');
  }

  const parts = payload.split(PAYLOAD_SEPARATOR);

  if (parts.length !== 4) {
    throw new EncryptionError('Malformed ciphertext: expected 4 colon-separated parts.');
  }

  const [version, ivPart, tagPart, dataPart] = parts;

  if (version !== PAYLOAD_VERSION) {
    throw new EncryptionError(
      `Unsupported ciphertext version "${version}"; this build understands ${PAYLOAD_VERSION}.`,
    );
  }

  const iv = Buffer.from(ivPart, 'base64url');
  const authTag = Buffer.from(tagPart, 'base64url');
  const ciphertext = Buffer.from(dataPart, 'base64url');

  if (iv.length !== IV_BYTES || authTag.length !== AUTH_TAG_BYTES) {
    throw new EncryptionError('Malformed ciphertext: bad IV or auth tag length.');
  }

  try {
    const decipher = createDecipheriv(ALGORITHM, getKey(), iv);
    decipher.setAuthTag(authTag);

    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch (error) {
    if (error instanceof EncryptionError) {
      throw error;
    }
    // `final()` throwing here means the auth tag didn't verify. Deliberately
    // not forwarding the original message — it varies by Node version and adds
    // nothing a caller can act on.
    throw new EncryptionError(
      'Failed to decrypt: the payload was tampered with, or was encrypted under a different key.',
    );
  }
}

/**
 * Convenience wrappers for nullable columns. `Integration.refreshToken` is
 * `String?`, and every call site would otherwise repeat the same null dance.
 */
export function encryptNullable(plaintext: string | null | undefined): string | null {
  return plaintext == null ? null : encrypt(plaintext);
}

export function decryptNullable(payload: string | null | undefined): string | null {
  return payload == null ? null : decrypt(payload);
}

/**
 * True if `payload` looks like something `encrypt` produced.
 *
 * Sprint 3 will need this when it backfills: rows written before encryption
 * landed hold plaintext, and a migration has to tell the two apart.
 */
export function isEncrypted(payload: string | null | undefined): boolean {
  if (typeof payload !== 'string') {
    return false;
  }
  const parts = payload.split(PAYLOAD_SEPARATOR);
  return parts.length === 4 && parts[0] === PAYLOAD_VERSION;
}

/**
 * Constant-time comparison for secrets that are compared rather than decrypted
 * (API keys, webhook signatures). Not used by the Integration path, but it
 * belongs next to the other crypto primitives so nobody reaches for `===` and
 * leaks a timing side channel.
 */
export function safeCompare(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');

  // timingSafeEqual throws on length mismatch, so the length check has to come
  // first. Length is not the secret here — the contents are.
  if (bufferA.length !== bufferB.length) {
    return false;
  }

  return timingSafeEqual(bufferA, bufferB);
}
