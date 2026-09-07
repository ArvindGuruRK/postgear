import { notFound, redirect } from 'next/navigation';
import { DashboardShell } from '@/components/navigation/dashboard-shell';
import { SyncActiveWorkspace } from '@/components/navigation/sync-active-workspace';
import { serverApi } from '@/lib/api';
import {
  getActiveOrgId,
  getSession,
  getSessionCookieHeader,
  hasCompletedOnboarding,
} from '@/lib/session';
import { WorkspaceProvider } from '@/components/navigation/workspace-provider';
import type { Organization } from '@/types/workspace';

/**
 * **Route gate 2: authenticated but not onboarded → /onboarding.**
 *
 * This sits between gate 1 (the (dashboard) group layout above) and the
 * workspace itself, exactly as SCHEMA_NOTES prescribes — an un-onboarded user
 * has no org id to route with, so the check has to happen before anything
 * reads `[orgId]`.
 *
 * `/onboarding` lives at `(dashboard)/onboarding`, a sibling of this segment,
 * so it passes through gate 1 and never reaches gate 2. That achieves the
 * "between the two layouts" placement without moving the eleven existing
 * `[orgId]` pages into a new route group.
 *
 * `params` is a Promise in App Router; `LayoutProps<'/[orgId]'>` is the type
 * Next generates and validates every layout against.
 */
export default async function OrgLayout({ children, params }: LayoutProps<'/[orgId]'>) {
  const { orgId } = await params;
  const session = await getSession();

  // Gate 1 already redirected, but the type is nullable and the compiler is
  // right to insist.
  if (!session) {
    redirect('/login');
  }

  if (!hasCompletedOnboarding(session)) {
    redirect('/onboarding');
  }

  const cookie = await getSessionCookieHeader();
  const { organizations } = await serverApi<{ organizations: Organization[] }>('/orgs', { cookie });
  const active = organizations.find((organization) => organization.id === orgId);

  // A URL naming a workspace this user is not in renders the 404 rather than
  // an empty shell. Not a redirect: the distinction between "does not exist"
  // and "you cannot see it" is one the server deliberately does not draw.
  if (!active) {
    notFound();
  }

  // The API scopes workspace-owned requests on the `pg_org` cookie, not on this
  // segment. Arriving by bookmark, by shared link, or as a user in more than
  // one workspace (where login sets no default) leaves the two disagreeing —
  // and every page that fetches workspace data then renders someone else's, or
  // nothing at all. See `SyncActiveWorkspace` for why the fix lives on the
  // client.
  const needsWorkspaceSync = (await getActiveOrgId()) !== active.id;

  return (
    <WorkspaceProvider
      organizations={organizations}
      activeOrgId={active.id}
      role={active.role}
      user={{ name: session.name, email: session.email }}
    >
      {needsWorkspaceSync ? <SyncActiveWorkspace orgId={active.id} /> : null}
      <DashboardShell orgId={orgId}>{children}</DashboardShell>
    </WorkspaceProvider>
  );
}
