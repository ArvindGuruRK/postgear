/**
 * Calendar: every scheduled post, by day, week or month, beside the
 * workspace's channels (Sprint 5; laid out as the reference's home in the UI
 * revamp, 2026-10-18).
 *
 * The server loads the channels (for the channel card, the day view's
 * posting times and the reschedule suggestions), the providers and the plan's
 * channel limit (for Add Channel). The posts themselves are fetched by the
 * client, because the visible range is a question of the viewer's local time
 * and the server does not know which day "today" is where they sit.
 */
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { CalendarProvider } from '@/components/calendar/calendar-context';
import { CalendarView } from '@/components/calendar/calendar-view';
import { serverApi } from '@/lib/api';
import { getSessionCookieHeader } from '@/lib/session';
import type { ChannelsResponse, ProviderSummary } from '@/types/channel';

export const metadata: Metadata = { title: 'Calendar' };

export default async function CalendarPage({ params }: PageProps<'/[orgId]/calendar'>) {
  const { orgId } = await params;
  const cookie = await getSessionCookieHeader();

  // Together: neither depends on the other. Either failing leaves the
  // calendar usable, so each falls back to empty rather than failing the page.
  const [{ channels, limit }, { providers }] = await Promise.all([
    serverApi<ChannelsResponse>('/channels', { cookie }).catch(
      (): ChannelsResponse => ({ channels: [], limit: null }),
    ),
    serverApi<{ providers: ProviderSummary[] }>('/channels/providers', { cookie }).catch(() => ({
      providers: [] as ProviderSummary[],
    })),
  ]);

  return (
    // The provider reads `?view=` and `?date=` through `useSearchParams`,
    // which Next requires inside a Suspense boundary.
    <Suspense>
      <CalendarProvider orgId={orgId} channels={channels}>
        <CalendarView providers={providers} limit={limit} />
      </CalendarProvider>
    </Suspense>
  );
}
