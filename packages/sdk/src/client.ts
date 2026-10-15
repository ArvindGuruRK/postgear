/**
 * The PostGear API client: a thin, typed `fetch` wrapper with no business
 * logic of its own (the sprint document's rule for an SDK, and the lesson
 * of the reference's: a client that hides a 401 inside "data" is worse than
 * none).
 *
 * - Every call sends `Authorization: Bearer <apiKey>`.
 * - Every non-2xx answer throws a `PostGearError` carrying the API's own
 *   message and status; a 429 also carries `retryAfterSeconds`.
 * - Every call is bounded by `timeoutMs` through an `AbortSignal`, so a hung
 *   connection is an error, not a hang.
 * - Nothing is retried. The caller knows whether a post can be re-sent; the
 *   SDK does not.
 */
import { PostGearError, PostGearNetworkError } from './errors';
import type {
  AnalyticsOverview,
  AnalyticsRange,
  Channel,
  CreatePostInput,
  ListPostsQuery,
  Me,
  Post,
  PostPage,
} from './types';

export interface PostGearOptions {
  /** A key from Settings → API keys (`pg_…`). */
  apiKey: string;
  /** Where the API runs. Default: `http://localhost:3001`. */
  baseUrl?: string;
  /** Per-request ceiling. Default: 15 s. */
  timeoutMs?: number;
  /** Injected for tests; defaults to the global `fetch`. */
  fetch?: typeof fetch;
}

export const DEFAULT_BASE_URL = 'http://localhost:3001';
export const DEFAULT_TIMEOUT_MS = 15_000;
export const SDK_USER_AGENT = 'postgear-sdk/0.1.0';

type Method = 'GET' | 'POST' | 'DELETE';

export class PostGear {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  readonly channels = {
    /** Every connected channel of the workspace the key belongs to. */
    list: async (): Promise<Channel[]> =>
      (await this.request<{ channels: Channel[] }>('GET', '/v1/channels')).channels,
  };

  readonly posts = {
    /** The queue, twenty per page, newest first. */
    list: async (query: ListPostsQuery = {}): Promise<PostPage> =>
      this.request<PostPage>('GET', '/v1/posts', { query }),
    get: async (id: string): Promise<Post> =>
      (await this.request<{ post: Post }>('GET', `/v1/posts/${encodeURIComponent(id)}`)).post,
    /** Creates a draft or queues a post; a queued post must pass every platform rule. */
    create: async (input: CreatePostInput): Promise<Post> =>
      (await this.request<{ post: Post }>('POST', '/v1/posts', { body: input })).post,
    delete: async (id: string): Promise<void> => {
      await this.request<{ deleted: true }>('DELETE', `/v1/posts/${encodeURIComponent(id)}`);
    },
  };

  readonly analytics = {
    overview: async (query: { range?: AnalyticsRange } = {}): Promise<AnalyticsOverview> =>
      (await this.request<{ overview: AnalyticsOverview }>('GET', '/v1/analytics/overview', { query }))
        .overview,
  };

  constructor(options: PostGearOptions) {
    if (!options.apiKey || typeof options.apiKey !== 'string') {
      throw new TypeError('PostGear: an apiKey is required');
    }
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetch ?? globalThis.fetch;

    if (typeof this.fetchImpl !== 'function') {
      throw new TypeError('PostGear: no fetch available; pass one in options.fetch');
    }
  }

  /** Who the key is: the workspace, the key's own name, the plan. Also the cheapest key check. */
  me(): Promise<Me> {
    return this.request<Me>('GET', '/v1/me');
  }

  private async request<T>(
    method: Method,
    path: string,
    options: { query?: object; body?: unknown } = {},
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries((options.query ?? {}) as Record<string, unknown>)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(url.toString(), {
        method,
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          accept: 'application/json',
          'user-agent': SDK_USER_AGENT,
          ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });
    } catch (cause) {
      throw new PostGearNetworkError(
        controller.signal.aborted
          ? `PostGear: no response within ${this.timeoutMs} ms`
          : `PostGear: the request failed (${cause instanceof Error ? cause.message : String(cause)})`,
        cause,
      );
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text();
    let payload: unknown = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = null;
      }
    }

    if (!response.ok) {
      const message =
        payload && typeof payload === 'object' && typeof (payload as { error?: unknown }).error === 'string'
          ? (payload as { error: string }).error
          : `PostGear API answered ${response.status}`;
      const retryAfter = response.headers.get('retry-after');
      throw new PostGearError(
        message,
        response.status,
        retryAfter !== null && Number.isFinite(Number(retryAfter)) ? Number(retryAfter) : null,
      );
    }

    return payload as T;
  }
}
