import type { Rect } from '../geometry';
import {
  type FaceTracksAssetMeta,
  faceFileCovers,
  readFaceFile,
  readFaceTracksAssetMeta,
} from './face-file';
import { findFaceCamera } from './facecam';
import {
  type FaceBoxInput,
  type FacePictureInput,
  linkPeople,
  type Person,
  smoothBoxes,
} from './people';

const STEP = 200;
const VIDEO = { width: 1280, height: 720 };
/** The Camera area of Split on a 9:16 canvas: full width, 40 % of the height. */
const SPLIT_CAMERA_ASPECT = 1080 / (1920 * 0.4);

function box(cx: number, cy: number, w: number, h: number, score = 0.9): FaceBoxInput {
  return { x: cx - w / 2, y: cy - h / 2, w, h, score };
}

/** Pictures five a second from `fromMs` to `toMs`, each with the boxes `at(t)` answers. */
function pictures(
  fromMs: number,
  toMs: number,
  at: (t: number) => FaceBoxInput[],
): FacePictureInput[] {
  const out: FacePictureInput[] = [];
  for (let t = fromMs; t < toMs; t += STEP) out.push({ t, boxes: at(t) });
  return out;
}

/** A tiny steady jitter, never random. */
function jitter(t: number, salt: number): number {
  return (((t / STEP) * 7919 + salt * 104729) % 13) / 13 - 0.5;
}

describe('linkPeople', () => {
  it('keeps two people side by side as two people for the whole stretch', () => {
    const frames = pictures(0, 60_000, () => [
      box(0.27, 0.47, 0.2, 0.44),
      box(0.73, 0.47, 0.2, 0.44),
    ]);
    const people = linkPeople(frames);
    expect(people).toHaveLength(2);
    expect(people.map((p) => p.coverage)).toEqual([1, 1]);
    const lefts = people.map((p) => (p.boxes[0]?.rect.x ?? 0) + 0.1).sort();
    expect(lefts[0]).toBeCloseTo(0.27);
    expect(lefts[1]).toBeCloseTo(0.73);
    expect(people[0]?.avgSize).toBeCloseTo(0.44);
  });

  it('bridges a face missing for a second (a turned head)', () => {
    const frames = pictures(0, 10_000, (t) =>
      t >= 4_000 && t < 4_800 ? [] : [box(0.5, 0.4, 0.15, 0.27)],
    );
    const people = linkPeople(frames);
    expect(people).toHaveLength(1);
    expect(people[0]?.from).toBe(0);
    expect(people[0]?.to).toBe(9_800);
  });

  it('after three seconds away, the same place is the same person and elsewhere is a new one', () => {
    const gone = (t: number) => t >= 5_000 && t < 8_000;
    const same = linkPeople(
      pictures(0, 14_000, (t) => (gone(t) ? [] : [box(0.5, 0.4, 0.15, 0.27)])),
    );
    expect(same).toHaveLength(1);

    const moved = linkPeople(
      pictures(0, 14_000, (t) => {
        if (gone(t)) return [];
        return [t < 5_000 ? box(0.3, 0.4, 0.15, 0.27) : box(0.7, 0.4, 0.15, 0.27)];
      }),
    );
    expect(moved).toHaveLength(2);
    expect(moved.map((p) => [p.from, p.to])).toEqual([
      [0, 4_800],
      [8_000, 13_800],
    ]);
  });

  it('drops chains shorter than two seconds', () => {
    const frames = pictures(0, 10_000, (t) => [
      box(0.3, 0.4, 0.15, 0.27),
      ...(t >= 2_000 && t < 3_000 ? [box(0.8, 0.2, 0.05, 0.09)] : []),
    ]);
    expect(linkPeople(frames)).toHaveLength(1);
  });

  it('reads pictures in time order whatever order they come in', () => {
    const frames = pictures(0, 5_000, () => [box(0.5, 0.4, 0.15, 0.27)]).reverse();
    const [person] = linkPeople(frames);
    expect(person?.from).toBe(0);
    expect(person?.boxes.map((b) => b.t)).toEqual(
      [...(person as Person).boxes.map((b) => b.t)].sort((a, b) => a - b),
    );
  });
});

describe('smoothBoxes', () => {
  it('takes the jitter out of a still face', () => {
    const frames = pictures(0, 10_000, (t) => [
      box(0.5 + jitter(t, 1) * 0.02, 0.4 + jitter(t, 2) * 0.02, 0.15, 0.27),
    ]);
    const [person] = linkPeople(frames) as [Person];
    const spread = (p: Person) => {
      const xs = p.boxes.map((b) => b.rect.x + b.rect.w / 2);
      const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
      return Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
    };
    const smooth = smoothBoxes(person);
    expect(spread(smooth)).toBeLessThan(spread(person) * 0.6);
    expect(smooth.boxes).toHaveLength(person.boxes.length);
  });

  it('keeps a real move', () => {
    const frames = pictures(0, 10_000, (t) => [box(t < 5_000 ? 0.3 : 0.4, 0.4, 0.15, 0.27)]);
    const smooth = smoothBoxes(linkPeople(frames)[0] as Person);
    const last = smooth.boxes.at(-1)?.rect;
    expect((last?.x ?? 0) + (last?.w ?? 0) / 2).toBeCloseTo(0.4);
  });
});

describe('findFaceCamera', () => {
  const corner = (t: number) =>
    box(0.905 + jitter(t, 3) * 0.004, 0.835 + jitter(t, 4) * 0.004, 0.06, 0.106);

  it('finds a still small face in a corner and frames head and shoulders, snapped to the edge', () => {
    const people = linkPeople(pictures(0, 30_000, (t) => [corner(t)]));
    const crop = findFaceCamera(people, VIDEO, SPLIT_CAMERA_ASPECT);
    expect(crop).not.toBeNull();
    const rect = crop as Rect;
    // Three face heights tall, the Camera area's shape, inside the picture.
    expect(rect.h).toBeCloseTo(0.106 * 3, 2);
    expect((rect.w * 16) / 9 / rect.h).toBeCloseTo(SPLIT_CAMERA_ASPECT, 2);
    expect(rect.x + rect.w).toBeLessThanOrEqual(1);
    expect(rect.y + rect.h).toBeCloseTo(1);
    // The face is inside the crop.
    expect(rect.x).toBeLessThan(0.905 - 0.03);
    expect(rect.y).toBeLessThan(0.835 - 0.053);
  });

  it('a full-frame talking head is not a face camera', () => {
    const people = linkPeople(pictures(0, 30_000, () => [box(0.5, 0.4, 0.22, 0.4)]));
    expect(findFaceCamera(people, VIDEO, SPLIT_CAMERA_ASPECT)).toBeNull();
  });

  it('a small face that moves about is not a face camera', () => {
    const people = linkPeople(
      pictures(0, 30_000, (t) => [box(0.85 - (t / 30_000) * 0.12, 0.8, 0.06, 0.106)]),
    );
    expect(people).toHaveLength(1);
    expect(findFaceCamera(people, VIDEO, SPLIT_CAMERA_ASPECT)).toBeNull();
  });

  it('a face seen only now and then is not a face camera', () => {
    const people = linkPeople(pictures(0, 30_000, (t) => (t < 10_000 ? [corner(t)] : [])));
    expect(findFaceCamera(people, VIDEO, SPLIT_CAMERA_ASPECT)).toBeNull();
  });

  it('with two cameras, picks the steadier one', () => {
    const shaky = (t: number) => box(0.1 + jitter(t, 5) * 0.03, 0.15, 0.06, 0.106);
    const people = linkPeople(pictures(0, 30_000, (t) => [corner(t), shaky(t)]));
    expect(people).toHaveLength(2);
    const crop = findFaceCamera(people, VIDEO, SPLIT_CAMERA_ASPECT);
    expect((crop as Rect).x).toBeGreaterThan(0.5);
  });

  it('no people, no camera', () => {
    expect(findFaceCamera([], VIDEO, SPLIT_CAMERA_ASPECT)).toBeNull();
  });
});

describe('the face file', () => {
  it('reads a file of boxes and times, and refuses anything more', () => {
    const file = { version: 1, sampleFps: 5, frames: [{ t: 0, boxes: [box(0.5, 0.5, 0.1, 0.1)] }] };
    expect(readFaceFile(file)).toHaveLength(1);
    const withLandmarks = {
      ...file,
      frames: [{ t: 0, boxes: [{ ...box(0.5, 0.5, 0.1, 0.1), keypoints: [] }] }],
    };
    expect(readFaceFile(withLandmarks)).toBeNull();
    expect(readFaceFile({ ...file, people: [] })).toBeNull();
  });

  it('reads the asset meta and says when it covers a stretch', () => {
    const meta = readFaceTracksAssetMeta({
      fromMs: 10_000,
      toMs: 72_000,
      sampleFps: 5,
      found: 3,
      producer: 'simulation',
    });
    expect(meta).not.toBeNull();
    expect(faceFileCovers(meta as FaceTracksAssetMeta, 12_000, 70_000)).toBe(true);
    expect(faceFileCovers(meta as FaceTracksAssetMeta, 8_000, 70_000)).toBe(false);
    expect(
      readFaceTracksAssetMeta({ fromMs: 5, toMs: 5, sampleFps: 5, found: 0, producer: 'x' }),
    ).toBeNull();
  });
});
