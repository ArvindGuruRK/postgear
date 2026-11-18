/**
 * Channel handles for My Channels: checking what a person typed in the Add A
 * Channel box before any platform is asked.
 *
 * A bare name or a pasted channel link both work; a link is cut down to its
 * handle. A video link is answered `link_is_a_video` ("That is a video link.
 * Paste it in the link box on Clips."). Anything that cannot be a channel on
 * the chosen platform is `channel_not_found`, the same sentence a real miss
 * gets, so a typo and an unknown name read alike.
 *
 * The rules are research 11 section 6.4: Twitch 4 to 25 of `a-z 0-9 _`;
 * YouTube `@` plus 3 to 30 letters, digits, `.`, `_` and `-` (a `UC...`
 * channel id also works); Kick letters, digits, `_` and `-`, at most 25.
 *
 * `channelListUrl` is the only way a handle reaches an address: the host is
 * fixed here and the handle has already passed its pattern.
 */
import { isLinkRefusal, LINK_MAX_LENGTH, recogniseLink } from './recognise';
import type { ClipPlatformId, ListKind } from './types';

const TWITCH_HANDLE = /^[a-z0-9_]{4,25}$/;
const YOUTUBE_HANDLE = /^@[A-Za-z0-9._-]{3,30}$/;
const YOUTUBE_CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;
const KICK_HANDLE = /^[a-z0-9_-]{1,25}$/;

const HOSTS: Readonly<Record<ClipPlatformId, readonly string[]>> = Object.freeze({
  youtube: ['youtube.com', 'www.youtube.com', 'm.youtube.com'],
  twitch: ['twitch.tv', 'www.twitch.tv', 'm.twitch.tv', 'go.twitch.tv'],
  kick: ['kick.com', 'www.kick.com'],
});

/** Channel pages after the name that still name the channel (`twitch.tv/name/videos`). */
const CHANNEL_TABS = new Set([
  'about',
  'clips',
  'community',
  'featured',
  'live',
  'playlists',
  'schedule',
  'shorts',
  'streams',
  'videos',
]);

/** Twitch and Kick pages that are not channels. */
const NOT_CHANNELS: Readonly<Record<'twitch' | 'kick', ReadonlySet<string>>> = Object.freeze({
  twitch: new Set([
    'collections',
    'directory',
    'downloads',
    'drops',
    'inventory',
    'search',
    'settings',
    'subscriptions',
    'turbo',
    'videos',
    'wallet',
  ]),
  kick: new Set(['browse', 'categories', 'category', 'dashboard', 'following', 'search', 'video']),
});

export type HandleRefusalCode = 'channel_not_found' | 'link_is_a_video';

/** A checked channel name: what the platform is asked about. */
export interface ChannelHandle {
  platform: ClipPlatformId;
  /** Twitch login (lower case), YouTube `@handle` or `UC...` id, Kick slug (lower case). */
  handle: string;
  /** YouTube only: set when a `UC...` channel id was given instead of a handle. */
  channelId?: string;
}

export type HandleCheck = ({ ok: true } & ChannelHandle) | { ok: false; code: HandleRefusalCode };

function notFound(): HandleCheck {
  return { ok: false, code: 'channel_not_found' };
}

function checkName(platform: ClipPlatformId, raw: string): HandleCheck {
  let name: string;
  try {
    name = decodeURIComponent(raw);
  } catch {
    return notFound();
  }
  switch (platform) {
    case 'twitch': {
      const login = (name.startsWith('@') ? name.slice(1) : name).toLowerCase();
      return TWITCH_HANDLE.test(login) ? { ok: true, platform, handle: login } : notFound();
    }
    case 'kick': {
      const slug = (name.startsWith('@') ? name.slice(1) : name).toLowerCase();
      return KICK_HANDLE.test(slug) && !NOT_CHANNELS.kick.has(slug)
        ? { ok: true, platform, handle: slug }
        : notFound();
    }
    case 'youtube': {
      if (YOUTUBE_CHANNEL_ID.test(name)) {
        return { ok: true, platform, handle: name, channelId: name };
      }
      const handle = name.startsWith('@') ? name : `@${name}`;
      return YOUTUBE_HANDLE.test(handle) ? { ok: true, platform, handle } : notFound();
    }
    default:
      return notFound();
  }
}

/** The name inside a channel link on `platform`, or null when the link is not a channel page. */
function nameFromLink(platform: ClipPlatformId, url: URL): string | null {
  const parts = url.pathname.split('/').filter((part) => part.length > 0);
  const [first, second, third] = parts;
  if (!first) {
    return null;
  }
  const tabOk = (tab: string | undefined): boolean => tab === undefined || CHANNEL_TABS.has(tab);

  if (platform === 'youtube') {
    if (first.startsWith('@') && parts.length <= 2 && tabOk(second)) {
      return first;
    }
    if (first === 'channel' && second && parts.length <= 3 && tabOk(third)) {
      return second;
    }
    return null;
  }
  const lower = first.toLowerCase();
  if (NOT_CHANNELS[platform].has(lower) || parts.length > 2 || !tabOk(second)) {
    return null;
  }
  return first;
}

/**
 * Checks what a person typed for a channel on `platform`: a bare name
 * (`vikram`, `@priya`) or a channel link. Returns the handle cut down and
 * normalised, or why it cannot be a channel. Never throws.
 */
export function validateHandle(platform: ClipPlatformId, text: string): HandleCheck {
  if (typeof text !== 'string') {
    return notFound();
  }
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > LINK_MAX_LENGTH || /\s/.test(trimmed)) {
    return notFound();
  }

  const looksLikeLink = trimmed.includes('/') || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(trimmed);
  if (!looksLikeLink) {
    return checkName(platform, trimmed);
  }

  // A video link pasted in the channel box gets its own sentence.
  if (!isLinkRefusal(recogniseLink(trimmed))) {
    return { ok: false, code: 'link_is_a_video' };
  }

  let url: URL;
  try {
    url = new URL(/^[A-Za-z][A-Za-z0-9+.-]*:/.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return notFound();
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.port !== '') {
    return notFound();
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!HOSTS[platform].includes(host)) {
    return notFound();
  }
  const name = nameFromLink(platform, url);
  return name === null ? notFound() : checkName(platform, name);
}

/**
 * The channel page the flat lister reads for one list (`kick.com/<slug>/videos`),
 * built from a checked handle on a fixed host. Null when the platform has no
 * such list (Twitch and Kick have no uploads or shorts; YouTube has no clips
 * list) or the handle does not pass its pattern again.
 */
export function channelListUrl(channel: ChannelHandle, kind: ListKind): string | null {
  const checked = checkName(channel.platform, channel.channelId ?? channel.handle);
  if (!checked.ok) {
    return null;
  }
  // The handle already passed its pattern; encoding is a second lock. A
  // YouTube handle keeps its leading `@`, which the address needs as it is.
  const name = checked.handle.startsWith('@')
    ? `@${encodeURIComponent(checked.handle.slice(1))}`
    : encodeURIComponent(checked.handle);
  switch (checked.platform) {
    case 'twitch':
      if (kind === 'streams') {
        return `https://www.twitch.tv/${name}/videos?filter=archives`;
      }
      return kind === 'clips' ? `https://www.twitch.tv/${name}/clips` : null;
    case 'kick':
      if (kind === 'streams') {
        return `https://kick.com/${name}/videos`;
      }
      return kind === 'clips' ? `https://kick.com/${name}/clips` : null;
    case 'youtube': {
      const base = checked.channelId
        ? `https://www.youtube.com/channel/${name}`
        : `https://www.youtube.com/${name}`;
      if (kind === 'uploads') {
        return `${base}/videos`;
      }
      if (kind === 'streams') {
        return `${base}/streams`;
      }
      return kind === 'shorts' ? `${base}/shorts` : null;
    }
    default:
      return null;
  }
}
