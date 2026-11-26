/**
 * Follow The Speaker in the document (Sprint 13, Module 08): pure edits from
 * a clip document to a new one, one undo step each. None changes its input;
 * an edit that does not apply (no path, not following) returns the same
 * document by identity, as the layout edits do.
 *
 * - `enableFollow` saves the person's own layout aside (`layout.follow.saved`,
 *   the layout without `follow`) and writes the worked-out crop keyframes
 *   into the followed area or areas. Enabling again (another mode, a new
 *   path) starts from the saved layout, so a followed layout is never saved
 *   as "the person's own".
 * - `disableFollow` gives back `saved` exactly.
 *
 * Which area is followed in `speaker` mode: the one with the largest frame
 * on the canvas (among equals never one named Camera, else the last), so
 * Fullscreen's Video, Split's Content (Square Split's equal halves too),
 * Gameplay's Game. Its crop must have its frame's shape, so a
 * `contain` area turns `cover` while followed, and a Blurred layout (whose
 * one area is `contain`) shows as Fullscreen. In `both` mode the layout is
 * two stacked areas in the Split preset's frames for the clip's shape (side
 * by side halves on a wide canvas, which has no Split), the left person on
 * top.
 *
 * Keyframes are in the video's own time, so a trim, a cut or a speed change
 * never needs them worked out again. Pure.
 */
import { newId } from '../document/create';
import type {
  ClipDocument,
  ClipLayout,
  CropKeyframe,
  FollowOverride,
  LayoutArea,
  SavedLayout,
} from '../document/schema';
import { type Rect, rectAspect } from '../geometry';
import { stripFrames, type VideoSize } from '../layout/edit';
import { presetFor } from '../layout/presets';
import type { FollowArea } from './path';

export type FollowMode = 'speaker' | 'both';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function canvasAspect(doc: ClipDocument): number {
  return doc.canvas.width / doc.canvas.height;
}

/** The layout as the person made it: `follow.saved` while following, else the layout itself. */
function ownLayout(layout: ClipLayout): SavedLayout {
  if (layout.follow) return layout.follow.saved;
  const { follow: _follow, ...rest } = layout;
  return rest;
}

function isCamera(area: Pick<LayoutArea, 'name'>): boolean {
  return area.name.trim().toLowerCase() === 'camera';
}

/**
 * The index of the area with the largest frame. Among equals, never one
 * named Camera (the face camera is not the speaker's frame: a Square Split's
 * halves are equal, and its Content is the one to follow), else the last.
 */
function speakerAreaIndex(areas: readonly Pick<LayoutArea, 'frame' | 'name'>[]): number {
  let best = 0;
  areas.forEach((area, i) => {
    if (i === 0) return;
    const current = areas[best] as Pick<LayoutArea, 'frame' | 'name'>;
    const size = area.frame.w * area.frame.h;
    const bestSize = current.frame.w * current.frame.h;
    if (size > bestSize + 1e-12) {
      best = i;
    } else if (Math.abs(size - bestSize) <= 1e-12 && !isCamera(area)) {
      best = i;
    }
  });
  return best;
}

/** Show Both's two frames on the clip's canvas, and their names. */
function bothFrames(doc: ClipDocument): Array<{ frame: Rect; name: string }> {
  const split = presetFor('split', doc.canvas.ratio);
  if (split && split.areas.length >= 2) {
    return [
      { frame: { ...(split.areas[0] as { frame: Rect }).frame }, name: 'Top' },
      { frame: { ...(split.areas[1] as { frame: Rect }).frame }, name: 'Bottom' },
    ];
  }
  const [left, right] = stripFrames(2, doc.canvas) as [Rect, Rect];
  return [
    { frame: left, name: 'Left' },
    { frame: right, name: 'Right' },
  ];
}

function areaShape(frame: Rect, doc: ClipDocument, videoSize: VideoSize): FollowArea {
  return {
    aspect: rectAspect(frame, canvasAspect(doc)),
    video: { width: videoSize.width, height: videoSize.height },
  };
}

/** Whether the clip follows the speaker. */
export function isFollowing(doc: ClipDocument): boolean {
  return doc.layout.follow !== undefined;
}

/** The ids of the areas whose crops follow someone (none when not following). */
export function followedAreaIds(doc: ClipDocument): string[] {
  const follow = doc.layout.follow;
  if (!follow) return [];
  const areas = doc.layout.areas;
  if (follow.mode === 'both') return areas.slice(0, 2).map((a) => a.id);
  const area = areas[speakerAreaIndex(areas)];
  return area ? [area.id] : [];
}

/**
 * The shape a path is made for in an area of the clip: `areaId`'s, or by
 * default the area `speaker` mode follows. Null for an unknown area.
 */
export function followArea(
  doc: ClipDocument,
  videoSize: VideoSize,
  areaId?: string,
): FollowArea | null {
  const areas = doc.layout.areas;
  const area = areaId ? areas.find((a) => a.id === areaId) : areas[speakerAreaIndex(areas)];
  return area ? areaShape(area.frame, doc, videoSize) : null;
}

/**
 * The shapes `enableFollow` will write paths into for `mode`, in its order
 * (`paths[0]`, `paths[1]`): one for `speaker` (the person's own layout's
 * largest area), top then bottom for `both`.
 */
export function followAreasFor(
  doc: ClipDocument,
  mode: FollowMode,
  videoSize: VideoSize,
): FollowArea[] {
  if (mode === 'both') return bothFrames(doc).map((b) => areaShape(b.frame, doc, videoSize));
  const own = ownLayout(doc.layout);
  const area = own.areas[speakerAreaIndex(own.areas)] as LayoutArea;
  return [areaShape(area.frame, doc, videoSize)];
}

function usablePath(path: readonly CropKeyframe[] | undefined): path is readonly CropKeyframe[] {
  return path !== undefined && path.length > 0;
}

/**
 * Turns Follow The Speaker on: `paths[0]` is the speaker area's path
 * (`speaker`), or the top and bottom areas' (`both`). `overrides` (hand
 * fixes) and `personId` (the many-faces pick) are kept for `speaker` only;
 * Show Both has neither in v1.
 */
export function enableFollow(
  doc: ClipDocument,
  input: {
    mode: FollowMode;
    faceAssetId: string;
    paths: readonly CropKeyframe[][];
    overrides?: FollowOverride[];
    /** The person picked when there were many faces (`speaker` mode; kept through hand fixes). */
    personId?: string | null;
  },
): ClipDocument {
  const saved = clone(ownLayout(doc.layout));
  if (input.mode === 'speaker') {
    const path = input.paths[0];
    if (!usablePath(path)) return doc;
    const index = speakerAreaIndex(saved.areas);
    const wasContain = (saved.areas[index] as LayoutArea).fit === 'contain';
    const areas: LayoutArea[] = saved.areas.map((area, i) =>
      i === index ? { ...clone(area), crop: clone(path), fit: 'cover' } : clone(area),
    );
    const layout: ClipLayout = { kind: saved.kind, areas };
    if (saved.kind === 'blurred' && wasContain) {
      layout.kind = 'fullscreen';
    } else {
      if (saved.base !== undefined) layout.base = saved.base;
      if (saved.fitCrop !== undefined) layout.fitCrop = saved.fitCrop;
    }
    layout.follow = {
      mode: 'speaker',
      faceAssetId: input.faceAssetId,
      overrides: clone(input.overrides ?? []),
      ...(input.personId ? { personId: input.personId } : {}),
      saved,
    };
    return { ...doc, layout };
  }

  const top = input.paths[0];
  const bottom = input.paths[1];
  if (!usablePath(top) || !usablePath(bottom)) return doc;
  const frames = bothFrames(doc);
  const wide = presetFor('split', doc.canvas.ratio) === null;
  const areas: LayoutArea[] = frames.map((b, i) => ({
    id: saved.areas[i]?.id ?? newId('area'),
    name: b.name,
    frame: b.frame,
    crop: clone(i === 0 ? top : bottom),
    fit: 'cover',
  }));
  const layout: ClipLayout = wide
    ? { kind: 'custom', base: 'solid', areas }
    : { kind: 'split', areas };
  layout.follow = { mode: 'both', faceAssetId: input.faceAssetId, overrides: [], saved };
  return { ...doc, layout };
}

/** Turns Follow The Speaker off: the layout as it was before, exactly. */
export function disableFollow(doc: ClipDocument): ClipDocument {
  const follow = doc.layout.follow;
  if (!follow) return doc;
  return { ...doc, layout: clone(follow.saved) };
}

/**
 * Fix By Hand: replaces the hand fixes and the speaker area's crop with the
 * path worked out with them (`followPath(..., { overrides })`). `speaker`
 * mode only; anything else returns the document unchanged.
 */
export function setFollowOverrides(
  doc: ClipDocument,
  overrides: readonly FollowOverride[],
  path: readonly CropKeyframe[],
): ClipDocument {
  const follow = doc.layout.follow;
  if (follow?.mode !== 'speaker' || path.length === 0) return doc;
  const index = speakerAreaIndex(doc.layout.areas);
  const areas = doc.layout.areas.map((area, i) =>
    i === index ? { ...area, crop: clone([...path]) } : area,
  );
  return {
    ...doc,
    layout: { ...doc.layout, areas, follow: { ...follow, overrides: clone([...overrides]) } },
  };
}
