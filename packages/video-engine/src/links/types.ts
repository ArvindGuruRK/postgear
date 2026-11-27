/**
 * What a pasted link is, and what a channel lists. Types only here; the
 * recognition rules are in `recognise.ts` and the network side lives in
 * `@postgear/media-tools` (yt-dlp) and the API (official list routes).
 */

/**
 * Sites a link can come from (Sprint 13 Module 12: sites as data, the rules
 * in `sites.ts`). The first three are Sprint 12's; the rest were added in
 * Module 12 (D13-08). The database's `ClipPlatform` is the upper-case twin,
 * plus UPLOAD. Whether a site is switched on is `CLIPS_PLATFORMS`.
 */
export const CLIP_PLATFORMS = [
  'youtube',
  'twitch',
  'kick',
  'vimeo',
  'rumble',
  'dailymotion',
  'loom',
  'x',
  'facebook',
  'linkedin',
  'reddit',
  'pinterest',
  'threads',
  'zoom',
  'tiktok',
  'instagram',
  'dropbox',
] as const;
export type ClipPlatformId = (typeof CLIP_PLATFORMS)[number];

/** The sites whose channels can be saved and listed (My Channels). Sprint 12's three. */
export const CHANNEL_PLATFORMS = ['youtube', 'twitch', 'kick'] as const;
export type ChannelPlatformId = (typeof CHANNEL_PLATFORMS)[number];

/** Whether a site has My Channels. */
export function isChannelPlatform(platform: string): platform is ChannelPlatformId {
  return (CHANNEL_PLATFORMS as readonly string[]).includes(platform);
}

/** What the UI calls each site. */
export const PLATFORM_NAMES: Readonly<Record<ClipPlatformId, string>> = Object.freeze({
  youtube: 'YouTube',
  twitch: 'Twitch',
  kick: 'Kick',
  vimeo: 'Vimeo',
  rumble: 'Rumble',
  dailymotion: 'Dailymotion',
  loom: 'Loom',
  x: 'X',
  facebook: 'Facebook',
  linkedin: 'LinkedIn',
  reddit: 'Reddit',
  pinterest: 'Pinterest',
  threads: 'Threads',
  zoom: 'Zoom',
  tiktok: 'TikTok',
  instagram: 'Instagram',
  dropbox: 'Dropbox',
});

/** `video` on YouTube becomes `past_stream` once the probe says it was a live stream. */
export const LINK_KINDS = ['video', 'past_stream', 'clip', 'short'] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

/**
 * A recognised link. `canonicalUrl` is always rebuilt from the id by
 * `recognise.ts`, never the pasted text: it is the only URL yt-dlp is ever
 * given, which is what makes recognition the extractor allowlist.
 */
export interface LinkRef {
  platform: ClipPlatformId;
  kind: LinkKind;
  externalId: string;
  canonicalUrl: string;
  /**
   * A second part some addresses need beside the id: the channel of a Kick
   * video or a Twitch clip, the account of a TikTok or Threads post, the file
   * name of a Dropbox link. YouTube never has one.
   */
  channel?: string;
}

export interface LinkFormat {
  /** Stable within one probe: `h1080`, `h720`, `audio`. Never a yt-dlp format string. */
  id: string;
  /** "1080p", "720p 60 fps", "Audio Only". */
  label: string;
  height: number | null;
  fps: number | null;
  /** The container the file is saved in: `mp4` or `m4a`. */
  ext: 'mp4' | 'm4a';
  /** Size when the platform says it; an estimate is never shown as a fact. */
  bytes: number | null;
  audioOnly: boolean;
}

/** YouTube's "most replayed" heat map, kept for Module 16's highlights. Source time. */
export interface ReplayedPoint {
  startMs: number;
  endMs: number;
  /** 0 to 1. */
  value: number;
}

/** One shape for every platform, whatever answered the probe. */
export interface LinkInfo extends LinkRef {
  title: string;
  channelName: string | null;
  durationMs: number;
  live: boolean;
  /** The platform's picture. The browser gets it through our thumbnail route, never directly. */
  thumbnailUrl: string | null;
  formats: LinkFormat[];
  replayed?: ReplayedPoint[];
}

/** Why a link was refused before any tool ran. */
export type LinkRefusalCode =
  | 'link_unsupported'
  | 'link_not_a_video'
  | 'link_live'
  | 'link_upload_only';

export interface LinkRefusal {
  refused: true;
  code: LinkRefusalCode;
  /** `link_upload_only`: the site's name ("Riverside"), for its sentence. */
  site?: string;
}

// --- Channels (My Channels) -------------------------------------------------

/** What a channel can list. YouTube has uploads and shorts; Twitch and Kick streams and clips. */
export const LIST_KINDS = ['streams', 'clips', 'uploads', 'shorts'] as const;
export type ListKind = (typeof LIST_KINDS)[number];

export const LIST_SORTS = ['newest', 'views'] as const;
export type ListSort = (typeof LIST_SORTS)[number];

/** Twitch clips can be listed over a period. */
export const LIST_PERIODS = ['day', 'week', 'month', 'all'] as const;
export type ListPeriod = (typeof LIST_PERIODS)[number];

export interface ChannelRef {
  platform: ChannelPlatformId;
  /** As typed and checked: a Twitch login, a YouTube `@handle`, a Kick slug. */
  handle: string;
  /** Twitch user id, YouTube channel id (`UC...`), Kick slug. */
  externalId: string;
  displayName: string;
  avatarUrl: string | null;
  /** YouTube only: the channel's uploads playlist. */
  uploadsListId?: string;
  /** Twitch only: `partner`, `affiliate` or empty, which sets how long archives are kept. */
  broadcasterType?: string;
}

export type ListedItemKind = 'vod' | 'highlight' | 'upload' | 'clip' | 'short';
export type ListedItemState = 'ready' | 'live' | 'upcoming' | 'processing';

/**
 * One row of a channel's list. Never carries a download address: the web
 * builds the canonical link from `{ platform, kind, externalId }` with
 * `canonicalLinkFor` and posts it to the probe, so Import keeps every check.
 */
export interface ListedItem {
  externalId: string;
  kind: ListedItemKind;
  title: string;
  /** ISO time. */
  publishedAt: string;
  durationSec: number | null;
  viewCount: number | null;
  /** The platform's own picture address; the browser loads it, we never copy it. */
  thumbnailUrl: string | null;
  state: ListedItemState;
  /** Twitch archives: when the platform deletes it. ISO time. */
  expiresAt?: string;
  /** Kick and Twitch clips: the channel slug the canonical link needs. */
  channel?: string;
}

export interface ChannelPage {
  items: ListedItem[];
  nextCursor?: string;
}
