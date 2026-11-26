/**
 * Detect Camera's sums (Sprint 13, Module 07), pure so they are tested
 * without a browser: which area is the Camera, which pictures of the face
 * file belong to the clip, and where the Camera box goes.
 *
 * The face file covers the clip's stretch with handles; only the pictures
 * the clip plays count, so "seen in most of the stretch" means most of the
 * clip. People come from `linkPeople` and `smoothBoxes`, the camera from
 * `findFaceCamera`, all in the engine (the same code the worker runs).
 */
import {
  type CanvasSize,
  type ClipDocument,
  clipSourceRanges,
  type FacePictureInput,
  findFaceCamera,
  type LayoutArea,
  linkPeople,
  type Rect,
  readFaceFile,
  rectAspect,
  smoothBoxes,
} from '@postgear/video-engine';

export const DETECT_CAMERA_LABEL = 'Detect Camera';
export const FINDING_FACES = 'Finding faces';
export const NO_FACE_CAMERA = 'We could not find a face camera. Drag the box yourself.';
export const FACES_FAILED = 'We could not finish looking for faces. Try again.';
export const CAMERA_MOVED = 'Camera box moved onto the face camera.';

/** The layout's Camera area (Split, or a custom layout with an area named Camera), or null. */
export function cameraAreaOf(doc: ClipDocument): LayoutArea | null {
  return (
    doc.layout.areas.find(
      (area) => area.name.trim().toLowerCase() === 'camera' && area.fit === 'cover',
    ) ?? null
  );
}

/** The pictures that fall inside the stretches the clip plays. */
export function picturesInClip(
  doc: ClipDocument,
  frames: readonly FacePictureInput[],
): FacePictureInput[] {
  const ranges = clipSourceRanges(doc);
  return frames.filter((frame) => ranges.some((r) => frame.t >= r.fromMs && frame.t < r.toMs));
}

/** Where the Camera box goes for this clip, or null when no face camera is in it. */
export function faceCameraCrop(
  doc: ClipDocument,
  area: LayoutArea,
  frames: readonly FacePictureInput[],
  videoSize: CanvasSize,
): Rect | null {
  const people = linkPeople(picturesInClip(doc, frames)).map((person) => smoothBoxes(person));
  const areaAspect = rectAspect(area.frame, doc.canvas.width / doc.canvas.height);
  return findFaceCamera(people, videoSize, areaAspect);
}

/** Reads a gzipped face file the way the editor fetches it, or null for anything else. */
export async function readFaceFileBytes(
  body: ReadableStream<Uint8Array>,
): Promise<FacePictureInput[] | null> {
  try {
    // The DOM types disagree on the chunk type of a gzip stream; the bytes are the same.
    const gunzip = new DecompressionStream('gzip') as unknown as ReadableWritablePair<
      Uint8Array,
      Uint8Array
    >;
    const json = await new Response(body.pipeThrough(gunzip) as BodyInit).json();
    return readFaceFile(json);
  } catch {
    return null;
  }
}
