/**
 * My Channels in words (Module 06, section 6; blueprint section 3), as pure
 * functions: the list names per platform, the row's facts, the expiry line,
 * how old a list is, and the canonical link a row's Import sends to the
 * probe. Dates are written in UTC in one English form so the server and the
 * browser agree.
 */
import {
  type ChannelPlatformId,
  type ListKind,
  type ListPeriod,
  type ListSort,
  linkRefForListedItem,
  MAX_LIST_ITEMS,
  PLATFORM_LIST_KINDS,
} from '@postgear/video-engine';
import type { ClipChannelView, ClipStreamItem } from '@/types/clips';

export const CONNECT_SENTENCE = 'No channels yet.';
export const ONLY_PUBLIC_LINE =
  'Only public videos are listed. Nothing is downloaded until you import one.';
export const EMPTY_CHANNEL = 'This channel has no public videos yet.';
export const LIVE_TOOLTIP = 'Come back when the stream has ended.';
export const YOUTUBE_SORT_HINT = 'YouTube lists newest first';
export const CAPPED_SENTENCE = `Showing the newest ${MAX_LIST_ITEMS.toLocaleString('en-GB')}. Paste a link for older videos.`;

/** The tab names of a channel's lists: Twitch and Kick Streams and Clips; YouTube Videos, Streams and Shorts. */
export function listName(platform: ChannelPlatformId, kind: ListKind): string {
  if (platform === 'youtube' && kind === 'uploads') return 'Videos';
  switch (kind) {
    case 'streams':
      return 'Streams';
    case 'clips':
      return 'Clips';
    case 'shorts':
      return 'Shorts';
    default:
      return 'Videos';
  }
}

/** The lists a channel offers, in the platform's order, from the API's answer or the engine's table. */
export function listsOf(channel: Pick<ClipChannelView, 'platform' | 'lists'>): ListKind[] {
  const offered = new Set(channel.lists.map((list) => list.kind));
  return PLATFORM_LIST_KINDS[channel.platform].filter(
    (kind) => offered.size === 0 || offered.has(kind),
  );
}

export const SORT_NAMES: Readonly<Record<ListSort, string>> = Object.freeze({
  newest: 'Newest',
  views: 'Most Viewed',
});

export const PERIOD_NAMES: Readonly<Record<ListPeriod, string>> = Object.freeze({
  all: 'All Time',
  day: 'Last Day',
  week: 'Last Week',
  month: 'Last Month',
});

/** "3 h 42 min" from seconds, or null. */
function lengthWords(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) return null;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 1) return `${Math.floor(seconds)} s`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/** "21 Nov, 3 h 42 min, 12,408 views". */
export function streamFacts(
  item: Pick<ClipStreamItem, 'publishedAt' | 'durationSec' | 'viewCount'>,
): string {
  const parts: string[] = [];
  const date = new Date(item.publishedAt);
  if (!Number.isNaN(date.getTime())) {
    parts.push(
      date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }),
    );
  }
  const length = lengthWords(item.durationSec);
  if (length) parts.push(length);
  if (
    typeof item.viewCount === 'number' &&
    Number.isFinite(item.viewCount) &&
    item.viewCount >= 0
  ) {
    parts.push(item.viewCount === 1 ? '1 view' : `${item.viewCount.toLocaleString('en-GB')} views`);
  }
  return parts.join(', ');
}

/** "Expires in about 3 days" for a Twitch archive, or null. */
export function expiryLine(expiresAt: string | undefined, now: Date): string | null {
  if (!expiresAt) return null;
  const at = new Date(expiresAt).getTime();
  if (Number.isNaN(at)) return null;
  const hours = (at - now.getTime()) / 3_600_000;
  if (hours <= 0) return 'Expires soon';
  if (hours < 24) {
    const whole = Math.max(1, Math.round(hours));
    return whole === 1 ? 'Expires in about an hour' : `Expires in about ${whole} hours`;
  }
  const days = Math.round(hours / 24);
  return days === 1 ? 'Expires in about a day' : `Expires in about ${days} days`;
}

/** "Updated just now", "Updated 4 minutes ago", "Updated 3 hours ago". */
export function updatedLine(iso: string | null | undefined, now: Date): string | null {
  if (!iso) return null;
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) return null;
  const minutes = Math.floor(Math.max(0, now.getTime() - at) / 60_000);
  if (minutes < 1) return 'Updated just now';
  if (minutes < 60)
    return minutes === 1 ? 'Updated 1 minute ago' : `Updated ${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? 'Updated 1 hour ago' : `Updated ${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'Updated 1 day ago' : `Updated ${days} days ago`;
}

/** "38 streams", "1 clip", "12 videos" for the list's count line. */
export function countLine(count: number, platform: ChannelPlatformId, kind: ListKind): string {
  const noun = listName(platform, kind).toLowerCase();
  const singular = noun.endsWith('s') ? noun.slice(0, -1) : noun;
  return count === 1 ? `1 ${singular}` : `${count.toLocaleString('en-GB')} ${noun}`;
}

/** The canonical link of a row, which Import sends to the probe; null when it cannot be built. */
export function canonicalLinkOf(platform: ChannelPlatformId, item: ClipStreamItem): string | null {
  return linkRefForListedItem(platform, item)?.canonicalUrl ?? null;
}

/** A row can be imported only once the stream has ended and been processed. */
export function importable(item: Pick<ClipStreamItem, 'state'>): boolean {
  return item.state === 'ready';
}
