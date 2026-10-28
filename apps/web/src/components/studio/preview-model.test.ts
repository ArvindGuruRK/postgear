import {
  addSlide,
  blankDocument,
  MAX_CAPTION_LENGTH,
  setCaption,
  updateElement,
} from '@postgear/design-engine';
import {
  CAPTION_FOLDS,
  captionCount,
  captionTooLong,
  clampIndex,
  dragOffset,
  drawnAround,
  EDGE_RESISTANCE,
  expiryLine,
  frameWidth,
  SHARE_UNAVAILABLE,
  sameSlides,
  shareProblem,
  slideWords,
  swipeAxis,
  swipeTarget,
} from './preview-model';

function sorted(set: ReadonlySet<number>): number[] {
  return [...set].sort((a, b) => a - b);
}

describe('clampIndex', () => {
  it('keeps an index inside the design', () => {
    expect(clampIndex(2, 5)).toBe(2);
    expect(clampIndex(-1, 5)).toBe(0);
    expect(clampIndex(9, 5)).toBe(4);
    expect(clampIndex(1.7, 5)).toBe(1);
  });

  it('is the first slide for an empty design or an index that is not a number', () => {
    expect(clampIndex(3, 0)).toBe(0);
    expect(clampIndex(Number.NaN, 4)).toBe(0);
  });
});

describe('drawnAround', () => {
  it('draws the slide on show and both of its neighbours', () => {
    expect(sorted(drawnAround(new Set(), 2, 6))).toEqual([1, 2, 3]);
  });

  it('stays inside the design at either end', () => {
    expect(sorted(drawnAround(new Set(), 0, 3))).toEqual([0, 1]);
    expect(sorted(drawnAround(new Set(), 2, 3))).toEqual([1, 2]);
    expect(sorted(drawnAround(new Set(), 0, 1))).toEqual([0]);
  });

  it('keeps what was drawn, and skips the slides a jump passes over', () => {
    const opened = drawnAround(new Set(), 0, 10);
    expect(sorted(drawnAround(opened, 7, 10))).toEqual([0, 1, 6, 7, 8]);
  });

  it('returns the same set when nothing new is needed', () => {
    const drawn = drawnAround(new Set(), 3, 8);
    expect(drawnAround(drawn, 3, 8)).toBe(drawn);
    expect(drawnAround(drawn, 2, 8)).not.toBe(drawn);
  });
});

describe('sameSlides', () => {
  const design = blankDocument({ format: 'square', newId: () => 's1' });

  it('ignores a new caption', () => {
    expect(sameSlides(design, setCaption(design, 'A caption'))).toBe(true);
  });

  it('sees a change to the slides, the theme or the handle', () => {
    expect(sameSlides(design, updateElement(design, 's1', 'headline', { text: 'Fresh' }))).toBe(
      false,
    );
    expect(sameSlides(design, { ...design, themeId: 'another-theme' })).toBe(false);
    expect(sameSlides(design, { ...design, handle: '@acme' })).toBe(false);
  });
});

describe('frameWidth', () => {
  it('keeps a slide within two thirds of the screen', () => {
    expect(frameWidth('square')).toBe('min(100%, 30rem, 65svh)');
    expect(frameWidth('portrait')).toBe('min(100%, 30rem, 52svh)');
    expect(frameWidth('story')).toBe('min(100%, 30rem, 36.56svh)');
  });

  it('gives a landscape slide a wider frame', () => {
    expect(frameWidth('landscape')).toBe('min(100%, 36rem, 115.56svh)');
  });
});

describe('slideWords', () => {
  const design = updateElement(
    updateElement(
      blankDocument({ format: 'square', handle: '@acme', newId: () => 's1' }),
      's1',
      'headline',
      { text: 'Big news' },
    ),
    's1',
    'body',
    { text: '  More detail here.  ' },
  );

  it('reads the words a slide shows, in its layout order', () => {
    const shown = updateElement(design, 's1', 'handle', { hidden: false });
    expect(slideWords(shown, 0)).toEqual(['Big news', 'More detail here.', '@acme']);
  });

  it('leaves out hidden elements', () => {
    const hidden = updateElement(design, 's1', 'handle', { hidden: true });
    expect(slideWords(hidden, 0)).not.toContain('@acme');
  });

  it('leaves out the counted slide number', () => {
    const layoutId = design.slides[0].layoutId;
    const two = addSlide(design, { layoutId, after: 's1', newId: () => 's2' });
    const numbered = updateElement(two, 's1', 'pageNumber', { hidden: false });
    expect(slideWords(numbered, 0)).not.toContain('1/2');
  });

  it('reads nothing for a slide that is not there', () => {
    expect(slideWords(design, 5)).toEqual([]);
  });
});

describe('swipeAxis', () => {
  it('waits until the pointer has moved far enough to tell', () => {
    expect(swipeAxis(3, -4)).toBeNull();
  });

  it('tells sideways from up and down', () => {
    expect(swipeAxis(-12, 5)).toBe('x');
    expect(swipeAxis(4, 15)).toBe('y');
  });
});

describe('dragOffset', () => {
  it('follows the finger between the ends', () => {
    expect(dragOffset(-50, 1, 3, 300)).toBe(-50);
    expect(dragOffset(50, 1, 3, 300)).toBe(50);
  });

  it('gives way slowly past the first and the last slide', () => {
    expect(dragOffset(100, 0, 3, 300)).toBeCloseTo(100 * EDGE_RESISTANCE);
    expect(dragOffset(-100, 2, 3, 300)).toBeCloseTo(-100 * EDGE_RESISTANCE);
    expect(dragOffset(-100, 0, 3, 300)).toBe(-100);
  });

  it('never moves the slides more than a slide', () => {
    expect(dragOffset(-900, 1, 3, 300)).toBe(-300);
  });
});

describe('swipeTarget', () => {
  it('turns to the next slide after a long drag left, and back after one right', () => {
    expect(swipeTarget(1, 4, -90, 600, 300)).toBe(2);
    expect(swipeTarget(1, 4, 90, 600, 300)).toBe(0);
  });

  it('stays after a short, slow drag', () => {
    expect(swipeTarget(1, 4, -30, 600, 300)).toBe(1);
  });

  it('turns after a quick flick, however short', () => {
    expect(swipeTarget(1, 4, -24, 40, 300)).toBe(2);
  });

  it('does not take a small wobble for a flick', () => {
    expect(swipeTarget(1, 4, -10, 5, 300)).toBe(1);
  });

  it('never goes past either end', () => {
    expect(swipeTarget(3, 4, -200, 300, 300)).toBe(3);
    expect(swipeTarget(0, 4, 200, 300, 300)).toBe(0);
  });
});

describe('captionCount', () => {
  const instagram = { maxLength: 2200, lengthMethod: 'utf16' } as const;

  it('counts against the platform limit', () => {
    expect(captionCount('Hello', instagram)).toEqual({
      used: 5,
      limit: 2200,
      over: false,
      text: '5 / 2,200',
    });
  });

  it('is over once the caption passes the limit', () => {
    expect(captionCount('a'.repeat(2200), instagram).over).toBe(false);
    expect(captionCount('a'.repeat(2201), instagram).over).toBe(true);
  });

  it("counts X's way, where a link is always 23", () => {
    const x = { maxLength: 280, lengthMethod: 'x-weighted' } as const;
    expect(captionCount('See https://example.com/a/very/long/path/indeed', x).used).toBe(27);
  });

  it("shows Studio's own limit when the platform takes more", () => {
    expect(captionCount('Hi', { maxLength: 63_206, lengthMethod: 'utf16' }).limit).toBe(
      MAX_CAPTION_LENGTH,
    );
  });

  it("counts against Studio's limit when there is no platform", () => {
    expect(captionCount('Hi', null)).toMatchObject({
      used: 2,
      limit: MAX_CAPTION_LENGTH,
      over: false,
    });
  });
});

describe('captionTooLong', () => {
  it('says what is wrong and what to do', () => {
    expect(captionTooLong('X', 280)).toBe(
      'This caption is too long for X, which takes up to 280 characters. Shorten it before you post there.',
    );
  });
});

describe('CAPTION_FOLDS', () => {
  it('folds where the composer previews fold', () => {
    expect(CAPTION_FOLDS.instagram?.after).toBe(125);
    expect(CAPTION_FOLDS.linkedin?.after).toBe(210);
    expect(CAPTION_FOLDS.facebook?.after).toBe(480);
    expect(CAPTION_FOLDS.x).toBeUndefined();
  });
});

describe('shareProblem', () => {
  it('reads every dead link the same', () => {
    expect(shareProblem(404)).toBe('gone');
    expect(shareProblem(410)).toBe('gone');
    expect(shareProblem(400)).toBe('gone');
  });

  it('offers another try when the API was away or failed', () => {
    expect(shareProblem(null)).toBe('failed');
    expect(shareProblem(0)).toBe('failed');
    expect(shareProblem(429)).toBe('failed');
    expect(shareProblem(500)).toBe('failed');
    expect(shareProblem(503)).toBe('failed');
  });

  it('says exactly what the stories say', () => {
    expect(SHARE_UNAVAILABLE).toBe('This link is no longer available.');
  });
});

describe('expiryLine', () => {
  it('names the day the link stops working, by the UTC calendar on the server', () => {
    expect(expiryLine('2026-11-03T14:00:00.000Z', 'UTC')).toBe(
      'This link expires on 3 November 2026.',
    );
    expect(expiryLine('2026-11-03T23:30:00.000Z', 'UTC')).toBe(
      'This link expires on 3 November 2026.',
    );
  });

  it("names the reader's own day, which can be the day before or after the UTC one", () => {
    expect(expiryLine('2026-11-04T00:30:00.000Z', 'America/Los_Angeles')).toBe(
      'This link expires on 3 November 2026.',
    );
    expect(expiryLine('2026-11-03T20:00:00.000Z', 'Asia/Kolkata')).toBe(
      'This link expires on 4 November 2026.',
    );
  });

  it('says nothing for a date it cannot read', () => {
    expect(expiryLine('not a date')).toBeNull();
  });
});
