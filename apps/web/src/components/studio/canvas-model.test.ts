import type { TypingKeyPress } from '@postgear/design-engine';
import {
  endsTyping,
  isFitted,
  scrollAnchor,
  scrollToAnchor,
  ZOOM_LEVELS,
  type ZoomKeyPress,
  zoomIn,
  zoomKeyOf,
  zoomLabel,
  zoomOut,
  zoomScale,
} from './canvas-model';

describe('zoom', () => {
  // A square slide on a desktop canvas: shown whole at 49% of its real size.
  const FIT = 0.49;

  it('draws Fit at the fitting scale, and a chosen level at that level', () => {
    expect(zoomScale('fit', FIT)).toBe(FIT);
    expect(zoomScale(1, FIT)).toBe(1);
  });

  it('never draws the slide smaller than Fit, even after the window grew past a chosen level', () => {
    expect(zoomScale(0.5, 0.8)).toBe(0.8);
    expect(isFitted(0.5, 0.8)).toBe(true);
    expect(isFitted(1, 0.8)).toBe(false);
  });

  it('steps in from Fit to the first level clearly larger', () => {
    // 50% would be a step nobody could see.
    expect(zoomIn('fit', FIT)).toBe(0.67);
    expect(zoomIn(0.67, FIT)).toBe(0.75);
    expect(zoomIn(1, FIT)).toBe(1.25);
  });

  it('stops at the top level', () => {
    expect(zoomIn(2, FIT)).toBeNull();
    expect(zoomIn('fit', 1.9)).toBeNull();
  });

  it('steps out level by level, then back to Fit rather than a level barely larger', () => {
    expect(zoomOut(2, FIT)).toBe(1.5);
    expect(zoomOut(1, FIT)).toBe(0.75);
    expect(zoomOut(0.75, FIT)).toBe(0.67);
    expect(zoomOut(0.67, FIT)).toBe('fit');
  });

  it('has nothing to zoom out to while the slide is whole', () => {
    expect(zoomOut('fit', FIT)).toBeNull();
    expect(zoomOut(0.5, 0.8)).toBeNull();
  });

  it('comes back to Fit from every level, one Zoom Out at a time', () => {
    for (const level of ZOOM_LEVELS.filter((value) => value > FIT)) {
      let zoom: ReturnType<typeof zoomOut> = level;
      let steps = 0;
      while (zoom !== null && zoom !== 'fit' && steps < ZOOM_LEVELS.length) {
        zoom = zoomOut(zoom, FIT);
        steps += 1;
      }
      expect(zoom).toBe('fit');
    }
  });

  it('shows the level as a whole percentage', () => {
    expect(zoomLabel(0.4937)).toBe('49%');
    expect(zoomLabel(1)).toBe('100%');
    expect(zoomLabel(2)).toBe('200%');
  });
});

describe('zoomKeyOf', () => {
  const press = (key: string, patch: Partial<ZoomKeyPress> = {}): ZoomKeyPress => ({
    key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    ...patch,
  });

  it('zooms in on plus or equals, out on minus or underscore, and fits on 0', () => {
    expect(zoomKeyOf(press('+'))).toBe('in');
    expect(zoomKeyOf(press('='))).toBe('in');
    expect(zoomKeyOf(press('-'))).toBe('out');
    expect(zoomKeyOf(press('_'))).toBe('out');
    expect(zoomKeyOf(press('0'))).toBe('fit');
  });

  it("leaves the browser's own zoom keys to the browser", () => {
    for (const key of ['+', '=', '-', '0']) {
      expect(zoomKeyOf(press(key, { ctrlKey: true }))).toBeNull();
      expect(zoomKeyOf(press(key, { metaKey: true }))).toBeNull();
      expect(zoomKeyOf(press(key, { altKey: true }))).toBeNull();
    }
  });

  it("does not take the canvas's element keys or Undo", () => {
    for (const key of ['ArrowLeft', 'Delete', 'Backspace', 'Enter', 'Escape', 'z', 'y', '1']) {
      expect(zoomKeyOf(press(key))).toBeNull();
    }
  });
});

describe('scroll anchor', () => {
  it('keeps the middle of the view on the same point of the slide through a zoom', () => {
    // Zoomed to 1000 x 1000 in a 400 x 300 view, scrolled to show 300..700 across.
    const before = {
      scrollLeft: 300,
      scrollTop: 100,
      scrollWidth: 1000,
      scrollHeight: 1000,
      clientWidth: 400,
      clientHeight: 300,
    };
    const anchor = scrollAnchor(before);
    expect(anchor).toEqual({ x: 0.5, y: 0.25 });

    // Twice the size: the same point is now at 1000 across and 500 down.
    expect(
      scrollToAnchor(
        { scrollWidth: 2000, scrollHeight: 2000, clientWidth: 400, clientHeight: 300 },
        anchor,
      ),
    ).toEqual({ left: 800, top: 350 });
  });

  it('centres a slide that grows out of Fit', () => {
    const fitted = {
      scrollLeft: 0,
      scrollTop: 0,
      scrollWidth: 400,
      scrollHeight: 300,
      clientWidth: 400,
      clientHeight: 300,
    };

    expect(
      scrollToAnchor(
        { scrollWidth: 800, scrollHeight: 900, clientWidth: 400, clientHeight: 300 },
        scrollAnchor(fitted),
      ),
    ).toEqual({ left: 200, top: 300 });
  });

  it('never scrolls past either end', () => {
    expect(
      scrollToAnchor(
        { scrollWidth: 800, scrollHeight: 800, clientWidth: 400, clientHeight: 400 },
        { x: 0, y: 1 },
      ),
    ).toEqual({ left: 0, top: 400 });
  });
});

describe('endsTyping', () => {
  const press = (key: string, patch: Partial<TypingKeyPress> = {}): TypingKeyPress => ({
    key,
    ctrlKey: false,
    metaKey: false,
    isComposing: false,
    ...patch,
  });

  it('ends on Escape and on Ctrl or Cmd with Enter, on one line or many', () => {
    for (const multiline of [true, false]) {
      expect(endsTyping(press('Escape'), multiline)).toBe(true);
      expect(endsTyping(press('Enter', { ctrlKey: true }), multiline)).toBe(true);
      expect(endsTyping(press('Enter', { metaKey: true }), multiline)).toBe(true);
    }
  });

  it('ends on Enter alone only where Enter cannot start a new line', () => {
    expect(endsTyping(press('Enter'), false)).toBe(true);
    expect(endsTyping(press('Enter'), true)).toBe(false);
  });

  it('ends nothing while an input method composes, nor on any other key', () => {
    expect(endsTyping(press('Escape', { isComposing: true }), false)).toBe(false);
    expect(endsTyping(press('Enter', { keyCode: 229 }), false)).toBe(false);
    expect(endsTyping(press('a'), false)).toBe(false);
    expect(endsTyping(press('Tab'), false)).toBe(false);
  });
});
