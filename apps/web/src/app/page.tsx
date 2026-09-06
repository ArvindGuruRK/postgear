import { redirect } from 'next/navigation';
import { serverApi } from '@/lib/api';
import { getSession, getSessionCookieHeader, hasCompletedOnboarding } from '@/lib/session';
import type { Organization } from '@/types/workspace';

/**
 * Root route — the single place that decides where a visitor belongs.
 *
 * Every post-authentication redirect in the app points here rather than
 * computing a destination itself (login, the OAuth callback, onboarding
 * completion). One router, one set of rules, no drift.
 *
 * PostGear has no marketing site yet, so an anonymous visitor gets the sign-in
 * screen rather than a 404.
 */
export default async function RootPage() {
  const session = await getSession();

  if (!session) {
    redirect('/login');
  }

  if (!hasCompletedOnboarding(session)) {
    redirect('/onboarding');
  }

  const cookie = await getSessionCookieHeader();
  const { organizations } = await serverApi<{ organizations: Organization[] }>('/orgs', { cookie });

  // Onboarding cannot complete without creating a workspace, so this should be
  // unreachable — but a user whose last membership was revoked would land here,
  // and sending them to /onboarding lets them create a new workspace instead of
  // seeing a crash. Nothing may assume organizations[0] exists.
  if (organizations.length === 0) {
    redirect('/onboarding');
  }

  redirect(`/${organizations[0].id}/calendar`);
}
