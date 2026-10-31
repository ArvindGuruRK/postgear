/**
 * One safe HTTP client for every outside call a workflow step makes
 * (Sprint 10, Module 12): Slack, Teams, Discord, HTTP Request and Google
 * Sheets, and the Sprint 8 webhook sender on top of it.
 *
 * ## Why not `fetch`
 *
 * Every address here is user-supplied and fetched server-side, the SSRF
 * surface the SEO crawler taught us about: a guard that resolves the host
 * and then lets the HTTP client resolve it *again* leaves a DNS-rebinding
 * window between the two lookups. So the request is made with
 * `node:http(s)` and a `lookup` pinned to the address the guard validated:
 * the socket can only ever connect to what was checked. `servername` keeps
 * TLS verification against the real host name. Redirects are never
 * followed (a 3xx comes back as the answer), so a redirect cannot lead to a
 * private address.
 *
 * ## Outcomes
 *
 * - `ok`: any 2xx (and, since redirects are not followed, any 3xx).
 * - `retry`: 408, 429, 5xx, a timeout or a network error; `Retry-After`
 *   (seconds or a date) becomes `retryAfterMs`.
 * - `rejected`: any other 4xx; the body is kept when asked, for the app's
 *   own error words.
 * - `unsafe`: the address failed the guard.
 *
 * The response body is read up to `maxResponseBytes` (64 KB by default)
 * and dropped unless `keepBody` is set; past the cap the connection is cut
 * and `bodyTruncated` says so. Error texts are status lines, never a body.
 */
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { request as httpsRequest, type RequestOptions } from 'node:https';
import { isIP } from 'node:net';
import { assertSafeUrl, bareHostname, type UrlGuardOptions } from '@postgear/seo-engine';

export const SAFE_HTTP_MAX_RESPONSE_BYTES = 64 * 1024;

export type SafeHttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface SafeHttpRequest {
  method: SafeHttpMethod;
  url: string;
  headers?: Record<string, string>;
  /** Sent as is; `content-length` is set from it. */
  body?: string;
  timeoutMs: number;
  maxResponseBytes?: number;
  /** Keep the (capped) response body as text on the outcome. */
  keepBody: boolean;
  /** Let the request reach http, localhost and private addresses (local testing only). */
  allowPrivate?: boolean;
  /** The guard's resolver, injected by tests so nothing touches DNS. */
  resolve?: UrlGuardOptions['resolve'];
  /** Aborts the request (the run was cancelled). */
  signal?: AbortSignal;
}

interface Timing {
  durationMs: number;
}

export type SafeHttpOutcome =
  | ({
      outcome: 'ok';
      statusCode: number;
      headers: IncomingHttpHeaders;
      body?: string;
      bodyTruncated?: boolean;
    } & Timing)
  | ({
      outcome: 'retry';
      statusCode: number | null;
      error: string;
      retryAfterMs?: number;
      body?: string;
    } & Timing)
  | ({ outcome: 'rejected'; statusCode: number; error: string; body?: string } & Timing)
  | ({ outcome: 'unsafe'; error: string } & Timing);

/** `Retry-After` in milliseconds: whole seconds or an HTTP date; undefined when absent or odd. */
export function parseRetryAfter(
  value: string | string[] | undefined,
  now = Date.now(),
): number | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    return Math.round(Number(trimmed) * 1000);
  }
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, date - now);
}

export async function safeHttpRequest(input: SafeHttpRequest): Promise<SafeHttpOutcome> {
  const started = Date.now();
  const durationMs = () => Date.now() - started;
  const cap = input.maxResponseBytes ?? SAFE_HTTP_MAX_RESPONSE_BYTES;

  let url: URL;
  let address: string | null = null;

  if (input.allowPrivate) {
    // Local testing: the receiver may be on this machine, which the guard
    // exists to refuse. Only the scheme is checked; the OS resolves the host.
    try {
      url = new URL(input.url);
    } catch {
      return { outcome: 'unsafe', error: 'That is not a valid URL.', durationMs: 0 };
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { outcome: 'unsafe', error: 'Only http and https URLs are allowed.', durationMs: 0 };
    }
  } else {
    const verdict = await assertSafeUrl(input.url, { resolve: input.resolve });
    if (!verdict.ok) {
      return { outcome: 'unsafe', error: verdict.message, durationMs: durationMs() };
    }
    url = verdict.url;
    address = verdict.addresses[0] ?? null;
  }

  const https = url.protocol === 'https:';
  const host = bareHostname(url);
  const headers: Record<string, string> = { ...(input.headers ?? {}), host: url.host };
  if (input.body !== undefined) {
    headers['content-length'] = String(Buffer.byteLength(input.body, 'utf8'));
  }
  const options: RequestOptions = {
    method: input.method,
    protocol: url.protocol,
    hostname: host,
    port: url.port === '' ? (https ? 443 : 80) : Number(url.port),
    path: `${url.pathname}${url.search}`,
    headers,
    agent: false,
    ...(address ? { lookup: pinnedLookup(address) } : {}),
  };
  if (https && isIP(host) === 0) {
    options.servername = host;
  }

  if (input.signal?.aborted) {
    return { outcome: 'retry', statusCode: null, error: 'Cancelled', durationMs: 0 };
  }

  return new Promise<SafeHttpOutcome>((resolve) => {
    let settled = false;
    const finish = (outcome: SafeHttpOutcome): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      input.signal?.removeEventListener('abort', onAbort);
      resolve(outcome);
    };

    const req = (https ? httpsRequest : httpRequest)(options);
    const timer = setTimeout(() => {
      req.destroy();
      finish({
        outcome: 'retry',
        statusCode: null,
        error: `No response within ${Math.round(input.timeoutMs / 1000)} s`,
        durationMs: durationMs(),
      });
    }, input.timeoutMs);

    const onAbort = () => {
      req.destroy();
      finish({ outcome: 'retry', statusCode: null, error: 'Cancelled', durationMs: durationMs() });
    };
    input.signal?.addEventListener('abort', onAbort, { once: true });

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
      const chunks: Buffer[] = [];
      let read = 0;
      let truncated = false;

      res.on('data', (chunk: Buffer) => {
        if (truncated) return;
        const room = cap - read;
        if (chunk.length > room) {
          if (input.keepBody && room > 0) chunks.push(chunk.subarray(0, room));
          read = cap;
          truncated = true;
          // A receiver that streams forever is cut off.
          res.destroy();
          return;
        }
        read += chunk.length;
        if (input.keepBody) chunks.push(chunk);
      });
      res.on('error', () => undefined);
      res.on('end', () => settle());
      res.on('close', () => settle());

      const settle = () => {
        const body = input.keepBody ? Buffer.concat(chunks).toString('utf8') : undefined;
        const kept = body === undefined ? {} : { body };
        if (statusCode >= 200 && statusCode < 400) {
          finish({
            outcome: 'ok',
            statusCode,
            headers: res.headers,
            ...kept,
            ...(truncated ? { bodyTruncated: true } : {}),
            durationMs: durationMs(),
          });
        } else if (statusCode === 408 || statusCode === 429 || statusCode >= 500) {
          const retryAfterMs = parseRetryAfter(res.headers['retry-after']);
          finish({
            outcome: 'retry',
            statusCode,
            error: `Receiver answered ${statusCode}`,
            ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
            ...kept,
            durationMs: durationMs(),
          });
        } else {
          finish({
            outcome: 'rejected',
            statusCode,
            error: `Receiver answered ${statusCode}`,
            ...kept,
            durationMs: durationMs(),
          });
        }
      };
    });

    if (input.body !== undefined) {
      req.end(input.body);
    } else {
      req.end();
    }
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
