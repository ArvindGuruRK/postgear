/**
 * Queue: every post in publish order, with how each one went (Sprint 5).
 *
 * The server renders the first page when no filter is in the URL, so the list
 * is there on first paint; with filters, the client fetches, because the date
 * filters are the viewer's local days. Channels are loaded for the filter and
 * for the reschedule dialog's posting-time suggestions.
 */
import type { Metadata } from 'next';
import { QueueView } from '@/components/queue/queue-view';
import { serverApi } from '@/lib/api';
import { getSessionCookieHeader } from '@/lib/session';
import type { Channel } from '@/types/channel';
import type { QueuePage as QueuePageData } from '@/types/post';

export const metadata: Metadata = { title: 'Queue' };

export default async function QueuePage({ params, searchParams }: PageProps<'/[orgId]/queue'>) {
  const { orgId } = await params;
  const query = await searchParams;
  const cookie = await getSessionCookieHeader();

  const initialParams = new URLSearchParams(
    Object.entries(query).flatMap(([key, value]) =>
      typeof value === 'string' ? [[key, value] as [string, string]] : [],
    ),
  );
  const plain = initialParams.toString() === '';

  const [{ channels }, initialPage] = await Promise.all([
    serverApi<{ channels: Channel[] }>('/channels', { cookie }).catch(() => ({
      channels: [] as Channel[],
    })),
    plain
      ? serverApi<QueuePageData>('/posts/queue?sort=asc&page=1', { cookie }).catch(() => null)
      : Promise.resolve(null),
  ]);

  return (
    <QueueView
      orgId={orgId}
      channels={channels}
      initialPage={initialPage}
      initialParams={initialParams.toString()}
    />
  );
}
