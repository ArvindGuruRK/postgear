/**
 * Channels — the social accounts this workspace can publish to.
 *
 * A server component that fetches once and hands the result to a client island,
 * following the pattern established by `(dashboard)/onboarding/page.tsx`: read
 * the session, forward its cookie to the API, then let the island mutate via
 * `api()` and call `router.refresh()` to re-run this.
 *
 * Route protection is already handled by the two layouts above — gate 1 in
 * `(dashboard)/layout.tsx` and gate 2 plus workspace membership in
 * `[orgId]/layout.tsx` — so this page does not repeat those checks.
 */
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ChannelsView } from '@/components/channels/channels-view';
import { serverApi } from '@/lib/api';
import { getSessionCookieHeader } from '@/lib/session';
import type { Channel, ProviderSummary } from '@/types/channel';
import type { Organization } from '@/types/workspace';

export const metadata: Metadata = { title: 'Channels' };

export default async function ChannelsPage({ params }: PageProps<'/[orgId]/channels'>) {
  const { orgId } = await params;
  const cookie = await getSessionCookieHeader();

  // Fetched together — neither depends on the other, and two sequential
  // round-trips would show an empty page for no reason.
  const [{ channels }, { providers }, { organizations }] = await Promise.all([
    serverApi<{ channels: Channel[] }>('/channels', { cookie }),
    serverApi<{ providers: ProviderSummary[] }>('/channels/providers', { cookie }),
    serverApi<{ organizations: Organization[] }>('/orgs', { cookie }),
  ]);

  // Connecting and disconnecting are ADMIN-only on the API. Reflecting that
  // here hides actions that would only fail — the guard is still the real
  // check, this just avoids offering a button that returns 403.
  const role = organizations.find((organization) => organization.id === orgId)?.role;
  const canManage = role === 'ADMIN' || role === 'SUPERADMIN';

  return (
    // `useSearchParams` in the island reads the ?connected / ?setup / ?error
    // params the OAuth callback redirects back with, and Next requires a
    // Suspense boundary around a client component that uses it.
    <Suspense>
      <ChannelsView initialChannels={channels} providers={providers} canManage={canManage} />
    </Suspense>
  );
}
