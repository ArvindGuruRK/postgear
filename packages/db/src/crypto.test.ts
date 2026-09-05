import {
  decrypt,
  decryptNullable,
  EncryptionError,
  encrypt,
  encryptNullable,
  isEncrypted,
  safeCompare,
} from './crypto';

// A real 32-byte key, hardcoded so the suite doesn't depend on a developer's
// local .env. Test-only — never reuse this value anywhere else.
const TEST_KEY = 'a'.repeat(64);
const OTHER_KEY = 'b'.repeat(64);

describe('crypto', () => {
  const originalEnv = process.env.ENCRYPTION_KEY_AES256;

  beforeEach(() => {
    process.env.ENCRYPTION_KEY_AES256 = TEST_KEY;
  });

  afterAll(() => {
    process.env.ENCRYPTION_KEY_AES256 = originalEnv;
  });

  describe('encrypt / decrypt round trip', () => {
    it('recovers the original plaintext', () => {
      const secret = 'ya29.a0AfB_byC-an-oauth-access-token';
      expect(decrypt(encrypt(secret))).toBe(secret);
    });

    it('handles an empty string', () => {
      expect(decrypt(encrypt(''))).toBe('');
    });

    it('handles unicode and multi-byte characters', () => {
      const secret = 'token-🔐-с-кириллицей-と日本語';
      expect(decrypt(encrypt(secret))).toBe(secret);
    });

    it('handles a long JSON blob, the shape refresh payloads actually take', () => {
      const secret = JSON.stringify({
        access_token: 'x'.repeat(2000),
        scope: ['read', 'write', 'offline_access'],
      });
      expect(decrypt(encrypt(secret))).toBe(secret);
    });
  });

  describe('ciphertext properties', () => {
    it('produces a different ciphertext each time (fresh IV per call)', () => {
      const secret = 'same-input-every-time';
      expect(encrypt(secret)).not.toBe(encrypt(secret));
    });

    it('still decrypts both of those to the same plaintext', () => {
      const secret = 'same-input-every-time';
      expect(decrypt(encrypt(secret))).toBe(decrypt(encrypt(secret)));
    });

    it('never contains the plaintext', () => {
      expect(encrypt('super-secret-value')).not.toContain('super-secret-value');
    });

    it('is tagged with the payload version', () => {
      expect(encrypt('anything').startsWith('v1:')).toBe(true);
    });
  });

  describe('tamper detection', () => {
    it('rejects a modified ciphertext body', () => {
      const parts = encrypt('sensitive').split(':');
      // Flip a character in the ciphertext segment.
      parts[3] = parts[3][0] === 'A' ? `B${parts[3].slice(1)}` : `A${parts[3].slice(1)}`;
      expect(() => decrypt(parts.join(':'))).toThrow(EncryptionError);
    });

    it('rejects a modified auth tag', () => {
      const parts = encrypt('sensitive').split(':');
      parts[2] = parts[2][0] === 'A' ? `B${parts[2].slice(1)}` : `A${parts[2].slice(1)}`;
      expect(() => decrypt(parts.join(':'))).toThrow(EncryptionError);
    });

    it('rejects a payload encrypted under a different key', () => {
      const payload = encrypt('sensitive');
      process.env.ENCRYPTION_KEY_AES256 = OTHER_KEY;
      expect(() => decrypt(payload)).toThrow(EncryptionError);
    });
  });

  describe('malformed input', () => {
    it.each([
      ['not-encrypted-at-all', 'plain text'],
      ['v1:only:three', 'too few parts'],
      ['v2:a:b:c', 'unknown version'],
      ['', 'empty string'],
    ])('rejects %p (%s)', (payload) => {
      expect(() => decrypt(payload)).toThrow(EncryptionError);
    });

    it('rejects an IV of the wrong length', () => {
      const parts = encrypt('sensitive').split(':');
      parts[1] = Buffer.from('short').toString('base64url');
      expect(() => decrypt(parts.join(':'))).toThrow(/bad IV or auth tag length/);
    });
  });

  describe('key validation', () => {
    it('throws a pointed error when the key is missing', () => {
      // `delete`, not `= undefined` — assigning undefined to a process.env
      // property stores the *string* "undefined", which sails past a falsy
      // check and fails later with a confusing length error instead.
      delete process.env.ENCRYPTION_KEY_AES256;
      expect(() => encrypt('x')).toThrow(/is not set/);
    });

    it('rejects the .env.example placeholder rather than silently deriving from it', () => {
      process.env.ENCRYPTION_KEY_AES256 = '32-byte-hex-string-for-encrypting-oauth-tokens-at-rest';
      expect(() => encrypt('x')).toThrow(/64 hex characters/);
    });

    it('rejects a key of the right length that is not hex', () => {
      process.env.ENCRYPTION_KEY_AES256 = 'z'.repeat(64);
      expect(() => encrypt('x')).toThrow(/hex characters/);
    });
  });

  describe('nullable wrappers', () => {
    it('passes null and undefined through as null', () => {
      expect(encryptNullable(null)).toBeNull();
      expect(encryptNullable(undefined)).toBeNull();
      expect(decryptNullable(null)).toBeNull();
      expect(decryptNullable(undefined)).toBeNull();
    });

    it('round trips a present value', () => {
      expect(decryptNullable(encryptNullable('refresh-token'))).toBe('refresh-token');
    });
  });

  describe('isEncrypted', () => {
    it('recognises its own output', () => {
      expect(isEncrypted(encrypt('x'))).toBe(true);
    });

    it('rejects legacy plaintext, which is the whole point of it', () => {
      expect(isEncrypted('ya29.a-plaintext-token-from-before-encryption')).toBe(false);
      expect(isEncrypted(null)).toBe(false);
      expect(isEncrypted(undefined)).toBe(false);
    });
  });

  describe('safeCompare', () => {
    it('matches identical strings', () => {
      expect(safeCompare('api-key-abc', 'api-key-abc')).toBe(true);
    });

    it('rejects different strings of equal length', () => {
      expect(safeCompare('api-key-abc', 'api-key-abd')).toBe(false);
    });

    it('rejects different lengths without throwing', () => {
      expect(safeCompare('short', 'much-longer-value')).toBe(false);
    });
  });
});
