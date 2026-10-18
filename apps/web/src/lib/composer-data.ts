/**
 * What the composer needs to open, loaded on the server in one round of
 * parallel requests: the workspace's channels, the providers with their
 * publishing rules, and, when the URL names them, the post being edited and
 * the library item being attached.
 *
 * Shared by the two ways the composer opens (UI revamp, 2026-10-19): the
 * full page at `/[orgId]/composer`, and the same route intercepted as a modal
 * over whatever page the person was on (`[orgId]/@modal/(.)composer`). One
 * loader, so the two can never disagree about what a URL means.
 *
 * - `?group=` reopens a saved post.
 * - `?media=` starts a new post with a library item attached: the media
 *   library's "Use in a post".
 * - `?at=` starts a new post at a given time: the calendar's clicked slot.
 */
import { ApiError, serverApi } from '@/lib/api';
import { getSessionCookieHeader } from '@/lib/session';
import type { Channel, ProviderSummary } from '@/types/channel';
import type { MediaItem } from '@/types/media';
import type { PostDetail } from '@/types/post';

export interface ComposerData {
  channels: Channel[];
  providers: ProviderSummary[];
  post: PostDetail | null;
  media: MediaItem | null;
  publishAt: string | null;
  /** Set when `?group=` named a post that could not be loaded. */
  loadError: string | null;
}

function single(value: string | string[] | undefined): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export async function loadComposer(
  query: Record<string, string | string[] | undefined>,
): Promise<ComposerData> {
  const group = single(query.group);
  const mediaId = group ? null : single(query.media);
  // Anything unparseable in `?at=` is ignored rather than failing the page.
  const at = group ? null : single(query.at);
  const publishAt = at && !Number.isNaN(Date.parse(at)) ? new Date(at).toISOString() : null;
  const cookie = await getSessionCookieHeader();

  const [{ channels }, { providers }, post, media] = await Promise.all([
    serverApi<{ channels: Channel[] }>('/channels', { cookie }),
    serverApi<{ providers: ProviderSummary[] }>('/channels/providers', { cookie }),
    group
      ? serverApi<{ post: PostDetail }>(`/posts/${encodeURIComponent(group)}`, { cookie }).then(
          (result) => ({ post: result.post, error: null }),
          (error: unknown) => ({
            post: null,
            error:
              error instanceof ApiError && error.status === 404
                ? 'That post no longer exists. It may have been deleted, so you are starting a new one.'
                : 'That post could not be loaded. You are starting a new one.',
          }),
        )
      : Promise.resolve({ post: null, error: null }),
    mediaId
      ? serverApi<{ media: MediaItem }>(`/media/${encodeURIComponent(mediaId)}`, { cookie }).then(
          (result) => result.media,
          // A stale "Use in a post" link just starts an empty post.
          () => null,
        )
      : Promise.resolve(null),
  ]);

  return {
    channels,
    providers,
    post: post.post,
    media,
    publishAt,
    loadError: post.error,
  };
}
