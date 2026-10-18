/**
 * Calendar: every scheduled post, by month, week or day (Sprint 5).
 *
 * The server loads the channels (for the filter and the posting-time
 * suggestions); the posts themselves are fetched by the client, because the
 * visible range is a question of the viewer's local time and the server does
 * not know which day "today" is where they sit.
 */
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { CalendarProvider } from '@/components/calendar/calendar-context';
import { CalendarView } from '@/components/calendar/calendar-view';
import { serverApi } from '@/lib/api';
import { getSessionCookieHeader } from '@/lib/session';
import type { Channel } from '@/types/channel';

export const metadata: Metadata = { title: 'Calendar' };

export default async function CalendarPage({ params }: PageProps<'/[orgId]/calendar'>) {
  const { orgId } = await params;
  const cookie = await getSessionCookieHeader();

  const { channels } = await serverApi<{ channels: Channel[] }>('/channels', { cookie }).catch(
    () => ({ channels: [] as Channel[] }),
  );

  return (
    // The provider reads `?view=` and `?date=` through `useSearchParams`,
    // which Next requires inside a Suspense boundary.
    <Suspense>
      <CalendarProvider orgId={orgId} channels={channels}>
        <CalendarView />
      </CalendarProvider>
    </Suspense>
  );
}
