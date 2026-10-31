/**
 * Sends one signed webhook request (Sprint 8).
 *
 * ## Why not `fetch`
 *
 * A webhook URL is user-supplied and fetched server-side, which makes it the
 * same SSRF surface as the SEO crawler, and the crawler's lesson applies: a
 * guard that resolves the host and then lets the HTTP client resolve it
 * *again* leaves a DNS-rebinding window between the two lookups. So the
 * request is made with `node:http(s)` and a `lookup` pinned to the address
 * the guard validated: the socket can only ever connect to what was
 * checked. `servername` keeps TLS verification against the real host name.
 *
 * ## What an outcome means
 *
 * The request itself is made by `safeHttpRequest` (safe-http.ts), shared
 * with every workflow step that reaches an outside app.
 *
 * - `delivered`: any 2xx. The receiver has it; the body is ignored.
 * - `retry`: 408, 429, 5xx, a timeout, or a network error. The receiver may
 *   be back later; the workflow's policy decides when to try again.
 * - `rejected`: any other 4xx. The request is wrong for this receiver and a
 *   retry would get the same answer, so the delivery fails at once.
 * - `unsafe`: the URL failed the guard. Treated as rejected by the activity,
 *   and logged: the URL was checked at save time, so this is a record that
 *   changed underneath (a host that now resolves privately), not a typo.
 *
 * `lastError` is a status line, never the receiver's response body: a
 * receiver's body is content a workspace member will see on the deliveries
 * screen, and an attacker-chosen one has no business there.
 */
import {
  signWebhookPayload,
  WEBHOOK_DELIVERY_HEADER,
  WEBHOOK_EVENT_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
} from '@postgear/db';
import { WEBHOOK_DELIVERY_TIMEOUT_MS } from '@postgear/scheduling';
import type { UrlGuardOptions } from '@postgear/seo-engine';
import { safeHttpRequest } from './safe-http';

export const WEBHOOK_USER_AGENT = 'PostGear-Webhooks/1.0';

export interface SendWebhookInput {
  url: string;
  secret: string;
  deliveryId: string;
  event: string;
  /** The exact JSON string that is signed and sent. */
  body: string;
  timeoutMs?: number;
  /** Let the request reach localhost / private addresses (local testing only). */
  allowPrivate?: boolean;
  /** Unix seconds; defaults to now. Injected for tests. */
  timestamp?: number;
  /** The guard's resolver, injected by tests so nothing touches DNS. */
  resolve?: UrlGuardOptions['resolve'];
}

export type SendWebhookOutcome =
  | { outcome: 'delivered'; statusCode: number; durationMs: number }
  | { outcome: 'retry'; statusCode: number | null; error: string; durationMs: number }
  | { outcome: 'rejected'; statusCode: number; error: string; durationMs: number }
  | { outcome: 'unsafe'; error: string; durationMs: number };

/** The headers every delivery carries, built once so the sender and its test agree. */
export function webhookHeaders(input: {
  secret: string;
  deliveryId: string;
  event: string;
  body: string;
  timestamp: number;
}): Record<string, string> {
  return {
    'content-type': 'application/json',
    'content-length': String(Buffer.byteLength(input.body, 'utf8')),
    'user-agent': WEBHOOK_USER_AGENT,
    [WEBHOOK_EVENT_HEADER]: input.event,
    [WEBHOOK_DELIVERY_HEADER]: input.deliveryId,
    [WEBHOOK_TIMESTAMP_HEADER]: String(input.timestamp),
    [WEBHOOK_SIGNATURE_HEADER]: signWebhookPayload(input.secret, input.timestamp, input.body),
  };
}

export async function sendWebhook(input: SendWebhookInput): Promise<SendWebhookOutcome> {
  const timestamp = input.timestamp ?? Math.floor(Date.now() / 1000);
  const { 'content-length': _length, ...headers } = webhookHeaders({
    secret: input.secret,
    deliveryId: input.deliveryId,
    event: input.event,
    body: input.body,
    timestamp,
  });

  // The guard, the pinned lookup, the timeout and the body cap live in
  // safe-http.ts (Sprint 10, Module 12). The body is never kept.
  const result = await safeHttpRequest({
    method: 'POST',
    url: input.url,
    headers,
    body: input.body,
    timeoutMs: input.timeoutMs ?? WEBHOOK_DELIVERY_TIMEOUT_MS,
    keepBody: false,
    allowPrivate: input.allowPrivate,
    resolve: input.resolve,
  });

  switch (result.outcome) {
    case 'ok':
      // Redirects are not followed: a 3xx is the receiver refusing this URL.
      return result.statusCode < 300
        ? { outcome: 'delivered', statusCode: result.statusCode, durationMs: result.durationMs }
        : {
            outcome: 'rejected',
            statusCode: result.statusCode,
            error: `Receiver answered ${result.statusCode}`,
            durationMs: result.durationMs,
          };
    case 'retry':
      return {
        outcome: 'retry',
        statusCode: result.statusCode,
        error: result.error,
        durationMs: result.durationMs,
      };
    case 'rejected':
      return {
        outcome: 'rejected',
        statusCode: result.statusCode,
        error: result.error,
        durationMs: result.durationMs,
      };
    case 'unsafe':
      return { outcome: 'unsafe', error: result.error, durationMs: result.durationMs };
  }
}
