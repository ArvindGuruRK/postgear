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
  clip_export_outdated:
    'You changed this clip after the last export. Export it again, or send the old version.',
  clip_does_not_fit: 'This clip does not fit one of the channels you chose.',
  export_running: 'This clip is already being exported. Wait for it to finish.',
  highlights_running: 'We are already looking for clips in this video.',
  highlights_failed: 'We could not finish looking for clips. Your AI minutes were given back.',
  video_not_ready: 'This video is still coming in. Wait for it to be ready.',
  // Sprint 13 (Clips AI).
  transcribe_running: 'We are already listening to this part of the video.',
  transcribe_failed:
    'We could not finish listening to this video. Your AI minutes were given back.',
  no_speech: 'We could not hear any speech in this video.',
  language_unsupported: 'We cannot make captions in this language yet. Pick another language.',
  captions_off: 'Captions are not available right now. Everything else still works.',
  transcript_missing: 'This part of the video has not been listened to yet.',
  transcript_range_invalid: 'Pick a part of the video that starts before it ends.',
  captions_file_unreadable:
    'We could not read this captions file. Check that it is an SRT or VTT file.',
  captions_file_too_big: 'This captions file is too big. Use a file under 2 MB.',
  captions_file_outside: 'The times in this captions file fall outside this clip.',
  captions_missing:
    "We could not find this clip's captions. Remove the captions and add them again.",
  faces_failed: 'We could not finish looking for faces. Try again.',
  faces_off: 'Finding faces is not available right now. Drag the box yourself.',
  captions_first: 'Add captions to this clip first, then translate them.',
  translate_same_language: 'These captions are already in that language. Pick another one.',
  translate_off: 'Translating is not available right now. Everything else still works.',
  caption_style_not_found: 'We could not find that caption style. Pick another style.',
  translate_failed:
    'We could not finish translating the captions. Your AI minutes were given back.',
  voice_failed: 'We could not make the voice. Your AI minutes were given back.',
  voice_off: 'Text to speech is not available right now. Everything else still works.',
  voice_language: 'This voice cannot read this language. Pick another voice.',
  voice_unknown: 'This voice is no longer available. Pick another voice.',
  video_removed: 'This video was removed after a request from its owner.',
  format_gone: 'This quality is no longer offered for this video. Pick another.',
  downloads_busy: 'Three downloads are already being prepared. Wait for one to finish.',
  download_failed: 'We could not prepare this file. Try again.',
  download_too_big:
    'This file is bigger than the space your plan has left. Delete some videos or downloads, or pick a smaller quality.',
  download_expired: 'This download has expired. Prepare it again.',
  download_not_ready: 'This file is still being prepared. Wait for it to finish.',
  download_not_found: 'We could not find this download. It may have been deleted.',
  download_audio_only:
    'Media takes videos and pictures. Save the MP3 to your computer instead.',
  media_too_big: 'This file is too big for Media. Save it to your computer instead.',
  media_save_failed: 'We could not save this file to Media. Try again.',
  not_an_upload: 'Only a video you uploaded has an original to download.',
  original_missing: 'The original file of this video is no longer here.',
  sharp_gone:
    'The sharp video is no longer online. This clip will export at 720p from the copy we kept.',
  channel_not_found: 'We could not find that channel. Check the spelling.',
  channel_exists: 'This channel is already in your list.',
  channel_listing_failed:
    "This channel's list is not available right now. Try again in a few minutes.",
  quota_exhausted:
    "We have reached today's limit for YouTube lists. Try again tomorrow, or paste a video link.",
  platform_changed:
    'We could not read this list. We are looking into it. You can paste a link instead.',
  list_sort_unsupported: 'YouTube lists newest first only.',
  refresh_throttled: 'This list was just updated. Try again in a few seconds.',
  import_failed: 'This did not finish. Try again.',
  export_failed: 'We could not export this clip. Nothing was charged. Try again.',
  preview_failed: 'We could not make the preview. Try again.',
  font_missing: 'We could not export this clip. Nothing was charged. Try again.',
  render_output_invalid: 'We could not export this clip. Nothing was charged. Try again.',
  sticker_missing:
    'A sticker in this clip was removed from the library. Take it out of the clip, then export again.',
  sticker_unusable: 'This file is not a picture we can use. Upload a PNG, GIF or WebP.',
  sticker_too_large: 'This moving picture is too big for a sticker. Use a shorter or smaller one.',
  sticker_upload_too_big: 'This file is over 8 MB. Pick a smaller one.',
  sticker_not_found: 'We could not find this sticker. It may have been removed.',
  sound_missing:
    'A sound in this clip was removed from the library. Take it out of the clip, then export again.',
  sound_unusable: 'This file is not a sound we can use. Upload an MP3, WAV, M4A or AAC file.',
  sound_too_long: 'This sound is longer than 10 minutes. Use a shorter one.',
  sound_upload_too_big: 'This file is over 20 MB. Pick a smaller one.',
  sound_not_found: 'We could not find this sound. It may have been removed.',
  library_throttled: 'You are searching very quickly. Wait a minute, then try again.',
  tool_failed: 'Something went wrong on our side. Try again in a little while.',
  tools_offline: 'Video tools are not running right now. Try again in a minute.',
  clips_busy: 'Our video tools are busy. Try again in a minute.',
  // Module 19: the per-person limit on the create routes (30 a minute).
  clips_throttled: 'You are going very quickly. Wait a minute, then try again.',
  // Module 19: a job that ran past its time from the contract.
  timed_out: 'This took too long and was stopped. Try again.',
  cancelled: 'Cancelled.',
} as const;

export type ClipErrorCode =
  | keyof typeof CLIP_ERROR_MESSAGES
  | 'platform_resting'
  | 'platform_paused';

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
  // Own keys only: a code like `constructor` must not read a built-in object member.
  const own = Object.hasOwn(CLIP_ERROR_MESSAGES, code)
    ? (CLIP_ERROR_MESSAGES as Record<string, string>)[code]
    : undefined;
  return own ?? CLIP_ERROR_MESSAGES.tool_failed;
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
  'render_output_invalid',
  'sticker_missing',
  'sticker_unusable',
  'sticker_too_large',
  'sound_missing',
  'sound_unusable',
  'sound_too_long',
  'cancelled',
  'no_speech',
  'language_unsupported',
  'captions_off',
  'captions_missing',
];

/** The error a job row and a view carry. */
export interface ClipError {
  code: string;
  message: string;
}
