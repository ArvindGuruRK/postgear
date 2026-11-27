/**
 * Channels: the social accounts this workspace can publish to.
 *
 * A server component that fetches once and hands the result to a client island,
 * following the pattern established by `(dashboard)/onboarding/page.tsx`: read
 * the session, forward its cookie to the API, then let the island mutate via
 * `api()` and call `router.refresh()` to re-run this.
 *
 * Route protection is already handled by the two layouts above (gate 1 in
 * `(dashboard)/layout.tsx` and gate 2 plus workspace membership in
 * `[orgId]/layout.tsx`), so this page does not repeat those checks.
 */
import { canManageChannels } from '@postgear/entitlements';
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ChannelsView } from '@/components/channels/channels-view';
import { serverApi } from '@/lib/api';
import { getSessionCookieHeader } from '@/lib/session';
import { getWorkspaceRole } from '@/lib/workspace-role';
import type { ChannelsResponse, ProviderSummary } from '@/types/channel';

export const metadata: Metadata = { title: 'Channels' };

export default async function ChannelsPage({ params }: PageProps<'/[orgId]/channels'>) {
  const { orgId } = await params;
  const cookie = await getSessionCookieHeader();

  // Fetched together: neither depends on the other, and two sequential
  // round-trips would show an empty page for no reason. `/channels` carries
  // the plan's channel limit beside the list (Sprint 8).
  const [{ channels, limit }, { providers }, role] = await Promise.all([
    serverApi<ChannelsResponse>('/channels', { cookie }),
    serverApi<{ providers: ProviderSummary[] }>('/channels/providers', { cookie }),
    getWorkspaceRole(orgId),
  ]);

  // Renaming, disconnecting and reordering are ADMIN-only on the API
  // (`canManageChannels`). Reflecting that here hides actions that would only
  // fail: the guard is still the real check, this just avoids offering a
  // button that returns 403.
  const canManage = canManageChannels(role);

  return (
    // `useSearchParams` in the island reads the ?connected / ?setup / ?error
    // params the OAuth callback redirects back with, and Next requires a
    // Suspense boundary around a client component that uses it.
    <Suspense>
      <ChannelsView
        orgId={orgId}
        initialChannels={channels}
        providers={providers}
        canManage={canManage}
        limit={limit}
      />
    </Suspense>
  );
}
