/**
 * Media — the workspace's library of uploaded images and video.
 *
 * The server renders the first page so the grid is there on first paint; the
 * client island then owns search, filtering, paging, uploads and deletes. The
 * same split the Channels page uses.
 *
 * A failed first load is handed to the island as `null` rather than thrown: the
 * island shows its own retry state, which is more useful than an error page for
 * what is usually a momentarily unreachable API.
 */
import type { Metadata } from 'next';
import { MediaLibrary } from '@/components/media/media-library';
import { serverApi } from '@/lib/api';
import { getSessionCookieHeader } from '@/lib/session';
import type { MediaPage as MediaPageData } from '@/types/media';

export const metadata: Metadata = { title: 'Media' };

export default async function MediaPage({ params }: PageProps<'/[orgId]/media'>) {
  const { orgId } = await params;
  const cookie = await getSessionCookieHeader();

  const initialPage = await serverApi<MediaPageData>('/media', { cookie }).catch(() => null);

  return <MediaLibrary orgId={orgId} initialPage={initialPage} />;
}
