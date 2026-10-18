/**
 * Analytics: how every channel and post is doing (Sprint 7).
 *
 * A server component that loads what the dashboard needs in one round of
 * parallel requests: the channels (the filter and the "connect one first"
 * gate), the providers (which platforms can be synced at all), the overview
 * for the range and channel in the URL, and the sync standing for the pill.
 * Each has a safe fallback so one failed request degrades one part of the
 * page: no overview renders an error with a retry, no sync standing leaves
 * the pill to ask for itself, no channels is a state the view already
 * handles.
 */
import type { Metadata } from 'next';
import { AnalyticsView } from '@/components/analytics/analytics-view';
import { apiQuery, filtersFromParams } from '@/components/analytics/analytics-view-model';
import { serverApi } from '@/lib/api';
import { getSessionCookieHeader } from '@/lib/session';
import type { AnalyticsOverview, AnalyticsSyncOverview } from '@/types/analytics';
import type { Channel, ProviderSummary } from '@/types/channel';

export const metadata: Metadata = { title: 'Analytics' };

export default async function AnalyticsPage({
  params,
  searchParams,
}: PageProps<'/[orgId]/analytics'>) {
  const { orgId } = await params;
  const query = await searchParams;
  const cookie = await getSessionCookieHeader();

  const filters = filtersFromParams(
    new URLSearchParams(
      Object.entries(query).flatMap(([key, value]) =>
        typeof value === 'string' ? [[key, value] as [string, string]] : [],
      ),
    ),
  );

  const [{ channels }, { providers }, overview, sync] = await Promise.all([
    serverApi<{ channels: Channel[] }>('/channels', { cookie }).catch(() => ({
      channels: [] as Channel[],
    })),
    serverApi<{ providers: ProviderSummary[] }>('/channels/providers', { cookie }).catch(() => ({
      providers: [] as ProviderSummary[],
    })),
    serverApi<AnalyticsOverview>(`/analytics/overview?${apiQuery(filters).toString()}`, {
      cookie,
    }).catch(() => null),
    serverApi<AnalyticsSyncOverview>('/analytics/sync', { cookie }).catch(() => null),
  ]);

  return (
    <AnalyticsView
      orgId={orgId}
      channels={channels}
      providers={providers}
      initialOverview={overview}
      initialSync={sync}
      initialFilters={filters}
    />
  );
}
