/**
 * Link recognition: which platform and which video a pasted link names.
 *
 * This is the extractor allowlist for import and download. A link is matched
 * against exact hosts and known path shapes, its id is checked against a
 * strict pattern, and the address yt-dlp is given is rebuilt from that id
 * (`canonicalLinkFor`), never the pasted text. Tracking parameters, start
 * times and playlist ids are dropped by construction.
 *
 * Shapes follow research 04 section 9 (modelled on yt-dlp's own patterns,
 * which are public domain). Only `https` is read; a link pasted without a
 * scheme is read as `https`. Channel, list, search and home pages answer
 * `link_not_a_video`, a page that is always a live stream `link_live`, and
 * everything else `link_unsupported`.
 *
 * Pure: the `URL` global only.
 */
import type {
  ChannelPlatformId,
  ClipPlatformId,
  LinkKind,
  LinkRef,
  LinkRefusal,
  LinkRefusalCode,
  ListedItem,
} from './types';
import { type SiteEntry, siteById, siteForHost, UPLOAD_ONLY_SITES } from './sites';

/** Longer than any real video link; the probe route takes up to 2,000 characters too. */
export const LINK_MAX_LENGTH = 2_000;

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
/** YouTube clip ids are long base64-like strings ("Ugkx..."). */
const YOUTUBE_CLIP_ID = /^[A-Za-z0-9_-]{10,64}$/;
const TWITCH_VIDEO_ID = /^\d{1,15}$/;
const TWITCH_CLIP_SLUG = /^[A-Za-z0-9_-]{1,100}$/;
const TWITCH_LOGIN = /^[a-z0-9_]{1,25}$/;
const KICK_VIDEO_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KICK_CLIP_ID = /^clip_[A-Za-z0-9_-]{1,64}$/;
const KICK_SLUG = /^[a-z0-9_-]{1,25}$/;

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
]);
const YOUTU_BE = 'youtu.be';
const TWITCH_HOSTS = new Set(['twitch.tv', 'www.twitch.tv', 'm.twitch.tv', 'go.twitch.tv']);
const TWITCH_CLIPS_HOST = 'clips.twitch.tv';
const TWITCH_PLAYER_HOST = 'player.twitch.tv';
const KICK_HOSTS = new Set(['kick.com', 'www.kick.com']);

/**
 * First path parts on twitch.tv that are pages, not channels. A link to one
 * of them is not a video, and none can be a channel name in a clip link.
 */
const TWITCH_RESERVED = new Set([
  'directory',
  'downloads',
  'drops',
  'embed',
  'friends',
  'inventory',
  'jobs',
  'messages',
  'moderator',
  'p',
  'popout',
  'prime',
  'search',
  'settings',
  'store',
  'subscriptions',
  'turbo',
  'u',
  'wallet',
]);

/** First path parts on kick.com that are pages, not channels. */
const KICK_RESERVED = new Set([
  'browse',
  'categories',
  'category',
  'dashboard',
  'following',
  'search',
  'settings',
  'subscriptions',
]);

function refusal(code: LinkRefusalCode): LinkRefusal {
  return { refused: true, code };
}

/** Whether `recogniseLink` refused. */
export function isLinkRefusal(value: LinkRef | LinkRefusal): value is LinkRefusal {
  return 'refused' in value && value.refused === true;
}

function makeRef(
  platform: ClipPlatformId,
  kind: LinkKind,
  externalId: string,
  channel?: string,
): LinkRef | LinkRefusal {
  const canonicalUrl = canonicalLinkFor({ platform, kind, externalId, channel });
  if (canonicalUrl === null) {
    return refusal('link_unsupported');
  }
  return channel === undefined
    ? { platform, kind, externalId, canonicalUrl }
    : { platform, kind, externalId, canonicalUrl, channel };
}

/** Parses pasted text into a URL we are willing to read, or null. */
function parseLink(text: string): URL | null {
  if (typeof text !== 'string') {
    return null;
  }
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > LINK_MAX_LENGTH || /\s/.test(trimmed)) {
    return null;
  }
  // A scheme is letters then "://" (or "scheme:" for mailto and friends).
  const hasScheme = /^[A-Za-z][A-Za-z0-9+.-]*:/.test(trimmed);
  let url: URL;
  try {
    url = new URL(hasScheme ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.port !== '') {
    return null;
  }
  return url;
}

function pathParts(url: URL): string[] {
  return url.pathname.split('/').filter((part) => part.length > 0);
}

function recogniseYouTube(url: URL, host: string): LinkRef | LinkRefusal {
  const parts = pathParts(url);

  if (host === YOUTU_BE) {
    const id = parts[0];
    if (parts.length !== 1 || !id) {
      return refusal(parts.length === 0 ? 'link_not_a_video' : 'link_unsupported');
    }
    return YOUTUBE_ID.test(id) ? makeRef('youtube', 'video', id) : refusal('link_unsupported');
  }

  const [first, second, third] = parts;
  if (!first) {
    return refusal('link_not_a_video');
  }

  if (first === 'watch' && parts.length === 1) {
    const id = url.searchParams.get('v');
    if (id === null) {
      // A watch page with only `list=` is a playlist.
      return refusal('link_not_a_video');
    }
    return YOUTUBE_ID.test(id) ? makeRef('youtube', 'video', id) : refusal('link_unsupported');
  }

  if (parts.length === 2 && second) {
    if (first === 'shorts') {
      return YOUTUBE_ID.test(second)
        ? makeRef('youtube', 'short', second)
        : refusal('link_unsupported');
    }
    if (first === 'live' || first === 'embed' || first === 'v') {
      return YOUTUBE_ID.test(second)
        ? makeRef('youtube', 'video', second)
        : refusal('link_unsupported');
    }
    if (first === 'clip') {
      return YOUTUBE_CLIP_ID.test(second)
        ? makeRef('youtube', 'clip', second)
        : refusal('link_unsupported');
    }
  }

  // A channel's live page always plays whatever is live now.
  if (
    (first.startsWith('@') && second === 'live' && parts.length === 2) ||
    ((first === 'channel' || first === 'c' || first === 'user') &&
      third === 'live' &&
      parts.length === 3)
  ) {
    return refusal('link_live');
  }

  // Channels, playlists, search, feeds and every other page on the site.
  return refusal('link_not_a_video');
}

function recogniseTwitch(url: URL, host: string): LinkRef | LinkRefusal {
  const parts = pathParts(url);

  if (host === TWITCH_CLIPS_HOST) {
    const [first] = parts;
    if (first === 'embed' && parts.length === 1) {
      const slug = url.searchParams.get('clip');
      return slug !== null && TWITCH_CLIP_SLUG.test(slug)
        ? makeRef('twitch', 'clip', slug)
        : refusal('link_unsupported');
    }
    if (parts.length !== 1 || !first) {
      return refusal(parts.length === 0 ? 'link_not_a_video' : 'link_unsupported');
    }
    return TWITCH_CLIP_SLUG.test(first)
      ? makeRef('twitch', 'clip', first)
      : refusal('link_unsupported');
  }

  if (host === TWITCH_PLAYER_HOST) {
    const video = url.searchParams.get('video');
    if (video !== null) {
      const id = video.startsWith('v') ? video.slice(1) : video;
      return TWITCH_VIDEO_ID.test(id)
        ? makeRef('twitch', 'past_stream', id)
        : refusal('link_unsupported');
    }
    if (url.searchParams.get('clip') !== null) {
      const slug = url.searchParams.get('clip') ?? '';
      return TWITCH_CLIP_SLUG.test(slug)
        ? makeRef('twitch', 'clip', slug)
        : refusal('link_unsupported');
    }
    // The player for a channel plays its live stream.
    return url.searchParams.get('channel') !== null
      ? refusal('link_live')
      : refusal('link_not_a_video');
  }

  const [first, second, third] = parts;
  if (!first) {
    return refusal('link_not_a_video');
  }

  if (first === 'videos') {
    if (parts.length === 2 && second) {
      return TWITCH_VIDEO_ID.test(second)
        ? makeRef('twitch', 'past_stream', second)
        : refusal('link_unsupported');
    }
    return refusal('link_not_a_video');
  }

  const login = first.toLowerCase();
  if (TWITCH_RESERVED.has(login) || login === 'collections') {
    return refusal('link_not_a_video');
  }

  if (parts.length === 3 && third && (second === 'v' || second === 'video')) {
    return TWITCH_LOGIN.test(login) && TWITCH_VIDEO_ID.test(third)
      ? makeRef('twitch', 'past_stream', third)
      : refusal('link_unsupported');
  }
  if (parts.length === 3 && third && second === 'clip') {
    return TWITCH_LOGIN.test(login) && TWITCH_CLIP_SLUG.test(third)
      ? makeRef('twitch', 'clip', third, login)
      : refusal('link_unsupported');
  }

  // A bare channel page, its lists (videos, clips, schedule, about) and anything else.
  return refusal('link_not_a_video');
}

function recogniseKick(url: URL): LinkRef | LinkRefusal {
  const parts = pathParts(url);
  const [first, second, third] = parts;
  if (!first) {
    return refusal('link_not_a_video');
  }
  const slug = first.toLowerCase();
  if (slug === 'video' && parts.length === 2) {
    // The old address without the channel, which every Kick link now needs.
    return refusal('link_unsupported');
  }
  if (KICK_RESERVED.has(slug)) {
    return refusal('link_not_a_video');
  }

  const clipParam = url.searchParams.get('clip');
  if (parts.length === 1 && clipParam !== null) {
    return KICK_SLUG.test(slug) && KICK_CLIP_ID.test(clipParam)
      ? makeRef('kick', 'clip', clipParam, slug)
      : refusal('link_unsupported');
  }

  if (parts.length === 3 && third) {
    if (second === 'videos') {
      const id = third.toLowerCase();
      return KICK_SLUG.test(slug) && KICK_VIDEO_ID.test(id)
        ? makeRef('kick', 'past_stream', id, slug)
        : refusal('link_unsupported');
    }
    if (second === 'clips') {
      return KICK_SLUG.test(slug) && KICK_CLIP_ID.test(third)
        ? makeRef('kick', 'clip', third, slug)
        : refusal('link_unsupported');
    }
  }

  // A bare channel page, its video and clip lists, and anything else.
  return refusal('link_not_a_video');
}

/**
 * Reads pasted text as a video link. Returns the platform, the kind, the id
 * and the canonical address, or why it was refused. Never throws.
 */
export function recogniseLink(text: string): LinkRef | LinkRefusal {
  const url = parseLink(text);
  if (!url) {
    return refusal('link_unsupported');
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (YOUTUBE_HOSTS.has(host) || host === YOUTU_BE) {
    return recogniseYouTube(url, host);
  }
  if (TWITCH_HOSTS.has(host) || host === TWITCH_CLIPS_HOST || host === TWITCH_PLAYER_HOST) {
    return recogniseTwitch(url, host);
  }
  if (KICK_HOSTS.has(host)) {
    return recogniseKick(url);
  }
  const uploadOnly = UPLOAD_ONLY_SITES[host];
  if (uploadOnly !== undefined) {
    return { refused: true, code: 'link_upload_only', site: uploadOnly };
  }
  const site = siteForHost(host);
  if (site && site.shapes.length > 0) {
    return recogniseSite(site, url, host);
  }
  return refusal('link_unsupported');
}

/**
 * A link on one of Module 12's sites, read through its shapes. A short link
 * (`fb.watch`, `pin.it`) cannot be read without following it, so it is
 * refused; any other page of the site is not one video.
 */
function recogniseSite(site: SiteEntry, url: URL, host: string): LinkRef | LinkRefusal {
  if (site.shortHosts?.includes(host)) {
    return refusal('link_unsupported');
  }
  const parts = pathParts(url);
  for (const shape of site.shapes) {
    const found = shape.match(parts, url);
    if (found) {
      return makeRef(site.id, shape.kind, found.id, found.channel);
    }
  }
  return refusal('link_not_a_video');
}

/** What `canonicalLinkFor` needs: a link's identity, with or without its address. */
export interface LinkIdentity {
  platform: ClipPlatformId;
  kind: LinkKind;
  externalId: string;
  /** Needed for Kick (every Kick address names the channel). */
  channel?: string;
}

/**
 * The one address yt-dlp is given for a video, rebuilt from its id. Null when
 * the id does not pass its platform's pattern, the kind does not exist on the
 * platform, or a Kick link has no channel.
 *
 * Twitch clips always use `clips.twitch.tv/<slug>`, which works without the
 * channel, so one clip has one address however it was pasted.
 */
export function canonicalLinkFor(ref: LinkIdentity): string | null {
  const { platform, kind, externalId } = ref;
  if (typeof externalId !== 'string') {
    return null;
  }
  switch (platform) {
    case 'youtube':
      if (kind === 'clip') {
        return YOUTUBE_CLIP_ID.test(externalId)
          ? `https://www.youtube.com/clip/${externalId}`
          : null;
      }
      if (!YOUTUBE_ID.test(externalId)) {
        return null;
      }
      return kind === 'short'
        ? `https://www.youtube.com/shorts/${externalId}`
        : `https://www.youtube.com/watch?v=${externalId}`;
    case 'twitch':
      if (kind === 'clip') {
        return TWITCH_CLIP_SLUG.test(externalId) ? `https://clips.twitch.tv/${externalId}` : null;
      }
      if (kind === 'short') {
        return null;
      }
      return TWITCH_VIDEO_ID.test(externalId) ? `https://www.twitch.tv/videos/${externalId}` : null;
    case 'kick': {
      const channel = ref.channel?.toLowerCase();
      if (channel === undefined || !KICK_SLUG.test(channel) || KICK_RESERVED.has(channel)) {
        return null;
      }
      if (kind === 'clip') {
        return KICK_CLIP_ID.test(externalId)
          ? `https://kick.com/${channel}/clips/${externalId}`
          : null;
      }
      if (kind === 'short') {
        return null;
      }
      const id = externalId.toLowerCase();
      return KICK_VIDEO_ID.test(id) ? `https://kick.com/${channel}/videos/${id}` : null;
    }
    default:
      return canonicalForSite(ref);
  }
}

/** Module 12's sites: the first shape of the kind whose patterns the id (and channel) pass. */
function canonicalForSite(ref: LinkIdentity): string | null {
  const site = siteById(ref.platform);
  if (!site) return null;
  for (const shape of site.shapes) {
    if (shape.kind !== ref.kind || !shape.idPattern.test(ref.externalId)) continue;
    if (shape.channelPattern) {
      if (ref.channel === undefined || !shape.channelPattern.test(ref.channel)) continue;
      return shape.canonical(ref.externalId, ref.channel);
    }
    return shape.canonical(ref.externalId);
  }
  return null;
}

/**
 * The link for one row of a channel's list (My Channels), so Import posts a
 * canonical address to the probe like any pasted link. Null when the row's id
 * does not pass the platform's pattern.
 */
export function linkRefForListedItem(
  platform: ChannelPlatformId,
  item: Pick<ListedItem, 'externalId' | 'kind' | 'channel'>,
): LinkRef | null {
  let kind: LinkKind;
  switch (item.kind) {
    case 'vod':
    case 'highlight':
      kind = 'past_stream';
      break;
    case 'upload':
      kind = 'video';
      break;
    case 'clip':
      kind = 'clip';
      break;
    case 'short':
      kind = 'short';
      break;
    default:
      return null;
  }
  const channel = platform === 'youtube' ? undefined : item.channel?.toLowerCase();
  const externalId =
    platform === 'kick' && kind !== 'clip' ? item.externalId.toLowerCase() : item.externalId;
  const canonicalUrl = canonicalLinkFor({ platform, kind, externalId, channel });
  if (canonicalUrl === null) {
    return null;
  }
  return channel === undefined
    ? { platform, kind, externalId, canonicalUrl }
    : { platform, kind, externalId, canonicalUrl, channel };
}
