/**
 * The HTML fetch path, and the probe used for link checks and robots/sitemap.
 *
 * Why not `fetch()`: the guard in `url-guard.ts` validates the address a host
 * resolves to, but a plain `fetch` resolves the host **again** when it
 * connects — a DNS answer that changes between the two lookups (rebinding)
 * would connect us to the private address the guard just refused. So every
 * request here goes through `node:http`/`node:https` with a `lookup` that
 * returns the validated address, while `servername`/`Host` still carry the
 * host name so TLS (SNI) and virtual hosting work. Redirects are followed by
 * hand for the same reason: each hop is re-validated before it is fetched,
 * and a hop into a private address fails the crawl as `unsafe_url`.
 *
 * Everything else is about never letting a hostile or merely huge site hurt
 * the process: a hard byte cap on the decoded body, a per-request timer on
 * top of the crawl's deadline signal, a redirect ceiling, and errors that
 * carry a kind and a host name — never a response body.
 *
 * Certificate problems do not stop the fetch. The analyzer's job is to report
 * that a certificate is bad, which it cannot do if the TLS layer refuses to
 * talk; `rejectUnauthorized: false` lets the handshake complete and
 * `socket.authorized` becomes the technical evaluator's `certificate` check.
 * Nothing we send is sensitive, so there is nothing for a bad certificate to
 * expose.
 */

import type { IncomingMessage } from 'node:http';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest, type RequestOptions } from 'node:https';
import type { LookupFunction } from 'node:net';
import { isIP } from 'node:net';
import { performance } from 'node:perf_hooks';
import type { TLSSocket } from 'node:tls';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import { SeoCrawlError, type UrlGuardOptions } from '../types';
import { assertSafeUrl, bareHostname } from './url-guard';

export const DEFAULT_MAX_HTML_BYTES = 2 * 1024 * 1024;
export const DEFAULT_MAX_REDIRECTS = 5;
export const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
export const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (compatible; PostGearBot/1.0; +https://postgear.rkay.in/seo-analyzer)';

const HTML_TYPES = ['text/html', 'application/xhtml+xml'];

export interface SafeFetchOptions {
  /** The crawl's deadline / the caller's abort. */
  signal?: AbortSignal;
  /** Ceiling for one request (connect to last byte). Default 15 s. */
  timeoutMs?: number;
  guard?: UrlGuardOptions;
  userAgent?: string;
  /** Largest decoded body accepted. Default 2 MiB. */
  maxBytes?: number;
  /** Redirect hops followed before giving up. Default 5. */
  maxRedirects?: number;
  /** Fail with `not_html` unless the content type is HTML. Default true. */
  requireHtml?: boolean;
  /** Fail with `bad_status` on a 4xx/5xx. Default true; probes set it false. */
  rejectBadStatus?: boolean;
  accept?: string;
}

export interface SafeFetchResponse {
  requestedUrl: string;
  finalUrl: string;
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  /** Decoded body size. */
  bytes: number;
  contentType: string | null;
  compressed: boolean;
  https: boolean;
  certificateValid: boolean | null;
  responseTimeMs: number;
  redirects: string[];
  /** The addresses the final host resolved to. */
  addresses: string[];
}

export type SafeProbeOptions = Omit<SafeFetchOptions, 'maxBytes' | 'requireHtml' | 'accept'>;

export type SafeProbeResponse = Omit<SafeFetchResponse, 'body' | 'bytes' | 'contentType'>;

// ---------------------------------------------------------------------------
// Error mapping
// ---------------------------------------------------------------------------

/** Socket-level failures that a retry a minute later could plausibly fix. */
const TRANSIENT_CODES = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE',
  'ECONNABORTED',
]);

function codeOf(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : '';
}

/**
 * Turns whatever a socket threw into a {@link SeoCrawlError}. The message
 * names the host and the code only — Node's own messages are fine, but the
 * rule in this package is that nothing from the wire reaches a message.
 */
export function classifyFetchError(error: unknown, host: string): SeoCrawlError {
  if (error instanceof SeoCrawlError) return error;
  const code = codeOf(error);
  if (code === 'ETIMEDOUT' || code === 'ERR_SOCKET_TIMEOUT') {
    return new SeoCrawlError('timeout', `${host} took too long to respond.`, true, {
      cause: error,
    });
  }
  if (TRANSIENT_CODES.has(code)) {
    return new SeoCrawlError('unreachable', `Could not reach ${host} (${code}).`, true, {
      cause: error,
    });
  }
  const label = code ? ` (${code})` : '';
  return new SeoCrawlError('unreachable', `Could not reach ${host}${label}.`, false, {
    cause: error,
  });
}

function abortErrorFrom(signal: AbortSignal | undefined, host: string): SeoCrawlError {
  const reason = signal?.reason;
  if (reason instanceof SeoCrawlError) return reason;
  return new SeoCrawlError('aborted', `The request to ${host} was cancelled.`, false, {
    cause: reason,
  });
}

export function badStatusError(statusCode: number, host: string): SeoCrawlError {
  const retryable = statusCode === 429 || statusCode >= 500;
  return new SeoCrawlError('bad_status', `${host} answered with HTTP ${statusCode}.`, retryable, {
    statusCode,
  });
}

function unsafeUrlError(result: {
  reason: SeoCrawlError['reason'];
  message: string;
}): SeoCrawlError {
  return new SeoCrawlError('unsafe_url', result.message, false, { reason: result.reason });
}

// ---------------------------------------------------------------------------
// One request to one pinned address
// ---------------------------------------------------------------------------

/**
 * A `lookup` that ignores DNS and answers with the address the guard
 * validated. Node ≥ 20 asks with `all: true` when it auto-selects the address
 * family, so both callback shapes are served.
 */
function pinnedLookup(address: string): LookupFunction {
  const family = isIP(address) === 6 ? 6 : 4;
  return (_hostname, options, callback) => {
    if (options.all) {
      callback(null, [{ address, family }]);
    } else {
      callback(null, address, family);
    }
  };
}

export function isHtmlContentType(contentType: string | null): boolean {
  if (!contentType) return false;
  const mime = contentType.split(';')[0].trim().toLowerCase();
  return HTML_TYPES.includes(mime);
}

function flattenHeaders(message: IncomingMessage): Record<string, string> {
  const flat: Record<string, string> = {};
  for (const [name, value] of Object.entries(message.headers)) {
    if (value === undefined) continue;
    flat[name.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value;
  }
  return flat;
}

function certificateValidity(message: IncomingMessage, https: boolean): boolean | null {
  if (!https) return null;
  const socket = message.socket as Partial<TLSSocket> | null;
  if (!socket || typeof socket.authorized !== 'boolean') return null;
  return socket.authorized;
}

interface RawRequest {
  method: 'GET' | 'HEAD';
  headers: Record<string, string>;
  signal?: AbortSignal;
  timeoutMs: number;
  maxBytes: number;
  /** Resolve as soon as the headers arrive and drop the body (probes). */
  discardBody: boolean;
}

interface RawResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: Buffer;
  bytes: number;
  compressed: boolean;
  certificateValid: boolean | null;
  responseTimeMs: number;
}

function decoderFor(encoding: string | undefined) {
  const value = (encoding ?? '').trim().toLowerCase();
  if (value === 'gzip' || value === 'x-gzip') return createGunzip();
  if (value === 'deflate') return createInflate();
  if (value === 'br') return createBrotliDecompress();
  return null;
}

function requestOnce(url: URL, address: string, init: RawRequest): Promise<RawResponse> {
  const https = url.protocol === 'https:';
  const host = bareHostname(url);
  const options: RequestOptions = {
    method: init.method,
    protocol: url.protocol,
    hostname: host,
    port: url.port === '' ? (https ? 443 : 80) : Number(url.port),
    path: `${url.pathname}${url.search}`,
    headers: { ...init.headers, host: url.host },
    lookup: pinnedLookup(address),
    agent: false,
  };
  if (https) {
    options.rejectUnauthorized = false;
    if (isIP(host) === 0) options.servername = host;
  }

  return new Promise<RawResponse>((resolve, reject) => {
    let settled = false;
    const started = performance.now();
    const req = (https ? httpsRequest : httpRequest)(options);

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      init.signal?.removeEventListener('abort', onAbort);
      fn();
    };
    const fail = (error: SeoCrawlError) => {
      finish(() => {
        req.destroy(error);
        reject(error);
      });
    };
    const onAbort = () => fail(abortErrorFrom(init.signal, host));
    const timer = setTimeout(
      () => fail(new SeoCrawlError('timeout', `${host} took too long to respond.`, true)),
      init.timeoutMs,
    );

    // The listener goes on before anything can destroy the request: a
    // destroyed ClientRequest emits ECONNRESET, and with no listener that is
    // an uncaught exception.
    req.on('error', (error) => fail(classifyFetchError(error, host)));

    if (init.signal?.aborted) {
      fail(abortErrorFrom(init.signal, host));
      return;
    }
    init.signal?.addEventListener('abort', onAbort, { once: true });
    req.on('response', (res) => {
      // After the headers, a dropped socket is reported on the response.
      res.on('error', (error) => fail(classifyFetchError(error, host)));
      const statusCode = res.statusCode ?? 0;
      const headers = flattenHeaders(res);
      const certificateValid = certificateValidity(res, https);
      const encoding = headers['content-encoding'];
      const compressed = decoderFor(encoding) !== null;
      const isRedirect = statusCode >= 300 && statusCode < 400 && headers.location !== undefined;

      if (init.discardBody || init.method === 'HEAD' || isRedirect) {
        const responseTimeMs = performance.now() - started;
        res.resume();
        finish(() => {
          resolve({
            statusCode,
            headers,
            body: Buffer.alloc(0),
            bytes: 0,
            compressed,
            certificateValid,
            responseTimeMs,
          });
          // A probe has what it needs; do not keep reading a body it will drop.
          if (init.discardBody) req.destroy();
        });
        return;
      }

      const declared = Number(headers['content-length']);
      if (Number.isFinite(declared) && declared > init.maxBytes && !compressed) {
        fail(
          new SeoCrawlError('too_large', `${host} sent a page larger than the limit.`, false, {
            statusCode,
          }),
        );
        return;
      }

      const decoder = decoderFor(encoding);
      const stream = decoder ? res.pipe(decoder) : res;
      const chunks: Buffer[] = [];
      let bytes = 0;

      stream.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > init.maxBytes) {
          fail(
            new SeoCrawlError('too_large', `${host} sent a page larger than the limit.`, false, {
              statusCode,
            }),
          );
          return;
        }
        chunks.push(chunk);
      });
      stream.on('error', (error) => {
        fail(
          new SeoCrawlError('unreachable', `The response from ${host} could not be read.`, false, {
            cause: error,
            statusCode,
          }),
        );
      });
      stream.on('end', () => {
        const responseTimeMs = performance.now() - started;
        finish(() =>
          resolve({
            statusCode,
            headers,
            body: Buffer.concat(chunks),
            bytes,
            compressed,
            certificateValid,
            responseTimeMs,
          }),
        );
      });
    });

    req.end();
  });
}

// ---------------------------------------------------------------------------
// Redirect-following, guard-checked requests
// ---------------------------------------------------------------------------

interface FollowOptions extends SafeFetchOptions {
  method: 'GET' | 'HEAD';
  discardBody: boolean;
}

interface Followed extends RawResponse {
  finalUrl: URL;
  redirects: string[];
  addresses: string[];
}

function pickAddress(addresses: string[]): string {
  // Prefer IPv4: a host that publishes both is reachable over v4 on far more
  // networks (this machine's included), and a v6 route that is down costs
  // a full timeout before anything else is tried.
  return addresses.find((address) => isIP(address) === 4) ?? addresses[0];
}

async function follow(input: string, options: FollowOptions): Promise<Followed> {
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const headers: Record<string, string> = {
    'user-agent': options.userAgent ?? DEFAULT_USER_AGENT,
    accept: options.accept ?? 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
    'accept-encoding': 'gzip, deflate, br',
    'accept-language': 'en',
    connection: 'close',
  };
  if (options.discardBody && options.method === 'GET') headers.range = 'bytes=0-1023';

  const redirects: string[] = [];
  let current = input;

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const safety = await assertSafeUrl(current, options.guard);
    if (!safety.ok) throw unsafeUrlError(safety);

    const response = await requestOnce(safety.url, pickAddress(safety.addresses), {
      method: options.method,
      headers,
      signal: options.signal,
      timeoutMs: options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
      maxBytes: options.maxBytes ?? DEFAULT_MAX_HTML_BYTES,
      discardBody: options.discardBody,
    });

    const location = response.headers.location;
    if (response.statusCode >= 300 && response.statusCode < 400 && location !== undefined) {
      redirects.push(safety.url.toString());
      let next: URL;
      try {
        next = new URL(location, safety.url);
      } catch {
        throw new SeoCrawlError(
          'unreachable',
          `${bareHostname(safety.url)} redirected to an invalid address.`,
          false,
          { statusCode: response.statusCode },
        );
      }
      current = next.toString();
      continue;
    }

    return { ...response, finalUrl: safety.url, redirects, addresses: safety.addresses };
  }

  throw new SeoCrawlError('unreachable', 'Too many redirects.', false);
}

/**
 * GET a page. The main crawl's HTML path, also used for `robots.txt` with
 * `requireHtml: false` and a small `maxBytes`.
 */
export async function fetchUrlSafely(
  url: string,
  options: SafeFetchOptions = {},
): Promise<SafeFetchResponse> {
  const result = await follow(url, { ...options, method: 'GET', discardBody: false });
  const host = bareHostname(result.finalUrl);
  const contentType = result.headers['content-type'] ?? null;

  if ((options.rejectBadStatus ?? true) && result.statusCode >= 400) {
    throw badStatusError(result.statusCode, host);
  }
  if ((options.requireHtml ?? true) && !isHtmlContentType(contentType)) {
    throw new SeoCrawlError('not_html', `${host} did not return an HTML page.`, false, {
      statusCode: result.statusCode,
    });
  }

  return {
    requestedUrl: url,
    finalUrl: result.finalUrl.toString(),
    statusCode: result.statusCode,
    headers: result.headers,
    body: result.body.toString('utf8'),
    bytes: result.bytes,
    contentType,
    compressed: result.compressed,
    https: result.finalUrl.protocol === 'https:',
    certificateValid: result.certificateValid,
    responseTimeMs: Math.round(result.responseTimeMs),
    redirects: result.redirects,
    addresses: result.addresses,
  };
}

/**
 * Asks whether a URL exists without downloading it: HEAD first, and a ranged
 * GET whose body is dropped at the first byte when the server refuses HEAD
 * (405/501, or no answer at all). Used for link checks and the sitemap probe.
 * A 4xx/5xx is a result here, not an error — the caller counts it.
 */
export async function headUrlSafely(
  url: string,
  options: SafeProbeOptions = {},
): Promise<SafeProbeResponse> {
  const asProbe = (result: Followed): SafeProbeResponse => ({
    requestedUrl: url,
    finalUrl: result.finalUrl.toString(),
    statusCode: result.statusCode,
    headers: result.headers,
    compressed: result.compressed,
    https: result.finalUrl.protocol === 'https:',
    certificateValid: result.certificateValid,
    responseTimeMs: Math.round(result.responseTimeMs),
    redirects: result.redirects,
    addresses: result.addresses,
  });

  let head: Followed | null = null;
  try {
    head = await follow(url, { ...options, method: 'HEAD', discardBody: true });
  } catch (error) {
    // A server that drops HEAD outright still gets the GET below; anything
    // the guard refused, a timeout, or a cancel is final.
    if (error instanceof SeoCrawlError && error.kind !== 'unreachable') throw error;
  }
  if (head && head.statusCode !== 405 && head.statusCode !== 501) return asProbe(head);

  const get = await follow(url, { ...options, method: 'GET', discardBody: true });
  return asProbe(get);
}
