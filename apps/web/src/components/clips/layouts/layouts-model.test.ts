import { applyLayout, createClipDocument, type Rect } from '@postgear/video-engine';
import {
  AREA_TONES,
  areaTone,
  CROP_NUDGE,
  CROP_NUDGE_BIG,
  CROP_SNAP_PX,
  chosenLayout,
  cleanLayoutName,
  cropBoxRadius,
  cropName,
  cropSnapLines,
  cropsMove,
  deleteLayoutSentence,
  layoutChoices,
  layoutDrawing,
  layoutShapeName,
  MIN_CROP_SIDE,
  moveCrop,
  nextCropName,
  noSavedLayoutsSentence,
  nudgeCrop,
  presetDrawing,
  resizeCrop,
  sameCrop,
} from './layouts-model';

const EPS = 1e-9;
const PANE = { width: 1000, height: 562.5 };
/** A 9:16 crop on a 16:9 video: w / h in fractions is (9/16) / (16/9). */
const K = 9 / 16 / (16 / 9);

function expectInside(rect: Rect) {
  expect(rect.x).toBeGreaterThanOrEqual(-EPS);
  expect(rect.y).toBeGreaterThanOrEqual(-EPS);
  expect(rect.x + rect.w).toBeLessThanOrEqual(1 + EPS);
  expect(rect.y + rect.h).toBeLessThanOrEqual(1 + EPS);
}

function expectShape(rect: Rect, k: number) {
  expect(rect.w / rect.h).toBeCloseTo(k, 9);
}

const crop = (x: number, y: number, h: number): Rect => ({ x, y, w: h * K, h });

describe('shapes and layouts', () => {
  it('offers seven layouts on Vertical, Square and 4:5, two on Horizontal', () => {
    expect(layoutChoices('9:16').map((c) => c.label)).toEqual([
      'Fullscreen',
      'Blurred',
      'Split',
      'Three',
      'Four',
      'Gameplay',
      'Screen Share',
    ]);
    expect(layoutChoices('1:1')).toHaveLength(7);
    expect(layoutChoices('4:5')).toHaveLength(7);
    expect(layoutChoices('16:9').map((c) => c.kind)).toEqual(['fullscreen', 'blurred']);
  });

  it('names the shapes and marks no tile for a custom layout', () => {
    expect(['9:16', '16:9', '1:1', '4:5'].map((r) => layoutShapeName(r as never))).toEqual([
      'Vertical',
      'Horizontal',
      'Square',
      'Portrait',
    ]);
    expect(chosenLayout('custom')).toBeNull();
    expect(chosenLayout('split')).toBe('split');
  });

  it('draws a preset from its table, the blurred middle as a wide video', () => {
    const split = presetDrawing('split', '9:16');
    expect(split?.width).toBe(1080);
    expect(split?.height).toBe(1920);
    expect(split?.base).toBe('solid');
    expect(split?.boxes).toHaveLength(2);
    expect(presetDrawing('split', '16:9')).toBeNull();

    const blurred = presetDrawing('blurred', '9:16');
    expect(blurred?.base).toBe('blurred');
    const middle = blurred?.boxes[0]?.rect as Rect;
    expect((middle.w * 1080) / (middle.h * 1920)).toBeCloseTo(16 / 9, 6);

    const gameplay = presetDrawing('gameplay', '9:16');
    expect(gameplay?.boxes.at(-1)?.radius).toBeGreaterThan(0);
  });

  it('draws the clip own layout, with its base', () => {
    const doc = applyLayout(
      createClipDocument({
        videoId: '00000000-0000-4000-8000-000000000001',
        fromMs: 0,
        toMs: 10_000,
        ratio: '9:16',
      }),
      'screen_share',
      { width: 1920, height: 1080 },
    );
    const drawing = layoutDrawing('9:16', doc.layout);
    expect(drawing.base).toBe('blurred');
    expect(drawing.boxes).toHaveLength(2);
  });
});

describe('area colours and names', () => {
  it('gives each area one of four fixed tones by place, never violet or red', () => {
    expect(AREA_TONES).toEqual(['primary', 'success', 'accent', 'warning']);
    expect([0, 1, 2, 3, 4, -1].map(areaTone)).toEqual([
      'primary',
      'success',
      'accent',
      'warning',
      'primary',
      'warning',
    ]);
    expect(cropName({ name: 'Camera' })).toBe('Camera Crop');
  });

  it('never says crop twice in a spoken name', () => {
    expect(cropName({ name: 'Crop 3' })).toBe('Crop 3');
    expect(cropName({ name: 'Face Crop' })).toBe('Face Crop');
    expect(cropName({ name: 'crop' })).toBe('crop');
    expect(cropName({ name: 'Cropped Face' })).toBe('Cropped Face Crop');
    expect(cropName({ name: 'Crops' })).toBe('Crops Crop');
  });

  it('names an added crop with the next number no crop uses', () => {
    expect(nextCropName([{ name: 'Camera' }, { name: 'Content' }])).toBe('Crop 3');
    expect(nextCropName([{ name: 'Camera' }, { name: 'crop 3' }])).toBe('Crop 4');
    expect(nextCropName([{ name: 'Crop 2' }, { name: 'Crop 3' }, { name: 'Crop 4' }])).toBe(
      'Crop 5',
    );
    expect(nextCropName([])).toBe('Crop 1');
  });
});

describe('moveCrop', () => {
  it('moves by the pointer and slides along the edges without shrinking', () => {
    const start = crop(0.4, 0.2, 0.5);
    expect(moveCrop(start, 0.1, 0.05).rect).toEqual({ ...start, x: 0.5, y: 0.25 });
    const pushed = moveCrop(start, 5, -5).rect;
    expect(pushed.x).toBeCloseTo(1 - start.w, 12);
    expect(pushed.y).toBe(0);
    expect(pushed.w).toBe(start.w);
    expect(pushed.h).toBe(start.h);
    expect(moveCrop(start, Number.NaN, Number.POSITIVE_INFINITY).rect).toEqual(start);
  });

  it('snaps its edges and centre to the video lines within 8 px, with guides', () => {
    const start = crop(0.4, 0.2, 0.5);
    const lines = cropSnapLines([]);
    // The centre lands 5 px from the middle line.
    const centre = 0.5 - start.w / 2;
    const near = moveCrop(start, centre - start.x + 5 / PANE.width, 0, { lines, pane: PANE });
    expect(near.rect.x).toBeCloseTo(centre, 12);
    expect(near.guides.x).toEqual([0.5]);
    // 12 px off: no snap.
    const far = moveCrop(start, centre - start.x + 12 / PANE.width, 0, { lines, pane: PANE });
    expect(far.guides.x).toEqual([]);
    // The bottom edge to the bottom of the video.
    const down = moveCrop(start, 0, 1 - start.h - start.y - 6 / PANE.height, {
      lines,
      pane: PANE,
    });
    expect(down.rect.y + down.rect.h).toBeCloseTo(1, 12);
    expect(down.guides.y).toEqual([1]);
  });

  it('snaps to another crop edges', () => {
    const other: Rect = { x: 0.1, y: 0.1, w: 0.2, h: 0.2 };
    const start = crop(0.5, 0.6, 0.3);
    const lines = cropSnapLines([other]);
    // Its left edge comes within 4 px of the other crop's right edge.
    const moved = moveCrop(start, 0.3 - start.x + 4 / PANE.width, 0, { lines, pane: PANE });
    expect(moved.rect.x).toBeCloseTo(0.3, 12);
    expect(moved.guides.x).toHaveLength(1);
    expect(moved.guides.x[0]).toBeCloseTo(0.3, 12);
  });

  it('never snaps on a pane that is not laid out', () => {
    const start = crop(0.4, 0.2, 0.5);
    const moved = moveCrop(start, 0.0001, 0, {
      lines: cropSnapLines([]),
      pane: { width: 0, height: 0 },
    });
    expect(moved.guides).toEqual({ x: [], y: [] });
  });
});

describe('resizeCrop', () => {
  it('keeps the shape from every handle and the opposite edge in place', () => {
    const start = crop(0.4, 0.2, 0.5);
    const right = start.x + start.w;
    const bottom = start.y + start.h;

    const se = resizeCrop(start, 'se', 0.01, 0.1).rect;
    expectShape(se, K);
    expect(se.x).toBeCloseTo(start.x, 12);
    expect(se.y).toBeCloseTo(start.y, 12);
    // The corner follows the direction that changes the box more (down).
    expect(se.h).toBeCloseTo(0.6, 12);
    // Inward along one side only, it shrinks.
    const ne = resizeCrop(start, 'ne', -0.05, 0).rect;
    expect(ne.w).toBeCloseTo(start.w - 0.05, 12);
    expect(ne.x).toBeCloseTo(start.x, 12);
    expect(ne.y + ne.h).toBeCloseTo(bottom, 12);

    const nw = resizeCrop(start, 'nw', 0.05, 0).rect;
    expectShape(nw, K);
    expect(nw.x + nw.w).toBeCloseTo(right, 12);
    expect(nw.y + nw.h).toBeCloseTo(bottom, 12);

    const e = resizeCrop(start, 'e', 0.05, 0).rect;
    expectShape(e, K);
    expect(e.x).toBeCloseTo(start.x, 12);
    expect(e.y + e.h / 2).toBeCloseTo(start.y + start.h / 2, 12);

    const n = resizeCrop(start, 'n', 0, -0.1).rect;
    expectShape(n, K);
    expect(n.y + n.h).toBeCloseTo(bottom, 12);
    expect(n.x + n.w / 2).toBeCloseTo(start.x + start.w / 2, 12);
  });

  it('stays inside the video and keeps a smallest size', () => {
    const start = crop(0.4, 0.2, 0.5);
    for (const handle of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as const) {
      for (const [dx, dy] of [
        [5, 5],
        [-5, -5],
        [5, -5],
        [-5, 5],
      ]) {
        const rect = resizeCrop(start, handle, dx as number, dy as number).rect;
        expectInside(rect);
        expectShape(rect, K);
        expect(Math.min(rect.w, rect.h)).toBeGreaterThanOrEqual(MIN_CROP_SIDE - EPS);
      }
    }
  });

  it('slides a side-grown crop inward rather than out of the video', () => {
    const start = crop(0.6, 0.02, 0.3);
    const grown = resizeCrop(start, 'e', 0.1, 0).rect;
    expectInside(grown);
    expect(grown.x).toBeCloseTo(start.x, 12);
    expect(grown.y).toBeGreaterThanOrEqual(0);
  });

  it('snaps the moving edge, and only within 8 px', () => {
    const start = crop(0.4, 0.2, 0.5);
    const lines = cropSnapLines([]);
    // The bottom edge 6 px above the video's bottom.
    const dy = 1 - (start.y + start.h) - 6 / PANE.height;
    const snapped = resizeCrop(start, 's', 0, dy, { lines, pane: PANE });
    expect(snapped.rect.y + snapped.rect.h).toBeCloseTo(1, 12);
    expect(snapped.guides.y).toEqual([1]);
    expectShape(snapped.rect, K);

    const free = resizeCrop(start, 's', 0, dy - 20 / PANE.height, { lines, pane: PANE });
    expect(free.guides).toEqual({ x: [], y: [] });
    expect(CROP_SNAP_PX).toBe(8);
  });
});

describe('the arrow keys', () => {
  it('move 1 percent, 5 with Shift, and stay inside', () => {
    const start = crop(0.4, 0.2, 0.5);
    expect(nudgeCrop(start, 'ArrowRight', false)?.x).toBeCloseTo(0.4 + CROP_NUDGE, 12);
    expect(nudgeCrop(start, 'ArrowUp', true)?.y).toBeCloseTo(0.2 - CROP_NUDGE_BIG, 12);
    expect(nudgeCrop(crop(0, 0, 0.5), 'ArrowLeft', true)?.x).toBe(0);
    expect(nudgeCrop(start, 'Enter', false)).toBeNull();
  });
});

describe('small helpers', () => {
  it('tells the same crop, and a crop that changes over time', () => {
    const a = crop(0.4, 0.2, 0.5);
    expect(sameCrop(a, { ...a })).toBe(true);
    expect(sameCrop(a, { ...a, x: a.x + 0.001 })).toBe(false);
    expect(
      cropsMove({
        layout: {
          kind: 'fullscreen',
          areas: [
            {
              id: 'a',
              name: 'Main',
              frame: { x: 0, y: 0, w: 1, h: 1 },
              fit: 'cover',
              crop: [
                { at: 0, rect: a },
                { at: 1000, rect: a },
              ],
            },
          ],
        },
      }),
    ).toBe(true);
  });

  it('scales a rounded corner to the crop size on the pane', () => {
    const area = { radius: 36, fit: 'cover' as const, frame: { x: 0, y: 0, w: 0.36, h: 0.2 } };
    // The crop is drawn 360 px wide; the frame is 0.36 of 1080 = 388.8 px on the clip.
    const r = cropBoxRadius(area, { x: 0, y: 0, w: 0.36, h: 0.36 }, PANE, 1080);
    expect(r).toBeCloseTo((36 * 360) / 388.8, 9);
    expect(cropBoxRadius({ ...area, fit: 'contain' }, area.frame, PANE, 1080)).toBe(0);
    expect(cropBoxRadius({ ...area, radius: undefined }, area.frame, PANE, 1080)).toBe(0);
  });

  it('cleans a layout name and writes the delete sentence', () => {
    expect(cleanLayoutName('  My\u0007   Stream  ')).toBe('My Stream');
    expect(cleanLayoutName('   ')).toBeNull();
    expect(cleanLayoutName('x'.repeat(90))).toHaveLength(60);
    expect(deleteLayoutSentence('My Stream')).toBe(
      'Delete "My Stream" for everyone in this workspace? Clips that use it keep their crops.',
    );
    expect(noSavedLayoutsSentence('9:16')).toMatch(/^No saved layouts for Vertical clips yet\./);
  });
});
