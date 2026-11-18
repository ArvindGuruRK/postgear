/**
 * Every refusal and failure Clips can report, with the one sentence a person
 * reads. The worker stores `{ code, message }` on a failed job with the
 * message from here, and the API answers with the same sentence, so a failure
 * reads the same in the card, the bell and the API.
 *
 * A sentence never contains a tool's output, a path or a platform's raw
 * error, and every one ends with what to do next. Sentences that need a
 * number come from `@postgear/entitlements` (plan limits) or from the API's
 * `clips.messages.ts` (route-level wording with values filled in).
 */
import { type ClipPlatformId, PLATFORM_NAMES } from './links/types';

export const CLIP_ERROR_MESSAGES = {
  link_unsupported:
    'We can only read YouTube, Twitch and Kick links for now. You can upload the file instead.',
  link_not_a_video: 'This link is a channel or a list. Paste the link of one video.',
  link_private: 'This video is private or needs a login, so we cannot read it.',
  link_live: 'This stream is still live. Come back when it has ended.',
  link_not_found: 'We could not find a video at this link.',
  link_is_a_video: 'That is a video link. Paste it in the link box on Clips.',
  probe_throttled: 'You are checking links very quickly. Wait a minute, then try again.',
  rights_required: 'Tick the box to confirm this video is yours, or that you may use it.',
  upload_not_video: 'This file is not a video we can read. Use MP4, MOV, MKV or WebM.',
  upload_incomplete: 'The upload did not finish. Upload the file again.',
  clip_range_invalid: 'A clip must be between 3 seconds and 30 minutes, inside the video.',
  clip_changed_elsewhere: 'Someone else changed this clip. Reload to see their version.',
  clip_not_exported: 'Export this clip first, then send it.',
  export_running: 'This clip is already being exported. Wait for it to finish.',
  highlights_running: 'We are already looking for clips in this video.',
  video_not_ready: 'This video is still coming in. Wait for it to be ready.',
  video_removed: 'This video was removed after a request from its owner.',
  format_gone: 'This quality is no longer offered for this video. Pick another.',
  sharp_gone:
    'The sharp video is no longer online. This clip will export at 720p from the copy we kept.',
  channel_not_found: 'We could not find that channel. Check the spelling.',
  channel_exists: 'This channel is already in your list.',
  channel_listing_failed:
    "This channel's list is not available right now. Try again in a few minutes.",
  quota_exhausted:
    "We have reached today's limit for YouTube lists. Try again tomorrow, or paste a video link.",
  platform_changed: 'We could not read this list. We are looking into it. You can paste a link instead.',
  list_sort_unsupported: 'YouTube lists newest first only.',
  refresh_throttled: 'This list was just updated. Try again in a few seconds.',
  import_failed: 'This did not finish. Try again.',
  export_failed: 'We could not export this clip. Nothing was charged. Try again.',
  preview_failed: 'We could not make the preview. Try again.',
  font_missing: 'We could not export this clip. Nothing was charged. Try again.',
  tool_failed: 'Something went wrong on our side. Try again in a little while.',
  tools_offline: 'Video tools are not running right now. Try again in a minute.',
  clips_busy: 'Our video tools are busy. Try again in a minute.',
  cancelled: 'Cancelled.',
} as const;

export type ClipErrorCode = keyof typeof CLIP_ERROR_MESSAGES | 'platform_resting' | 'platform_paused';

/** "{Platform} is not answering us right now..." */
export function platformRestingMessage(platform: ClipPlatformId): string {
  return `${PLATFORM_NAMES[platform]} is not answering us right now. Try again in a little while, or upload the file instead.`;
}

/** "{Platform} links are paused for now..." */
export function platformPausedMessage(platform: ClipPlatformId): string {
  return `${PLATFORM_NAMES[platform]} links are paused for now. You can upload the file instead.`;
}

/** The sentence for a code. Platform sentences need the platform; anything unknown reads as a plain failure. */
export function clipErrorMessage(code: string, platform?: ClipPlatformId): string {
  if (code === 'platform_resting' && platform) {
    return platformRestingMessage(platform);
  }
  if (code === 'platform_paused' && platform) {
    return platformPausedMessage(platform);
  }
  return (CLIP_ERROR_MESSAGES as Record<string, string>)[code] ?? CLIP_ERROR_MESSAGES.tool_failed;
}

/**
 * Failures that would fail again on a retry: the workflow stops at once
 * instead of trying a second time. Mirrors `CLIP_NON_RETRYABLE` in
 * `@postgear/scheduling`, which the worker hands to Temporal.
 */
export const NON_RETRYABLE_CLIP_CODES: readonly string[] = [
  'link_private',
  'link_not_found',
  'link_live',
  'link_unsupported',
  'link_not_a_video',
  'upload_not_video',
  'clip_range_invalid',
  'clips_video_too_long',
  'clips_minutes_used',
  'clips_storage_full',
  'format_gone',
  'font_missing',
  'cancelled',
];

/** The error a job row and a view carry. */
export interface ClipError {
  code: string;
  message: string;
}
