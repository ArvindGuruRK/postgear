/**
 * Discover (Sprint 11): what is rising and what is being reported where the
 * audience is.
 *
 * The server asks only for the status (whether the place service is on, and
 * whether the API reads recorded feeds), with a `null` fallback the island
 * copes with. The feed itself is fetched by the island, because the place is
 * the viewer's own and lives in their browser, not in the request.
 *
 * The island is keyed by the workspace, so switching workspaces starts from
 * that workspace's remembered place instead of carrying the last one over.
 */
import type { Metadata } from 'next';
import { tabFrom } from '@/components/discover/discover-model';
import { DiscoverView } from '@/components/discover/discover-view';
import { serverApi } from '@/lib/api';
import { getSessionCookieHeader } from '@/lib/session';
import type { DiscoverStatus } from '@/types/discover';

export const metadata: Metadata = { title: 'Discover' };

export default async function DiscoverPage({
  params,
  searchParams,
}: PageProps<'/[orgId]/discover'>) {
  const [{ orgId }, query] = await Promise.all([params, searchParams]);
  const cookie = await getSessionCookieHeader();

  const status = await serverApi<{ status: DiscoverStatus }>('/discover/status', { cookie })
    .then((result) => result.status)
    .catch(() => null);

  return <DiscoverView key={orgId} orgId={orgId} status={status} initialTab={tabFrom(query.tab)} />;
}
