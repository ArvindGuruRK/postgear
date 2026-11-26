/**
 * People from boxes (Sprint 13, Module 07).
 *
 * A face detector answers boxes per picture and nothing more: it does not
 * know that the box on the left now is the box on the left a fifth of a
 * second ago. `linkPeople` chains boxes through time into people (never
 * *who*: a person here is "the face that stays on the left"), and
 * `smoothBoxes` takes the detector's jitter out so it never reaches a crop.
 *
 * Pure and small: the editor runs it in the browser on the face file it
 * loads once, and the worker runs it for clips made by a setup.
 */
import { clampRect, type Rect } from '../geometry';

/** One box as the face file holds it: fractions of the picture, and the detector's confidence. */
export interface FaceBoxInput {
  x: number;
  y: number;
  w: number;
  h: number;
  score: number;
}

/** One picture of the face file: its time (ms of the video) and its boxes. */
export interface FacePictureInput {
  t: number;
  boxes: readonly FaceBoxInput[];
}

export interface PersonBox {
  /** Ms of the video. */
  t: number;
  rect: Rect;
}

export interface Person {
  /** `person-1`, `person-2`, in the order they first appear. */
  id: string;
  /** First and last time seen, ms of the video. */
  from: number;
  to: number;
  boxes: PersonBox[];
  /** The face's mean height, as a fraction of the picture's height. */
  avgSize: number;
  /** The part of the file's pictures this person is seen in, 0 to 1. */
  coverage: number;
}

/** A face missing for up to this long (a turned head, a hand) is rejoined by the usual match. */
export const PEOPLE_SHORT_GAP_MS = 1_200;
/** Up to this long, a face is rejoined only if it comes back where it was. */
export const PEOPLE_LONG_GAP_MS = 5_000;
/** Chains shorter than this are noise (a face-like pattern for a moment). */
export const PEOPLE_MIN_MS = 2_000;
/** The overlap a box must have with the last one to be "where it was" after a long gap. */
const SAME_PLACE_IOU = 0.5;
/** Within the short gap: enough overlap, or a centre this close (in face sizes). */
const MATCH_IOU = 0.15;
const MATCH_DISTANCE = 0.75;

interface Chain {
  boxes: PersonBox[];
  last: Rect;
  lastT: number;
}

function iou(a: Rect, b: Rect): number {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.w, b.x + b.w);
  const bottom = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, right - left) * Math.max(0, bottom - top);
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

function centreDistance(a: Rect, b: Rect): number {
  return Math.hypot(a.x + a.w / 2 - (b.x + b.w / 2), a.y + a.h / 2 - (b.y + b.h / 2));
}

/** The match cost of a chain and a box, or null when they cannot be one person. */
function matchCost(chain: Chain, rect: Rect, t: number): number | null {
  const gap = t - chain.lastT;
  if (gap <= 0) return null;
  const overlap = iou(chain.last, rect);
  const distance = centreDistance(chain.last, rect) / Math.max(chain.last.w, chain.last.h, 1e-6);
  if (gap <= PEOPLE_SHORT_GAP_MS) {
    if (overlap < MATCH_IOU && distance > MATCH_DISTANCE) return null;
  } else if (gap <= PEOPLE_LONG_GAP_MS) {
    if (overlap < SAME_PLACE_IOU) return null;
  } else {
    return null;
  }
  return 1 - overlap + distance;
}

function toRect(box: FaceBoxInput): Rect {
  return clampRect({ x: box.x, y: box.y, w: box.w, h: box.h });
}

/**
 * Chains boxes through time into people: greedy matching between each
 * picture and the open chains (best overlap and nearest centre first), each
 * chain and box used once. Chains shorter than `PEOPLE_MIN_MS` are dropped.
 * Pictures are read in time order whatever order they come in.
 */
export function linkPeople(frames: readonly FacePictureInput[]): Person[] {
  const pictures = [...frames].sort((a, b) => a.t - b.t);
  const open: Chain[] = [];
  const closed: Chain[] = [];

  for (const picture of pictures) {
    // Chains too old to rejoin are closed first.
    for (let i = open.length - 1; i >= 0; i -= 1) {
      const chain = open[i] as Chain;
      if (picture.t - chain.lastT > PEOPLE_LONG_GAP_MS) {
        closed.push(chain);
        open.splice(i, 1);
      }
    }

    const rects = picture.boxes.map(toRect);
    const pairs: Array<{ chain: number; box: number; cost: number }> = [];
    open.forEach((chain, chainIndex) => {
      rects.forEach((rect, boxIndex) => {
        const cost = matchCost(chain, rect, picture.t);
        if (cost !== null) pairs.push({ chain: chainIndex, box: boxIndex, cost });
      });
    });
    pairs.sort((a, b) => a.cost - b.cost || a.chain - b.chain || a.box - b.box);

    const usedChains = new Set<number>();
    const usedBoxes = new Set<number>();
    for (const pair of pairs) {
      if (usedChains.has(pair.chain) || usedBoxes.has(pair.box)) continue;
      usedChains.add(pair.chain);
      usedBoxes.add(pair.box);
      const chain = open[pair.chain] as Chain;
      const rect = rects[pair.box] as Rect;
      chain.boxes.push({ t: picture.t, rect });
      chain.last = rect;
      chain.lastT = picture.t;
    }
    rects.forEach((rect, boxIndex) => {
      if (usedBoxes.has(boxIndex)) return;
      open.push({ boxes: [{ t: picture.t, rect }], last: rect, lastT: picture.t });
    });
  }

  const total = Math.max(1, pictures.length);
  return [...closed, ...open]
    .filter((chain) => chain.lastT - (chain.boxes[0] as PersonBox).t >= PEOPLE_MIN_MS)
    .sort((a, b) => (a.boxes[0] as PersonBox).t - (b.boxes[0] as PersonBox).t)
    .map((chain, index) => ({
      id: `person-${index + 1}`,
      from: (chain.boxes[0] as PersonBox).t,
      to: chain.lastT,
      boxes: chain.boxes,
      avgSize: chain.boxes.reduce((sum, box) => sum + box.rect.h, 0) / chain.boxes.length,
      coverage: Math.min(1, chain.boxes.length / total),
    }));
}

/** How far either side of a box the smoothing reaches, ms (two pictures at five a second). */
export const SMOOTH_REACH_MS = 400;

/**
 * The person with each box replaced by the mean of its neighbours within
 * `reachMs` (centre and size averaged apart, so a box never drifts off its
 * face): the detector's frame-to-frame jitter is taken out, a real move is
 * kept with a lag of a fraction of a second.
 */
export function smoothBoxes(person: Person, reachMs = SMOOTH_REACH_MS): Person {
  const boxes = person.boxes;
  const smoothed = boxes.map((box, index) => {
    let cx = 0;
    let cy = 0;
    let w = 0;
    let h = 0;
    let n = 0;
    for (let j = index; j >= 0 && box.t - (boxes[j] as PersonBox).t <= reachMs; j -= 1) {
      const r = (boxes[j] as PersonBox).rect;
      cx += r.x + r.w / 2;
      cy += r.y + r.h / 2;
      w += r.w;
      h += r.h;
      n += 1;
    }
    for (
      let j = index + 1;
      j < boxes.length && (boxes[j] as PersonBox).t - box.t <= reachMs;
      j += 1
    ) {
      const r = (boxes[j] as PersonBox).rect;
      cx += r.x + r.w / 2;
      cy += r.y + r.h / 2;
      w += r.w;
      h += r.h;
      n += 1;
    }
    const mw = w / n;
    const mh = h / n;
    return { t: box.t, rect: clampRect({ x: cx / n - mw / 2, y: cy / n - mh / 2, w: mw, h: mh }) };
  });
  return { ...person, boxes: smoothed };
}
