import {
  clampRect,
  FULL_RECT,
  fitRect,
  MIN_RECT_SIDE,
  rectAspect,
  rectCentre,
  rectsEqual,
} from './geometry';

const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 9);

describe('clampRect', () => {
  it('leaves a rectangle inside the square as it is', () => {
    expect(clampRect({ x: 0.1, y: 0.2, w: 0.5, h: 0.4 })).toEqual({
      x: 0.1,
      y: 0.2,
      w: 0.5,
      h: 0.4,
    });
  });

  it('slides a box dragged past an edge along it instead of shrinking it', () => {
    expect(clampRect({ x: 0.8, y: -0.3, w: 0.5, h: 0.5 })).toEqual({
      x: 0.5,
      y: 0,
      w: 0.5,
      h: 0.5,
    });
  });

  it('never lets a side collapse below the minimum or grow past the whole', () => {
    const tiny = clampRect({ x: 0.5, y: 0.5, w: 0, h: -1 });
    expect(tiny.w).toBe(MIN_RECT_SIDE);
    expect(tiny.h).toBe(MIN_RECT_SIDE);
    expect(clampRect({ x: -1, y: -1, w: 3, h: 3 })).toEqual(FULL_RECT);
  });

  it('turns numbers that are not numbers into a safe box', () => {
    // Any position that is not a finite number goes to the edge (0), a size to the whole.
    expect(
      clampRect({ x: Number.NaN, y: Number.POSITIVE_INFINITY, w: Number.NaN, h: 0.5 }),
    ).toEqual({
      x: 0,
      y: 0,
      w: 1,
      h: 0.5,
    });
  });
});

describe('fitRect', () => {
  it('fits a 9:16 crop inside a 16:9 picture, full height and centred', () => {
    const crop = fitRect(9 / 16, FULL_RECT, 16 / 9);
    close(crop.h, 1);
    close(crop.y, 0);
    // 9/16 of the height in pixels is (9/16) / (16/9) of the width.
    close(crop.w, 81 / 256);
    close(crop.x, (1 - 81 / 256) / 2);
    close(rectAspect(crop, 16 / 9), 9 / 16);
  });

  it('fits a wide box inside a tall surface, full width and centred', () => {
    const box = fitRect(16 / 9, FULL_RECT, 9 / 16);
    close(box.w, 1);
    close(rectAspect(box, 9 / 16), 16 / 9);
    close(box.y + box.h / 2, 0.5);
  });

  it('fits inside a smaller frame, staying inside it', () => {
    const into = { x: 0.2, y: 0.1, w: 0.6, h: 0.3 };
    const box = fitRect(1, into, 1);
    close(box.h, 0.3);
    close(box.w, 0.3);
    close(rectCentre(box).x, rectCentre(into).x);
    expect(box.x).toBeGreaterThanOrEqual(into.x);
    expect(box.x + box.w).toBeLessThanOrEqual(into.x + into.w + 1e-12);
  });

  it('answers the frame unchanged for an aspect that makes no sense', () => {
    const into = { x: 0.1, y: 0.1, w: 0.5, h: 0.5 };
    expect(fitRect(0, into)).toEqual(into);
    expect(fitRect(Number.NaN, into)).toEqual(into);
    expect(fitRect(1, into, -1)).toEqual(into);
    expect(fitRect(0, into)).not.toBe(into);
  });
});

describe('rectCentre and rectsEqual', () => {
  it('finds the centre', () => {
    const centre = rectCentre({ x: 0.2, y: 0.4, w: 0.2, h: 0.2 });
    close(centre.x, 0.3);
    close(centre.y, 0.5);
  });

  it('compares within a tolerance', () => {
    expect(
      rectsEqual({ x: 0.1, y: 0.2, w: 0.3, h: 0.4 }, { x: 0.1 + 1e-12, y: 0.2, w: 0.3, h: 0.4 }),
    ).toBe(true);
    expect(
      rectsEqual({ x: 0.1, y: 0.2, w: 0.3, h: 0.4 }, { x: 0.11, y: 0.2, w: 0.3, h: 0.4 }),
    ).toBe(false);
  });
});
