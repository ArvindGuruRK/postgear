import { cookies } from 'next/headers';
import { serverApi } from './api';

/**
 * Server-side session access, and the enforcement point for both route gates.
 *
 * ## Why there is no `proxy.ts`
 *
 * Next 16 renamed `middleware.ts` to `proxy.ts` and its own documentation
 * recommends avoiding it "unless no other options exist". A proxy here would
 * have to re-verify the JWT signature itself, duplicating what the API already
 * does — two checks that can disagree, with the shared secret handled in two
 * places. The layouts below are authoritative and cannot be bypassed: a nested
 * route always renders its parent layouts first, and reading `cookies()` opts
 * the route into dynamic rendering, so there is no cached HTML to serve an
 * anonymous visitor.
 *
 * The cost is one `/auth/me` round trip per protected navigation. That is a
 * single indexed primary-key lookup on the API side, and it buys authorization
 * data that is never stale — a revoked session stops working immediately
 * rather than at token expiry.
 */

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  isSuperAdmin: boolean;
  onboardingStep: number;
  onboardingCompletedAt: string | null;
}

/**
 * Serializes the incoming request's cookies for forwarding to the API.
 *
 * Server-side `fetch` has no cookie jar, so without this the API sees an
 * anonymous request and every protected page redirects to `/login` even
 * though the browser is perfectly well signed in.
 */
export async function getSessionCookieHeader(): Promise<string> {
  return (await cookies()).toString();
}

/**
 * The signed-in user, or `null`.
 *
 * Never throws on an expired or absent session — that is an ordinary state for
 * a page to be in, not an error, and the caller decides what to do about it.
 */
export async function getSession(): Promise<SessionUser | null> {
  const cookie = await getSessionCookieHeader();

  if (!cookie) {
    // Skip the round trip entirely when there is not even a cookie to send.
    return null;
  }

  try {
    const result = await serverApi<{ user: SessionUser } | null>('/auth/me', {
      cookie,
      throwOnUnauthorized: false,
    });

    return result?.user ?? null;
  } catch {
    // A network failure reaching the API must read as "not signed in" rather
    // than crashing the layout — the user sees the login screen, which is
    // recoverable, instead of an error page, which is not.
    return null;
  }
}

/**
 * Gate 2's predicate: has this user finished onboarding?
 *
 * Backed by `User.onboardingCompletedAt`, not by "has at least one
 * organization". The derived check would flip to true the moment step 1
 * creates the workspace, making steps 2 through 5 unreachable — see the
 * reasoning in `apps/api/src/modules/onboarding/onboarding.service.ts`.
 */
export function hasCompletedOnboarding(user: SessionUser): boolean {
  return user.onboardingCompletedAt !== null;
}

/** The active workspace id from the (readable) org cookie, if one is set. */
export async function getActiveOrgId(): Promise<string | null> {
  const name = process.env.ORG_COOKIE_NAME ?? 'pg_org';
  return (await cookies()).get(name)?.value ?? null;
}
