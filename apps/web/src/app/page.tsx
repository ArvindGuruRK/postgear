import { redirect } from 'next/navigation';
import { getSession, hasCompletedOnboarding } from '@/lib/session';
import { workspaceHome } from '@/lib/workspace-home';
import { getOrganizations } from '@/lib/workspace-role';

/**
 * Root route: the single place that decides where a visitor belongs.
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

  const organizations = await getOrganizations();

  // Onboarding cannot complete without creating a workspace, so this should be
  // unreachable, but a user whose last membership was revoked would land here,
  // and sending them to /onboarding lets them create a new workspace instead of
  // seeing a crash. Nothing may assume organizations[0] exists.
  if (organizations.length === 0) {
    redirect('/onboarding');
  }

  // Home, the first entry in the rail, is where a signed-in visitor lands;
  // an Editor lands on Clips (Module 14).
  redirect(workspaceHome(organizations[0].id, organizations[0].role));
}
