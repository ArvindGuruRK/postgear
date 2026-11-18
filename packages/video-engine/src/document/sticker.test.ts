import { createClipDocument } from './create';
import { STICKER_SIZE_MIN } from './limits';
import { stickerItemSchema } from './schema';
import {
  BADGE,
  badgeLayout,
  badgeSmallLine,
  badgeWidth,
  DEFAULT_STICKER_MS,
  defaultBadgeItem,
  defaultStickerItem,
  isBadge,
  stickerFrameAt,
  stickerRefKey,
} from './sticker';

const VIDEO = '11111111-1111-4111-8111-111111111111';
const STICKER_ID = '22222222-2222-4222-8222-222222222222';
const CANVAS = { width: 1080, height: 1920 };

function clip(toMs = 30_000) {
  return createClipDocument({ videoId: VIDEO, fromMs: 0, toMs, ratio: '9:16' });
}

describe('the sticker item', () => {
  it('a tile adds a quarter-wide sticker in the picture shape, centred, three seconds, looping', () => {
    const item = defaultStickerItem(clip(), 4_000, { library: 'sticker', id: STICKER_ID }, { width: 512, height: 256 });
    expect(item).toMatchObject({
      type: 'sticker',
      start: 4_000,
      duration: DEFAULT_STICKER_MS,
      anchor: 'moment',
      ref: { library: 'sticker', id: STICKER_ID },
      transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1 },
      flipX: false,
      widthPx: 270,
      heightPx: 135,
      loop: true,
    });
    expect(stickerItemSchema.safeParse(item).success).toBe(true);
  });

  it('keeps a new sticker inside the clip, and never smaller than the smallest box', () => {
    const late = defaultStickerItem(clip(10_000), 9_500, { asset: STICKER_ID }, { width: 100, height: 1 });
    expect(late.start + late.duration).toBe(10_000);
    expect(late.heightPx).toBe(STICKER_SIZE_MIN);
  });

  it('keys a sticker file by where it comes from; the badge has no file', () => {
    expect(stickerRefKey({ library: 'sticker', id: STICKER_ID })).toBe(`library:${STICKER_ID}`);
    expect(stickerRefKey({ asset: STICKER_ID })).toBe(`asset:${STICKER_ID}`);
    expect(stickerRefKey({ badge: 'kick', name: 'me' })).toBeNull();
  });

  it('refuses a badge name that is empty, too long, has an emoji or a line break', () => {
    const base = defaultBadgeItem(clip(), 0, 'twitch', 'simstreamer', 400);
    const named = (name: string) =>
      stickerItemSchema.safeParse({ ...base, ref: { badge: 'twitch', name } }).success;
    expect(named('simstreamer')).toBe(true);
    expect(named('   ')).toBe(false);
    expect(named('x'.repeat(31))).toBe(false);
    expect(named('fire \u{1F525}')).toBe(false);
    expect(named('two\nlines')).toBe(false);
    expect(stickerItemSchema.safeParse({ ...base, ref: { badge: 'myspace', name: 'a' } }).success).toBe(false);
  });
});

describe('which frame a moving sticker shows', () => {
  const anim = { fps: 20, frames: 10 };

  it('steps a frame every 1/fps from the item start', () => {
    expect(stickerFrameAt(0, anim, true)).toBe(0);
    expect(stickerFrameAt(49, anim, true)).toBe(0);
    expect(stickerFrameAt(50, anim, true)).toBe(1);
    expect(stickerFrameAt(-200, anim, true)).toBe(0);
  });

  it('wraps when it loops and holds the last frame when it plays once', () => {
    expect(stickerFrameAt(500, anim, true)).toBe(0);
    expect(stickerFrameAt(575, anim, true)).toBe(1);
    expect(stickerFrameAt(500, anim, false)).toBe(9);
    expect(stickerFrameAt(9_000, anim, false)).toBe(9);
  });

  it('lands on the right frame at a boundary floating point misses (frame 3 at 150 ms, 20 fps)', () => {
    // 0.15 x 20 is 2.9999999999999996 in floating point.
    expect(stickerFrameAt(150, anim, true)).toBe(3);
  });

  it('shows frame 0 for a still picture', () => {
    expect(stickerFrameAt(1_234, { fps: 0, frames: 1 }, true)).toBe(0);
  });
});

describe('the Follow Badge', () => {
  it('names the platform in words and is as wide as its longest line', () => {
    expect(badgeSmallLine('youtube')).toBe('Follow On YouTube');
    expect(badgeWidth(100, 50)).toBe(BADGE.minWidth);
    expect(badgeWidth(260, 500.2)).toBe(Math.ceil(BADGE.textLeft + 500.2 + BADGE.padRight));
  });

  it('is a pill, a disc and a play mark, with two left-aligned lines in its own font', () => {
    const item = { ...defaultBadgeItem(clip(), 0, 'kick', ' simstreamer ', 500), id: 'stk_b' };
    expect(isBadge(item)).toBe(true);
    expect(item.ref).toEqual({ badge: 'kick', name: 'simstreamer' });
    const layout = badgeLayout(item, CANVAS);
    const [pill, disc, mark] = layout.shapes;
    // The pill is the whole badge, centred on the item.
    expect(pill).toMatchObject({ kind: 'pill', cx: 540, cy: 1536, width: 500, height: 140, radius: 70 });
    expect(pill?.opacity).toBeCloseTo(BADGE.fillOpacity, 6);
    // The disc sits 70 px in from the left edge (290), in Kick's colour with a dark mark.
    expect(disc).toMatchObject({ kind: 'disc', cx: 360, cy: 1536, width: 100, colour: '#53FC18' });
    expect(mark).toMatchObject({ kind: 'mark', colour: '#111111' });
    const [small, name] = layout.texts;
    expect(small).toMatchObject({ text: 'Follow On Kick', style: { font: 'Inter', weight: 600, align: 'left' } });
    expect(name).toMatchObject({ text: 'simstreamer', style: { font: 'Inter', weight: 800, align: 'left' } });
    // The lines' boxes start at the text's left edge (290 + 144) and end at the badge's right edge.
    const nameLeft = (name?.transform.x ?? 0) * 1080 - (name?.widthPx ?? 0) / 2;
    expect(nameLeft).toBeCloseTo(290 + BADGE.textLeft, 6);
    expect(nameLeft + (name?.widthPx ?? 0)).toBeCloseTo(790, 6);
  });

  it('turns and scales every part about the badge centre, and multiplies opacity through', () => {
    const base = { ...defaultBadgeItem(clip(), 0, 'twitch', 'me', 400), id: 'stk_b' };
    const item = { ...base, transform: { ...base.transform, scale: 2, rotation: 90, opacity: 0.5 } };
    const layout = badgeLayout(item, CANVAS);
    const disc = layout.shapes[1];
    // Upright, the disc is 130 px left of the centre; doubled and turned a quarter clockwise it is 260 px above.
    expect(disc?.cx).toBeCloseTo(540, 6);
    expect(disc?.cy).toBeCloseTo(1536 - 260, 6);
    expect(disc?.width).toBe(200);
    expect(disc?.rotationDeg).toBe(90);
    expect(disc?.opacity).toBe(0.5);
    expect(layout.texts[0]?.transform).toMatchObject({ scale: 2, rotation: 90 });
    expect(layout.texts[0]?.transform.opacity).toBeCloseTo(BADGE.small.opacity * 0.5, 6);
  });

  it('is nothing for a picture sticker', () => {
    const item = defaultStickerItem(clip(), 0, { asset: STICKER_ID }, { width: 1, height: 1 });
    expect(badgeLayout(item, CANVAS)).toEqual({ shapes: [], texts: [] });
  });
});
