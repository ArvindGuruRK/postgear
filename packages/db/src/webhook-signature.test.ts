import {
  signWebhookPayload,
  verifyWebhookSignature,
  WEBHOOK_SIGNATURE_TOLERANCE_SECONDS,
  webhookSignedPayload,
} from './webhook-signature';

const SECRET = 'whsec_test_secret_000';
const BODY = '{"id":"d1","event":"post.published"}';
const NOW = new Date('2026-10-16T10:00:00Z');
const TS = Math.floor(NOW.getTime() / 1000);

describe('webhook signature', () => {
  it('signs "<timestamp>.<body>" with HMAC-SHA256 under a v1 prefix', () => {
    expect(webhookSignedPayload(TS, BODY)).toBe(`${TS}.${BODY}`);
    const signature = signWebhookPayload(SECRET, TS, BODY);
    expect(signature).toMatch(/^v1=[0-9a-f]{64}$/);
    // Deterministic: the same inputs sign the same way.
    expect(signWebhookPayload(SECRET, TS, BODY)).toBe(signature);
    // And every input matters.
    expect(signWebhookPayload(`${SECRET}x`, TS, BODY)).not.toBe(signature);
    expect(signWebhookPayload(SECRET, TS + 1, BODY)).not.toBe(signature);
    expect(signWebhookPayload(SECRET, TS, `${BODY} `)).not.toBe(signature);
  });

  it('verifies a fresh, correctly signed delivery', () => {
    const signature = signWebhookPayload(SECRET, TS, BODY);
    expect(
      verifyWebhookSignature({
        secret: SECRET,
        body: BODY,
        signatureHeader: signature,
        timestampHeader: String(TS),
        now: NOW,
      }),
    ).toEqual({ ok: true });
  });

  it('accepts a comma-separated header that carries other schemes too', () => {
    const signature = signWebhookPayload(SECRET, TS, BODY);
    expect(
      verifyWebhookSignature({
        secret: SECRET,
        body: BODY,
        signatureHeader: `v0=deadbeef, ${signature}`,
        timestampHeader: String(TS),
        now: NOW,
      }).ok,
    ).toBe(true);
  });

  it.each([
    ['missing', { signatureHeader: null, timestampHeader: String(TS) }],
    ['missing', { signatureHeader: signWebhookPayload(SECRET, TS, BODY), timestampHeader: '' }],
    ['timestamp', { signatureHeader: 'v1=00', timestampHeader: 'yesterday' }],
    ['malformed', { signatureHeader: 'sha1=abc', timestampHeader: String(TS) }],
    [
      'mismatch',
      { signatureHeader: signWebhookPayload('other', TS, BODY), timestampHeader: String(TS) },
    ],
    [
      'mismatch',
      { signatureHeader: signWebhookPayload(SECRET, TS, '{}'), timestampHeader: String(TS) },
    ],
  ] as const)('refuses with %s', (reason, headers) => {
    expect(verifyWebhookSignature({ secret: SECRET, body: BODY, now: NOW, ...headers })).toEqual({
      ok: false,
      reason,
    });
  });

  it('refuses a replay outside the tolerance window, in either direction', () => {
    const old = TS - WEBHOOK_SIGNATURE_TOLERANCE_SECONDS - 1;
    const future = TS + WEBHOOK_SIGNATURE_TOLERANCE_SECONDS + 1;

    for (const stamp of [old, future]) {
      expect(
        verifyWebhookSignature({
          secret: SECRET,
          body: BODY,
          signatureHeader: signWebhookPayload(SECRET, stamp, BODY),
          timestampHeader: String(stamp),
          now: NOW,
        }),
      ).toEqual({ ok: false, reason: 'expired' });
    }

    const edge = TS - WEBHOOK_SIGNATURE_TOLERANCE_SECONDS;
    expect(
      verifyWebhookSignature({
        secret: SECRET,
        body: BODY,
        signatureHeader: signWebhookPayload(SECRET, edge, BODY),
        timestampHeader: String(edge),
        now: NOW,
      }).ok,
    ).toBe(true);
  });
});
