/**
 * Verifying a PostGear webhook delivery.
 *
 * PostGear signs every delivery: `X-PostGear-Signature: v1=<hex>` is the
 * HMAC-SHA256 of `"<X-PostGear-Timestamp>.<raw body>"` under the webhook's
 * secret. Verify against the **raw** request body — a body that has been
 * parsed and re-serialised will not match — and reject anything older than
 * the tolerance, which is what stops a captured delivery being replayed.
 *
 * This file is the SDK's own copy of `packages/db/src/webhook-signature.ts`
 * so the package stands alone; the two are kept in step by their tests.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { WebhookEvent } from './types';

export const WEBHOOK_SIGNATURE_HEADER = 'x-postgear-signature';
export const WEBHOOK_TIMESTAMP_HEADER = 'x-postgear-timestamp';
export const WEBHOOK_EVENT_HEADER = 'x-postgear-event';
export const WEBHOOK_DELIVERY_HEADER = 'x-postgear-delivery';

export const DEFAULT_TOLERANCE_SECONDS = 5 * 60;

export type WebhookVerification =
  | { ok: true }
  | { ok: false; reason: 'missing' | 'malformed' | 'timestamp' | 'expired' | 'mismatch' };

export interface VerifyWebhookInput {
  /** The raw request body, exactly as received. */
  payload: string | Buffer;
  /** The webhook's signing secret, as shown when it was created or rotated. */
  secret: string;
  /** The `X-PostGear-Signature` header. */
  signature: string | null | undefined;
  /** The `X-PostGear-Timestamp` header. */
  timestamp: string | null | undefined;
  toleranceSeconds?: number;
  /** Injected for tests. */
  now?: Date;
}

/** Computes the signature PostGear would send; exported so a receiver's tests can forge valid ones. */
export function signWebhookPayload(secret: string, timestamp: number | string, payload: string | Buffer): string {
  const body = typeof payload === 'string' ? payload : payload.toString('utf8');
  const digest = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return `v1=${digest}`;
}

export function verifyWebhookSignature(input: VerifyWebhookInput): WebhookVerification {
  if (!input.signature || !input.timestamp) {
    return { ok: false, reason: 'missing' };
  }

  const timestamp = Number(input.timestamp);
  if (!Number.isInteger(timestamp) || timestamp <= 0) {
    return { ok: false, reason: 'timestamp' };
  }

  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000);
  if (Math.abs(nowSeconds - timestamp) > (input.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS)) {
    return { ok: false, reason: 'expired' };
  }

  const presented = input.signature
    .split(',')
    .map((part) => part.trim())
    .find((part) => part.startsWith('v1='));
  if (!presented) {
    return { ok: false, reason: 'malformed' };
  }

  const expected = signWebhookPayload(input.secret, timestamp, input.payload);
  const a = Buffer.from(presented, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: 'mismatch' };
  }

  return { ok: true };
}

/**
 * Verifies and parses in one step: returns the typed event, or throws with
 * the reason. The shape most receivers want.
 */
export function constructWebhookEvent<TData = WebhookEvent['data']>(
  input: VerifyWebhookInput,
): WebhookEvent<TData> {
  const verdict = verifyWebhookSignature(input);
  if (!verdict.ok) {
    throw new Error(`PostGear webhook signature invalid: ${verdict.reason}`);
  }
  const body = typeof input.payload === 'string' ? input.payload : input.payload.toString('utf8');
  return JSON.parse(body) as WebhookEvent<TData>;
}
