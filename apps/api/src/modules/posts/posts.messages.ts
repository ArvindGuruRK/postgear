/**
 * User-facing strings for posts.
 *
 * Specific, for the reason `channels.messages.ts` gives: the caller is an
 * authenticated member editing their own workspace's content.
 */
export const POST_MESSAGES = {
  NOT_FOUND: 'Post not found',
  DELETED: 'Post deleted',
  CHANNEL_UNAVAILABLE:
    'One of the selected channels is no longer connected. Remove it and save again.',
  MEDIA_UNAVAILABLE: 'An attachment is no longer in the media library. Remove it and save again.',
  PUBLISH_DATE_PAST: 'Choose a time in the future to add this post to the queue.',
  RESCHEDULE_PAST:
    'A queued post can only be moved to a time in the future. Use "Post now" to publish it right away.',
  NOT_QUEUED: 'Only a queued or failed post can be published now. Add it to the queue first.',
  CALENDAR_RANGE_TOO_LONG: 'The calendar can show at most 62 days at a time.',
  LOCKED: 'This post has already been published and can no longer be changed.',
  CONFLICT:
    'Someone else changed this post after you opened it. Reload to see the latest version before saving.',
} as const;
