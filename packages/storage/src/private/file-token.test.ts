/**
 * Signed file tokens: a good one opens, an expired, tampered or foreign one
 * does not, and nothing but the right secret can make one.
 */
import { expiryFrom, MAX_SIGNED_URL_SECONDS, signFileToken, verifyFileToken } from './file-token';

const secret = 's'.repeat(40);
const otherSecret = 'o'.repeat(40);
const key = 'clips/3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e/0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d/proxy-0123456789abcdef0123456789abcdef.mp4';
const now = Date.UTC(2026, 10, 18, 12, 0, 0);

function tokenFor(seconds = 300, downloadName?: string): string {
  return signFileToken(
    { purpose: 'get', key, expiresAt: expiryFrom(seconds, now), downloadName },
    secret,
  );
}

describe('file tokens', () => {
  it('verify with the same secret before expiry, carrying the key and name', () => {
    const result = verifyFileToken(tokenFor(300, 'My Clip.mp4'), secret, now + 1000);

    expect(result).toEqual({
      ok: true,
      claims: {
        purpose: 'get',
        key,
        expiresAt: Math.floor(now / 1000) + 300,
        downloadName: 'My Clip.mp4',
      },
    });
  });

  it('are refused once expired, including at the exact second', () => {
    const token = tokenFor(60);
    expect(verifyFileToken(token, secret, now + 59_000).ok).toBe(true);
    expect(verifyFileToken(token, secret, now + 60_000)).toEqual({ ok: false, reason: 'expired' });
  });

  it('are refused with a different secret', () => {
    expect(verifyFileToken(tokenFor(), otherSecret, now)).toEqual({
      ok: false,
      reason: 'signature',
    });
  });

  it('are refused when any one character changes', () => {
    const token = tokenFor();

    for (let index = 0; index < token.length; index += 1) {
      const char = token[index];
      if (char === '.') continue;
      const swapped = char === 'A' ? 'B' : 'A';
      const tampered = `${token.slice(0, index)}${swapped}${token.slice(index + 1)}`;
      expect(verifyFileToken(tampered, secret, now).ok).toBe(false);
    }
  });

  it('refuse a payload swapped in from another token', () => {
    const [, signature] = tokenFor().split('.');
    const [otherPayload] = tokenFor(600).split('.');
    expect(verifyFileToken(`${otherPayload}.${signature}`, secret, now)).toEqual({
      ok: false,
      reason: 'signature',
    });
  });

  it('refuse junk without throwing', () => {
    for (const token of ['', 'abc', 'a.b.c', '..', `${'a'.repeat(5000)}.b`, 'a+b.c/d']) {
      expect(verifyFileToken(token, secret, now)).toEqual({ ok: false, reason: 'malformed' });
    }
  });

  it('carry part uploads with their upload id and number', () => {
    const token = signFileToken(
      { purpose: 'part', key, expiresAt: expiryFrom(3600, now), uploadId: 'a1b2', partNumber: 3 },
      secret,
    );
    const result = verifyFileToken(token, secret, now);
    expect(result.ok && result.claims).toMatchObject({ purpose: 'part', uploadId: 'a1b2', partNumber: 3 });
  });

  it('cannot be made for a foreign key, a short secret or a silly lifetime', () => {
    expect(() =>
      signFileToken({ purpose: 'get', key: '../../etc/passwd', expiresAt: 10 }, secret),
    ).toThrow(/did not generate/);
    expect(() => signFileToken({ purpose: 'get', key, expiresAt: 10 }, 'short')).toThrow(
      /CLIPS_URL_SECRET/,
    );
    expect(() => expiryFrom(0, now)).toThrow();
    expect(() => expiryFrom(1.5, now)).toThrow();
    expect(() => expiryFrom(MAX_SIGNED_URL_SECONDS + 1, now)).toThrow();
    expect(() =>
      signFileToken(
        { purpose: 'part', key, expiresAt: 10, uploadId: 'x', partNumber: 10_001 },
        secret,
      ),
    ).toThrow(/part number/);
  });
});
