/**
 * Drawing only what is visible: the slice of time the view shows, and the
 * filmstrip pictures that slice needs.
 *
 * A filmstrip (see `assets.ts`) is one small picture every `intervalMs` of
 * the video, packed into sheets of `columns` by `rows`. Tile `i` shows the
 * video from `i x intervalMs` until the next one, sits on sheet
 * `floor(i / (columns x rows))`, and within that sheet at column
 * `i mod columns` of row `floor((i mod perSheet) / columns)`.
 *
 * Times here are whatever clock the caller draws in: output time for the
 * editor's ruler, the video's own time for a part's filmstrip.
 */
import type { FilmstripMeta } from '../assets';

export interface TimeRange {
  fromMs: number;
  toMs: number;
}

/** One filmstrip picture to draw, and where it is on its sheet. */
export interface FilmstripTile {
  index: number;
  sheet: number;
  column: number;
  row: number;
  /** The video moment the tile starts at, in ms. */
  atMs: number;
  /** The tile's top left corner on its sheet, in the sheet's pixels (for a CSS background position). */
  x: number;
  y: number;
}

/** One place along a bar where a tile is drawn. */
export interface FilmstripSlot {
  /** Pixels from the start of the range. */
  offsetPx: number;
  widthPx: number;
  tile: FilmstripTile;
}

function finite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

/**
 * The time the view shows, from the scroll and width in pixels. Never
 * before 0; an empty range when the scale or width is not usable.
 */
export function visibleRange(scrollPx: number, widthPx: number, pxPerMs: number): TimeRange {
  if (!Number.isFinite(pxPerMs) || pxPerMs <= 0) {
    return { fromMs: 0, toMs: 0 };
  }
  const scroll = Math.max(0, finite(scrollPx));
  const width = Math.max(0, finite(widthPx));
  const fromMs = scroll / pxPerMs;
  const toMs = (scroll + width) / pxPerMs;
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) {
    return { fromMs: 0, toMs: 0 };
  }
  return { fromMs, toMs };
}

/** Whether a filmstrip's numbers can be read at all. */
function usable(meta: FilmstripMeta): boolean {
  return (
    Number.isFinite(meta.intervalMs) &&
    meta.intervalMs > 0 &&
    Number.isInteger(meta.columns) &&
    meta.columns > 0 &&
    Number.isInteger(meta.rows) &&
    meta.rows > 0 &&
    Number.isInteger(meta.count) &&
    meta.count > 0 &&
    Number.isFinite(meta.tileWidth) &&
    Number.isFinite(meta.tileHeight)
  );
}

/** The tile at an index (the caller keeps it within the strip). */
function tileAt(meta: FilmstripMeta, index: number): FilmstripTile {
  const perSheet = meta.columns * meta.rows;
  const sheet = Math.floor(index / perSheet);
  const within = index % perSheet;
  const column = within % meta.columns;
  const row = Math.floor(within / meta.columns);
  return {
    index,
    sheet,
    column,
    row,
    atMs: index * meta.intervalMs,
    x: column * meta.tileWidth,
    y: row * meta.tileHeight,
  };
}

/** The last tile index the strip really has (its count, and its sheets when that is fewer). */
function lastIndex(meta: FilmstripMeta): number {
  const perSheet = meta.columns * meta.rows;
  const bySheets =
    Number.isInteger(meta.sheets) && meta.sheets > 0 ? meta.sheets * perSheet : meta.count;
  return Math.min(meta.count, bySheets) - 1;
}

/**
 * Every tile that shows some of `[fromMs, toMs)`, in order. Tiles stop at
 * `count` (and at the last sheet the strip has), so a range past the strip's
 * end returns only the tiles that exist. An empty or backwards range has no
 * tiles.
 */
export function tilesInRange(meta: FilmstripMeta, fromMs: number, toMs: number): FilmstripTile[] {
  if (!usable(meta)) {
    return [];
  }
  const from = Math.max(0, finite(fromMs));
  const to = finite(toMs);
  if (!(to > from)) {
    return [];
  }
  const last = lastIndex(meta);
  const first = Math.floor(from / meta.intervalMs);
  const end = Math.min(last, Math.ceil(to / meta.intervalMs) - 1);
  const tiles: FilmstripTile[] = [];
  for (let index = first; index <= end; index += 1) {
    tiles.push(tileAt(meta, index));
  }
  return tiles;
}

/**
 * The tiles to draw along a bar showing `[fromMs, toMs)` at `pxPerMs`, each
 * `slotWidthPx` wide (the tile's drawn width), so the bar is filled without
 * drawing more tiles than fit: a 6 hour video zoomed out gets one picture per
 * slot, not a thousand pictures a pixel wide. Each slot shows the tile at
 * the moment its left edge stands for; the last slot is cut to the bar's end.
 */
export function filmstripSlots(
  meta: FilmstripMeta,
  fromMs: number,
  toMs: number,
  pxPerMs: number,
  slotWidthPx: number,
): FilmstripSlot[] {
  if (!usable(meta) || !Number.isFinite(pxPerMs) || pxPerMs <= 0) {
    return [];
  }
  const from = Math.max(0, finite(fromMs));
  const to = finite(toMs);
  const slot = finite(slotWidthPx);
  if (!(to > from) || !(slot > 0)) {
    return [];
  }
  const widthPx = (to - from) * pxPerMs;
  if (!Number.isFinite(widthPx)) {
    return [];
  }
  const last = lastIndex(meta);
  if (last < 0) {
    return [];
  }
  const count = Math.min(10_000, Math.ceil(widthPx / slot));
  const slots: FilmstripSlot[] = [];
  for (let i = 0; i < count; i += 1) {
    const offsetPx = i * slot;
    const atMs = from + offsetPx / pxPerMs;
    const index = Math.min(last, Math.floor(atMs / meta.intervalMs));
    slots.push({
      offsetPx,
      widthPx: Math.min(slot, widthPx - offsetPx),
      tile: tileAt(meta, index),
    });
  }
  return slots;
}
