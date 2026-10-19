/**
 * The invitation link's signature and expiry. Single use is `OrgService`'s
 * (see org.service.spec.ts); this is only "was this link issued by us, for
 * what, and is it still in date".
 */
import { createHmac } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import { INVITE_TTL_MS, InviteTokenService } from './invite-token.service';

const SECRET = 'a-test-secret-that-is-at-least-32-chars';
const NOW = Date.parse('2026-10-19T12:00:00Z');

function service(secret = SECRET): InviteTokenService {
  return new InviteTokenService({ getOrThrow: () => secret } as unknown as ConfigService);
}

/** Re-encodes a token's payload with one field changed, keeping the old signature. */
function withPayload(token: string, change: Record<string, unknown>): string {
  const [body, signature] = token.split('.');
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  const edited = Buffer.from(JSON.stringify({ ...payload, ...change }), 'utf8').toString(
    'base64url',
  );
  return `${edited}.${signature}`;
}

describe('InviteTokenService', () => {
  const signer = service();

  it('round-trips the workspace, role, address and expiry', () => {
    const { token, payload } = signer.sign(
      { orgId: 'org-1', role: 'ADMIN', email: 'Ada@Example.com' },
      NOW,
    );

    expect(payload).toMatchObject({ orgId: 'org-1', role: 'ADMIN', email: 'ada@example.com' });
    expect(payload.exp).toBe(NOW + INVITE_TTL_MS);
    expect(signer.verify(token, NOW + 1000)).toEqual({ ok: true, payload });
  });

  it('expires after seven days', () => {
    const { token } = signer.sign({ orgId: 'org-1', role: 'USER' }, NOW);

    expect(INVITE_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
    expect(signer.verify(token, NOW + INVITE_TTL_MS - 1).ok).toBe(true);
    expect(signer.verify(token, NOW + INVITE_TTL_MS)).toEqual({ ok: false, reason: 'expired' });
  });

  it('leaves the address out of a link that was not bound to one', () => {
    const { payload } = signer.sign({ orgId: 'org-1', role: 'USER' }, NOW);

    expect(payload).not.toHaveProperty('email');
  });

  it('gives every link its own id, so single use is per link', () => {
    const first = signer.sign({ orgId: 'org-1', role: 'USER' }, NOW);
    const second = signer.sign({ orgId: 'org-1', role: 'USER' }, NOW);

    expect(first.payload.id).not.toBe(second.payload.id);
    expect(first.payload.id).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it.each([
    ['a promoted role', { role: 'ADMIN' }],
    ['another workspace', { orgId: 'org-2' }],
    ['a later expiry', { exp: NOW + 10 * INVITE_TTL_MS }],
    ['another address', { email: 'mallory@example.com' }],
  ])('rejects a payload edited to %s', (_label, change) => {
    const { token } = signer.sign({ orgId: 'org-1', role: 'USER', email: 'ada@example.com' }, NOW);

    expect(signer.verify(withPayload(token, change), NOW)).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });

  it('checks the signature before the expiry, so an edited expiry is not "expired"', () => {
    const { token } = signer.sign({ orgId: 'org-1', role: 'USER' }, NOW);

    expect(signer.verify(withPayload(token, { exp: NOW - 1 }), NOW)).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });

  it('rejects a changed signature and a link signed with another secret', () => {
    const { token } = signer.sign({ orgId: 'org-1', role: 'USER' }, NOW);
    const [body, signature] = token.split('.');
    const flipped = `${signature.slice(0, -2)}${signature.endsWith('AA') ? 'BB' : 'AA'}`;

    expect(signer.verify(`${body}.${flipped}`, NOW).ok).toBe(false);
    expect(service('another-secret-that-is-also-32-chars-long').verify(token, NOW).ok).toBe(false);
  });

  it('does not sign with the raw JWT secret, so it cannot mint or accept session-shaped MACs', () => {
    const { token } = signer.sign({ orgId: 'org-1', role: 'USER' }, NOW);
    const [body] = token.split('.');
    const underRawSecret = createHmac('sha256', SECRET).update(body).digest('base64url');

    expect(signer.verify(`${body}.${underRawSecret}`, NOW)).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });

  it('rejects a correctly signed body that is not an invitation', () => {
    const key = createHmac('sha256', SECRET).update('postgear:workspace-invite:v1').digest();
    const signed = (value: string) => {
      const body = Buffer.from(value, 'utf8').toString('base64url');
      return `${body}.${createHmac('sha256', key).update(body).digest('base64url')}`;
    };
    const valid = { v: 1, id: 'a'.repeat(22), orgId: 'org-1', role: 'USER', exp: NOW + 1000 };

    // The helper is right: the untouched shape verifies.
    expect(signer.verify(signed(JSON.stringify(valid)), NOW).ok).toBe(true);

    expect(signer.verify(signed('not json'), NOW).ok).toBe(false);
    expect(signer.verify(signed(JSON.stringify({ ...valid, v: 2 })), NOW).ok).toBe(false);
    expect(signer.verify(signed(JSON.stringify({ ...valid, role: 'SUPERADMIN' })), NOW).ok).toBe(
      false,
    );
    expect(signer.verify(signed(JSON.stringify({ ...valid, extra: true })), NOW).ok).toBe(false);
  });

  it.each([
    ['not a string', 42],
    ['empty', ''],
    ['no signature', 'abc'],
    ['three parts', 'a.b.c'],
    ['a path', '../../etc/passwd'],
    ['overlong', `${'a'.repeat(2048)}.b`],
    ['signed garbage', 'bm90LWpzb24.c2ln'],
  ])('rejects a token that is %s', (_label, token) => {
    expect(signer.verify(token, NOW)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('refuses to start without a secret', () => {
    const config = {
      getOrThrow: () => {
        throw new Error('JWT_SECRET missing');
      },
    } as unknown as ConfigService;

    expect(() => new InviteTokenService(config)).toThrow('JWT_SECRET missing');
  });
});
