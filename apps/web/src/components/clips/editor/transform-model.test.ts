import {
  type ClipDocument,
  createClipDocument,
  defaultBadgeItem,
  defaultStickerItem,
  defaultTextItem,
  type StickerItem,
  type TextItem,
} from '@postgear/video-engine';
import {
  centreToTransform,
  drawingOrder,
  estimatedTextHeight,
  hitTest,
  type ItemFrame,
  itemFrame,
  keepOnCanvas,
  moveFrame,
  NO_GUIDES,
  nudgeFrame,
  overlaysAt,
  rotateAbout,
  scaleFromCorner,
  screenToCanvas,
  snapRotation,
  stickerFrame,
  textFrame,
  toCanvas,
  widenFromSide,
} from './transform-model';

const VIDEO = '11111111-1111-4111-8111-111111111111';
const CANVAS = { width: 1080, height: 1920 };

function clip(): ClipDocument {
  return createClipDocument({ videoId: VIDEO, fromMs: 0, toMs: 30_000, ratio: '9:16' });
}

function text(
  id: string,
  start: number,
  duration: number,
  change: Partial<TextItem> = {},
): TextItem {
  return { ...defaultTextItem(clip(), start), id, start, duration, ...change };
}

function frame(change: Partial<ItemFrame> = {}): ItemFrame {
  return { id: 'a', cx: 500, cy: 500, width: 100, height: 50, rotation: 0, ...change };
}

const near = (a: number, b: number, places = 6) => expect(a).toBeCloseTo(b, places);

describe('what is on the stage', () => {
  it('shows the texts on screen at the playhead, in drawing order', () => {
    const doc: ClipDocument = {
      ...clip(),
      tracks: [
        { id: 'trk_1', kind: 'overlay', items: [text('a', 0, 2_000), text('b', 2_000, 2_000)] },
        { id: 'trk_2', kind: 'overlay', items: [text('c', 1_000, 3_000)] },
      ],
    };
    expect(overlaysAt(doc, 1_500).map((item) => item.id)).toEqual(['a', 'c']);
    // An item ends where the next begins: the later one shows.
    expect(overlaysAt(doc, 2_000).map((item) => item.id)).toEqual(['b', 'c']);
    expect(overlaysAt(doc, 4_000)).toEqual([]);
  });

  it('frames a text by its box width and its measured height', () => {
    const item = text('a', 0, 1_000, {
      transform: { x: 0.5, y: 0.25, scale: 2, rotation: 15, opacity: 1 },
      widthPx: 400,
    });
    const measured = textFrame(item, CANVAS, 300);
    expect(measured).toEqual({ id: 'a', cx: 540, cy: 480, width: 800, height: 300, rotation: 15 });
    // Before the preview measures, one line of the font at the item's size.
    const guessed = textFrame(item, CANVAS);
    expect(guessed.height).toBe(estimatedTextHeight(item));
    expect(guessed.height).toBeGreaterThan(item.style.size * 2);
  });
});

describe('hit-testing', () => {
  it('takes the topmost item under the pointer and nothing on empty space', () => {
    const below = frame({ id: 'below' });
    const above = frame({ id: 'above', cx: 540 });
    expect(hitTest([below, above], { x: 530, y: 500 })).toBe('above');
    expect(hitTest([below, above], { x: 460, y: 500 })).toBe('below');
    expect(hitTest([below, above], { x: 900, y: 900 })).toBeNull();
  });

  it('follows the turn: a corner of the upright box misses a turned one', () => {
    const turned = frame({ rotation: 90 });
    // Upright, (545, 520) is inside; turned a quarter, the box is 50 wide and 100 tall.
    expect(hitTest([frame()], { x: 545, y: 520 })).toBe('a');
    expect(hitTest([turned], { x: 545, y: 520 })).toBeNull();
    expect(hitTest([turned], { x: 520, y: 545 })).toBe('a');
  });
});

describe('moving', () => {
  const free = { snap: false, threshold: 10 };
  const snapping = { snap: true, threshold: 10 };

  it('moves by the pointer and snaps the centre to the canvas centre line', () => {
    const start = frame({ cx: 500, cy: 300 });
    expect(moveFrame(start, { x: 33, y: 0 }, CANVAS, [], free)).toEqual({
      cx: 533,
      cy: 300,
      guides: NO_GUIDES,
    });
    const snapped = moveFrame(start, { x: 33, y: 0 }, CANVAS, [], snapping);
    expect(snapped.cx).toBe(540);
    expect(snapped.guides.x).toEqual([540]);
  });

  it('snaps an edge to another item edge, and Alt (no snap) moves freely', () => {
    const other = frame({ id: 'b', cx: 800, cy: 1_000, width: 200, height: 100 });
    // The moving box's right edge (cx + 50) lands near the other's left edge (700).
    const start = frame({ cx: 600, cy: 1_300 });
    const snapped = moveFrame(start, { x: 46, y: 0 }, CANVAS, [other], snapping);
    expect(snapped.cx).toBe(650);
    expect(snapped.guides.x).toEqual([700]);
    expect(moveFrame(start, { x: 46, y: 0 }, CANVAS, [other], free).cx).toBe(646);
  });

  it('keeps at least a quarter of the item on the clip', () => {
    const start = frame({ cx: 100, cy: 100, width: 200, height: 100 });
    const far = moveFrame(start, { x: -5_000, y: -5_000 }, CANVAS, [], snapping);
    // A quarter of 200 wide is 50 on the clip: the centre stops 50 px left of the edge.
    expect(far).toEqual({ cx: -50, cy: -25, guides: { x: [], y: [] } });
    expect(keepOnCanvas(5_000, 5_000, start, CANVAS)).toEqual({ x: 1_130, y: 1_945 });
  });

  it('nudges by a pixel, or ten with Shift', () => {
    expect(nudgeFrame(frame(), { x: 1, y: 0 }, false, CANVAS)).toEqual({ x: 501, y: 500 });
    expect(nudgeFrame(frame(), { x: 0, y: -1 }, true, CANVAS)).toEqual({ x: 500, y: 490 });
  });
});

describe('corner and side handles', () => {
  it('scales about the opposite corner, keeping the shape', () => {
    const start = frame();
    // nw corner (450, 475) stays; se dragged from (550, 525) to (600, 550) is 1.5 times.
    const result = scaleFromCorner(start, 'se', { x: 600, y: 550 }, 1);
    expect(result.scale).toBe(1.5);
    const after = { ...start, cx: result.cx, cy: result.cy, width: 150, height: 75 };
    const nw = toCanvas(after, { x: -75, y: -37.5 });
    near(nw.x, 450);
    near(nw.y, 475);
  });

  it('keeps the opposite corner still on a turned item too', () => {
    const start = frame({ rotation: 90 });
    const fixed = toCanvas(start, { x: 50, y: -25 });
    const result = scaleFromCorner(start, 'sw', { x: 400, y: 300 }, 2);
    const k = result.scale / 2;
    const after = { ...start, cx: result.cx, cy: result.cy, width: 100 * k, height: 50 * k };
    const ne = toCanvas(after, { x: (100 * k) / 2, y: (-50 * k) / 2 });
    near(ne.x, fixed.x);
    near(ne.y, fixed.y);
  });

  it('never scales below the smallest scale', () => {
    expect(scaleFromCorner(frame(), 'se', { x: 300, y: 300 }, 1).scale).toBe(0.1);
  });

  it('widens a text box about the opposite side', () => {
    const start = frame({ width: 400 });
    // The west edge (300) stays; the east edge goes to 800.
    const result = widenFromSide(start, 'e', { x: 800, y: 520 }, 2);
    expect(result).toEqual({ widthPx: 250, cx: 550, cy: 500 });
    // Never narrower than the smallest box.
    expect(widenFromSide(start, 'e', { x: 0, y: 500 }, 1).widthPx).toBe(40);
  });
});

describe('turning', () => {
  it('turns by the angle swept about the centre, clockwise positive', () => {
    const centre = { x: 0, y: 0 };
    // From straight above to the right is a quarter turn clockwise on screen.
    expect(rotateAbout(centre, 0, { x: 0, y: -10 }, { x: 10, y: 0 }, false)).toBe(90);
    expect(rotateAbout(centre, 30, { x: 0, y: -10 }, { x: -10, y: 0 }, false)).toBe(-60);
  });

  it('snaps to a quarter turn within 5 degrees, unless Alt is held', () => {
    expect(snapRotation(3)).toBe(0);
    expect(snapRotation(-4.9)).toBe(0);
    expect(snapRotation(87)).toBe(90);
    expect(snapRotation(-178)).toBe(180);
    expect(snapRotation(185)).toBe(180);
    expect(snapRotation(-92)).toBe(-90);
    expect(snapRotation(10)).toBe(10);
    const centre = { x: 0, y: 0 };
    const nearly = { x: Math.cos((-87 * Math.PI) / 180), y: Math.sin((-87 * Math.PI) / 180) };
    expect(rotateAbout(centre, 0, { x: 1, y: 0 }, nearly, true)).toBe(-90);
    expect(rotateAbout(centre, 0, { x: 1, y: 0 }, nearly, false)).toBe(-87);
  });
});

describe('screen and document', () => {
  it('divides pointer movement by the stage scale', () => {
    // A 1080 wide canvas drawn 324 px wide: one screen pixel is 1/0.3 canvas pixels.
    const point = screenToCanvas({ x: 130, y: 70 }, { x: 100, y: 40 }, 0.3);
    near(point.x, 100);
    near(point.y, 100);
  });

  it('writes the centre back as fractions of the canvas', () => {
    expect(centreToTransform(540, 480, CANVAS)).toEqual({ x: 0.5, y: 0.25 });
  });
});

describe('sticker frames and drawing order', () => {
  const STAR = '5c0e8a52-0000-4000-8000-000000000001';

  function picture(id: string, change: Partial<StickerItem> = {}): StickerItem {
    return {
      ...defaultStickerItem(
        clip(),
        0,
        { library: 'sticker', id: STAR },
        { width: 200, height: 100 },
      ),
      id,
      ...change,
    };
  }

  it('a sticker frame is its box times its scale, centred on the item', () => {
    const item = picture('stk_a', {
      transform: { x: 0.25, y: 0.5, scale: 2, rotation: 30, opacity: 1 },
    });
    expect(stickerFrame(item, CANVAS)).toEqual({
      id: 'stk_a',
      cx: 270,
      cy: 960,
      width: 540,
      height: 270,
      rotation: 30,
    });
    expect(itemFrame(item, CANVAS)).toEqual(stickerFrame(item, CANVAS));
  });

  it('draws picture stickers under texts and badges, so a press picks the text on top', () => {
    const badge: StickerItem = {
      ...defaultBadgeItem(clip(), 0, 'youtube', 'Night Owl', 400),
      id: 'stk_badge',
    };
    const words = text('txt_a', 0, 3_000);
    const under = picture('stk_pic');
    // In track order the picture comes after the text; it is still drawn first.
    const order = drawingOrder([words, under, badge]).map((item) => item.id);
    expect(order).toEqual(['stk_pic', 'txt_a', 'stk_badge']);

    // The picture moved under the text: a press on the text's centre picks the text.
    const covered = picture('stk_pic', { transform: { ...words.transform } });
    const frames = drawingOrder([words, covered]).map((item) => itemFrame(item, CANVAS));
    const centre = textFrame(words, CANVAS);
    expect(hitTest(frames, { x: centre.cx, y: centre.cy })).toBe('txt_a');
    // Drawn the other way round, the picture would have won: the order is what decides.
    expect(hitTest([...frames].reverse(), { x: centre.cx, y: centre.cy })).toBe('stk_pic');
  });
});
