/**
 * A Twitch name as a person types it (Sprint 13, Module 14 section C3):
 * `simstreamer`, `@SimStreamer`, or a link to the channel
 * (`https://www.twitch.tv/simstreamer/videos`), reduced to the login Twitch
 * knows, or null when it cannot be one. The API checks the same way before
 * anything is fetched; the page checks first so a typo never costs a call.
 */
import { TWITCH_LOGIN_PATTERN } from '../types';

/** The longest thing worth reading: a channel link with a path after it. */
export const MAX_TWITCH_INPUT_LENGTH = 200;

const CHANNEL_LINK = /^(?:https?:\/\/)?(?:www\.|m\.)?twitch\.tv\/([^/?#\s]+)/i;

export function twitchLogin(input: string): string | null {
  if (typeof input !== 'string' || input.length > MAX_TWITCH_INPUT_LENGTH) return null;
  let value = input.trim();
  const link = CHANNEL_LINK.exec(value);
  if (link) value = link[1];
  value = value.replace(/^@/, '').toLowerCase();
  return TWITCH_LOGIN_PATTERN.test(value) ? value : null;
}
