/**
 * Sentences only the channel routes say (Module 03, section 5). Codes that
 * already have a sentence in `@postgear/video-engine`'s `CLIP_ERROR_MESSAGES`
 * (`channel_not_found`, `channel_exists`, `channel_listing_failed`,
 * `quota_exhausted`, `platform_changed`, `refresh_throttled`,
 * `link_is_a_video`, `tools_offline`, `clips_busy`) use it; the plan limit
 * (`channel_limit`) comes from `@postgear/entitlements`. Sentence case, plain
 * words, never a platform's own error.
 */
import { type ClipPlatformId, PLATFORM_NAMES } from '@postgear/video-engine';

export const CLIP_CHANNELS_MESSAGES = {
  /** A channel id that is not one of this workspace's channels. */
  CHANNEL_GONE: 'We could not find that channel in this workspace.',
  CHANNEL_REMOVED: 'Channel removed.',
  /** After 20 pages of 50 (research 11, section 7). */
  LIST_CAPPED: 'Showing the newest 1,000. Paste a link for older videos.',
  LIST_CURSOR_INVALID: 'This list has changed. Start again from the top.',
  platform_rate_limited: 'This platform is busy right now. We will try again shortly.',
  list_kind_unsupported: 'This channel does not have that list.',
  channels_throttled: 'You are doing that very quickly. Wait a minute, then try again.',
  hidden_limit: 'You have hidden as many videos as this channel allows. Unhide a few first.',
} as const;

/** "{Platform} lists newest first only." (YouTube's reads as the engine's `list_sort_unsupported`.) */
export function sortUnsupportedMessage(platform: ClipPlatformId): string {
  return `${PLATFORM_NAMES[platform]} lists newest first only.`;
}
