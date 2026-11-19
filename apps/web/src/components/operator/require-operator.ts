import { notFound, redirect } from 'next/navigation';
import { cache } from 'react';
import { getSession, type SessionUser } from '@/lib/session';

/**
 * The operator screens' gate (Sprint 12, Module 19 section 7), decided on the
 * server from the session before anything of the screen is drawn:
 *
 * - signed out: the login page, as any other page in the app;
 * - signed in but not a platform operator: the app's 404 page, so the screen
 *   never announces itself.
 *
 * `cache` makes it one `/auth/me` round trip a request: the layout and the
 * page render in parallel in Next 16, so both call it and neither draws
 * before it has answered. The API stays the binding check (`PlatformAdminGuard`,
 * with the production allowlist); the page also turns its 403 into the 404.
 */
export const requireOperator = cache(async (): Promise<SessionUser> => {
  const session = await getSession();
  if (!session) redirect('/login');
  if (!session.isSuperAdmin) notFound();
  return session;
});
