/**
 * Clips as the list, the video page and the editor answer them, for the
 * library and video page tests. Plain data only, so a test can spread its own
 * changes over one.
 */
import type { ClipListItem, ClipSummary, ClipView } from '@/types/clips';

export const CLIP_VIDEO_ID = '6c4b8f49-5420-441c-9888-f9db240f229b';

export function fixtureClipSummary(overrides: Partial<ClipSummary> = {}): ClipSummary {
  return {
    id: 'clip-1',
    title: 'Team Talk (0:30)',
    status: 'DRAFT',
    origin: 'MANUAL',
    ratio: '9:16',
    durationMs: 42_000,
    score: null,
    revision: 3,
    exported: false,
    exportedMediaId: null,
    createdAt: '2026-11-18T10:00:00.000Z',
    updatedAt: '2026-11-18T10:05:00.000Z',
    state: 'draft',
    range: { fromMs: 30_000, toMs: 72_000 },
    ...overrides,
  };
}

export function fixtureClipItem(overrides: Partial<ClipListItem> = {}): ClipListItem {
  return {
    ...fixtureClipSummary(),
    videoId: CLIP_VIDEO_ID,
    videoTitle: 'PostGear Sample: A Three Minute Talk',
    platform: 'youtube',
    poster: null,
    preview: null,
    ...overrides,
  };
}

/** The clip answer a rename, hide or duplicate gives back. */
export function fixtureClipView(overrides: Partial<ClipView> = {}): ClipView {
  const summary = fixtureClipSummary();
  return {
    id: summary.id,
    videoId: CLIP_VIDEO_ID,
    title: summary.title,
    status: summary.status,
    state: summary.state,
    origin: summary.origin,
    ratio: summary.ratio,
    durationMs: summary.durationMs,
    score: null,
    reasons: [],
    revision: summary.revision + 1,
    exported: false,
    lastExportedRevision: null,
    exportedMediaId: null,
    document: null,
    createdAt: summary.createdAt,
    updatedAt: '2026-11-18T11:00:00.000Z',
    ...overrides,
  };
}
