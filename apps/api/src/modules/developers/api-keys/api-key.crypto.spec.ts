/**
 * The secret's shape, pinned: a wrong length or alphabet here would silently
 * break `looksLikeApiKey`, and with it every call to `/v1`.
 */
import { createHash } from 'node:crypto';
import {
  API_KEY_SECRET_LENGTH,
  API_KEY_VISIBLE_PREFIX_LENGTH,
  generateApiKey,
  hashApiKey,
  looksLikeApiKey,
  visiblePrefix,
} from './api-key.crypto';

describe('api-key.crypto', () => {
  it('generates a pg_ secret of 43 base64url characters', () => {
    const { secret } = generateApiKey();

    expect(secret).toHaveLength(API_KEY_SECRET_LENGTH);
    expect(secret).toMatch(/^pg_[A-Za-z0-9_-]{40}$/);
  });

  it('derives the prefix as the first eleven characters', () => {
    const { secret, prefix } = generateApiKey();

    expect(prefix).toBe(secret.slice(0, API_KEY_VISIBLE_PREFIX_LENGTH));
    expect(prefix).toHaveLength(11);
    expect(prefix.startsWith('pg_')).toBe(true);
  });

  it('stores sha256 hex of the full secret, never the secret', () => {
    const { secret, keyHash } = generateApiKey();

    expect(keyHash).toBe(createHash('sha256').update(secret).digest('hex'));
    expect(keyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(keyHash).not.toContain(secret);
    expect(hashApiKey(secret)).toBe(keyHash);
  });

  it('never generates the same secret twice', () => {
    const secrets = new Set(Array.from({ length: 50 }, () => generateApiKey().secret));

    expect(secrets.size).toBe(50);
  });

  it('recognises a key-shaped value and nothing else', () => {
    expect(looksLikeApiKey(generateApiKey().secret)).toBe(true);
    expect(looksLikeApiKey(`pg_seedDemoKey${'0'.repeat(29)}`)).toBe(true);

    expect(looksLikeApiKey('')).toBe(false);
    expect(looksLikeApiKey('pg_')).toBe(false);
    expect(looksLikeApiKey('pg_tooShort')).toBe(false);
    expect(looksLikeApiKey(`sk_${'a'.repeat(40)}`)).toBe(false);
    expect(looksLikeApiKey(`pg_${'a'.repeat(41)}`)).toBe(false);
    // A base64 (not base64url) alphabet is refused: the generator never emits `+` or `/`.
    expect(looksLikeApiKey(`pg_${'a'.repeat(38)}+/`)).toBe(false);
    // A session JWT sent to the wrong API.
    expect(looksLikeApiKey('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1In0.abc')).toBe(false);
  });

  it('slices a visible prefix from any secret', () => {
    expect(visiblePrefix('pg_abcdefghijklmnop')).toBe('pg_abcdefgh');
  });
});
