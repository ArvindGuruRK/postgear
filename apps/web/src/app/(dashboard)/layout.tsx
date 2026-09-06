import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { getSession } from '@/lib/session';

/**
 * **Route gate 1: not authenticated → /login.**
 *
 * The (dashboard) group separates authenticated routes from (auth) in the URL
 * structure without adding a path segment; the visible shell lives one level
 * down in [orgId]/layout, where the org id needed to build navigation links
 * first exists.
 *
 * This gate belongs here rather than in [orgId] because an unauthenticated
 * visitor should not reach an org at all — and because /onboarding is a
 * sibling of [orgId] inside this group, so it inherits this check while
 * deliberately escaping gate 2.
 *
 * There is no `proxy.ts` (Next 16's rename of middleware) doing this instead.
 * See the reasoning in `lib/session.ts`. A layout gate cannot be bypassed:
 * every nested route renders its parent layouts first, and `cookies()` opts
 * the route into dynamic rendering, so no cached HTML can be served to an
 * anonymous visitor.
 */
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const session = await getSession();

  if (!session) {
    redirect('/login');
  }

  return <>{children}</>;
}
