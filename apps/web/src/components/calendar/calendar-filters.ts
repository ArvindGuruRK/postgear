import type { Channel } from '@/types/channel';
import type { PostSummary } from '@/types/post';

/**
 * The calendar's two list rules (2026-10-19), kept apart from the context so
 * they can be tested without rendering anything.
 */

/** `channels` in the order of `ids`; channels not named keep their order after them. */
export function orderChannels(channels: Channel[], ids: string[]): Channel[] {
  const rank = new Map(ids.map((id, index) => [id, index]));
  return channels
    .map((channel, index) => ({ channel, index }))
    .sort(
      (a, b) =>
        (rank.get(a.channel.id) ?? ids.length + a.index) -
        (rank.get(b.channel.id) ?? ids.length + b.index),
    )
    .map((entry) => entry.channel);
}

/**
 * Posts on any of `channelIds` (every channel when empty) that carry any of
 * `tagIds` (every post, tagged or not, when empty). The two filters combine:
 * a post must pass both.
 */
export function filterPosts(
  posts: PostSummary[],
  channelIds: string[],
  tagIds: string[],
): PostSummary[] {
  if (channelIds.length === 0 && tagIds.length === 0) {
    return posts;
  }

  return posts.filter(
    (post) =>
      (channelIds.length === 0 ||
        post.channels.some((channel) => channelIds.includes(channel.channelId))) &&
      // `?? []`: a response from an API older than tags carries none.
      (tagIds.length === 0 || (post.tags ?? []).some((tag) => tagIds.includes(tag.id))),
  );
}
