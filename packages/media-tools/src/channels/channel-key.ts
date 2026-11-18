/**
 * The part of a channel page address that names the channel, checked again
 * after the engine's `validateHandle`: a Twitch login, a Kick slug, a YouTube
 * `@handle` or `UC...` channel id.
 *
 * Its own file because it is pure: the simulated lister uses it and is
 * served to the API through `@postgear/media-tools/listing`, whose import
 * graph must never reach the process runner (`src/run/`). The yt-dlp
 * argument builder re-exports it from `flat-list.args.ts`.
 */
import type { ClipPlatformId } from '@postgear/video-engine';
import { ChannelListerError } from './types';

const TWITCH_LOGIN = /^[a-z0-9_]{4,25}$/;
const KICK_SLUG = /^[A-Za-z0-9_-]{1,25}$/;
const YOUTUBE_HANDLE = /^@[A-Za-z0-9._-]{3,30}$/;
const YOUTUBE_CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;

/** The checked channel name for `platform`, or `channel_not_found` when it cannot be one. */
export function channelKey(platform: ClipPlatformId, handleOrId: string): string {
  const value = handleOrId.trim();
  if (platform === 'twitch') {
    const login = value.toLowerCase();
    if (TWITCH_LOGIN.test(login)) return login;
  } else if (platform === 'kick') {
    if (KICK_SLUG.test(value)) return value.toLowerCase();
  } else {
    const handle = value.startsWith('@') || YOUTUBE_CHANNEL_ID.test(value) ? value : `@${value}`;
    if (YOUTUBE_HANDLE.test(handle) || YOUTUBE_CHANNEL_ID.test(handle)) return handle;
  }
  throw new ChannelListerError('channel_not_found', { retryable: false });
}
