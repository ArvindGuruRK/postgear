import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Ratio } from '../canvas';
import { createClipDocument } from '../document/create';
import { type ClipDocument, type CropKeyframe, clipDocumentSchema } from '../document/schema';
import { parseClipDocument } from '../document/upgrade';
import { applyLayout, areaCropAt, type VideoSize } from '../layout/edit';
import { TEST_ASSET_ID, TEST_VIDEO_ID } from '../render/test-docs';
import { trimSegment } from '../time/edits';
import {
  disableFollow,
  enableFollow,
  followArea,
  followAreasFor,
  followedAreaIds,
  isFollowing,
  setFollowOverrides,
} from './follow';

const VIDEO: VideoSize = { width: 1280, height: 720 };

function fresh(ratio: Ratio = '9:16'): ClipDocument {
  return createClipDocument({
    videoId: TEST_VIDEO_ID,
    fromMs: 10_000,
    toMs: 40_000,
    ratio,
    sourceAspect: VIDEO.width / VIDEO.height,
  });
}

/** A followed path: one crop size, x moving from the left to the right. */
function path(x0: number, x1: number, w = 0.316, h = 1): CropKeyframe[] {
  return [
    { at: 10_000, rect: { x: x0, y: 0, w, h } },
    { at: 19_999, rect: { x: x0, y: 0, w, h } },
    { at: 20_000, rect: { x: x1, y: 0, w, h } },
    { at: 40_000, rect: { x: x1, y: 0, w, h } },
  ];
}

function parses(doc: ClipDocument): void {
  const result = clipDocumentSchema.safeParse(doc);
  if (!result.success) throw new Error(JSON.stringify(result.error.issues));
}

describe('enableFollow and disableFollow', () => {
  it("follows Square Split's Content, never its equal Camera half", () => {
    const own = applyLayout(fresh('1:1'), 'split', VIDEO);
    const [first, second] = own.layout.areas;
    expect(first?.frame.w && first.frame.w * first.frame.h).toBeCloseTo(
      (second?.frame.w ?? 0) * (second?.frame.h ?? 0),
    );
    const content = own.layout.areas.find((a) => a.name === 'Content');
    const followed = enableFollow(own, {
      mode: 'speaker',
      faceAssetId: TEST_ASSET_ID,
      paths: [path(0.1, 0.6, 0.5, 1)],
    });
    expect(followedAreaIds(followed)).toEqual([content?.id]);
    expect(followed.layout.areas.find((a) => a.name === 'Camera')).toEqual(
      own.layout.areas.find((a) => a.name === 'Camera'),
    );
  });

  it('keeps the person picked, through hand fixes, and parses without one', () => {
    const own = fresh();
    const followed = enableFollow(own, {
      mode: 'speaker',
      faceAssetId: TEST_ASSET_ID,
      paths: [path(0.1, 0.6)],
      personId: 'person-3',
    });
    parses(followed);
    expect(followed.layout.follow?.personId).toBe('person-3');
    const fixed = setFollowOverrides(
      followed,
      [{ from: 12_000, to: 14_000, rect: { x: 0.2, y: 0, w: 0.316, h: 1 } }],
      path(0.2, 0.6),
    );
    expect(fixed.layout.follow?.personId).toBe('person-3');
    const plain = enableFollow(own, {
      mode: 'speaker',
      faceAssetId: TEST_ASSET_ID,
      paths: [path(0.1, 0.6)],
    });
    expect(plain.layout.follow && 'personId' in plain.layout.follow).toBe(false);
    parses(plain);
  });

  it('follows the largest area in speaker mode and gives the layout back exactly', () => {
    const own = applyLayout(fresh(), 'split', VIDEO);
    const before = structuredClone(own.layout);
    const followed = enableFollow(own, {
      mode: 'speaker',
      faceAssetId: TEST_ASSET_ID,
      paths: [path(0.1, 0.6)],
    });
    expect(own.layout).toEqual(before);
    expect(isFollowing(followed)).toBe(true);
    parses(followed);
    // Split's Content (the bottom, larger frame) follows; the Camera keeps its box.
    const content = own.layout.areas[1]?.id as string;
    expect(followedAreaIds(followed)).toEqual([content]);
    expect(followed.layout.areas[1]?.crop).toEqual(path(0.1, 0.6));
    expect(followed.layout.areas[0]).toEqual(own.layout.areas[0]);
    expect(followed.layout.kind).toBe('split');
    expect(followed.layout.follow?.saved).toEqual(before);

    const back = disableFollow(followed);
    expect(back.layout).toEqual(before);
    expect(isFollowing(back)).toBe(false);
    expect(disableFollow(back)).toBe(back);
  });

  it('stacks two areas in Split frames for Show Both, and gives the layout back exactly', () => {
    const own = fresh();
    const before = structuredClone(own.layout);
    const both = enableFollow(own, {
      mode: 'both',
      faceAssetId: TEST_ASSET_ID,
      paths: [path(0.1, 0.1, 0.5, 0.6), path(0.5, 0.5, 0.5, 0.8)],
    });
    parses(both);
    expect(both.layout.areas).toHaveLength(2);
    expect(both.layout.areas.map((a) => a.name)).toEqual(['Top', 'Bottom']);
    expect(both.layout.areas[0]?.frame).toEqual({ x: 0, y: 0, w: 1, h: 0.375 });
    expect(both.layout.areas[0]?.id).toBe(own.layout.areas[0]?.id);
    expect(followedAreaIds(both)).toEqual(both.layout.areas.map((a) => a.id));
    expect(both.layout.follow?.overrides).toEqual([]);
    expect(disableFollow(both).layout).toEqual(before);

    const shapes = followAreasFor(own, 'both', VIDEO);
    expect(shapes[0]?.aspect).toBeCloseTo(1080 / 720, 6);
    expect(shapes[1]?.aspect).toBeCloseTo(1080 / 1200, 6);
  });

  it('keeps the first saved layout when enabled again, whatever the mode', () => {
    const own = fresh();
    const before = structuredClone(own.layout);
    const once = enableFollow(own, {
      mode: 'speaker',
      faceAssetId: TEST_ASSET_ID,
      paths: [path(0.1, 0.6)],
    });
    const both = enableFollow(once, {
      mode: 'both',
      faceAssetId: TEST_ASSET_ID,
      paths: [path(0.1, 0.1), path(0.5, 0.5)],
    });
    const again = enableFollow(both, {
      mode: 'speaker',
      faceAssetId: TEST_ASSET_ID,
      paths: [path(0.2, 0.3)],
    });
    expect(again.layout.follow?.saved).toEqual(before);
    expect(again.layout.areas).toHaveLength(1);
    expect(disableFollow(again).layout).toEqual(before);
  });

  it('shows a Blurred clip full frame while followed, and gives Blurred back', () => {
    const own = applyLayout(fresh(), 'blurred', VIDEO);
    const before = structuredClone(own.layout);
    const followed = enableFollow(own, {
      mode: 'speaker',
      faceAssetId: TEST_ASSET_ID,
      paths: [path(0.1, 0.6)],
    });
    parses(followed);
    expect(followed.layout.kind).toBe('fullscreen');
    expect(followed.layout.fitCrop).toBeUndefined();
    expect(followed.layout.areas[0]?.fit).toBe('cover');
    expect(disableFollow(followed).layout).toEqual(before);
  });

  it('refuses an empty path by returning the same document', () => {
    const own = fresh();
    expect(enableFollow(own, { mode: 'speaker', faceAssetId: TEST_ASSET_ID, paths: [] })).toBe(own);
    expect(
      enableFollow(own, { mode: 'both', faceAssetId: TEST_ASSET_ID, paths: [path(0.1, 0.2)] }),
    ).toBe(own);
  });

  it('writes hand fixes and their path in speaker mode only', () => {
    const followed = enableFollow(fresh(), {
      mode: 'speaker',
      faceAssetId: TEST_ASSET_ID,
      paths: [path(0.1, 0.6)],
    });
    const overrides = [{ from: 12_000, to: 15_000, rect: { x: 0.3, y: 0, w: 0.316, h: 1 } }];
    const fixed = setFollowOverrides(followed, overrides, path(0.3, 0.6));
    parses(fixed);
    expect(fixed.layout.follow?.overrides).toEqual(overrides);
    expect(fixed.layout.areas[0]?.crop).toEqual(path(0.3, 0.6));
    expect(fixed.layout.follow?.saved).toEqual(followed.layout.follow?.saved);
    expect(setFollowOverrides(fresh(), overrides, path(0.3, 0.6)).layout.follow).toBeUndefined();
  });

  it('keeps crop keyframes in source time when a part is trimmed', () => {
    const followed = enableFollow(fresh(), {
      mode: 'speaker',
      faceAssetId: TEST_ASSET_ID,
      paths: [path(0.1, 0.6)],
    });
    const segment = followed.segments[0];
    if (!segment) throw new Error('no part');
    const trimmed = trimSegment(followed, {
      segmentId: segment.id,
      edge: 'start',
      sourceMs: 15_000,
      videoDurationMs: 240_000,
    });
    if (!trimmed.ok) throw new Error(trimmed.code);
    expect(trimmed.doc.segments[0]?.sourceIn).toBe(15_000);
    expect(trimmed.doc.layout).toEqual(followed.layout);
    const area = trimmed.doc.layout.areas[0];
    if (!area) throw new Error('no area');
    expect(areaCropAt(area, 25_000).x).toBe(0.6);
  });

  it('gives the followed area its frame shape on the canvas', () => {
    const doc = applyLayout(fresh(), 'split', VIDEO);
    const content = followArea(doc, VIDEO);
    expect(content?.aspect).toBeCloseTo(1080 / 1200, 6);
    expect(content?.video).toEqual(VIDEO);
    expect(followArea(doc, VIDEO, doc.layout.areas[0]?.id)?.aspect).toBeCloseTo(1080 / 720, 6);
    expect(followArea(doc, VIDEO, 'nope')).toBeNull();
    expect(followAreasFor(doc, 'speaker', VIDEO)).toEqual([content]);
  });

  it('still opens every version 1 clip, and a followed one of each parses', () => {
    const dir = join(__dirname, '..', '..', 'fixtures', 'v1-clips');
    const files = readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'records.json');
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const doc = parseClipDocument(JSON.parse(readFileSync(join(dir, file), 'utf8')));
      expect(doc.layout.follow).toBeUndefined();
      const followed = enableFollow(doc, {
        mode: 'speaker',
        faceAssetId: TEST_ASSET_ID,
        paths: [path(0.1, 0.6)],
      });
      parses(followed);
      expect(parseClipDocument(JSON.parse(JSON.stringify(followed)))).toEqual(followed);
    }
  });
});
