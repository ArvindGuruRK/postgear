/**
 * User-facing strings for the analytics routes.
 *
 * Short, because little can go wrong here that the caller can act on: a
 * post that is not this workspace's reads as not found, as every other
 * module's does, and a channel that is not this workspace's is refused the
 * way the posts and AI modules refuse one. The sync status line's own
 * messages are written by the worker (`apps/worker/src/lib/analytics-sync.ts`)
 * at the moment the failure is classified, and stored already safe; this
 * module only passes them through.
 */
export const ANALYTICS_MESSAGES = {
  POST_NOT_FOUND: 'Post not found',
  CHANNEL_UNAVAILABLE:
    'That channel is not connected to this workspace. Choose another and try again.',
} as const;
