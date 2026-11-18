import { CANVASES, RATIOS, type Ratio } from '../canvas';
import { createClipDocument } from '../document/create';
import { MAX_AREAS } from '../document/limits';
import { type ClipDocument, clipDocumentSchema, type LayoutArea } from '../document/schema';
import { FULL_RECT, type Rect, rectAspect } from '../geometry';
import { frameState } from '../render/frame-state';
import { TEST_ASSET_ID, TEST_VIDEO_ID } from '../render/test-docs';
import { layoutBase } from './base';
import {
  addArea,
  applyLayout,
  applySavedLayout,
  areaCropAt,
  removeArea,
  renameArea,
  setAreaCrop,
  setCanvasRatio,
  setFitCrop,
  stripFrames,
  type VideoSize,
} from './edit';
import { FACE_CAM_HEIGHT, LAYOUT_PRESETS, layoutsFor, PRESET_KINDS } from './presets';

const LANDSCAPE: VideoSize = { width: 1920, height: 1080 };
const PORTRAIT: VideoSize = { width: 1080, height: 1920 };
const OLD_TV: VideoSize = { width: 1440, height: 1080 };
const EPS = 1e-9;

function fresh(ratio: Ratio = '9:16', video: VideoSize = LANDSCAPE): ClipDocument {
  return createClipDocument({
    videoId: TEST_VIDEO_ID,
    fromMs: 10_000,
    toMs: 40_000,
    ratio,
    sourceAspect: video.width / video.height,
  });
}

function crop(area: LayoutArea): Rect {
  const rect = area.crop[0]?.rect;
  if (!rect) throw new Error('no crop');
  return rect;
}

function expectInside(rect: Rect): void {
  expect(rect.x).toBeGreaterThanOrEqual(-EPS);
  expect(rect.y).toBeGreaterThanOrEqual(-EPS);
  expect(rect.w).toBeGreaterThan(0);
  expect(rect.h).toBeGreaterThan(0);
  expect(rect.x + rect.w).toBeLessThanOrEqual(1 + 1e-6);
  expect(rect.y + rect.h).toBeLessThanOrEqual(1 + 1e-6);
}

function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** A cover area's crop has its frame's real shape. */
function expectFrameShape(doc: ClipDocument, area: LayoutArea, video: VideoSize): void {
  const frameShape = rectAspect(area.frame, doc.canvas.width / doc.canvas.height);
  const cropShape = rectAspect(crop(area), video.width / video.height);
  expect(cropShape).toBeCloseTo(frameShape, 9);
}

function expectRectClose(a: Rect, b: Rect): void {
  expect(a.x).toBeCloseTo(b.x, 9);
  expect(a.y).toBeCloseTo(b.y, 9);
  expect(a.w).toBeCloseTo(b.w, 9);
  expect(a.h).toBeCloseTo(b.h, 9);
}

describe('the preset table', () => {
  it('offers all seven layouts on Vertical, Square and 4:5, and two on Horizontal', () => {
    for (const ratio of ['9:16', '1:1', '4:5'] as const) {
      expect(layoutsFor(ratio)).toEqual([...PRESET_KINDS]);
    }
    expect(layoutsFor('16:9')).toEqual(['fullscreen', 'blurred']);
  });

  it('places every frame inside the canvas, without overlap except rounded boxes', () => {
    for (const kind of PRESET_KINDS) {
      for (const ratio of RATIOS) {
        const preset = LAYOUT_PRESETS[kind][ratio];
        if (!preset) continue;
        expect(preset.kind).toBe(kind);
        expect(preset.ratio).toBe(ratio);
        expect(preset.areas.length).toBeGreaterThan(0);
        expect(preset.areas.length).toBeLessThanOrEqual(MAX_AREAS);
        preset.areas.forEach((a, i) => {
          expectInside(a.frame);
          for (const b of preset.areas.slice(i + 1)) {
            if (overlap(a.frame, b.frame) > 1e-9) {
              // Only a rounded box may sit over another area (the Gameplay camera).
              expect([kind, (a.radius ?? 0) > 0 || (b.radius ?? 0) > 0]).toEqual([kind, true]);
            }
          }
        });
      }
    }
  });

  it('draws the rounded boxes last and keeps the Screen Share camera 4:3', () => {
    for (const ratio of ['9:16', '1:1', '4:5'] as const) {
      for (const kind of ['gameplay', 'screen_share'] as const) {
        const preset = LAYOUT_PRESETS[kind][ratio];
        const last = preset?.areas[preset.areas.length - 1];
        expect(last?.name).toBe('Camera');
        expect(last?.radius).toBeGreaterThan(0);
      }
      const camera = LAYOUT_PRESETS.screen_share[ratio]?.areas[1];
      if (!camera) throw new Error('no camera');
      const { width, height } = CANVASES[ratio];
      expect(rectAspect(camera.frame, width / height)).toBeCloseTo(4 / 3, 9);
      expect(LAYOUT_PRESETS.screen_share[ratio]?.base).toBe('blurred');
    }
  });
});

describe('applyLayout', () => {
  it.each(
    RATIOS.flatMap((ratio) =>
      layoutsFor(ratio).flatMap((kind) =>
        [LANDSCAPE, PORTRAIT, OLD_TV].map((video) => [kind, ratio, video] as const),
      ),
    ),
  )('%s at %s on a %o video: valid, inside, never stretched', (kind, ratio, video) => {
    const doc = applyLayout(fresh(ratio, video), kind, video);
    expect(clipDocumentSchema.safeParse(doc).success).toBe(true);
    expect(doc.layout.kind).toBe(kind);
    expect(doc.layout.areas.map((a) => a.name)).toEqual(
      LAYOUT_PRESETS[kind][ratio]?.areas.map((a) => a.name),
    );
    for (const area of doc.layout.areas) {
      expectInside(area.frame);
      expectInside(crop(area));
      expect(area.crop).toHaveLength(1);
      if (area.fit === 'cover') {
        expectFrameShape(doc, area, video);
      }
    }
    // frameState reads every area and the right base.
    const state = frameState(doc, 0, {
      sources: { [doc.sources[0]?.id ?? '']: { ...video, fps: 30 } },
    });
    expect(state.areas).toHaveLength(doc.layout.areas.length);
    expect(state.background.kind).toBe(layoutBase(doc.layout) === 'blurred' ? 'blurred' : 'colour');
  });

  it('starts the Split and Gameplay cameras on the lower left at a face-camera size', () => {
    for (const kind of ['split', 'gameplay', 'screen_share'] as const) {
      const doc = applyLayout(fresh(), kind, LANDSCAPE);
      const camera = doc.layout.areas.find((a) => a.name === 'Camera');
      if (!camera) throw new Error('no camera');
      const rect = crop(camera);
      expect(rect.x).toBe(0);
      expect(rect.y + rect.h).toBeCloseTo(1, 12);
      expect(rect.h).toBeCloseTo(FACE_CAM_HEIGHT, 12);
    }
    const gameplay = applyLayout(fresh(), 'gameplay', LANDSCAPE);
    expect(gameplay.layout.areas[1]?.radius).toBe(36);
    expect(crop(gameplay.layout.areas[0] as LayoutArea).w).toBeCloseTo(0.31640625, 9);
  });

  it('takes a half or a quarter of the video for Three and Four', () => {
    const three = applyLayout(fresh(), 'three', LANDSCAPE);
    expect(
      crop(three.layout.areas[1] as LayoutArea).x + crop(three.layout.areas[1] as LayoutArea).w,
    ).toBeLessThanOrEqual(0.5 + EPS);
    expect(crop(three.layout.areas[2] as LayoutArea).x).toBeGreaterThanOrEqual(0.5 - EPS);
    const four = applyLayout(fresh(), 'four', LANDSCAPE);
    const bottomRight = crop(four.layout.areas[3] as LayoutArea);
    expect(bottomRight.x).toBeGreaterThanOrEqual(0.5 - EPS);
    expect(bottomRight.y).toBeGreaterThanOrEqual(0.5 - EPS);
  });

  it('keeps area ids by place and a Camera crop the person moved', () => {
    const split = applyLayout(fresh(), 'split', LANDSCAPE);
    const cameraId = split.layout.areas[0]?.id as string;
    const moved = setAreaCrop(split, cameraId, { x: 0.6, y: 0, w: 0.3375, h: 0.4 }, LANDSCAPE);
    const gameplay = applyLayout(moved, 'gameplay', LANDSCAPE);
    expect(gameplay.layout.areas[0]?.id).toBe(cameraId);
    const camera = gameplay.layout.areas[1] as LayoutArea;
    // Same size against the largest box of its shape (0.4), same place in the room it has.
    expect(crop(camera).h).toBeCloseTo(0.4, 12);
    expect(crop(camera).x).toBeCloseTo((0.6 / (1 - 0.3375)) * (1 - 0.225), 12);
    expectFrameShape(gameplay, camera, LANDSCAPE);
  });

  it('refuses a layout the shape does not offer, and custom', () => {
    expect(() => applyLayout(fresh('16:9'), 'split', LANDSCAPE)).toThrow(RangeError);
    expect(() => applyLayout(fresh(), 'custom', LANDSCAPE)).toThrow(RangeError);
  });
});

describe('the Fit crop ratio', () => {
  it('shows the whole video by default, then a centred 4:3 or 1:1 part', () => {
    const blurred = applyLayout(fresh(), 'blurred', LANDSCAPE);
    expect(blurred.layout.fitCrop).toBe('original');
    expect(crop(blurred.layout.areas[0] as LayoutArea)).toEqual(FULL_RECT);

    const fourThree = setFitCrop(blurred, '4:3', LANDSCAPE);
    const rect = crop(fourThree.layout.areas[0] as LayoutArea);
    expect(fourThree.layout.fitCrop).toBe('4:3');
    expect(rectAspect(rect, 16 / 9)).toBeCloseTo(4 / 3, 12);
    expect(rect.x + rect.w / 2).toBeCloseTo(0.5, 12);
    expect(rect.h).toBe(1);

    const square = setFitCrop(blurred, '1:1', LANDSCAPE);
    expect(rectAspect(crop(square.layout.areas[0] as LayoutArea), 16 / 9)).toBeCloseTo(1, 12);
    expect(setFitCrop(square, 'original', LANDSCAPE).layout.areas[0]?.crop[0]?.rect).toEqual(
      FULL_RECT,
    );

    // The content in the canvas follows the crop's shape, so the preview and export agree.
    const state = frameState(square, 0, {
      sources: { [square.sources[0]?.id ?? '']: { ...LANDSCAPE, fps: 30 } },
    });
    expect(state.areas[0]?.content).toEqual({
      x: 0,
      y: (1 - 1080 / 1920) / 2,
      w: 1,
      h: 1080 / 1920,
    });
  });

  it('is kept when the layout comes back to Blurred, and ignored elsewhere', () => {
    const chosen = setFitCrop(applyLayout(fresh(), 'blurred', LANDSCAPE), '1:1', LANDSCAPE);
    const back = applyLayout(applyLayout(chosen, 'split', LANDSCAPE), 'blurred', LANDSCAPE);
    expect(back.layout.fitCrop).toBe('1:1');
    expect(rectAspect(crop(back.layout.areas[0] as LayoutArea), 16 / 9)).toBeCloseTo(1, 12);
    const split = applyLayout(fresh(), 'split', LANDSCAPE);
    expect(setFitCrop(split, '4:3', LANDSCAPE)).toBe(split);
  });
});

describe('areaCropAt', () => {
  const area = {
    crop: [
      { at: 1_000, rect: { x: 0, y: 0, w: 0.5, h: 1 } },
      { at: 2_000, rect: { x: 0.5, y: 0, w: 0.5, h: 1 } },
    ],
  };

  it('holds one keyframe for the whole video', () => {
    expect(areaCropAt({ crop: [{ at: 0, rect: FULL_RECT }] }, 99_000)).toEqual(FULL_RECT);
  });

  it('interpolates between two keyframes and holds outside them', () => {
    expect(areaCropAt(area, 500).x).toBe(0);
    expect(areaCropAt(area, 1_500).x).toBeCloseTo(0.25, 12);
    expect(areaCropAt(area, 5_000).x).toBe(0.5);
  });

  it('reads the source frame that is shown, not the exact moment', () => {
    // At 30 fps, 1 049 ms is inside frame 31 (1 033.3 ms to 1 066.7 ms): read at 1 034 ms.
    expect(areaCropAt(area, 1_049, 30).x).toBeCloseTo((1_034 - 1_000) / 1_000 / 2, 12);
    expect(areaCropAt(area, 1_049).x).toBeCloseTo(0.049 / 2, 12);
  });
});

describe('setAreaCrop', () => {
  it('keeps the area shape and the video edges, and keeps the kind', () => {
    const split = applyLayout(fresh(), 'split', LANDSCAPE);
    const camera = split.layout.areas[0] as LayoutArea;
    // A box of the right shape dragged past the right and top edges slides along them.
    const moved = setAreaCrop(split, camera.id, { x: 0.9, y: -0.2, w: 0.3375, h: 0.4 }, LANDSCAPE);
    const area = moved.layout.areas[0] as LayoutArea;
    expectInside(crop(area));
    expectFrameShape(moved, area, LANDSCAPE);
    expect(crop(area).x + crop(area).w).toBeCloseTo(1, 12);
    expect(crop(area).y).toBeCloseTo(0, 12);
    // A box of the wrong shape gets the frame's shape, inside it and centred.
    const wrong = setAreaCrop(split, camera.id, { x: 0.9, y: 0.6, w: 0.5, h: 0.5 }, LANDSCAPE);
    const shaped = wrong.layout.areas[0] as LayoutArea;
    expectInside(crop(shaped));
    expectFrameShape(wrong, shaped, LANDSCAPE);
    expect(crop(shaped).y).toBeCloseTo(0.5, 12);
    expect(moved.layout.kind).toBe('split');
    expect(moved.layout.areas[1]).toBe(split.layout.areas[1]);
    expect(clipDocumentSchema.safeParse(moved).success).toBe(true);
  });

  it('keeps a contain crop at its own shape and ignores an unknown area', () => {
    const blurred = setFitCrop(applyLayout(fresh(), 'blurred', LANDSCAPE), '1:1', LANDSCAPE);
    const id = blurred.layout.areas[0]?.id as string;
    const moved = setAreaCrop(blurred, id, { x: 0, y: 0, w: 0.5, h: 0.5 }, LANDSCAPE);
    expect(rectAspect(crop(moved.layout.areas[0] as LayoutArea), 16 / 9)).toBeCloseTo(1, 12);
    expect(setAreaCrop(blurred, 'nope', FULL_RECT, LANDSCAPE)).toBe(blurred);
  });

  it('replaces several keyframes with one', () => {
    const doc = fresh();
    const area = doc.layout.areas[0] as LayoutArea;
    area.crop = [
      { at: 0, rect: crop(area) },
      { at: 5_000, rect: crop(area) },
    ];
    expect(setAreaCrop(doc, area.id, crop(area), LANDSCAPE).layout.areas[0]?.crop).toHaveLength(1);
  });
});

describe('adding, removing and renaming areas', () => {
  it('adds up to four areas as strips, the new one last, and the layout turns custom', () => {
    let doc = applyLayout(fresh(), 'split', LANDSCAPE);
    doc = addArea(doc, LANDSCAPE);
    expect(doc.layout.kind).toBe('custom');
    expect(doc.layout.base).toBe('solid');
    expect(doc.layout.areas.map((a) => a.name)).toEqual(['Camera', 'Content', 'Area 3']);
    expect(doc.layout.areas.map((a) => a.frame)).toEqual(stripFrames(3, doc.canvas));
    doc = addArea(doc, LANDSCAPE, 'Chat');
    expect(doc.layout.areas).toHaveLength(MAX_AREAS);
    expect(doc.layout.areas[3]?.name).toBe('Chat');
    for (const area of doc.layout.areas) {
      expect(area.fit).toBe('cover');
      expectInside(crop(area));
      expectFrameShape(doc, area, LANDSCAPE);
    }
    expect(clipDocumentSchema.safeParse(doc).success).toBe(true);
    expect(addArea(doc, LANDSCAPE)).toBe(doc);
  });

  it('keeps a blurred base when Screen Share turns custom, and drops the rounded corners', () => {
    const doc = addArea(applyLayout(fresh(), 'screen_share', LANDSCAPE), LANDSCAPE);
    expect(doc.layout).toMatchObject({ kind: 'custom', base: 'blurred' });
    expect(doc.layout.areas.every((a) => a.radius === undefined)).toBe(true);
    const state = frameState(doc, 0);
    expect(state.background.kind).toBe('blurred');
  });

  it('removes an area but never the last one, re-fitting the rest', () => {
    const four = applyLayout(fresh(), 'four', LANDSCAPE);
    const id = four.layout.areas[0]?.id as string;
    const three = removeArea(four, id, LANDSCAPE);
    expect(three.layout.kind).toBe('custom');
    expect(three.layout.areas.map((a) => a.name)).toEqual([
      'Top Right',
      'Bottom Left',
      'Bottom Right',
    ]);
    for (const area of three.layout.areas) {
      expectFrameShape(three, area, LANDSCAPE);
    }
    let one = three;
    for (const area of three.layout.areas.slice(1)) {
      one = removeArea(one, area.id, LANDSCAPE);
    }
    expect(one.layout.areas).toHaveLength(1);
    expect(one.layout.areas[0]?.frame).toEqual(FULL_RECT);
    expect(removeArea(one, one.layout.areas[0]?.id as string, LANDSCAPE)).toBe(one);
    expect(removeArea(four, 'nope', LANDSCAPE)).toBe(four);
  });

  it('renames an area, trimmed, and keeps the kind', () => {
    const split = applyLayout(fresh(), 'split', LANDSCAPE);
    const id = split.layout.areas[0]?.id as string;
    const renamed = renameArea(split, id, '  Face  ');
    expect(renamed.layout.areas[0]?.name).toBe('Face');
    expect(renamed.layout.kind).toBe('split');
    expect(renameArea(split, id, '   ')).toBe(split);
    expect(renameArea(split, id, 'x'.repeat(41))).toBe(split);
    expect(renameArea(split, 'nope', 'Face')).toBe(split);
  });

  it('cuts a wide canvas into columns', () => {
    expect(stripFrames(2, CANVASES['16:9'])).toEqual([
      { x: 0, y: 0, w: 0.5, h: 1 },
      { x: 0.5, y: 0, w: 0.5, h: 1 },
    ]);
  });
});

describe('setCanvasRatio', () => {
  it.each(
    PRESET_KINDS.flatMap((kind) => (['1:1', '4:5'] as const).map((to) => [kind, to] as const)),
  )('%s from Vertical to %s and back gives the same layout', (kind, to) => {
    const start = applyLayout(fresh(), kind, LANDSCAPE);
    const there = setCanvasRatio(start, to, LANDSCAPE);
    expect(there.canvas).toMatchObject({ ratio: to, ...CANVASES[to] });
    expect(there.layout.kind).toBe(kind);
    expect(clipDocumentSchema.safeParse(there).success).toBe(true);
    there.layout.areas.forEach((area, i) => {
      expect(area.frame).toEqual(LAYOUT_PRESETS[kind][to]?.areas[i]?.frame);
      expectInside(crop(area));
      if (area.fit === 'cover') expectFrameShape(there, area, LANDSCAPE);
    });
    const back = setCanvasRatio(there, '9:16', LANDSCAPE);
    expect(back.canvas).toEqual(start.canvas);
    back.layout.areas.forEach((area, i) => {
      const before = start.layout.areas[i] as LayoutArea;
      expect(area.id).toBe(before.id);
      expect(area.frame).toEqual(before.frame);
      expect(area.radius).toBe(before.radius);
      expectRectClose(crop(area), crop(before));
    });
  });

  it('falls back to Blurred when Horizontal does not offer the layout', () => {
    const split = applyLayout(fresh(), 'split', LANDSCAPE);
    const wide = setCanvasRatio(split, '16:9', LANDSCAPE);
    expect(wide.layout.kind).toBe('blurred');
    expect(wide.layout.areas).toHaveLength(1);
    expect(clipDocumentSchema.safeParse(wide).success).toBe(true);
    const full = setCanvasRatio(fresh(), '16:9', LANDSCAPE);
    expect(full.layout.kind).toBe('fullscreen');
    expect(crop(full.layout.areas[0] as LayoutArea)).toEqual(FULL_RECT);
  });

  it('keeps a custom layout custom, frames and base included', () => {
    const custom = addArea(applyLayout(fresh(), 'blurred', LANDSCAPE), LANDSCAPE);
    const square = setCanvasRatio(custom, '1:1', LANDSCAPE);
    expect(square.layout).toMatchObject({ kind: 'custom', base: 'blurred' });
    square.layout.areas.forEach((area, i) => {
      expect(area.frame).toEqual(custom.layout.areas[i]?.frame);
      expectFrameShape(square, area, LANDSCAPE);
    });
  });

  it('keeps overlay items in place, pulled inside the canvas, and does nothing for the same shape', () => {
    const doc = fresh();
    doc.tracks = [
      {
        id: 'ov',
        kind: 'overlay',
        items: [
          {
            id: 's',
            type: 'sticker',
            start: 0,
            duration: 1_000,
            anchor: 'clip',
            ref: { asset: TEST_ASSET_ID },
            transform: { x: 1.3, y: 0.25, scale: 1, rotation: 0, opacity: 1 },
            flipX: false,
          },
        ],
      },
    ];
    const square = setCanvasRatio(doc, '1:1', LANDSCAPE);
    const track = square.tracks[0];
    if (track?.kind !== 'overlay') throw new Error('no track');
    expect(track.items[0]?.transform).toMatchObject({ x: 1, y: 0.25 });
    expect(setCanvasRatio(doc, '9:16', LANDSCAPE)).toBe(doc);
  });
});

describe('applySavedLayout', () => {
  it('takes the frames, keeps each crop where it was and gives it its frame shape for this video', () => {
    const split = applyLayout(fresh(), 'split', LANDSCAPE);
    const saved = setAreaCrop(
      split,
      split.layout.areas[0]?.id ?? '',
      { x: 0.6, y: 0.5, w: 0.3, h: 0.3 },
      LANDSCAPE,
    ).layout;
    expect(saved).not.toBe(split.layout);
    const target = fresh('9:16', OLD_TV);
    const applied = applySavedLayout(target, saved, OLD_TV);
    expect(clipDocumentSchema.safeParse(applied).success).toBe(true);
    expect(applied.layout.kind).toBe('split');
    expect(applied.layout.areas.map((a) => a.name)).toEqual(['Camera', 'Content']);
    for (const [i, area] of applied.layout.areas.entries()) {
      const before = saved.areas[i] as LayoutArea;
      expectRectClose(area.frame, before.frame);
      expectInside(crop(area));
      expectFrameShape(applied, area, OLD_TV);
      // Inside the saved crop, centred in it.
      const was = crop(before);
      const now = crop(area);
      expect(now.x).toBeGreaterThanOrEqual(was.x - EPS);
      expect(now.y).toBeGreaterThanOrEqual(was.y - EPS);
      expect(now.x + now.w).toBeLessThanOrEqual(was.x + was.w + 1e-6);
      expect(now.y + now.h).toBeLessThanOrEqual(was.y + was.h + 1e-6);
      expect(now.x + now.w / 2).toBeCloseTo(was.x + was.w / 2, 9);
      expect(now.y + now.h / 2).toBeCloseTo(was.y + was.h / 2, 9);
    }
  });

  it('gives the same crops back on a video of the same shape', () => {
    const saved = applyLayout(fresh(), 'gameplay', LANDSCAPE).layout;
    const applied = applySavedLayout(fresh(), saved, LANDSCAPE);
    for (const [i, area] of applied.layout.areas.entries()) {
      expectRectClose(crop(area), crop(saved.areas[i] as LayoutArea));
      expect(area.radius).toBe(saved.areas[i]?.radius);
    }
  });

  it('keeps area ids by place, never the saved ids, and carries base and Crop Ratio', () => {
    const doc = applyLayout(fresh(), 'split', LANDSCAPE);
    const blurred = setFitCrop(applyLayout(fresh(), 'blurred', LANDSCAPE), '1:1', LANDSCAPE);
    const applied = applySavedLayout(doc, blurred.layout, PORTRAIT);
    expect(applied.layout.areas[0]?.id).toBe(doc.layout.areas[0]?.id);
    expect(applied.layout.areas).toHaveLength(1);
    expect(applied.layout.fitCrop).toBe('1:1');
    // The 1:1 part of this (portrait) video, not the saved one's numbers.
    expect(rectAspect(crop(applied.layout.areas[0] as LayoutArea), 1080 / 1920)).toBeCloseTo(1, 9);

    const share = applyLayout(fresh(), 'screen_share', LANDSCAPE);
    const custom = removeArea(share, share.layout.areas[1]?.id ?? '', LANDSCAPE).layout;
    const three = applyLayout(fresh(), 'three', LANDSCAPE);
    const onThree = applySavedLayout(three, custom, LANDSCAPE);
    expect(onThree.layout.kind).toBe('custom');
    expect(onThree.layout.base).toBe('blurred');
    expect(onThree.layout.areas.map((a) => a.id)).toEqual([three.layout.areas[0]?.id]);
    const savedIds = new Set(custom.areas.map((a) => a.id));
    const fromFour = applySavedLayout(
      fresh(),
      applyLayout(fresh(), 'four', LANDSCAPE).layout,
      LANDSCAPE,
    );
    expect(fromFour.layout.areas.filter((a) => savedIds.has(a.id))).toHaveLength(0);
    expect(new Set(fromFour.layout.areas.map((a) => a.id)).size).toBe(4);
    expect(clipDocumentSchema.safeParse(fromFour).success).toBe(true);
  });
});
