/**
 * Composer — write a post once, tailor it per channel, preview it, save it.
 *
 * A server component that loads what the island needs in one round of
 * parallel requests: the workspace's channels, the providers with their
 * publishing rules, and — when the URL names them — the post being edited and
 * the library item being attached.
 *
 * `?group=` reopens a saved post. `?media=` starts a new post with a library
 * item attached, which is how the media library's "Use in a post" arrives.
 *
 * ## Why the island's key is a fresh id per render
 *
 * The composer keeps its state in the client, and after a first save it
 * rewrites the URL to `?group=` without navigating (so editors are not torn
 * down). A key derived from the URL would therefore see "new post" before and
 * after — and clicking "New post" from a just-saved draft would keep showing
 * the draft. This server component only renders on a navigation, so a random
 * key per render means exactly: every navigation into the composer starts
 * from what the server says, and nothing else remounts it.
 */
import { randomUUID } from 'node:crypto';
import type { Metadata } from 'next';
import { Composer } from '@/components/composer/composer';
import { ApiError, serverApi } from '@/lib/api';
import { getSessionCookieHeader } from '@/lib/session';
import type { Channel, ProviderSummary } from '@/types/channel';
import type { MediaItem } from '@/types/media';
import type { PostDetail } from '@/types/post';

export const metadata: Metadata = { title: 'Composer' };

function single(value: string | string[] | undefined): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export default async function ComposerPage({
  params,
  searchParams,
}: PageProps<'/[orgId]/composer'>) {
  const { orgId } = await params;
  const query = await searchParams;
  const group = single(query.group);
  const mediaId = group ? null : single(query.media);
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
                ? 'That post no longer exists. It may have been deleted — you are starting a new one.'
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

  return (
    <Composer
      key={randomUUID()}
      orgId={orgId}
      channels={channels}
      providers={providers}
      initialPost={post.post}
      initialMedia={media}
      loadError={post.error}
    />
  );
}
