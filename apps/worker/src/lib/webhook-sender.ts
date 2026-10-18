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
import { request as httpRequest } from 'node:http';
import { request as httpsRequest, type RequestOptions } from 'node:https';
import { isIP } from 'node:net';
import {
  signWebhookPayload,
  WEBHOOK_DELIVERY_HEADER,
  WEBHOOK_EVENT_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
} from '@postgear/db';
import { WEBHOOK_DELIVERY_TIMEOUT_MS } from '@postgear/scheduling';
import { assertSafeUrl, bareHostname, type UrlGuardOptions } from '@postgear/seo-engine';

export const WEBHOOK_USER_AGENT = 'PostGear-Webhooks/1.0';

/** Largest response body read before the connection is dropped. The body is never kept. */
const MAX_RESPONSE_BYTES = 64 * 1024;

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
  const started = Date.now();
  const timeoutMs = input.timeoutMs ?? WEBHOOK_DELIVERY_TIMEOUT_MS;
  const timestamp = input.timestamp ?? Math.floor(Date.now() / 1000);
  const headers = webhookHeaders({
    secret: input.secret,
    deliveryId: input.deliveryId,
    event: input.event,
    body: input.body,
    timestamp,
  });

  let url: URL;
  let address: string | null = null;

  if (input.allowPrivate) {
    // Local testing: the receiver is on this machine, which the guard exists
    // to refuse. Only the scheme is checked; the OS resolves the host.
    try {
      url = new URL(input.url);
    } catch {
      return { outcome: 'unsafe', error: 'That is not a valid URL.', durationMs: 0 };
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { outcome: 'unsafe', error: 'Only http and https URLs are delivered to.', durationMs: 0 };
    }
  } else {
    const verdict = await assertSafeUrl(input.url, { resolve: input.resolve });
    if (!verdict.ok) {
      return { outcome: 'unsafe', error: verdict.message, durationMs: Date.now() - started };
    }
    url = verdict.url;
    address = verdict.addresses[0] ?? null;
  }

  const https = url.protocol === 'https:';
  const host = bareHostname(url);
  const options: RequestOptions = {
    method: 'POST',
    protocol: url.protocol,
    hostname: host,
    port: url.port === '' ? (https ? 443 : 80) : Number(url.port),
    path: `${url.pathname}${url.search}`,
    headers: { ...headers, host: url.host },
    agent: false,
    ...(address ? { lookup: pinnedLookup(address) } : {}),
  };
  if (https && isIP(host) === 0) {
    options.servername = host;
  }

  return new Promise<SendWebhookOutcome>((resolve) => {
    let settled = false;
    const finish = (outcome: SendWebhookOutcome): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    };
    const durationMs = () => Date.now() - started;

    const req = (https ? httpsRequest : httpRequest)(options);
    const timer = setTimeout(() => {
      req.destroy();
      finish({
        outcome: 'retry',
        statusCode: null,
        error: `No response within ${Math.round(timeoutMs / 1000)} s`,
        durationMs: durationMs(),
      });
    }, timeoutMs);

    req.on('error', (error: NodeJS.ErrnoException) => {
      finish({
        outcome: 'retry',
        statusCode: null,
        error: describeNetworkError(error),
        durationMs: durationMs(),
      });
    });

    req.on('response', (res) => {
      const statusCode = res.statusCode ?? 0;
      let read = 0;
      // The body is drained (so the socket is reusable by the OS) but never
      // kept, and a receiver that streams forever is cut off.
      res.on('data', (chunk: Buffer) => {
        read += chunk.length;
        if (read > MAX_RESPONSE_BYTES) {
          res.destroy();
        }
      });
      res.on('error', () => undefined);
      res.on('end', () => settle());
      res.on('close', () => settle());

      const settle = () => {
        if (statusCode >= 200 && statusCode < 300) {
          finish({ outcome: 'delivered', statusCode, durationMs: durationMs() });
        } else if (statusCode === 408 || statusCode === 429 || statusCode >= 500) {
          finish({
            outcome: 'retry',
            statusCode,
            error: `Receiver answered ${statusCode}`,
            durationMs: durationMs(),
          });
        } else {
          finish({
            outcome: 'rejected',
            statusCode,
            error: `Receiver answered ${statusCode}`,
            durationMs: durationMs(),
          });
        }
      };
    });

    req.end(input.body);
  });
}

/** A `lookup` that answers with the validated address for every name. */
function pinnedLookup(address: string): RequestOptions['lookup'] {
  const family = isIP(address) === 6 ? 6 : 4;
  return (_hostname, optionsOrCallback, maybeCallback) => {
    const callback =
      typeof optionsOrCallback === 'function' ? optionsOrCallback : (maybeCallback as never);
    const wantsAll =
      typeof optionsOrCallback === 'object' &&
      optionsOrCallback !== null &&
      (optionsOrCallback as { all?: boolean }).all === true;
    if (wantsAll) {
      (callback as (err: null, addresses: { address: string; family: number }[]) => void)(null, [
        { address, family },
      ]);
    } else {
      (callback as (err: null, address: string, family: number) => void)(null, address, family);
    }
  };
}

function describeNetworkError(error: NodeJS.ErrnoException): string {
  switch (error.code) {
    case 'ECONNREFUSED':
      return 'Connection refused';
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return 'Host not found';
    case 'ECONNRESET':
      return 'Connection reset';
    case 'ETIMEDOUT':
      return 'Connection timed out';
    case 'CERT_HAS_EXPIRED':
    case 'ERR_TLS_CERT_ALTNAME_INVALID':
    case 'DEPTH_ZERO_SELF_SIGNED_CERT':
    case 'SELF_SIGNED_CERT_IN_CHAIN':
    case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
      return 'TLS certificate not trusted';
    default:
      return error.code ? `Network error (${error.code})` : 'Network error';
  }
}
