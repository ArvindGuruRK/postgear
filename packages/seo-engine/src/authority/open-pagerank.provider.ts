/**
 * Domain authority from Open PageRank (openpagerank.com) — the free backlink
 * index the sprint plan points at for the P1 authority signal.
 *
 * One GET per audit with the host name; the answer carries a 0–10
 * `page_rank_decimal` that is scaled to the Moz-style 0–100 the rest of the
 * engine speaks. A domain the index does not know comes back with a
 * per-domain status other than 200 and is reported as `null` — the evaluator
 * then estimates, which is the honest outcome, not a failure. The call has a
 * deadline, one retry on 429/5xx (a rate-limited audit should not fail
 * outright, and a second rate limit should not stall it), and an error
 * message that never includes the response body or the key: the key goes in
 * a header, and the only thing a caller learns from a failure is the status.
 */
import type { AuthorityEstimate, AuthorityProvider } from '../types';

export const OPEN_PAGERANK_ENDPOINT = 'https://openpagerank.com/api/v1.0/getPageRank';
export const DEFAULT_OPEN_PAGERANK_TIMEOUT_MS = 5_000;

export interface OpenPageRankOptions {
  apiKey: string;
  timeoutMs?: number;
  /** Injected for tests. */
  fetch?: typeof globalThis.fetch;
  sleep?: (ms: number) => Promise<void>;
  endpoint?: string;
}

interface OpenPageRankRow {
  status_code?: number;
  domain?: string;
  page_rank_decimal?: number | string | null;
}

interface OpenPageRankBody {
  status_code?: number;
  response?: OpenPageRankRow[];
}

export class AuthorityProviderError extends Error {
  constructor(
    message: string,
    readonly statusCode?: number,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'AuthorityProviderError';
  }
}

/** A signal that fires on the parent's abort or after `timeoutMs`; `dispose` in `finally`. */
function withDeadline(
  timeoutMs: number,
  parent?: AbortSignal,
): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
  const onAbort = () => controller.abort(parent?.reason);
  if (parent?.aborted) onAbort();
  else parent?.addEventListener('abort', onAbort, { once: true });
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      parent?.removeEventListener('abort', onAbort);
    },
  };
}

export function createOpenPageRankProvider(options: OpenPageRankOptions): AuthorityProvider {
  const timeoutMs = options.timeoutMs ?? DEFAULT_OPEN_PAGERANK_TIMEOUT_MS;
  const doFetch = options.fetch ?? globalThis.fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const endpoint = options.endpoint ?? OPEN_PAGERANK_ENDPOINT;

  async function call(hostname: string, signal?: AbortSignal): Promise<Response> {
    const url = new URL(endpoint);
    url.searchParams.append('domains[]', hostname);
    const deadline = withDeadline(timeoutMs, signal);
    try {
      return await doFetch(url.toString(), {
        method: 'GET',
        headers: { 'API-OPR': options.apiKey, accept: 'application/json' },
        signal: deadline.signal,
      });
    } catch (error) {
      if (signal?.aborted) throw new AuthorityProviderError('The authority lookup was cancelled.');
      throw new AuthorityProviderError('Open PageRank could not be reached.', undefined, {
        cause: error,
      });
    } finally {
      deadline.dispose();
    }
  }

  return {
    name: 'openpagerank',
    async estimate(hostname, estimateOptions = {}) {
      const host = hostname.toLowerCase().replace(/^www\./, '');
      let response = await call(host, estimateOptions.signal);
      if (response.status === 429 || response.status >= 500) {
        await sleep(500);
        response = await call(host, estimateOptions.signal);
      }
      if (!response.ok) {
        throw new AuthorityProviderError(
          `Open PageRank answered HTTP ${response.status}.`,
          response.status,
        );
      }

      let body: OpenPageRankBody;
      try {
        body = (await response.json()) as OpenPageRankBody;
      } catch (error) {
        throw new AuthorityProviderError(
          'Open PageRank returned an unreadable answer.',
          undefined,
          {
            cause: error,
          },
        );
      }
      const row = body.response?.find((item) => (item.domain ?? '').toLowerCase() === host);
      const candidate = row ?? body.response?.[0];
      if (candidate?.status_code !== 200) return null;
      const decimal = Number(candidate.page_rank_decimal);
      if (!Number.isFinite(decimal)) return null;
      const pageRank = Math.round(Math.min(10, Math.max(0, decimal)) * 100) / 100;
      const estimate: AuthorityEstimate = {
        source: 'openpagerank',
        domainAuthority: Math.round(pageRank * 10),
        pageRank,
      };
      return estimate;
    },
  };
}
