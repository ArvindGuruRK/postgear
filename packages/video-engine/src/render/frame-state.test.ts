import type { ClipDocument } from '../document/schema';
import {
  cropAt,
  cropIsConstant,
  effectiveFades,
  fadeAt,
  frameState,
  placeArea,
  zoomScaleAt,
} from './frame-state';
import { CENTRED_VERTICAL_CROP, TEST_ASSET_ID, testDocument, testSegment } from './test-docs';

const SOURCES = { src: { width: 1920, height: 1080, fps: 30 } };

/** 10 s at 1x from source 10 s, then 10 s at 2x from source 20 s: 15 s of clip. */
function twoSegments(): ClipDocument {
  return testDocument([testSegment('a', 10_000, 20_000), testSegment('b', 20_000, 30_000, 2)]);
}

describe('frameState: segments and the time map', () => {
  it('starts the clip on the first segment', () => {
    const state = frameState(twoSegments(), 0);
    expect(state.durationMs).toBe(15_000);
    expect(state.segment).toMatchObject({
      id: 'a',
      index: 0,
      sourceMs: 10_000,
      outStart: 0,
      outEnd: 10_000,
    });
  });

  it('gives the moment just before a cut to the first segment and the cut itself to the next', () => {
    const doc = twoSegments();
    expect(frameState(doc, 9_999).segment).toMatchObject({ id: 'a', sourceMs: 19_999 });
    expect(frameState(doc, 10_000).segment).toMatchObject({ id: 'b', sourceMs: 20_000, speed: 2 });
  });

  it('plays a 2x segment at twice the source rate', () => {
    const doc = twoSegments();
    expect(frameState(doc, 12_500).segment.sourceMs).toBe(25_000);
    expect(frameState(doc, 14_999).segment.sourceMs).toBe(29_998);
  });

  it('keeps the last frame at the very end and clamps moments outside the clip', () => {
    const doc = twoSegments();
    expect(frameState(doc, 15_000).segment).toMatchObject({ id: 'b', sourceMs: 30_000 });
    expect(frameState(doc, 99_999).outputMs).toBe(15_000);
    expect(frameState(doc, -5).outputMs).toBe(0);
    expect(frameState(doc, Number.NaN).outputMs).toBe(0);
    expect(frameState(doc, 1_234.6).outputMs).toBe(1_235);
  });

  it('reads the shown source frame when the frame rate is known', () => {
    const doc = twoSegments();
    const state = frameState(doc, 1, { sources: SOURCES });
    expect(state.segment.sourceMs).toBe(10_001);
    expect(state.segment.sourceFrame).toBe(300);
    expect(state.segment.shownSourceMs).toBe(10_000);
    // Output frame 1 is at 33.33 ms: the exact moment reads source frame 301, the rounded one 300.
    const exact = frameState(doc, 1000 / 30, { sources: SOURCES });
    expect(exact.segment.sourceFrame).toBe(301);
    expect(exact.outputMs).toBe(33);
    expect(frameState(doc, 33, { sources: SOURCES }).segment.sourceFrame).toBe(300);
    expect(frameState(doc, 1).segment.sourceFrame).toBeNull();
    expect(frameState(doc, 1).segment.shownSourceMs).toBe(10_001);
  });

  it('shows each source frame twice at 0.5x', () => {
    const doc = testDocument([testSegment('slow', 0, 4_000, 0.5)]);
    const frames = [0, 33, 34, 66, 67, 100].map(
      (ms) => frameState(doc, ms, { sources: SOURCES }).segment.sourceFrame,
    );
    // Output 0 to 66 ms is source 0 to 33 ms (frame 0); output 67 ms is source 34 ms (frame 1).
    expect(frames).toEqual([0, 0, 0, 0, 1, 1]);
  });
});

describe('frameState: crops', () => {
  const moving = [
    { at: 0, rect: { x: 0, y: 0, w: 0.3, h: 1 } },
    { at: 10_000, rect: { x: 0.5, y: 0, w: 0.3, h: 1 } },
    { at: 20_000, rect: { x: 0.2, y: 0, w: 0.5, h: 0.5 } },
  ];

  it('interpolates linearly in source time and holds at both ends', () => {
    expect(cropAt(moving, -100)).toEqual(moving[0]?.rect);
    expect(cropAt(moving, 5_000).x).toBeCloseTo(0.25, 12);
    expect(cropAt(moving, 15_000)).toEqual({ x: 0.35, y: 0, w: 0.4, h: 0.75 });
    expect(cropAt(moving, 25_000)).toEqual(moving[2]?.rect);
    expect(cropAt([], 0)).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it('reads the crop at the shown frame, not at the output moment', () => {
    const doc = testDocument([testSegment('a', 0, 20_000)]);
    const area = doc.layout.areas[0];
    if (!area) throw new Error('no area');
    area.crop = moving;
    // Source 5,010 ms is inside frame 150, which starts at 5,000 ms.
    const shown = frameState(doc, 5_010, { sources: SOURCES });
    expect(shown.segment.shownSourceMs).toBe(5_000);
    expect(shown.areas[0]?.crop.x).toBeCloseTo(0.25, 12);
    const exact = frameState(doc, 5_010);
    expect(exact.areas[0]?.crop.x).toBeCloseTo(0.2505, 12);
  });

  it('knows a constant crop from a moving one', () => {
    expect(cropIsConstant(moving)).toBe(false);
    expect(cropIsConstant([moving[0] as (typeof moving)[number]])).toBe(true);
    expect(
      cropIsConstant([
        { at: 0, rect: { x: 0.1, y: 0, w: 0.3, h: 1 } },
        { at: 500, rect: { x: 0.1, y: 0, w: 0.3, h: 1 } },
      ]),
    ).toBe(true);
  });

  it('narrows a cover crop to the frame shape about its centre', () => {
    const doc = testDocument([testSegment('a', 0, 5_000)], { crop: { x: 0, y: 0, w: 1, h: 1 } });
    const area = frameState(doc, 0, { sources: SOURCES }).areas[0];
    expect(area?.visibleCrop.w).toBeCloseTo(0.31640625, 12);
    expect(area?.visibleCrop.x).toBeCloseTo((1 - 0.31640625) / 2, 12);
    expect(area?.visibleCrop.h).toBe(1);
    expect(area?.content).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it('leaves the preset crop alone when it already has the frame shape', () => {
    const doc = testDocument([testSegment('a', 0, 5_000)]);
    const area = frameState(doc, 0, { sources: SOURCES }).areas[0];
    expect(area?.visibleCrop.x).toBeCloseTo(CENTRED_VERTICAL_CROP.x, 12);
    expect(area?.visibleCrop.w).toBeCloseTo(CENTRED_VERTICAL_CROP.w, 12);
  });

  it('centres a contain area inside its frame', () => {
    const placed = placeArea(
      { frame: { x: 0, y: 0, w: 1, h: 1 }, fit: 'contain' },
      { x: 0, y: 0, w: 1, h: 1 },
      16 / 9,
      9 / 16,
    );
    expect(placed.visibleCrop).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    expect(placed.content.w).toBe(1);
    expect(placed.content.h).toBeCloseTo(0.31640625, 12);
    expect(placed.content.y).toBeCloseTo((1 - 0.31640625) / 2, 12);
  });

  it('gives the Blurred layout a cover-fitted base of the whole video', () => {
    const doc = testDocument([testSegment('a', 0, 5_000)]);
    doc.layout.kind = 'blurred';
    const state = frameState(doc, 0, { sources: SOURCES });
    expect(state.background.kind).toBe('blurred');
    if (state.background.kind === 'blurred') {
      expect(state.background.crop.w).toBeCloseTo(0.31640625, 12);
    }
    expect(frameState(testDocument([testSegment('a', 0, 5_000)]), 0).background).toEqual({
      kind: 'colour',
      colour: '#000000',
    });
  });
});

describe('frameState: zoom, fades, items', () => {
  it('eases a zoom in and out with smoothstep, in output time', () => {
    expect(zoomScaleAt(1_999, 2_000, 6_000, 1_000, 2)).toBe(1);
    expect(zoomScaleAt(2_500, 2_000, 6_000, 1_000, 2)).toBeCloseTo(1.5, 12);
    expect(zoomScaleAt(4_000, 2_000, 6_000, 1_000, 2)).toBe(2);
    expect(zoomScaleAt(5_750, 2_000, 6_000, 1_000, 2)).toBeCloseTo(1 + 0.0625 * 2.5, 12);
    expect(zoomScaleAt(3_000, 2_000, 6_000, 0, 3)).toBe(3);
  });

  it('maps a source-time zoom through a 2x segment', () => {
    const doc = twoSegments();
    // Source 22 to 26 s plays at 2x from output 10 s: output 11 to 13 s.
    doc.zooms = [
      {
        id: 'z',
        source: 'src',
        from: 22_000,
        to: 26_000,
        scale: 2,
        focus: { x: 0.3, y: 0.6 },
        ease: 0,
      },
    ];
    expect(frameState(doc, 10_999).zoom.scale).toBe(1);
    expect(frameState(doc, 11_000).zoom).toEqual({
      scale: 2,
      focus: { x: 0.3, y: 0.6 },
      zoomId: 'z',
    });
    expect(frameState(doc, 13_000).zoom.scale).toBe(1);
  });

  it('fades in and out from black, multiplying where they meet', () => {
    expect(fadeAt(500, 15_000, 1_000, 1_000)).toBeCloseTo(0.5, 12);
    expect(fadeAt(14_500, 15_000, 1_000, 1_000)).toBeCloseTo(0.5, 12);
    expect(fadeAt(7_000, 15_000, 1_000, 1_000)).toBe(1);
    expect(fadeAt(1_500, 3_000, 2_000, 2_000)).toBeCloseTo(0.75 * 0.75, 12);
    expect(effectiveFades({ inMs: 5_000, outMs: 0 }, 3_000)).toEqual({ inMs: 3_000, outMs: 0 });
    const doc = testDocument([testSegment('a', 0, 4_000, 1, 0.5)], { fadeInMs: 1_000 });
    const state = frameState(doc, 250);
    expect(state.fadeOpacity).toBeCloseTo(0.25, 12);
    expect(state.videoGain).toBeCloseTo(0.125, 12);
  });

  it('lists the items and sounds inside their windows', () => {
    const doc = testDocument([testSegment('a', 0, 10_000)]);
    doc.tracks = [
      {
        id: 'ov',
        kind: 'overlay',
        items: [
          {
            id: 'st',
            type: 'sticker',
            start: 1_000,
            duration: 2_000,
            anchor: 'moment',
            ref: { asset: TEST_ASSET_ID },
            transform: { x: 0.25, y: 0.75, scale: 1.5, rotation: 30, opacity: 0.5 },
            flipX: true,
          },
        ],
      },
      {
        id: 'au',
        kind: 'audio',
        items: [
          {
            id: 'fx',
            type: 'sfx',
            start: 2_000,
            duration: 2_000,
            anchor: 'moment',
            ref: { asset: TEST_ASSET_ID },
            offsetMs: 500,
            volume: 0.8,
            fadeInMs: 1_000,
            fadeOutMs: 0,
            duck: false,
          },
        ],
      },
    ];
    expect(frameState(doc, 999).overlays).toEqual([]);
    expect(frameState(doc, 1_000).overlays).toEqual([
      {
        id: 'st',
        trackId: 'ov',
        type: 'sticker',
        centre: { x: 0.25, y: 0.75 },
        scale: 1.5,
        rotationDeg: 30,
        opacity: 0.5,
        flipX: true,
        localMs: 0,
        startMs: 1_000,
        endMs: 3_000,
      },
    ]);
    expect(frameState(doc, 3_000).overlays).toEqual([]);
    const sounds = frameState(doc, 2_500).sounds;
    expect(sounds).toHaveLength(1);
    expect(sounds[0]?.gain).toBeCloseTo(0.4, 12);
    expect(sounds[0]?.fileMs).toBe(1_000);
  });
});
