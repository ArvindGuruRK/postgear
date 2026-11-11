/**
 * Discover (Sprint 11): what is rising and what is being reported where the
 * audience is.
 *
 * The server asks for the status (whether the place service is on, whether
 * the API reads recorded feeds, and which sources are set up), with a `null`
 * fallback the island copes with. The feed itself is fetched by the island,
 * because the place is the viewer's own and lives in their browser, not in
 * the request.
 *
 * It also asks for what the workspace saved (Module 06): the place a first
 * visit starts from, the languages, the News topics and the switched-off
 * groups. That is known before the first paint, so a new member opens on the
 * workspace's city with no guess in between. A failed read is `null` too, and
 * the page then starts from the time zone guess as it always did. So is a
 * read made while the active-workspace cookie still names another workspace
 * (a bookmark, a typed address): the API would answer with that workspace's
 * place, so the settings wait for the render after `SyncActiveWorkspace`.
 *
 * The viewer's role comes along (Module 05), the way the Channels and
 * Workflows pages learn it: only a workspace admin is told who can add a
 * missing YouTube key, and only an admin may press Save For This Workspace.
 * It is presentation only (the API's guard is the real check), so a failed
 * lookup reads as a member.
 *
 * The island is keyed by the workspace, so switching workspaces starts from
 * that workspace's remembered place instead of carrying the last one over
 * (and drops an open Create Post sheet with it).
 */
import type { Metadata } from 'next';
import { settingsInScope, tabFrom } from '@/components/discover/discover-model';
import { DiscoverPage } from '@/components/discover/discover-page';
import { serverApi } from '@/lib/api';
import { getActiveOrgId, getSessionCookieHeader } from '@/lib/session';
import type { DiscoverSettings, DiscoverStatus } from '@/types/discover';
import type { Organization } from '@/types/workspace';

export const metadata: Metadata = { title: 'Discover' };

export default async function DiscoverRoute({
  params,
  searchParams,
}: PageProps<'/[orgId]/discover'>) {
  const [{ orgId }, query] = await Promise.all([params, searchParams]);
  const [cookie, activeOrgId] = await Promise.all([getSessionCookieHeader(), getActiveOrgId()]);
  const scoped = settingsInScope(orgId, activeOrgId);

  const [status, settings, isAdmin] = await Promise.all([
    serverApi<{ status: DiscoverStatus }>('/discover/status', { cookie })
      .then((result) => result.status)
      .catch(() => null),
    scoped
      ? serverApi<{ settings: DiscoverSettings }>('/discover/settings', { cookie })
          .then((result) => result.settings)
          .catch(() => null)
      : Promise.resolve(null),
    serverApi<{ organizations: Organization[] }>('/orgs', { cookie })
      .then((result) => {
        const role = result.organizations.find((organization) => organization.id === orgId)?.role;
        return role === 'ADMIN' || role === 'SUPERADMIN';
      })
      .catch(() => false),
  ]);

  return (
    <DiscoverPage
      key={orgId}
      orgId={orgId}
      status={status}
      initialTab={tabFrom(query.tab)}
      settings={settings}
      isAdmin={isAdmin}
    />
  );
}
