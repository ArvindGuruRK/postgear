/**
 * The Clips page's tabs (Sprint 12, Module 01), and the copy around them.
 *
 * Create is where a person starts (paste a link, upload a file); Streams
 * lists the public videos of the channels the workspace added (Module 06,
 * placed second as the blueprint draws it: find a video, then work on it);
 * Videos holds
 * the imported long videos; Clips the clips cut from them; Downloads the
 * files fetched in a chosen format. The open tab lives in `?tab=` so a link
 * or a reload lands on the same tab; Create is the default and is left out
 * of the address.
 */
import type { ClipVideoSort } from '@/types/clips';

export const CLIPS_TABS = ['create', 'streams', 'videos', 'clips', 'downloads'] as const;
export type ClipsTab = (typeof CLIPS_TABS)[number];

export const DEFAULT_CLIPS_TAB: ClipsTab = 'create';

export const CLIPS_TAB_NAMES: Record<ClipsTab, string> = {
  create: 'Create',
  streams: 'Streams',
  videos: 'Videos',
  clips: 'Clips',
  downloads: 'Downloads',
};

/** The tab a `?tab=` value names, or Create for anything else. */
export function clipsTabFrom(value: string | string[] | undefined | null): ClipsTab {
  return typeof value === 'string' && (CLIPS_TABS as readonly string[]).includes(value)
    ? (value as ClipsTab)
    : DEFAULT_CLIPS_TAB;
}

/** Module 19: the Videos tab's order from `?sort=` (See What Uses Space links to `size`). */
export function videoSortFrom(value: string | string[] | undefined | null): ClipVideoSort {
  return value === 'size' || value === 'oldest' ? value : 'newest';
}

/** The one sentence every Clips route shows below 1366 px (UX blueprint section 12). */
export const BIGGER_SCREEN_SENTENCE =
  'Clips is made for a bigger screen. Open it on a laptop or desktop.';

/** What a tab shows until its module lands. */
export const LATER_STEP_SENTENCE = 'Arrives in a later step of this sprint.';
