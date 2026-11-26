/**
 * Face files for Follow The Speaker's tests (Module 08): five pictures a
 * second, boxes as fractions of a 16:9 picture. Test data only.
 */
import {
  applyLayout,
  type ClipDocument,
  createClipDocument,
  type FacePictureInput,
} from '@postgear/video-engine';
import type { FaceData } from './follow-model';

export const VIDEO = '3f2a9c1e-0000-4000-8000-000000000001';
export const CLIP = '55555555-5555-4555-8555-555555555555';
export const FACE_ASSET = '66666666-6666-4666-8666-666666666666';
export const VIDEO_SIZE = { width: 1280, height: 720 };

type Box = FacePictureInput['boxes'][number];

export const LEFT: Box = { x: 0.2, y: 0.25, w: 0.1, h: 0.18, score: 0.95 };
export const RIGHT: Box = { x: 0.7, y: 0.25, w: 0.1, h: 0.18, score: 0.95 };

/** A tall clip of the video's 10 s to 40 s, Fullscreen. */
export function tallClip(): ClipDocument {
  const doc = createClipDocument({ videoId: VIDEO, fromMs: 10_000, toMs: 40_000, ratio: '9:16' });
  return applyLayout({ ...doc, meta: { shapeChosen: true } }, 'fullscreen', VIDEO_SIZE);
}

/** Pictures from `fromMs` to `toMs`, each with the boxes `at(t)` gives. */
export function pictures(
  at: (t: number) => Box[],
  fromMs = 5_000,
  toMs = 45_000,
): FacePictureInput[] {
  const out: FacePictureInput[] = [];
  for (let t = fromMs; t < toMs; t += 200) out.push({ t, boxes: at(t) });
  return out;
}

/** One person, missing from 20 s to 24 s (a lost stretch). */
export function onePersonWithGap(): FacePictureInput[] {
  return pictures((t) => (t >= 20_000 && t < 24_000 ? [] : [LEFT]));
}

export function twoPeople(): FacePictureInput[] {
  return pictures(() => [LEFT, RIGHT]);
}

/** The x of each of the five faces of `manyPeople`, left to right. */
export const MANY_X = [0.05, 0.25, 0.45, 0.65, 0.85];

/**
 * Five faces in a row: too many to choose a speaker from. With `gapFor`,
 * that face (by its place) is missing from 20 s to 24 s.
 */
export function manyPeople(gapFor: number | null = null): FacePictureInput[] {
  const row = MANY_X.map((x) => ({ x, y: 0.3, w: 0.08, h: 0.14, score: 0.9 }));
  return pictures((t) =>
    gapFor !== null && t >= 20_000 && t < 24_000 ? row.filter((_, i) => i !== gapFor) : row,
  );
}

export function nobody(): FacePictureInput[] {
  return pictures(() => []);
}

export function faceData(frames: FacePictureInput[]): FaceData {
  return {
    frames,
    meta: { fromMs: 5_000, toMs: 45_000 },
    sceneCutsMs: [],
    speech: null,
    assetId: FACE_ASSET,
  };
}

/** The faces answer the API gives for these frames. */
export const READY = {
  status: 'ready' as const,
  url: 'http://localhost:3001/clips/files/faces?sig=1',
  meta: { fromMs: 5_000, toMs: 45_000, sampleFps: 5, found: 1, producer: 'simulation' },
  sceneCutsMs: [],
  speech: null,
  assetId: FACE_ASSET,
};
