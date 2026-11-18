import type { FilmstripMeta } from '../assets';
import { filmstripSlots, tilesInRange, visibleRange } from './visible';

/** A strip of 250 tiles, one every 2 s, 10 by 10 to a sheet (the last sheet half full). */
const META: FilmstripMeta = {
  tileWidth: 160,
  tileHeight: 90,
  columns: 10,
  rows: 10,
  intervalMs: 2_000,
  count: 250,
  sheets: 3,
};

describe('visibleRange', () => {
  it('turns the scroll and width into a time range', () => {
    expect(visibleRange(0, 1000, 0.1)).toEqual({ fromMs: 0, toMs: 10_000 });
    expect(visibleRange(500, 1000, 0.1)).toEqual({ fromMs: 5_000, toMs: 15_000 });
  });

  it('never starts before 0, and is empty without a usable scale', () => {
    expect(visibleRange(-200, 1000, 0.1).fromMs).toBe(0);
    expect(visibleRange(0, 1000, 0)).toEqual({ fromMs: 0, toMs: 0 });
    expect(visibleRange(0, 1000, Number.NaN)).toEqual({ fromMs: 0, toMs: 0 });
    expect(visibleRange(Number.NaN, Number.NaN, 0.1)).toEqual({ fromMs: 0, toMs: 0 });
  });
});

describe('tilesInRange', () => {
  it('returns the tiles that show some of the range, with their sheet, column and row', () => {
    const tiles = tilesInRange(META, 3_000, 9_000);
    expect(tiles.map((t) => t.index)).toEqual([1, 2, 3, 4]);
    expect(tiles[0]).toEqual({ index: 1, sheet: 0, column: 1, row: 0, atMs: 2_000, x: 160, y: 0 });
  });

  it('places tiles on later sheets', () => {
    const [tile] = tilesInRange(META, 2_000 * 123, 2_000 * 123 + 1);
    expect(tile).toEqual({
      index: 123,
      sheet: 1,
      column: 3,
      row: 2,
      atMs: 246_000,
      x: 480,
      y: 180,
    });
  });

  it('handles the edges: the start, an exact boundary, and past the end', () => {
    expect(tilesInRange(META, 0, 1).map((t) => t.index)).toEqual([0]);
    // [2 s, 4 s) is exactly tile 1, not tile 2.
    expect(tilesInRange(META, 2_000, 4_000).map((t) => t.index)).toEqual([1]);
    // The strip stops at its count.
    const last = tilesInRange(META, 495_000, 1_000_000);
    expect(last.map((t) => t.index)).toEqual([247, 248, 249]);
    expect(last[2]).toMatchObject({ sheet: 2, column: 9, row: 4 });
    expect(tilesInRange(META, 600_000, 700_000)).toEqual([]);
    // Empty and backwards ranges.
    expect(tilesInRange(META, 5_000, 5_000)).toEqual([]);
    expect(tilesInRange(META, 9_000, 3_000)).toEqual([]);
    // Before 0 reads from 0.
    expect(tilesInRange(META, -10_000, 1).map((t) => t.index)).toEqual([0]);
  });

  it('never reads a sheet the strip does not have, and refuses unusable numbers', () => {
    expect(tilesInRange({ ...META, sheets: 2 }, 390_000, 500_000).map((t) => t.index)).toEqual([
      195, 196, 197, 198, 199,
    ]);
    expect(tilesInRange({ ...META, intervalMs: 0 }, 0, 10_000)).toEqual([]);
    expect(tilesInRange({ ...META, columns: Number.NaN }, 0, 10_000)).toEqual([]);
    expect(tilesInRange({ ...META, count: 0 }, 0, 10_000)).toEqual([]);
    expect(tilesInRange(META, Number.NaN, Number.NaN)).toEqual([]);
  });
});

describe('filmstripSlots', () => {
  it('fills a bar with one tile per slot, the last slot cut to the bar', () => {
    // 10 s at 0.1 px/ms is 1000 px: 80 px slots give 13 slots, the last 40 px wide.
    const slots = filmstripSlots(META, 0, 10_000, 0.1, 80);
    expect(slots).toHaveLength(13);
    expect(slots[0]).toMatchObject({ offsetPx: 0, widthPx: 80, tile: { index: 0 } });
    expect(slots[1]?.tile.index).toBe(0);
    expect(slots[3]?.tile.index).toBe(1);
    expect(slots[12]).toMatchObject({ offsetPx: 960, widthPx: 40 });
  });

  it('draws a 6 hour strip zoomed out as a few slots, not a picture per tile', () => {
    const slots = filmstripSlots(META, 0, 500_000, 1200 / 500_000, 80);
    expect(slots).toHaveLength(15);
    expect(slots[slots.length - 1]?.tile.index).toBeLessThanOrEqual(249);
  });

  it('is empty for unusable input', () => {
    expect(filmstripSlots(META, 0, 10_000, 0, 80)).toEqual([]);
    expect(filmstripSlots(META, 0, 10_000, 0.1, 0)).toEqual([]);
    expect(filmstripSlots(META, 10_000, 0, 0.1, 80)).toEqual([]);
  });
});
