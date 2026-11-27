/**
 * Discover settings (Sprint 11, Module 06): the workspace's place, languages,
 * News topics and which groups are on.
 *
 * A server component that loads what is saved so the cards are right on
 * first paint; when the request fails the island loads for itself and shows
 * the failure with a retry, rather than this page throwing.
 *
 * Two more things come along, both with a quiet fallback. The viewer's role,
 * looked up the way the Discover page does it: a member reads the page with
 * every control disabled, and a failed lookup reads as a member (the API's
 * guard is the real check). And whether this PostGear can look a city up at
 * all, which decides what the place card offers.
 *
 * The island is keyed by the workspace, so switching workspaces never shows
 * the last one's settings.
 */
import { canManageWorkspaceSettings } from '@postgear/entitlements';
import type { Metadata } from 'next';
import { DiscoverSettingsForm } from '@/components/settings/discover-settings';
import { serverApi } from '@/lib/api';
import { getSessionCookieHeader } from '@/lib/session';
import { getWorkspaceRole } from '@/lib/workspace-role';
import type { DiscoverSettings, DiscoverStatus } from '@/types/discover';

export const metadata: Metadata = { title: 'Discover Settings' };

export default async function DiscoverSettingsPage({
  params,
}: PageProps<'/[orgId]/settings/discover'>) {
  const { orgId } = await params;
  const cookie = await getSessionCookieHeader();

  const [settings, status, isAdmin] = await Promise.all([
    serverApi<{ settings: DiscoverSettings }>('/discover/settings', { cookie })
      .then((result) => result.settings)
      .catch(() => null),
    serverApi<{ status: DiscoverStatus }>('/discover/status', { cookie })
      .then((result) => result.status)
      .catch(() => null),
    getWorkspaceRole(orgId).then(canManageWorkspaceSettings),
  ]);

  return (
    <DiscoverSettingsForm
      key={orgId}
      initial={settings}
      isAdmin={isAdmin}
      geocoder={status?.geocoder ?? 'nominatim'}
    />
  );
}
