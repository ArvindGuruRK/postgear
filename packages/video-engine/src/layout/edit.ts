/**
 * Layout edits: pure functions from a clip document to a new one.
 *
 * The Layouts panel and the crop stage call these, one per undo step. None
 * changes its input; each returns a new document (or the same one, by
 * identity, when the edit does not apply: an unknown area id, a fifth area,
 * the last area removed, an empty name), so a caller can tell a no-op by
 * `next === doc`.
 *
 * Rules:
 * - Crops are fractions of the video, frames fractions of the canvas, so the
 *   same numbers serve the light copy and the sharp range. `videoSize` is
 *   only read for its shape (width over height).
 * - A cover area's crop always has its frame's shape (real proportions), so
 *   nothing is stretched; a contain area keeps its crop's own shape and is
 *   centred inside its frame.
 * - When a layout stays a preset: moving or resizing a crop keeps the kind
 *   (every layout expects its crops to be moved), and so does renaming an
 *   area. Changing the frames (adding or removing an area) makes it
 *   `custom`, and the layout then writes its `base` so the background it had
 *   (blurred or solid) is kept.
 * - Sprint 12 writes one crop keyframe per area. `areaCropAt` already reads
 *   several (linear between them, held outside) for Sprint 13's Follow The
 *   Speaker; a crop edit here replaces them with one.
 *
 * Pure: no Node built-ins, no other `@postgear/*` package.
 */
import { CANVASES, type CanvasSize, type Ratio } from '../canvas';
import { DEFAULT_SOURCE_ASPECT, newId } from '../document/create';
import { MAX_AREAS } from '../document/limits';
import type {
  ClipDocument,
  ClipLayout,
  CropKeyframe,
  FitCrop,
  LayoutArea,
  LayoutKind,
  Track,
} from '../document/schema';
import { clampRect, FULL_RECT, fitRect, type Rect, rectAspect } from '../geometry';
import { cropAt } from '../render/frame-state';
import { frameToMs } from '../time/time-map';
import { layoutBase } from './base';
import { type CropRule, FACE_CAM_HEIGHT, type PresetArea, presetFor } from './presets';

/** The video's picture size; only its shape is read. */
export type VideoSize = CanvasSize;

/** Longest area name the schema takes. */
export const AREA_NAME_MAX = 40;

/** Real width over height of the video, 16:9 when the size is not usable. */
export function videoAspectOf(size: VideoSize | null | undefined): number {
  if (!size || !(size.width > 0) || !(size.height > 0)) {
    return DEFAULT_SOURCE_ASPECT;
  }
  const aspect = size.width / size.height;
  return Number.isFinite(aspect) ? aspect : DEFAULT_SOURCE_ASPECT;
}

/** Real width over height of a frame on a canvas. */
function frameAspect(frame: Rect, canvas: CanvasSize): number {
  return rectAspect(frame, canvas.width / canvas.height);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** The crop of a Fit crop ratio: the whole video, or its centred 4:3 or 1:1 part. */
export function fitCropRect(fitCrop: FitCrop, videoAspect: number): Rect {
  if (fitCrop === '4:3') {
    return fitRect(4 / 3, FULL_RECT, videoAspect);
  }
  if (fitCrop === '1:1') {
    return fitRect(1, FULL_RECT, videoAspect);
  }
  return { ...FULL_RECT };
}

/** The first crop a preset rule gives an area with a frame of `aspect`. */
function cropForRule(rule: CropRule, aspect: number, videoAspect: number, fitCrop: FitCrop): Rect {
  switch (rule.rule) {
    case 'fit':
      return fitCropRect(fitCrop, videoAspect);
    case 'region':
      return fitRect(aspect, rule.region, videoAspect);
    case 'face_cam': {
      let h = FACE_CAM_HEIGHT;
      let w = (h * aspect) / videoAspect;
      if (w > 1) {
        const largest = fitRect(aspect, FULL_RECT, videoAspect);
        w = largest.w;
        h = largest.h;
      }
      return { x: 0, y: 1 - h, w, h };
    }
    default:
      return fitRect(aspect, FULL_RECT, videoAspect);
  }
}

/**
 * Where a box sits in the room it has to move in: 0 at the start, 1 at the
 * end, 0.5 when it has no room.
 */
function placeInRoom(start: number, size: number): number {
  const room = 1 - size;
  return room > 1e-9 ? clamp(start / room, 0, 1) : 0.5;
}

/**
 * A crop re-fitted to a new shape: the same size relative to the largest crop
 * of its shape, and the same place in the room it has. Going to another
 * shape and back gives the crop it started as (unless it had no room in a
 * direction, where it comes back centred), which is what makes a ratio change
 * round-trip.
 */
export function refitCrop(
  crop: Rect,
  fromAspect: number,
  toAspect: number,
  videoAspect: number,
): Rect {
  const before = fitRect(fromAspect, FULL_RECT, videoAspect);
  const scale = clamp(Math.max(crop.w / before.w, crop.h / before.h), Number.EPSILON, 1);
  const largest = fitRect(toAspect, FULL_RECT, videoAspect);
  const w = largest.w * scale;
  const h = largest.h * scale;
  const px = placeInRoom(crop.x, crop.w);
  const py = placeInRoom(crop.y, crop.h);
  return { x: px * (1 - w), y: py * (1 - h), w, h };
}

/** One keyframe holding `rect` for the whole video (at the first keyframe's moment). */
function singleKeyframe(area: LayoutArea, rect: Rect): CropKeyframe[] {
  return [{ at: area.crop[0]?.at ?? 0, rect }];
}

function firstCrop(area: LayoutArea): Rect {
  return { ...(area.crop[0]?.rect ?? FULL_RECT) };
}

function withLayout(doc: ClipDocument, layout: ClipLayout): ClipDocument {
  return { ...doc, layout };
}

/**
 * The crop of an area at a moment of source time: linear between keyframes,
 * held before the first and after the last. With the video's frame rate it
 * is read at the source frame actually shown (at 0.5x a source frame shows
 * twice; cookbook section 3), as `frameState` does.
 */
export function areaCropAt(
  area: Pick<LayoutArea, 'crop'>,
  sourceMs: number,
  sourceFps?: number,
): Rect {
  if (sourceFps !== undefined && sourceFps > 0 && Number.isFinite(sourceMs)) {
    const frame = Math.floor((sourceMs * sourceFps) / 1000 + 1e-6);
    return cropAt(area.crop, frameToMs(frame, sourceFps));
  }
  return cropAt(area.crop, sourceMs);
}

/**
 * The document with a preset layout: its areas, each crop placed by the
 * preset's rule and sized to its frame's shape. Area ids are kept by place
 * (so a selection survives), and an area of the same name that was cover
 * before and is cover now keeps its crop, re-fitted to the new shape (a
 * Camera placed in Split stays on the face in Gameplay). Blurred keeps the
 * Fit crop ratio chosen before, `original` by default.
 *
 * Throws a `RangeError` for a kind the clip's shape does not offer (the
 * panel never shows it) and for `custom`, which is not a preset.
 */
export function applyLayout(
  doc: ClipDocument,
  kind: LayoutKind,
  videoSize: VideoSize,
): ClipDocument {
  const preset = presetFor(kind, doc.canvas.ratio);
  if (!preset) {
    throw new RangeError(`The ${kind} layout is not offered for the ${doc.canvas.ratio} shape`);
  }
  const va = videoAspectOf(videoSize);
  const fitCrop: FitCrop = doc.layout.fitCrop ?? 'original';
  const previous = doc.layout.areas;

  const areas: LayoutArea[] = preset.areas.map((p: PresetArea, index) => {
    const aspect = frameAspect(p.frame, doc.canvas);
    const before = previous.find((a) => a.name === p.name);
    let rect = cropForRule(p.crop, aspect, va, fitCrop);
    if (before && before.fit === 'cover' && p.fit === 'cover') {
      rect = refitCrop(firstCrop(before), frameAspect(before.frame, doc.canvas), aspect, va);
    }
    const area: LayoutArea = {
      id: previous[index]?.id ?? newId('area'),
      name: p.name,
      frame: { ...p.frame },
      crop: [{ at: 0, rect }],
      fit: p.fit,
    };
    if (p.radius !== undefined && p.radius > 0) {
      area.radius = p.radius;
    }
    return area;
  });

  const layout: ClipLayout = { kind: preset.kind, areas };
  if (preset.kind === 'blurred' || doc.layout.fitCrop !== undefined) {
    layout.fitCrop = fitCrop;
  }
  return withLayout(doc, layout);
}

/**
 * Moves or resizes one area's crop. The rectangle is kept inside the video
 * (sliding along an edge rather than shrinking) and given the area's shape:
 * its frame's for cover, its current crop's for contain, as the largest box
 * of that shape inside it, centred. The kind is kept.
 */
export function setAreaCrop(
  doc: ClipDocument,
  areaId: string,
  rect: Rect,
  videoSize: VideoSize,
): ClipDocument {
  const area = doc.layout.areas.find((a) => a.id === areaId);
  if (!area) {
    return doc;
  }
  const va = videoAspectOf(videoSize);
  const aspect =
    area.fit === 'cover' ? frameAspect(area.frame, doc.canvas) : rectAspect(firstCrop(area), va);
  const shaped = fitRect(aspect, clampRect(rect), va);
  const areas = doc.layout.areas.map((a) =>
    a.id === areaId ? { ...a, crop: singleKeyframe(a, shaped) } : a,
  );
  return withLayout(doc, { ...doc.layout, areas });
}

/**
 * The document with a saved layout (a workspace's own arrangement, kept
 * from another clip). Frames are fractions of the canvas, so they are taken
 * as they are; every crop keeps its place as a fraction of the video and is
 * given its frame's shape for this video (a cover crop becomes the largest
 * box of its frame's shape inside the saved crop, centred in it), so a
 * layout saved on a 16:9 video applies to a 4:3 one without stretching.
 * A Blurred layout's middle area takes its Crop Ratio's part of this video.
 *
 * Area ids are kept by place (a selection survives), new ones made for the
 * rest; the saved ids are never reused, so they cannot clash with this
 * document's own. The kind, base and Crop Ratio come with the layout.
 */
export function applySavedLayout(
  doc: ClipDocument,
  saved: ClipLayout,
  videoSize: VideoSize,
): ClipDocument {
  const va = videoAspectOf(videoSize);
  const fitCrop = saved.fitCrop;
  const previous = doc.layout.areas;
  const areas: LayoutArea[] = saved.areas.slice(0, MAX_AREAS).map((area, index) => {
    const frame = clampRect(area.frame);
    let rect: Rect;
    if (area.fit === 'cover') {
      rect = fitRect(frameAspect(frame, doc.canvas), clampRect(firstCrop(area)), va);
    } else if (saved.kind === 'blurred' && fitCrop !== undefined) {
      rect = fitCropRect(fitCrop, va);
    } else {
      rect = clampRect(firstCrop(area));
    }
    const next: LayoutArea = {
      id: previous[index]?.id ?? newId('area'),
      name: area.name,
      frame,
      crop: [{ at: 0, rect }],
      fit: area.fit,
    };
    if (area.radius !== undefined && area.radius > 0) {
      next.radius = area.radius;
    }
    return next;
  });
  if (areas.length === 0) {
    return doc;
  }
  const layout: ClipLayout = { kind: saved.kind, areas };
  if (saved.base !== undefined) {
    layout.base = saved.base;
  }
  if (fitCrop !== undefined) {
    layout.fitCrop = fitCrop;
  }
  return withLayout(doc, layout);
}

/** `count` equal strips of the canvas: rows on a tall or square canvas, columns on a wide one. */
export function stripFrames(count: number, canvas: CanvasSize): Rect[] {
  const n = Math.max(1, Math.floor(count));
  const columns = canvas.width > canvas.height;
  return Array.from({ length: n }, (_, i) =>
    columns ? { x: i / n, y: 0, w: 1 / n, h: 1 } : { x: 0, y: i / n, w: 1, h: 1 / n },
  );
}

/** The areas laid out again as strips, each crop re-fitted to its new frame. */
function retile(doc: ClipDocument, areas: readonly LayoutArea[], videoSize: VideoSize): ClipLayout {
  const va = videoAspectOf(videoSize);
  const frames = stripFrames(areas.length, doc.canvas);
  const next: LayoutArea[] = areas.map((area, i) => {
    const frame = frames[i] as Rect;
    const from =
      area.fit === 'cover' ? frameAspect(area.frame, doc.canvas) : rectAspect(firstCrop(area), va);
    const rect = refitCrop(firstCrop(area), from, frameAspect(frame, doc.canvas), va);
    return { id: area.id, name: area.name, frame, crop: singleKeyframe(area, rect), fit: 'cover' };
  });
  const layout: ClipLayout = { kind: 'custom', base: layoutBase(doc.layout), areas: next };
  if (doc.layout.fitCrop !== undefined) {
    layout.fitCrop = doc.layout.fitCrop;
  }
  return layout;
}

function uniqueAreaName(areas: readonly LayoutArea[]): string {
  const taken = new Set(areas.map((a) => a.name.toLowerCase()));
  for (let n = areas.length + 1; ; n += 1) {
    const name = `Area ${n}`;
    if (!taken.has(name.toLowerCase())) {
      return name;
    }
  }
}

/**
 * Adds an area (up to `MAX_AREAS`), last, so it is drawn on top and the
 * caller can select it as `layout.areas.at(-1)`. The canvas is shared out
 * again as equal strips: the new area takes the last strip with a centred
 * crop of its shape, and every other area keeps its crop re-fitted to its
 * strip. The layout becomes `custom`.
 */
export function addArea(doc: ClipDocument, videoSize: VideoSize, name?: string): ClipDocument {
  const current = doc.layout.areas;
  if (current.length >= MAX_AREAS) {
    return doc;
  }
  const trimmed = name?.trim();
  const added: LayoutArea = {
    id: newId('area'),
    name: trimmed && trimmed.length <= AREA_NAME_MAX ? trimmed : uniqueAreaName(current),
    frame: { ...FULL_RECT },
    // A placeholder of the whole video; `retile` gives it its strip's shape, centred.
    crop: [{ at: 0, rect: { ...FULL_RECT } }],
    fit: 'contain',
  };
  return withLayout(doc, retile(doc, [...current, added], videoSize));
}

/** Removes an area (never the last one); the rest share the canvas again. The layout becomes `custom`. */
export function removeArea(doc: ClipDocument, areaId: string, videoSize: VideoSize): ClipDocument {
  const current = doc.layout.areas;
  if (current.length <= 1 || !current.some((a) => a.id === areaId)) {
    return doc;
  }
  return withLayout(
    doc,
    retile(
      doc,
      current.filter((a) => a.id !== areaId),
      videoSize,
    ),
  );
}

/** Renames an area (1 to 40 characters once trimmed). The kind is kept. */
export function renameArea(doc: ClipDocument, areaId: string, name: string): ClipDocument {
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > AREA_NAME_MAX) {
    return doc;
  }
  if (!doc.layout.areas.some((a) => a.id === areaId)) {
    return doc;
  }
  const areas = doc.layout.areas.map((a) => (a.id === areaId ? { ...a, name: trimmed } : a));
  return withLayout(doc, { ...doc.layout, areas });
}

/**
 * The Blurred layout's Crop Ratio: Original keeps the whole video, 4:3 and
 * 1:1 keep a centred part of that shape. Only the Blurred layout has one; on
 * any other layout this is a no-op.
 */
export function setFitCrop(
  doc: ClipDocument,
  fitCrop: FitCrop,
  videoSize: VideoSize,
): ClipDocument {
  if (doc.layout.kind !== 'blurred') {
    return doc;
  }
  const rect = fitCropRect(fitCrop, videoAspectOf(videoSize));
  const areas = doc.layout.areas.map((a) =>
    a.fit === 'contain' ? { ...a, crop: singleKeyframe(a, { ...rect }) } : a,
  );
  return withLayout(doc, { ...doc.layout, fitCrop, areas });
}

/** A part framed its own way that a shape change refits (not a brand intro or outro). */
function hasOwnLayout(segment: ClipDocument['segments'][number]): boolean {
  return (
    segment.layoutOverride !== undefined && segment.role !== 'intro' && segment.role !== 'outro'
  );
}

/** Overlay items keep their place as a fraction of the canvas, pulled inside it. */
function clampItems(tracks: readonly Track[]): Track[] {
  return tracks.map((track) => {
    if (track.kind !== 'overlay') {
      return track;
    }
    return {
      ...track,
      items: track.items.map((item) => ({
        ...item,
        transform: {
          ...item.transform,
          x: clamp(item.transform.x, 0, 1),
          y: clamp(item.transform.y, 0, 1),
        },
      })),
    };
  });
}

/**
 * Changes the clip's shape. A preset layout the new shape offers takes that
 * shape's frames (ids and names kept) with every cover crop re-fitted to its
 * new frame; a Custom layout keeps its frames and re-fits its crops; a preset
 * the new shape does not offer (Split on Horizontal) falls back to Blurred.
 * Overlay items keep their relative place, pulled inside the canvas. Going
 * back to the first shape gives the first layout again.
 *
 * A part's own layout (Module 11: each part of a montage carries its clip's)
 * is changed by the same rules, with its own video's size from
 * `options.sourceSizes` (by source id) when given. A brand intro's or
 * outro's layout covers its whole video and fits any shape as it is.
 */
export function setCanvasRatio(
  doc: ClipDocument,
  ratio: Ratio,
  videoSize: VideoSize,
  options: { sourceSizes?: Readonly<Record<string, VideoSize>> } = {},
): ClipDocument {
  if (doc.canvas.ratio === ratio) {
    return doc;
  }
  const size = CANVASES[ratio];
  const segments = doc.segments.some(hasOwnLayout)
    ? doc.segments.map((segment) => {
        if (!hasOwnLayout(segment) || !segment.layoutOverride) return segment;
        const own = { ...doc, layout: segment.layoutOverride, segments: [], tracks: [] };
        const sized = options.sourceSizes?.[segment.source] ?? videoSize;
        return { ...segment, layoutOverride: setCanvasRatio(own, ratio, sized).layout };
      })
    : doc.segments;
  const reshaped: ClipDocument = {
    ...doc,
    canvas: { ...doc.canvas, ratio, width: size.width, height: size.height },
    segments,
    tracks: clampItems(doc.tracks),
  };

  const kind = doc.layout.kind;
  if (kind !== 'custom' && !presetFor(kind, ratio)) {
    return applyLayout(reshaped, 'blurred', videoSize);
  }

  const va = videoAspectOf(videoSize);
  const preset = kind === 'custom' ? null : presetFor(kind, ratio);
  const areas: LayoutArea[] = doc.layout.areas.map((area, i) => {
    const p = preset?.areas[i];
    const frame = p ? { ...p.frame } : { ...area.frame };
    const next: LayoutArea = { ...area, frame };
    if (p) {
      next.fit = p.fit;
      if (p.radius !== undefined && p.radius > 0) {
        next.radius = p.radius;
      } else {
        delete next.radius;
      }
    }
    if (area.fit === 'cover' && next.fit === 'cover') {
      const rect = refitCrop(
        firstCrop(area),
        frameAspect(area.frame, doc.canvas),
        frameAspect(frame, reshaped.canvas),
        va,
      );
      next.crop = singleKeyframe(area, rect);
    }
    return next;
  });
  return withLayout(reshaped, { ...doc.layout, areas });
}
