/**
 * The pictures a clip card shows (Sprint 12, Module 07 section 4), made from
 * files the video already has: no new file is ever written for a card.
 *
 * - **Poster**: the filmstrip tile nearest the clip's start, as a box in its
 *   sprite sheet's pixels (`x`, `y`, `width`, `height` inside
 *   `sheetWidth` by `sheetHeight`), so the card draws it with a CSS
 *   background position. Without a filmstrip, the video's poster picture as
 *   a box covering the whole image. Null when there is neither.
 * - **Preview**: the light copy's signed address and the clip's range, so a
 *   card can play just that part, muted, on hover.
 *
 * Pure: rows and signed addresses in, shapes out.
 */
import type { FilmstripMeta, PosterMeta } from '@postgear/video-engine';

export interface ClipPoster {
  url: string;
  x: number;
  y: number;
  width: number;
  height: number;
  sheetWidth: number;
  sheetHeight: number;
}

export interface ClipPreview {
  url: string;
  fromMs: number;
  toMs: number;
  expiresAt: string;
}

/** Where tile `index` sits: its sheet, and its box in that sheet's pixels. */
export function tileBox(
  meta: FilmstripMeta,
  index: number,
): { sheet: number; x: number; y: number } {
  const perSheet = Math.max(1, meta.columns * meta.rows);
  const sheet = Math.floor(index / perSheet);
  const within = index % perSheet;
  return {
    sheet,
    x: (within % meta.columns) * meta.tileWidth,
    y: Math.floor(within / meta.columns) * meta.tileHeight,
  };
}

/** The tile nearest `atMs` (clamped to the strip). */
export function nearestTile(meta: FilmstripMeta, atMs: number): number {
  const last = Math.max(0, meta.count - 1);
  const index = Math.round(Math.max(0, atMs) / Math.max(1, meta.intervalMs));
  return Math.min(last, Math.max(0, index));
}

/**
 * The filmstrip tile nearest `atMs`: which sheet holds it (from 0) and its
 * box in that sheet, or null for an empty strip. The caller signs that one
 * sheet and adds its address.
 */
export function filmstripPosterBox(
  meta: FilmstripMeta,
  atMs: number,
): (Omit<ClipPoster, 'url'> & { sheet: number }) | null {
  if (meta.count <= 0) return null;
  const box = tileBox(meta, nearestTile(meta, atMs));
  return {
    sheet: box.sheet,
    x: box.x,
    y: box.y,
    width: meta.tileWidth,
    height: meta.tileHeight,
    sheetWidth: meta.columns * meta.tileWidth,
    sheetHeight: meta.rows * meta.tileHeight,
  };
}

/** The video's own poster picture as a box covering the whole image. */
export function wholePoster(url: string, meta: Pick<PosterMeta, 'width' | 'height'>): ClipPoster {
  return {
    url,
    x: 0,
    y: 0,
    width: meta.width,
    height: meta.height,
    sheetWidth: meta.width,
    sheetHeight: meta.height,
  };
}
