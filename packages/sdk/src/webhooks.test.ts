/**
 * The verifier, and that it agrees byte for byte with what PostGear's worker
 * signs (`packages/db/src/webhook-signature.ts` — the same vector is pinned
 * there).
 */
import { constructWebhookEvent, signWebhookPayload, verifyWebhookSignature } from './webhooks';

const SECRET = 'whsec_test_secret_000';
const BODY = '{"id":"d1","event":"post.published","createdAt":"x","workspaceId":"w","data":{"post":{"id":"g"}}}';
const NOW = new Date('2026-10-16T10:00:00Z');
const TS = Math.floor(NOW.getTime() / 1000);

describe('webhook verification', () => {
  it('accepts a correctly signed, fresh delivery (string or Buffer body)', () => {
    const signature = signWebhookPayload(SECRET, TS, BODY);
    for (const payload of [BODY, Buffer.from(BODY, 'utf8')]) {
      expect(
        verifyWebhookSignature({ payload, secret: SECRET, signature, timestamp: String(TS), now: NOW }),
      ).toEqual({ ok: true });
    }
  });

  it('matches the worker’s signature for a known vector', () => {
    // Computed by packages/db/src/webhook-signature.ts for these exact inputs.
    expect(signWebhookPayload('k', 1, 'b')).toBe(`v1=${expectedHmac('k', '1.b')}`);
  });

  it.each([
    ['missing', { signature: null, timestamp: String(TS) }],
    ['timestamp', { signature: 'v1=00', timestamp: 'now' }],
    ['malformed', { signature: 'sha256=abc', timestamp: String(TS) }],
    ['mismatch', { signature: signWebhookPayload('other', TS, BODY), timestamp: String(TS) }],
    ['expired', { signature: signWebhookPayload(SECRET, TS - 301, BODY), timestamp: String(TS - 301) }],
  ] as const)('refuses with %s', (reason, headers) => {
    expect(verifyWebhookSignature({ payload: BODY, secret: SECRET, now: NOW, ...headers })).toEqual({ ok: false, reason });
  });

  it('constructs a typed event or throws with the reason', () => {
    const signature = signWebhookPayload(SECRET, TS, BODY);
    const event = constructWebhookEvent({ payload: BODY, secret: SECRET, signature, timestamp: String(TS), now: NOW });
    expect(event.event).toBe('post.published');
    expect(event.data.post.id).toBe('g');

    expect(() =>
      constructWebhookEvent({ payload: BODY, secret: 'wrong', signature, timestamp: String(TS), now: NOW }),
    ).toThrow(/mismatch/);
  });
});

function expectedHmac(secret: string, message: string): string {
  // Independent of the module under test, so the vector means something.
  return require('node:crypto').createHmac('sha256', secret).update(message).digest('hex');
}
