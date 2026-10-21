/**
 * Media: the workspace's library of uploaded images and video.
 *
 * The server renders the first page so the grid is there on first paint; the
 * client island then owns search, filtering, paging, uploads and deletes. The
 * same split the Channels page uses.
 *
 * `?search=` (2026-10-21) is how the top bar's search lands here with a word
 * already in the box. The server then hands over no first page (it would be
 * the unfiltered one) and the island fetches the filtered list itself. The
 * island is keyed by the word, so choosing a different media result while
 * already on this page starts a fresh search instead of keeping the old one.
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

/** The API refuses a media search longer than this. */
const MAX_SEARCH_LENGTH = 200;

export default async function MediaPage({ params, searchParams }: PageProps<'/[orgId]/media'>) {
  const { orgId } = await params;
  const { search: rawSearch } = await searchParams;
  const search = (typeof rawSearch === 'string' ? rawSearch.trim() : '').slice(
    0,
    MAX_SEARCH_LENGTH,
  );
  const cookie = await getSessionCookieHeader();

  const initialPage = search
    ? null
    : await serverApi<MediaPageData>('/media', { cookie }).catch(() => null);

  return (
    <MediaLibrary key={search} orgId={orgId} initialPage={initialPage} initialSearch={search} />
  );
}
