/**
 * The single way this app talks to the PostGear API.
 *
 * ## Two callers, one function
 *
 * Browser code and server components both end up here. The difference is only
 * in how the session cookie travels:
 *
 * - **In the browser**, `credentials: 'include'` attaches it automatically.
 *   The API and the web app are different *ports* but the same *host*, and
 *   cookies are scoped by host, so no proxy layer is needed — just CORS with
 *   credentials, which `apps/api/src/main.ts` enables.
 * - **On the server**, there is no ambient cookie jar, so `serverApi()`
 *   forwards the incoming request's cookies explicitly. Forgetting that is the
 *   classic cause of "logged in in the browser, logged out in the layout".
 */

/** Browser-visible; must be inlined at build time, hence the NEXT_PUBLIC_ prefix. */
const BROWSER_API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

/**
 * Server-side base URL. Separate from the browser one because in a container
 * or on a private network the server reaches the API by a different address
 * than the user's browser does.
 */
const SERVER_API_URL = process.env.API_URL ?? BROWSER_API_URL;

/**
 * An error carrying the API's message.
 *
 * The API deliberately returns generic strings for anything auth-related (see
 * `apps/api/src/modules/auth/auth.messages.ts`), so whatever arrives here is
 * already safe to show a user verbatim — there is no field-level detail to
 * leak because the server never sent any.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Server-side only: the cookie header to forward. */
  cookie?: string;
  /** Set false to get `null` instead of a throw on 401. */
  throwOnUnauthorized?: boolean;
}

async function request<T>(baseUrl: string, path: string, options: ApiOptions = {}): Promise<T> {
  const { method = 'GET', body, cookie, throwOnUnauthorized = true } = options;

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'include',
    // Session-dependent by definition; a cached response would show one user
    // another user's data.
    cache: 'no-store',
  });

  if (response.status === 401 && !throwOnUnauthorized) {
    return null as T;
  }

  // 204 and an empty body would both make .json() throw.
  const text = await response.text();
  const payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};

  if (!response.ok) {
    throw new ApiError(
      typeof payload.error === 'string' ? payload.error : 'Something went wrong. Please try again.',
      response.status,
    );
  }

  return payload as T;
}

/** Call from client components. */
export function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  return request<T>(BROWSER_API_URL, path, options);
}

/**
 * Call from server components, route handlers and layouts.
 *
 * The caller passes the cookie header, normally from `getSessionCookieHeader()`
 * in `session.ts`.
 */
export function serverApi<T>(path: string, options: ApiOptions = {}): Promise<T> {
  return request<T>(SERVER_API_URL, path, options);
}

/**
 * Where the browser should navigate to begin an OAuth handshake.
 *
 * A full navigation, not a fetch: the provider's consent screen is a page the
 * user has to see, and the callback needs to arrive as a top-level request so
 * the API's `sameSite: 'lax'` session cookie is accepted.
 */
export function oauthStartUrl(provider: 'google' | 'github'): string {
  return `${BROWSER_API_URL}/auth/oauth/${provider}`;
}
