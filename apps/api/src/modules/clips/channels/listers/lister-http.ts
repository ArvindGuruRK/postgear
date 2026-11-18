/**
 * The only way the official channel listers reach the network: plain HTTPS
 * to a fixed set of origins (`api.twitch.tv`, `id.twitch.tv`,
 * `www.googleapis.com`), each named in code, never taken from a person.
 *
 * - Any other origin is refused before a request is made, and redirects are
 *   never followed (one could point anywhere).
 * - Every request has a timeout and the body is capped, so a slow or huge
 *   answer cannot hold a request or the process.
 * - No cookies. The answer comes back whatever its status, so a binding can
 *   tell a 401 (fetch a new token) from a 429 (slow down).
 * - Errors carry no address: the YouTube key rides in the query string, and
 *   a URL in a log line would leak it.
 *
 * Injected as a function, so the specs drive the listers with recorded
 * answers and never touch the network.
 */
import { ListingFailure } from './listing-failure';

export interface ListerHttpRequest {
  url: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  /** Sent as `application/x-www-form-urlencoded` with a POST. */
  form?: Record<string, string>;
  signal?: AbortSignal;
}

export interface ListerHttpResponse {
  status: number;
  header(name: string): string | null;
  /** The body as JSON, or null when it is not JSON. */
  json: unknown;
}

export type ListerHttp = (request: ListerHttpRequest) => Promise<ListerHttpResponse>;

export const LISTER_ORIGINS = Object.freeze([
  'https://api.twitch.tv',
  'https://id.twitch.tv',
  'https://www.googleapis.com',
]);

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;

export interface ListerHttpOptions {
  origins?: readonly string[];
  timeoutMs?: number;
  maxBytes?: number;
  fetchImpl?: typeof globalThis.fetch;
}

export function createListerHttp(options: ListerHttpOptions = {}): ListerHttp {
  const origins = new Set(options.origins ?? LISTER_ORIGINS);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  return async (request) => {
    let target: URL;
    try {
      target = new URL(request.url);
    } catch {
      throw new ListingFailure('channel_listing_failed');
    }
    if (!origins.has(target.origin)) {
      throw new ListingFailure('channel_listing_failed');
    }

    const method = request.method ?? 'GET';
    const headers: Record<string, string> = { accept: 'application/json', ...request.headers };
    let body: string | undefined;
    if (method === 'POST' && request.form) {
      body = new URLSearchParams(request.form).toString();
      headers['content-type'] = 'application/x-www-form-urlencoded';
    }
    const signals = [AbortSignal.timeout(timeoutMs)];
    if (request.signal) signals.push(request.signal);

    let response: Response;
    try {
      response = await fetchImpl(target, {
        method,
        headers,
        body,
        redirect: 'error',
        credentials: 'omit',
        signal: AbortSignal.any(signals),
      });
    } catch (error) {
      // The cause is kept for a debugger, never logged: it may hold the address.
      throw new ListingFailure(request.signal?.aborted ? 'cancelled' : 'channel_listing_failed', {
        cause: error,
      });
    }

    const text = await readCapped(response, maxBytes);
    let json: unknown = null;
    if (text !== null && text.length > 0) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }
    return { status: response.status, header: (name) => response.headers.get(name), json };
  };
}

/** The body as text, or null when it passes the cap (the answer then reads as not JSON). */
async function readCapped(response: Response, maxBytes: number): Promise<string | null> {
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } catch (error) {
    throw new ListingFailure('channel_listing_failed', { cause: error });
  }
  return new TextDecoder('utf-8').decode(Buffer.concat(chunks));
}
