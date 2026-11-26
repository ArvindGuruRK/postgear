/**
 * Finding a face camera (Sprint 13, Module 07): the streamer's own small
 * picture laid over a game, which Detect Camera puts the Camera box on.
 *
 * A face camera is a person whose face
 * - stays almost still (its centre moves less than `FACECAM_MAX_DRIFT` of
 *   the picture, read as the 90th percentile so a single wild box does not
 *   count),
 * - is small (its mean height under a fifth of the picture's),
 * - sits outside the middle third of the picture, across or down (overlays
 *   sit near an edge, usually a corner),
 * - and is seen in most of the stretch.
 *
 * The crop is the face's box grown to head and shoulders (three face
 * heights, a little more below than above), given the Camera area's shape,
 * held inside the picture and snapped to an edge it nearly touches. With
 * several candidates the steadiest wins. Pure.
 */
import { clampRect, type Rect } from '../geometry';
import type { VideoSize } from '../layout/edit';
import type { Person } from './people';

export const FACECAM_MAX_DRIFT = 0.03;
export const FACECAM_MAX_SIZE = 0.2;
export const FACECAM_MIN_COVERAGE = 0.6;
/** The crop's height in face heights, and how much of the rest goes above the face. */
export const FACECAM_HEIGHT_FACES = 3;
export const FACECAM_ABOVE_FACES = 0.9;
/** A crop edge this close to the picture's edge is moved onto it. */
export const FACECAM_SNAP = 0.04;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] as number;
}

interface Candidate {
  face: Rect;
  drift: number;
  coverage: number;
}

/** The person's typical face box and how much it moves, or null when it is no face camera. */
function asCandidate(person: Person, videoAspect: number): Candidate | null {
  if (person.boxes.length === 0) return null;
  if (person.coverage < FACECAM_MIN_COVERAGE || person.avgSize >= FACECAM_MAX_SIZE) return null;
  const xs = person.boxes.map((b) => b.rect.x + b.rect.w / 2);
  const ys = person.boxes.map((b) => b.rect.y + b.rect.h / 2);
  const cx = median(xs);
  const cy = median(ys);
  // Drift in real proportions: a fraction across a wide picture is longer than one down it.
  const drifts = person.boxes.map((_, i) =>
    Math.hypot(((xs[i] as number) - cx) * videoAspect, (ys[i] as number) - cy),
  );
  const drift = percentile(drifts, 0.9);
  if (drift > FACECAM_MAX_DRIFT) return null;
  const outer = cx < 1 / 3 || cx > 2 / 3 || cy < 1 / 3 || cy > 2 / 3;
  if (!outer) return null;
  const w = median(person.boxes.map((b) => b.rect.w));
  const h = median(person.boxes.map((b) => b.rect.h));
  return { face: { x: cx - w / 2, y: cy - h / 2, w, h }, drift, coverage: person.coverage };
}

function snap(rect: Rect): Rect {
  let { x, y } = rect;
  if (x < FACECAM_SNAP) x = 0;
  if (1 - (x + rect.w) < FACECAM_SNAP) x = 1 - rect.w;
  if (y < FACECAM_SNAP) y = 0;
  if (1 - (y + rect.h) < FACECAM_SNAP) y = 1 - rect.h;
  return { ...rect, x, y };
}

/**
 * The Camera area's crop on the face camera, or null when no person is one.
 * `areaAspect` is the Camera frame's real width over height on the canvas.
 */
export function findFaceCamera(
  people: readonly Person[],
  videoSize: VideoSize,
  areaAspect: number,
): Rect | null {
  const videoAspect =
    videoSize.width > 0 && videoSize.height > 0 ? videoSize.width / videoSize.height : 16 / 9;
  const best = people
    .map((person) => asCandidate(person, videoAspect))
    .filter((c): c is Candidate => c !== null)
    .sort((a, b) => a.drift - b.drift || b.coverage - a.coverage)[0];
  if (!best || !(areaAspect > 0)) return null;

  const { face } = best;
  let h = face.h * FACECAM_HEIGHT_FACES;
  let w = (h * areaAspect) / videoAspect;
  // Too big for the picture: the largest box of the area's shape that fits.
  const scale = Math.min(1, 1 / w, 1 / h);
  w *= scale;
  h *= scale;
  const top = face.y - face.h * FACECAM_ABOVE_FACES * scale;
  const centreX = face.x + face.w / 2;
  return snap(clampRect({ x: centreX - w / 2, y: top, w, h }));
}
