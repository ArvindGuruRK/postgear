import {
  clampToRegion,
  clampWithReport,
  dragToOffset,
  offsetBounds,
  placeInRegion,
} from './constraints';
import type { Rect } from './types';

/** A slot a quarter of the way in, half the width, a fifth of the height. */
const SLOT: Rect = { x: 25, y: 20, w: 50, h: 20 };

describe('offsetBounds', () => {
  it('lets a slot reach each edge of its region and no further', () => {
    expect(offsetBounds(SLOT)).toEqual({ minX: -25, maxX: 25, minY: -20, maxY: 60 });
  });

  it('gives a full-width slot no room sideways', () => {
    const bounds = offsetBounds({ x: 0, y: 10, w: 100, h: 30 });
    expect(bounds.minX).toBeCloseTo(0, 10);
    expect(bounds.maxX).toBeCloseTo(0, 10);
  });
});

describe('clampToRegion', () => {
  it('keeps an offset that stays inside', () => {
    expect(clampToRegion(SLOT, { x: 10, y: -5 })).toEqual({ x: 10, y: -5 });
  });

  it('stops at the edge instead of leaving the region', () => {
    expect(clampToRegion(SLOT, { x: 9_999, y: -9_999 })).toEqual({ x: 25, y: -20 });
  });

  it('refuses to let an element cross into another region, from any start', () => {
    for (const x of [-500, -40, 0, 40, 500]) {
      for (const y of [-500, -30, 0, 70, 500]) {
        const placed = placeInRegion(SLOT, { x, y });

        expect(placed.x).toBeGreaterThanOrEqual(-0.0001);
        expect(placed.y).toBeGreaterThanOrEqual(-0.0001);
        expect(placed.x + placed.w).toBeLessThanOrEqual(100.0001);
        expect(placed.y + placed.h).toBeLessThanOrEqual(100.0001);
      }
    }
  });

  it('pins a slot larger than its region to the start edge rather than inverting', () => {
    const oversized: Rect = { x: 0, y: 0, w: 140, h: 100 };
    const clamped = clampToRegion(oversized, { x: 50, y: 0 });
    expect(clamped.x).toBeCloseTo(0, 10);
    expect(clamped.y).toBeCloseTo(0, 10);
  });

  it('treats a non-finite offset as no offset', () => {
    expect(clampToRegion(SLOT, { x: Number.NaN, y: Number.POSITIVE_INFINITY })).toEqual({
      x: 0,
      y: 60,
    });
  });
});

describe('clampWithReport', () => {
  it('says nothing was clamped when the move was legal', () => {
    const report = clampWithReport(SLOT, { x: 5, y: 5 });
    expect(report.clampedX).toBe(false);
    expect(report.clampedY).toBe(false);
    expect(report.edge).toEqual({ x: null, y: null });
  });

  it('names the edge a drag stopped at', () => {
    const report = clampWithReport(SLOT, { x: -400, y: 400 });
    expect(report.clampedX).toBe(true);
    expect(report.clampedY).toBe(true);
    expect(report.edge).toEqual({ x: 'start', y: 'end' });
  });

  it('names the edge pushed against when a slot fills its region', () => {
    const full: Rect = { x: 0, y: 10, w: 100, h: 40 };
    expect(clampWithReport(full, { x: 3, y: 0 }).edge.x).toBe('end');
    expect(clampWithReport(full, { x: -3, y: 0 }).edge.x).toBe('start');
  });

  it('names no edge for an offset with no direction', () => {
    expect(clampWithReport(SLOT, { x: Number.NaN, y: 0 }).edge).toEqual({ x: null, y: null });
  });
});

describe('dragToOffset', () => {
  it('scales a canvas movement by the region it happened in', () => {
    // A region half the canvas wide: moving 5% of the canvas is 10% of it.
    const region: Rect = { x: 0, y: 0, w: 50, h: 25 };
    expect(dragToOffset(region, { x: 0, y: 0 }, { x: 5, y: 5 })).toEqual({ x: 10, y: 20 });
  });
});
