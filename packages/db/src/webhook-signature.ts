/**
 * Signing and verifying outbound webhook payloads (Sprint 8).
 *
 * Lives next to the other crypto primitives because both ends of PostGear
 * need it: the worker signs what it sends, and the API's tests (and the SDK,
 * which carries its own copy) verify. One implementation, so the two can
 * never disagree about what exactly is signed.
 *
 * ## The scheme
 *
 * `X-PostGear-Signature: v1=<hex>` where the hex is HMAC-SHA256 over
 * `"<timestamp>.<body>"` with the webhook's secret, and `<timestamp>` is the
 * unix-seconds value sent in `X-PostGear-Timestamp`. Binding the timestamp
 * into the signed string is what lets a receiver refuse a replayed request:
 * an attacker who captured a valid delivery cannot re-send it later without
 * also re-signing it, and cannot re-sign it without the secret. The `v1=`
 * prefix leaves room for a new algorithm without a flag day.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const WEBHOOK_SIGNATURE_HEADER = 'x-postgear-signature';
export const WEBHOOK_TIMESTAMP_HEADER = 'x-postgear-timestamp';
export const WEBHOOK_EVENT_HEADER = 'x-postgear-event';
export const WEBHOOK_DELIVERY_HEADER = 'x-postgear-delivery';

/** How far a delivery's timestamp may be from the receiver's clock. */
export const WEBHOOK_SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

const SCHEME = 'v1';

/** The exact string that is signed. Exported so a test can pin it. */
export function webhookSignedPayload(timestamp: number | string, body: string): string {
  return `${timestamp}.${body}`;
}

export function signWebhookPayload(secret: string, timestamp: number | string, body: string): string {
  const digest = createHmac('sha256', secret).update(webhookSignedPayload(timestamp, body)).digest('hex');
  return `${SCHEME}=${digest}`;
}

export type WebhookVerification =
  | { ok: true }
  | { ok: false; reason: 'missing' | 'malformed' | 'timestamp' | 'expired' | 'mismatch' };

/**
 * Verifies a received delivery. Constant-time on the digest, and refuses a
 * timestamp outside the tolerance window before doing any comparison.
 */
export function verifyWebhookSignature(params: {
  secret: string;
  body: string;
  signatureHeader: string | null | undefined;
  timestampHeader: string | null | undefined;
  now?: Date;
  toleranceSeconds?: number;
}): WebhookVerification {
  const { secret, body, signatureHeader, timestampHeader } = params;

  if (!signatureHeader || !timestampHeader) {
    return { ok: false, reason: 'missing' };
  }

  const timestamp = Number(timestampHeader);
  if (!Number.isInteger(timestamp) || timestamp <= 0) {
    return { ok: false, reason: 'timestamp' };
  }

  const nowSeconds = Math.floor((params.now ?? new Date()).getTime() / 1000);
  const tolerance = params.toleranceSeconds ?? WEBHOOK_SIGNATURE_TOLERANCE_SECONDS;
  if (Math.abs(nowSeconds - timestamp) > tolerance) {
    return { ok: false, reason: 'expired' };
  }

  // Several schemes may be sent comma-separated in future; find ours.
  const presented = signatureHeader
    .split(',')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SCHEME}=`));
  if (!presented) {
    return { ok: false, reason: 'malformed' };
  }

  const expected = signWebhookPayload(secret, timestamp, body);
  const a = Buffer.from(presented, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: 'mismatch' };
  }

  return { ok: true };
}
