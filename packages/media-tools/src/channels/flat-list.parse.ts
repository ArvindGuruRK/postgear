/**
 * yt-dlp's `-J --flat-playlist` answer to our `ListedItem` rows.
 *
 * Flat entries "may miss fields" (research 11), so every field is optional
 * and a missing one becomes null. The id is read from the entry's address
 * with the platform's own pattern (and from `id` as a fallback); an entry
 * whose id does not fit is dropped, never guessed. The address itself is
 * never passed on: a listed item carries no download address.
 */
import type {
  ClipPlatformId,
  ListedItem,
  ListedItemKind,
  ListedItemState,
  ListKind,
} from '@postgear/video-engine';
import { z } from 'zod';
import { ChannelListerError, twitchArchiveExpiry } from './types';

const entrySchema = z.object({
  id: z.string().nullish(),
  url: z.string().nullish(),
  title: z.string().nullish(),
  duration: z.number().nullish(),
  view_count: z.number().nullish(),
  timestamp: z.number().nullish(),
  release_timestamp: z.number().nullish(),
  upload_date: z.string().nullish(),
  live_status: z.string().nullish(),
  thumbnail: z.string().nullish(),
  thumbnails: z.array(z.unknown()).nullish(),
});
type FlatEntry = z.infer<typeof entrySchema>;

const thumbnailSchema = z.object({ url: z.string(), width: z.number().nullish() });

const playlistSchema = z.object({
  _type: z.string().nullish(),
  id: z.string().nullish(),
  title: z.string().nullish(),
  channel: z.string().nullish(),
  channel_id: z.string().nullish(),
  uploader: z.string().nullish(),
  uploader_id: z.string().nullish(),
  entries: z.array(z.unknown()).nullish(),
});

/** The channel facts a flat answer holds, for `resolve`. */
export interface FlatPlaylistFacts {
  title: string | null;
  channelName: string | null;
  channelId: string | null;
  uploaderId: string | null;
}

export interface FlatListContext {
  platform: ClipPlatformId;
  kind: ListKind;
  /** The login or slug the page was built from; clips need it in their canonical link. */
  channelKey: string;
  /** Twitch only: sets the expiry of past broadcasts. */
  broadcasterType?: string;
}

const TWITCH_VIDEO_ID = /^v?(\d{1,20})$/;
const SLUG_ID = /^[A-Za-z0-9_-]{1,120}$/;
const UUID_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KICK_CLIP_ID = /^clip_[A-Za-z0-9]{1,64}$/;
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const MAX_TITLE = 300;

function parseUrl(value: string | null | undefined): URL | null {
  if (!value || value.length > 2048) return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/** The id inside the entry's address, by platform and list; else the entry's `id`, if it fits. */
function externalIdOf(entry: FlatEntry, context: FlatListContext): string | null {
  const url = parseUrl(entry.url);
  const segments = url ? url.pathname.split('/').filter((part) => part.length > 0) : [];
  const id = entry.id ?? '';
  if (context.platform === 'twitch') {
    if (context.kind === 'clips') {
      const fromUrl =
        url?.hostname === 'clips.twitch.tv'
          ? segments[0]
          : segments[1] === 'clip'
            ? segments[2]
            : undefined;
      const slug = fromUrl ?? id;
      return SLUG_ID.test(slug) ? slug : null;
    }
    const fromUrl = segments[0] === 'videos' ? segments[1] : undefined;
    const match = TWITCH_VIDEO_ID.exec(fromUrl ?? id);
    return match?.[1] ?? null;
  }
  if (context.platform === 'kick') {
    if (context.kind === 'clips') {
      const fromUrl =
        segments[1] === 'clips' ? segments[2] : (url?.searchParams.get('clip') ?? undefined);
      const clip = fromUrl ?? id;
      return KICK_CLIP_ID.test(clip) ? clip : null;
    }
    const fromUrl = segments[1] === 'videos' ? segments[2] : undefined;
    const uuid = fromUrl ?? id;
    return UUID_ID.test(uuid) ? uuid.toLowerCase() : null;
  }
  const fromUrl =
    url?.searchParams.get('v') ?? (segments[0] === 'shorts' ? segments[1] : undefined) ?? undefined;
  const video = fromUrl ?? id;
  return YOUTUBE_ID.test(video) ? video : null;
}

function itemKind(context: FlatListContext): ListedItemKind {
  if (context.kind === 'clips') return 'clip';
  if (context.kind === 'shorts') return 'short';
  if (context.kind === 'uploads') return 'upload';
  return 'vod';
}

function itemState(liveStatus: string | null | undefined): ListedItemState {
  if (liveStatus === 'is_live') return 'live';
  if (liveStatus === 'is_upcoming') return 'upcoming';
  if (liveStatus === 'post_live') return 'processing';
  return 'ready';
}

/** ISO time from the entry's timestamp or `YYYYMMDD` date; empty when the flat entry has none. */
function publishedAtOf(entry: FlatEntry): string {
  const seconds = entry.timestamp ?? entry.release_timestamp;
  if (typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0) {
    return new Date(seconds * 1000).toISOString();
  }
  const date = entry.upload_date && /^(\d{4})(\d{2})(\d{2})$/.exec(entry.upload_date);
  if (date) {
    const iso = `${date[1]}-${date[2]}-${date[3]}T00:00:00.000Z`;
    if (!Number.isNaN(Date.parse(iso))) return iso;
  }
  return '';
}

function httpsUrl(value: string | null | undefined): string | null {
  const url = parseUrl(value);
  return url && url.protocol === 'https:' && url.username === '' && url.password === ''
    ? url.href
    : null;
}

function thumbnailOf(entry: FlatEntry): string | null {
  const direct = httpsUrl(entry.thumbnail);
  if (direct) return direct;
  let best: { url: string; width: number } | null = null;
  for (const raw of entry.thumbnails ?? []) {
    const parsed = thumbnailSchema.safeParse(raw);
    if (!parsed.success) continue;
    const url = httpsUrl(parsed.data.url);
    const width = parsed.data.width ?? 0;
    if (url && (!best || width >= best.width)) best = { url, width };
  }
  return best?.url ?? null;
}

function cleanText(value: string | null | undefined, fallback: string): string {
  const text = Array.from(value ?? '')
    .map((char) => (char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 ? ' ' : char))
    .join('')
    .trim();
  if (text.length === 0) return fallback;
  return text.length > MAX_TITLE ? text.slice(0, MAX_TITLE) : text;
}

function toItem(entry: FlatEntry, context: FlatListContext): ListedItem | null {
  const externalId = externalIdOf(entry, context);
  if (!externalId) return null;
  const kind = itemKind(context);
  const state = itemState(entry.live_status);
  const publishedAt = publishedAtOf(entry);
  const durationSec =
    typeof entry.duration === 'number' && Number.isFinite(entry.duration) && entry.duration >= 0
      ? Math.round(entry.duration * 10) / 10
      : null;
  const viewCount =
    typeof entry.view_count === 'number' &&
    Number.isInteger(entry.view_count) &&
    entry.view_count >= 0
      ? entry.view_count
      : null;
  const item: ListedItem = {
    externalId,
    kind,
    title: cleanText(entry.title, 'Untitled video'),
    publishedAt,
    durationSec,
    viewCount,
    thumbnailUrl: thumbnailOf(entry),
    state,
  };
  if (context.platform === 'twitch' && kind === 'vod' && publishedAt) {
    const expiresAt = twitchArchiveExpiry(publishedAt, context.broadcasterType);
    if (expiresAt) item.expiresAt = expiresAt;
  }
  // Kick links always name the channel; Twitch only for clips.
  if (context.platform === 'kick' || (context.platform === 'twitch' && kind === 'clip')) {
    item.channel = context.channelKey;
  }
  return item;
}

/**
 * The items of a flat answer, in yt-dlp's order, and the channel facts. A
 * shape we cannot read is `platform_changed`: the site moved and yt-dlp did
 * not follow yet.
 */
export function parseFlatList(
  json: unknown,
  context: FlatListContext,
): { items: ListedItem[]; facts: FlatPlaylistFacts } {
  const parsed = playlistSchema.safeParse(json);
  if (!parsed.success || (parsed.data._type && parsed.data._type !== 'playlist')) {
    throw new ChannelListerError('platform_changed', {
      retryable: false,
      ...(parsed.success ? {} : { cause: parsed.error }),
    });
  }
  const items: ListedItem[] = [];
  const seen = new Set<string>();
  for (const raw of parsed.data.entries ?? []) {
    const entry = entrySchema.safeParse(raw);
    if (!entry.success) continue;
    const item = toItem(entry.data, context);
    if (item && !seen.has(item.externalId)) {
      seen.add(item.externalId);
      items.push(item);
    }
  }
  const data = parsed.data;
  return {
    items,
    facts: {
      title: data.title ? cleanText(data.title, '') || null : null,
      channelName:
        data.channel || data.uploader ? cleanText(data.channel ?? data.uploader, '') || null : null,
      channelId: data.channel_id ?? null,
      uploaderId: data.uploader_id ?? null,
    },
  };
}
