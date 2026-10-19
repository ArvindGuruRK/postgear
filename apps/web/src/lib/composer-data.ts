/**
 * What the composer needs to open, loaded on the server in one round of
 * parallel requests: the workspace's channels, the providers with their
 * publishing rules, and, when the URL names them, the post being edited and
 * the library item being attached.
 *
 * Shared by the two ways the composer modal opens (UI revamp, 2026-10-19):
 * intercepted over whatever page the person was on
 * (`[orgId]/@modal/(.)composer`), and over the calendar on a reload or a
 * shared link (`[orgId]/@modal/composer`). One loader, so the two can never
 * disagree about what a URL means.
 *
 * - `?group=` reopens a saved post.
 * - `?media=` starts a new post with a library item attached: the media
 *   library's "Use in a post".
 * - `?at=` starts a new post at a given time: the calendar's clicked slot.
 * - `?template=` starts a new post from a starter template: Home's
 *   "Templates" row. The id is resolved to its text here, so the client is
 *   handed words, never an id to look up; an unknown id is ignored.
 * - `?duplicate=` starts a new post from another one's words and media: the
 *   calendar's "Duplicate" (2026-10-19, after Postiz). No channel, tags,
 *   settings or repeat come with it, and it gets the default new-post time.
 * - `?channel=` starts a new post with that channel picked: a channel's
 *   "Create a post".
 *
 * A new post that starts with no words (none of `?group=`, `?template=` or
 * `?duplicate=`) gets the workspace's default signature, fetched here so it
 * is in the editor from the first paint rather than typed in after it.
 */
import { duplicateParts } from '@/components/composer/composer-state';
import { ApiError, serverApi } from '@/lib/api';
import { composerRequest } from '@/lib/composer-request';
import { findTemplate } from '@/lib/post-templates';
import { getSessionCookieHeader } from '@/lib/session';
import type { Channel, ProviderSummary } from '@/types/channel';
import type { MediaItem } from '@/types/media';
import type { PostDetail, PostPart } from '@/types/post';
import type { Signature } from '@/types/signature';

export interface ComposerData {
  channels: Channel[];
  providers: ProviderSummary[];
  post: PostDetail | null;
  media: MediaItem | null;
  publishAt: string | null;
  /** A starter template's text for a new post (`?template=`), or null. */
  text: string | null;
  /** A duplicated post's parts for a new post (`?duplicate=`), or null. */
  parts: PostPart[] | null;
  /** A channel to start a new post with (`?channel=`), or null. */
  channelId: string | null;
  /** The default signature for a new blank post, or null. */
  signature: string | null;
  /** Set when `?group=` or `?duplicate=` named a post that could not be loaded. */
  loadError: string | null;
  /** What this URL asked for, normalized as read here: see `composerRequest`. */
  request: string;
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
  // Only for a new post: a saved post has its own words.
  const template = group ? null : findTemplate(single(query.template));
  const duplicate = group || template ? null : single(query.duplicate);
  const channelId = group ? null : single(query.channel);
  const blank = !group && !template && !duplicate;
  const cookie = await getSessionCookieHeader();

  const [{ channels }, { providers }, post, media, original, signature] = await Promise.all([
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
    duplicate
      ? serverApi<{ post: PostDetail }>(`/posts/${encodeURIComponent(duplicate)}`, {
          cookie,
        }).then(
          (result) => ({ parts: duplicateParts(result.post), error: null }),
          () => ({
            parts: null,
            error: 'The post to duplicate could not be loaded, so you are starting a new one.',
          }),
        )
      : Promise.resolve({ parts: null, error: null }),
    blank
      ? serverApi<{ signature: Signature | null }>('/signatures/default', { cookie }).then(
          (result) => result.signature?.content ?? null,
          // No signature is a fine start; neither is worth failing the page.
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
    text: template?.text ?? null,
    parts: original.parts,
    channelId,
    signature,
    loadError: post.error ?? original.error,
    request: composerRequest({
      group,
      media: mediaId,
      at: publishAt,
      template: template?.id ?? null,
      duplicate,
      channel: channelId,
    }),
  };
}
