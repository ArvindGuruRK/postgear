/**
 * Clips settings (Sprint 13, Module 17 item 26): whether this workspace's
 * speech always stays on our own servers.
 *
 * A server component that loads the switch and the media service's hosted
 * lane so the card is right on first paint; a failed load shows the card
 * disabled with a sentence instead of throwing. An admin changes it; anyone
 * else reads it disabled (the API's guard is the real check). Keyed by the
 * workspace, so switching workspaces never shows the last one's setting.
 */
import { canManageWorkspaceSettings } from '@postgear/entitlements';
import type { Metadata } from 'next';
import { type ClipPrivacy, ClipsPrivacySettings } from '@/components/settings/clips-privacy-settings';
import { serverApi } from '@/lib/api';
import { getSessionCookieHeader } from '@/lib/session';
import { getWorkspaceRole } from '@/lib/workspace-role';

export const metadata: Metadata = { title: 'Clips Settings' };

export default async function ClipsSettingsPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  const cookie = await getSessionCookieHeader();

  const [privacy, isAdmin] = await Promise.all([
    serverApi<{ privacy: ClipPrivacy }>('/clips/privacy', { cookie })
      .then((result) => result.privacy)
      .catch(() => null),
    getWorkspaceRole(orgId).then(canManageWorkspaceSettings),
  ]);

  return <ClipsPrivacySettings key={orgId} initial={privacy} isAdmin={isAdmin} />;
}
