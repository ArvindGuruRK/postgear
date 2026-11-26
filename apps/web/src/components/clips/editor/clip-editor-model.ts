/**
 * The clip editor's words and small rules (Module 08), kept apart from the
 * components so they are tested as plain functions.
 */
import {
  type CanvasSize,
  DEFAULT_SOURCE_ASPECT,
  RATIO_LABELS,
  type Ratio,
} from '@postgear/video-engine';
import type { ClipDetail } from '@/types/clips';
import type { FirstShape } from './editor-state';

export const SHARP_GONE_SENTENCE =
  'The sharp video is no longer online. This clip will export at 720p from the copy we kept.';
export const CONFLICT_SENTENCE = 'Someone else changed this clip. Reload to see their version.';
export const RELOAD_FAILED_SENTENCE =
  'The latest version could not be loaded. Check your connection and try again.';
export const LATER_PANEL_SENTENCE = 'Arrives in a later step of this sprint.';
export const CANNOT_PLAY_SENTENCE = 'This video cannot be played right now.';
export const NO_PREVIEW_SENTENCE =
  'This clip cannot be played here because its video is no longer in your library.';
export const DOCUMENT_UNREADABLE_SENTENCE =
  'This clip could not be opened. It was saved in a form this editor no longer reads.';
export const LEAVE_TITLE = 'Leave without saving?';
export const LEAVE_SENTENCE =
  'Your latest changes are not saved yet. If you leave now, they may be lost.';

/** The video page, opened at this clip (the top bar's way back). */
export function backHref(orgId: string, videoId: string, clipId: string): string {
  return `/${encodeURIComponent(orgId)}/clips/video/${encodeURIComponent(videoId)}?clip=${encodeURIComponent(clipId)}`;
}

/** The Clips tab, for a clip whose video was deleted. */
export function clipsTabHref(orgId: string): string {
  return `/${encodeURIComponent(orgId)}/clips?tab=clips`;
}

/**
 * The video's picture size, for fitting crops: the light copy's when known
 * (the preview plays it), else the video's own, else a 16:9 stand-in (the
 * engine's default aspect) at 720p.
 */
export function videoSizeOf(detail: Pick<ClipDetail, 'proxy' | 'video'>): CanvasSize {
  const { proxy, video } = detail;
  if (proxy && proxy.width > 0 && proxy.height > 0) {
    return { width: proxy.width, height: proxy.height };
  }
  if (video?.width && video.height && video.width > 0 && video.height > 0) {
    return { width: video.width, height: video.height };
  }
  return { width: Math.round(720 * DEFAULT_SOURCE_ASPECT), height: 720 };
}

/** The line under each shape in the first-open dialog. */
export const SHAPE_LINES: Readonly<Record<FirstShape, string>> = Object.freeze({
  '9:16': '9:16 for TikTok, Shorts and Reels',
  '16:9': '16:9 for YouTube',
  '1:1': '1:1 for feeds',
});

export function shapeName(ratio: Ratio): string {
  return RATIO_LABELS[ratio];
}

// ---------------------------------------------------------------------------
// The timeline dock's height, kept in this browser
// ---------------------------------------------------------------------------

export const DOCK_STORAGE_KEY = 'postgear.clips.dockHeight';
export const DOCK_MIN_PX = 160;
export const DOCK_MAX_PX = 480;
export const DOCK_DEFAULT_PX = 220;

export function clampDockHeight(value: number): number {
  if (!Number.isFinite(value)) return DOCK_DEFAULT_PX;
  return Math.min(DOCK_MAX_PX, Math.max(DOCK_MIN_PX, Math.round(value)));
}

/** The remembered height, or the default when storage is blocked, empty or holds nonsense. */
export function readDockHeight(): number {
  try {
    const stored = window.localStorage.getItem(DOCK_STORAGE_KEY);
    if (stored === null) return DOCK_DEFAULT_PX;
    const value = Number(stored);
    return Number.isFinite(value) ? clampDockHeight(value) : DOCK_DEFAULT_PX;
  } catch {
    return DOCK_DEFAULT_PX;
  }
}

export function writeDockHeight(value: number): void {
  try {
    window.localStorage.setItem(DOCK_STORAGE_KEY, String(clampDockHeight(value)));
  } catch {
    // A blocked storage only means the height is not remembered.
  }
}

// ---------------------------------------------------------------------------
// The Transcript pane (Sprint 13, Module 04): whether it was open, per browser
// ---------------------------------------------------------------------------

const TRANSCRIPT_STORAGE_KEY = 'postgear.clips.transcriptOpen';

export function readTranscriptOpen(): boolean {
  try {
    return window.localStorage.getItem(TRANSCRIPT_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeTranscriptOpen(open: boolean): void {
  try {
    window.localStorage.setItem(TRANSCRIPT_STORAGE_KEY, open ? '1' : '0');
  } catch {
    // A blocked storage only means the choice is not remembered.
  }
}

// ---------------------------------------------------------------------------
// The stage's scale
// ---------------------------------------------------------------------------

/**
 * How much the clip's canvas is scaled to fit a box, never above 1 and never
 * zero: a 1080 by 1920 canvas in a 400 by 600 box is 0.3125.
 */
export function fitScale(canvas: CanvasSize, box: { width: number; height: number }): number {
  if (!(canvas.width > 0 && canvas.height > 0 && box.width > 0 && box.height > 0)) return 0;
  return Math.min(1, box.width / canvas.width, box.height / canvas.height);
}
