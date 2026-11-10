/**
 * From what the sources returned to what a tab shows: one list per group, no
 * story twice, in the order a reader expects, and short enough to scan.
 *
 * ## The age limit takes a clock and an off switch
 *
 * Stories older than 48 hours are dropped, against a clock the caller may pass.
 * Simulation switches the limit off with `maxNewsAgeMs: null`, because its
 * recorded stories all pass 48 hours two days after they were recorded and
 * News would then be empty for good.
 */
import { createHash } from 'node:crypto';
import type { ComposedItem, DiscoverItemKind, SourceId, SourceItem } from '../types';

export const NEWS_MAX_AGE_MS = 48 * 60 * 60 * 1000;

/** The most items a group of each kind shows. A kind not named here is not capped. */
export const GROUP_CAPS: Partial<Record<DiscoverItemKind, number>> = { trend: 10, news: 20 };

export interface FeedGroupInput {
  id: string;
  items: SourceItem[];
}

export interface ComposedGroup {
  id: string;
  items: ComposedItem[];
}

export interface ComposeOptions {
  now?: Date;
  /** Null turns the limit off. */
  maxNewsAgeMs?: number | null;
}

/** Same words, whatever the case, punctuation or spacing. Marks stay: Tamil vowels are marks. */
function titleKey(title: string): string {
  return title
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ')
    .trim();
}

export function itemId(source: SourceId, key: string): string {
  return createHash('sha1').update(`${source}${key}`).digest('hex');
}

function timeOf(item: SourceItem): number {
  const time = item.publishedAt ? Date.parse(item.publishedAt) : Number.NaN;
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
}

/** Trends by their rank in the feed, stories newest first, everything else as it came. */
function ordered(items: SourceItem[]): SourceItem[] {
  return [...items].sort((a, b) => {
    if (a.kind === 'trend' && b.kind === 'trend') {
      return (
        (a.signal?.rank ?? Number.MAX_SAFE_INTEGER) - (b.signal?.rank ?? Number.MAX_SAFE_INTEGER)
      );
    }
    if (a.kind === 'news' && b.kind === 'news') return timeOf(b) - timeOf(a);
    return 0;
  });
}

/**
 * De-duplicates across groups, so a story in the city's group is not repeated in
 * the country's: the group that comes first keeps it. That happens before the
 * cap, so duplicates never use up a group's room.
 */
export function composeFeed(
  groups: readonly FeedGroupInput[],
  options: ComposeOptions = {},
): ComposedGroup[] {
  const now = (options.now ?? new Date()).getTime();
  const maxAge = options.maxNewsAgeMs === undefined ? NEWS_MAX_AGE_MS : options.maxNewsAgeMs;
  const seen = new Set<string>();

  return groups.map((group) => {
    const kept: SourceItem[] = [];

    for (const item of ordered(group.items)) {
      if (maxAge !== null && item.kind === 'news' && now - timeOf(item) > maxAge) {
        // An undated story has no age to judge, so it stays.
        if (item.publishedAt) continue;
      }

      const key = titleKey(item.title);
      if (key === '' || seen.has(key)) continue;

      const cap = GROUP_CAPS[item.kind];
      if (cap !== undefined && kept.length >= cap) continue;

      seen.add(key);
      kept.push(item);
    }

    return {
      id: group.id,
      items: kept.map((item) => ({
        id: itemId(item.source.id, item.url ?? item.opaqueUrl ?? item.title),
        ...item,
      })),
    };
  });
}
