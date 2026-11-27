/**
 * The brand kit on a clip (Sprint 13, Module 10): each part, each part off,
 * applying twice, removing it again, captions and bleeps skipping the intro
 * and outro, the logo inside the margins on every shape, and items moving
 * by the intro's length.
 */
import { RATIOS } from '../canvas';
import { captionWords, clipSourceRanges } from '../captions/map';
import { createCaptionsTrack } from '../captions/track';
import { safeAreaGuide } from '../captions/safe-area';
import { builtInCaptionStyle } from '../captions/styles';
import { addHookTitle } from '../effects/hook';
import { clipDocumentSchema, type ClipDocument, type StickerItem } from '../document/schema';
import { setCanvasRatio } from '../layout/edit';
import { bleepRanges } from '../render/bleep-plan';
import { buildRenderPlan } from '../render/plan';
import { frameState } from '../render/frame-state';
import {
  testContext,
  testDocument,
  testSegment,
  testSource,
  testSticker,
  testText,
} from '../render/test-docs';
import { outputDuration } from '../time/time-map';
import {
  applyBrandKit,
  BRAND_LOGO_MARGIN_SHARE,
  brandLogoBox,
  brandPartsOf,
  brandSourceId,
  removeBrandKit,
  setBrandPart,
} from './apply';
import { type ClipBrandKit, LOGO_POSITIONS } from './types';

const KIT_ID = '1b2c3d4e-5f60-4718-9a2b-3c4d5e6f7081';
const LOGO_ID = '2c3d4e5f-6071-4829-8b3c-4d5e6f708192';
const INTRO_ID = '3d4e5f60-7182-493a-9c4d-5e6f708192a3';
const OUTRO_ID = '4e5f6071-8293-4a4b-8d5e-6f708192a3b4';
const TRANSCRIPT_ID = '5f607182-93a4-4b5c-9e6f-708192a3b4c5';

function kit(overrides: Partial<ClipBrandKit> = {}): ClipBrandKit {
  return {
    id: KIT_ID,
    name: 'Acme',
    logo: { assetId: LOGO_ID, width: 400, height: 200 },
    logoPosition: 'top-right',
    captionStyleId: 'bold-pop',
    intro: { videoId: INTRO_ID, durationMs: 3_000, width: 1280, height: 720 },
    outro: { kind: 'card', text: 'Follow for more', background: '#101820', colour: '#ffd43b' },
    ...overrides,
  };
}

/** A 10 s clip of source 20 to 30 s with a clip item, a moment item and a Whole Clip item. */
function clip(): ClipDocument {
  const base = testDocument([testSegment('body', 20_000, 30_000)]);
  return {
    ...base,
    tracks: [
      {
        id: 'ov',
        kind: 'overlay',
        items: [
          testText('clip_text', { anchor: 'clip', start: 1_000, duration: 2_000 }),
          testSticker('moment_sticker', { anchor: 'moment', start: 4_000, duration: 1_000 }),
        ],
      },
      {
        id: 'ov2',
        kind: 'overlay',
        items: [testText('whole', { anchor: 'clip', start: 0, duration: 10_000 })],
      },
    ],
    bleeps: [{ id: 'blp', source: 'src', from: 21_000, to: 21_400, mode: 'bleep' }],
  };
}

function withCaptions(doc: ClipDocument): ClipDocument {
  const look = builtInCaptionStyle('clean')?.look;
  if (!look) throw new Error('no clean style');
  const track = createCaptionsTrack({
    transcriptAssetId: TRANSCRIPT_ID,
    language: 'en',
    styleId: 'clean',
    look,
  });
  return { ...doc, tracks: [...doc.tracks, track] };
}

function logoOf(doc: ClipDocument): StickerItem | null {
  for (const track of doc.tracks) {
    if (track.kind !== 'overlay') continue;
    for (const item of track.items) if (item.type === 'sticker' && item.brand) return item;
  }
  return null;
}

function itemStart(doc: ClipDocument, id: string): number | null {
  for (const track of doc.tracks) {
    if (track.kind === 'captions') continue;
    for (const item of track.items) if (item.id === id) return item.start;
  }
  return null;
}

function itemDuration(doc: ClipDocument, id: string): number | null {
  for (const track of doc.tracks) {
    if (track.kind === 'captions') continue;
    for (const item of track.items) if (item.id === id) return item.duration;
  }
  return null;
}

describe('applyBrandKit', () => {
  const doc = clip();
  const branded = applyBrandKit(doc, kit());

  it('makes a valid document and records the kit', () => {
    expect(clipDocumentSchema.safeParse(branded).success).toBe(true);
    expect(branded.brandKitId).toBe(KIT_ID);
    expect(brandPartsOf(branded)).toEqual({ kitId: KIT_ID, logo: true, intro: true, outro: true });
  });

  it('plays the intro first, from its own source with its own cover layout', () => {
    const first = branded.segments[0];
    expect(first).toMatchObject({
      role: 'intro',
      source: brandSourceId(INTRO_ID),
      sourceIn: 0,
      sourceOut: 3_000,
      speed: 1,
      volume: 1,
    });
    expect(first?.layoutOverride?.areas[0]).toMatchObject({
      frame: { x: 0, y: 0, w: 1, h: 1 },
      fit: 'cover',
      crop: [{ at: 0, rect: { x: 0, y: 0, w: 1, h: 1 } }],
    });
    expect(branded.sources).toContainEqual({ id: brandSourceId(INTRO_ID), videoId: INTRO_ID });
    expect(outputDuration(branded)).toBe(13_000);
  });

  it('moves clip items by the intro, moment items with their video, Whole Clip items stay whole', () => {
    expect(itemStart(branded, 'clip_text')).toBe(4_000);
    expect(itemStart(branded, 'moment_sticker')).toBe(7_000);
    expect(itemStart(branded, 'whole')).toBe(0);
    expect(itemDuration(branded, 'whole')).toBe(13_000);
  });

  it('moves a hook title with the clip, so it stays over the hook after the intro', () => {
    const titled = addHookTitle(doc, 'Wait for it', 'hook-bold');
    const result = applyBrandKit(titled, kit());
    const title = result.tracks
      .flatMap((track) => (track.kind === 'overlay' ? track.items : []))
      .find((item) => item.type === 'text' && item.hookTitle);
    expect(title?.start).toBe(3_000);
    expect(removeBrandKit(result)).toEqual(titled);
  });

  it('adds the outro card in the kit colours with its logo and line', () => {
    expect(branded.cards).toEqual({
      closing: {
        text: 'Follow for more',
        background: '#101820',
        colour: '#FFD43B',
        logo: { asset: LOGO_ID },
        look: null,
        durationMs: 2_000,
      },
    });
  });

  it('adds an outro video as the last part', () => {
    const result = applyBrandKit(doc, {
      ...kit(),
      outro: {
        kind: 'video',
        video: { videoId: OUTRO_ID, durationMs: 2_500, width: 720, height: 1280 },
      },
    });
    expect(clipDocumentSchema.safeParse(result).success).toBe(true);
    expect(result.segments.at(-1)).toMatchObject({
      role: 'outro',
      source: brandSourceId(OUTRO_ID),
    });
    expect(result.cards).toBeUndefined();
    expect(outputDuration(result)).toBe(15_500);
    // The clip item does not move for an outro; the Whole Clip one grows.
    expect(itemStart(result, 'clip_text')).toBe(4_000);
    expect(itemDuration(result, 'whole')).toBe(15_500);
    expect(removeBrandKit(result)).toEqual(doc);
  });

  it('puts the logo over the whole clip, small, in its corner, as the kit logo asset', () => {
    const logo = logoOf(branded);
    expect(logo).toMatchObject({
      ref: { asset: LOGO_ID },
      brand: true,
      anchor: 'clip',
      start: 0,
      duration: 13_000,
      widthPx: 151,
      heightPx: 76,
    });
    expect(logo?.transform.x).toBeGreaterThan(0.5);
    expect(logo?.transform.y).toBeLessThan(0.5);
  });

  it('switches each part off on its own', () => {
    const noLogo = applyBrandKit(doc, kit(), { logo: false });
    expect(brandPartsOf(noLogo)).toEqual({ kitId: KIT_ID, logo: false, intro: true, outro: true });
    const noIntro = applyBrandKit(doc, kit(), { intro: false });
    expect(brandPartsOf(noIntro)).toEqual({ kitId: KIT_ID, logo: true, intro: false, outro: true });
    expect(itemStart(noIntro, 'clip_text')).toBe(1_000);
    const noOutro = applyBrandKit(doc, kit(), { outro: false });
    expect(brandPartsOf(noOutro)).toEqual({ kitId: KIT_ID, logo: true, intro: true, outro: false });
    expect(noOutro.cards).toBeUndefined();
    const none = applyBrandKit(doc, kit(), {
      logo: false,
      intro: false,
      outro: false,
      captions: false,
    });
    expect(none).toEqual({ ...doc, brandKitId: KIT_ID });
  });

  it('keeps a readable kit id (a kit seeded by hand), and the document still reads', () => {
    const seeded = applyBrandKit(doc, { ...kit(), id: 'seed-brand-kit-lotus' });
    expect(seeded.brandKitId).toBe('seed-brand-kit-lotus');
    expect(clipDocumentSchema.parse(seeded).brandKitId).toBe('seed-brand-kit-lotus');
  });

  it('leaves out what the kit does not have', () => {
    const bare = applyBrandKit(doc, kit({ logo: null, intro: null, outro: null }));
    expect(bare).toEqual({ ...doc, brandKitId: KIT_ID });
    const noCorner = applyBrandKit(doc, kit({ logoPosition: null }));
    expect(logoOf(noCorner)).toBeNull();
    // An outro card with no line and no logo is no card.
    const empty = applyBrandKit(
      doc,
      kit({
        logo: null,
        outro: { kind: 'card', text: '  ', background: '#000000', colour: '#FFFFFF' },
      }),
    );
    expect(empty.cards).toBeUndefined();
  });

  it('gives the same document when the same kit is applied again', () => {
    expect(applyBrandKit(branded, kit())).toEqual(branded);
    const captioned = applyBrandKit(withCaptions(doc), kit());
    expect(applyBrandKit(captioned, kit())).toEqual(captioned);
  });

  it('gives back the document exactly when the kit is removed', () => {
    expect(removeBrandKit(branded)).toEqual(doc);
    expect(removeBrandKit(doc)).toBe(doc);
  });

  it('sets the kit caption style when the clip has captions and the part is on', () => {
    const captioned = withCaptions(doc);
    const styled = applyBrandKit(captioned, kit());
    const track = styled.tracks.find((t) => t.kind === 'captions');
    expect(track && track.kind === 'captions' ? track.styleId : null).toBe('bold-pop');
    const kept = applyBrandKit(captioned, kit(), { captions: false });
    const keptTrack = kept.tracks.find((t) => t.kind === 'captions');
    expect(keptTrack && keptTrack.kind === 'captions' ? keptTrack.styleId : null).toBe('clean');
    // A style that is gone keeps the clip's.
    const gone = applyBrandKit(captioned, kit(), {}, { captionLook: () => null });
    const goneTrack = gone.tracks.find((t) => t.kind === 'captions');
    expect(goneTrack && goneTrack.kind === 'captions' ? goneTrack.styleId : null).toBe('clean');
    // No captions: nothing is added.
    expect(applyBrandKit(doc, kit()).tracks.some((t) => t.kind === 'captions')).toBe(false);
  });
});

describe('setBrandPart', () => {
  const doc = clip();
  const branded = applyBrandKit(doc, kit());

  it('switches one part off and on again, keeping the others', () => {
    const off = setBrandPart(branded, kit(), 'intro', false);
    expect(brandPartsOf(off)).toEqual({ kitId: KIT_ID, logo: true, intro: false, outro: true });
    expect(logoOf(off)?.duration).toBe(10_000);
    expect(setBrandPart(off, kit(), 'intro', true)).toEqual(branded);
    const noLogo = setBrandPart(branded, kit(), 'logo', false);
    expect(logoOf(noLogo)).toBeNull();
    expect(setBrandPart(noLogo, kit(), 'logo', true)).toEqual(branded);
    const noOutro = setBrandPart(branded, kit(), 'outro', false);
    expect(noOutro.cards).toBeUndefined();
    expect(setBrandPart(noOutro, kit(), 'outro', true)).toEqual(branded);
  });
});

describe('captions and bleeps skip the intro and outro', () => {
  // The intro video's source time (0 to 3 s) overlaps words of the main video's transcript.
  const transcript = {
    words: [
      { i: 0, start: 500, end: 900, text: 'intro', sure: 1 },
      { i: 1, start: 1_200, end: 1_600, text: 'time', sure: 1 },
      { i: 2, start: 21_000, end: 21_400, text: 'main', sure: 1 },
      { i: 3, start: 22_000, end: 22_300, text: 'words', sure: 1 },
    ],
  };
  const doc = applyBrandKit(withCaptions(clip()), {
    ...kit(),
    outro: {
      kind: 'video',
      video: { videoId: OUTRO_ID, durationMs: 2_000, width: 720, height: 1280 },
    },
  });

  it('maps words only for the clip, even without naming the source', () => {
    const track = doc.tracks.find((t) => t.kind === 'captions');
    if (track?.kind !== 'captions') throw new Error('no captions');
    const words = captionWords(doc, track, transcript);
    expect(words.map((w) => [w.text, w.start])).toEqual([
      ['m***', 4_000],
      ['words', 5_000],
    ]);
    expect(clipSourceRanges(doc)).toEqual([{ fromMs: 20_000, toMs: 30_000 }]);
  });

  it('bleeps the main video at its new place and never the intro or outro', () => {
    expect(bleepRanges(doc).map((b) => [b.fromMs, b.toMs])).toEqual([[4_000, 4_400]]);
    // A bleep on an intro source (as a montage could hold) is still skipped on the brand part.
    const odd: ClipDocument = {
      ...doc,
      bleeps: [
        ...doc.bleeps,
        { id: 'blp_intro', source: brandSourceId(INTRO_ID), from: 100, to: 400, mode: 'mute' },
      ],
    };
    expect(bleepRanges(odd).map((b) => b.id)).toEqual(['blp']);
  });
});

describe('the logo inside the margins on every shape', () => {
  it.each(RATIOS.flatMap((ratio) => LOGO_POSITIONS.map((position) => [ratio, position] as const)))(
    '%s %s',
    (ratio, position) => {
      const base = testDocument([testSegment('body', 0, 10_000)]);
      const shaped = setCanvasRatio(base, ratio, { width: 1920, height: 1080 });
      const doc = applyBrandKit(shaped, kit({ logoPosition: position, intro: null, outro: null }));
      expect(clipDocumentSchema.safeParse(doc).success).toBe(true);
      const logo = logoOf(doc) as StickerItem;
      const W = doc.canvas.width;
      const H = doc.canvas.height;
      const w = logo.widthPx / W;
      const h = logo.heightPx / H;
      const box = { x: logo.transform.x - w / 2, y: logo.transform.y - h / 2, w, h };
      const guide = safeAreaGuide(ratio);
      const margin = BRAND_LOGO_MARGIN_SHARE * Math.min(W, H);
      const safe = guide
        ? guide.safe
        : { x: margin / W, y: margin / H, w: 1 - (2 * margin) / W, h: 1 - (2 * margin) / H };
      const eps = 1.5 / Math.min(W, H);
      expect(box.x).toBeGreaterThanOrEqual(safe.x - eps);
      expect(box.y).toBeGreaterThanOrEqual(safe.y - eps);
      expect(box.x + box.w).toBeLessThanOrEqual(safe.x + safe.w + eps);
      expect(box.y + box.h).toBeLessThanOrEqual(safe.y + safe.h + eps);
      // It is in its own corner: touching the two margins it names.
      const left = position.endsWith('left');
      const top = position.startsWith('top');
      expect(
        Math.abs((left ? box.x : box.x + box.w) - (left ? safe.x : safe.x + safe.w)),
      ).toBeLessThan(eps);
      expect(
        Math.abs((top ? box.y : box.y + box.h) - (top ? safe.y : safe.y + safe.h)),
      ).toBeLessThan(eps);
      // About 14 percent of the short side wide, in the picture's own shape.
      expect(logo.widthPx).toBe(Math.round(0.14 * Math.min(W, H)));
      expect(brandLogoBox(doc.canvas, { width: 400, height: 200 }, position).w).toBeCloseTo(w, 2);
    },
  );
});

describe('the intro after a shape change', () => {
  it('is cover-fitted to the new shape (its crop is the whole video)', () => {
    const base = testDocument([testSegment('body', 20_000, 30_000)]);
    // A vertical 720 by 1280 intro on a 9:16 clip, then the clip turned Horizontal.
    const branded = applyBrandKit(
      base,
      kit({
        intro: { videoId: INTRO_ID, durationMs: 3_000, width: 720, height: 1280 },
        outro: null,
        logo: null,
      }),
    );
    const wide = setCanvasRatio(branded, '16:9', { width: 1920, height: 1080 });
    expect(wide.segments[0]?.layoutOverride).toEqual(branded.segments[0]?.layoutOverride);
    const introAsset = testSource({
      file: 'intro.mp4',
      durationMs: 3_000,
      width: 720,
      height: 1280,
    });
    const sources = { src: testSource(), [brandSourceId(INTRO_ID)]: introAsset };
    const plan = buildRenderPlan(wide, testContext({ assets: { sources } }));
    const intro = plan.segments[0];
    // The full width of the vertical video, a 16:9 band of it, centred.
    expect(intro?.picture.areas[0]).toMatchObject({
      crop: { x: 0, y: 438, w: 720, h: 406 },
      width: 1920,
      height: 1080,
      x: 0,
      y: 0,
    });
    expect(intro?.picture.fillsOutput).toBe(true);
    // And the preview's state agrees: the same cover fit.
    const state = frameState(wide, 1_000, {
      sources: { [brandSourceId(INTRO_ID)]: { width: 720, height: 1280, fps: 30 } },
    });
    expect(state.areas[0]?.visibleCrop.w).toBeCloseTo(1, 6);
    // 16:9 of a 9:16 picture: (9 / 16) / (16 / 9) of its height.
    expect(state.areas[0]?.visibleCrop.h).toBeCloseTo(81 / 256, 6);
  });
});

describe('the schema keeps brand parts at the ends', () => {
  const branded = applyBrandKit(clip(), kit({ outro: null, logo: null }));

  it('refuses an intro that is not at the start, or one longer than 5 s', () => {
    const [intro, ...rest] = branded.segments;
    const moved = { ...branded, segments: [...rest, intro as NonNullable<typeof intro>] };
    expect(clipDocumentSchema.safeParse(moved).success).toBe(false);
    const long = {
      ...branded,
      segments: [{ ...(intro as NonNullable<typeof intro>), sourceOut: 5_500 }, ...rest],
    };
    expect(clipDocumentSchema.safeParse(long).success).toBe(false);
  });

  it('accepts a hook before or after the intro', () => {
    const [intro, body] = branded.segments as [
      NonNullable<(typeof branded.segments)[0]>,
      NonNullable<(typeof branded.segments)[0]>,
    ];
    const hook = { ...testSegment('hook_0', 21_000, 23_000), role: 'hook' as const };
    expect(
      clipDocumentSchema.safeParse({ ...branded, segments: [hook, intro, body] }).success,
    ).toBe(true);
    expect(
      clipDocumentSchema.safeParse({ ...branded, segments: [intro, hook, body] }).success,
    ).toBe(true);
  });

  it('refuses an outro that is not at the end', () => {
    const withOutro = applyBrandKit(clip(), {
      ...kit(),
      outro: {
        kind: 'video',
        video: { videoId: OUTRO_ID, durationMs: 2_000, width: 720, height: 1280 },
      },
    });
    const segments = [...withOutro.segments];
    const outro = segments.pop() as NonNullable<(typeof segments)[0]>;
    expect(
      clipDocumentSchema.safeParse({ ...withOutro, segments: [outro, ...segments] }).success,
    ).toBe(false);
  });
});
