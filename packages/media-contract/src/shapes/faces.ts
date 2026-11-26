/**
 * `mediaPyDetectFaces`: where faces are in a stretch of a video, as boxes over
 * time (Sprint 13, Module 07). Never who: no landmarks, no likeness, no
 * picture of a face, no name.
 *
 * It reads the video's light copy (`PROXY`), named by its storage key, in one
 * forward decode at five pictures a second, each at most 640 px wide, and
 * runs the face detector on every picture. The answer is a key to the **face
 * file**: per picture, its time and the boxes found in it, as fractions of
 * the picture. The Node side keeps the file as the video's `FACE_TRACKS`
 * asset (shared by every clip that plays the stretch) and the browser turns
 * the boxes into people (`linkPeople` in the engine).
 *
 * The face file's shape is pinned: a test fails if it gains any field, so a
 * landmark or a cropped picture can never slip into it.
 */
import { z } from 'zod/v4';
import { VISUAL_SIMULATION_FORCES } from './visual';
import { contractVersion, orgId, sourceMs, storageKey, timeRange, uuid } from './common';

/** Pictures a second the face detector looks at (research 06, the face section). */
export const FACES_SAMPLE_FPS = 5;
/** The widest picture the detector is handed, in pixels. */
export const FACES_MAX_WIDTH = 640;
/** The most stretches one call may look at (one clip's stretch, or a few). */
export const MAX_FACE_RANGES = 16;
/** The most boxes kept in one picture: the largest, so a crowd cannot swell the file. */
export const MAX_FACES_PER_PICTURE = 8;
/** The longest stretch one face file may cover: three hours. */
const MAX_FACE_PICTURES = 3 * 3600 * FACES_SAMPLE_FPS;

const facesSimulationHint = z
  .strictObject({
    /** A sample's name (`talk`, `stream`, `two-speakers`, `verideck`); null for any other video. */
    sample: z
      .string()
      .regex(/^[a-z0-9-]{1,32}$/)
      .nullable(),
    force: z.enum(VISUAL_SIMULATION_FORCES).nullable(),
  })
  .meta({ id: 'FacesSimulationHint' });

export const mediaPyDetectFacesInput = z
  .strictObject({
    version: contractVersion,
    jobId: uuid,
    orgId,
    videoId: uuid,
    /** The light copy. */
    proxyKey: storageKey,
    /** The video's whole length: a stretch past it is refused. */
    durationMs: sourceMs,
    /** The stretches to look at, in the video's time; in order, never overlapping. */
    ranges: z.array(timeRange).min(1).max(MAX_FACE_RANGES),
    sampleFps: z.literal(FACES_SAMPLE_FPS),
    maxWidth: z.literal(FACES_MAX_WIDTH),
    simulation: facesSimulationHint.nullable(),
  })
  .meta({ id: 'MediaPyDetectFacesInput', title: 'MediaPyDetectFacesInput' });

export const mediaPyDetectFacesOutput = z
  .strictObject({
    /** The face file. */
    facesKey: storageKey,
    /** Pictures looked at. */
    sampled: z.number().int().min(0),
    /** Boxes found in all of them together (0: no face anywhere in the stretch). */
    found: z.number().int().min(0),
    /** What looked, such as `mediapipe:blaze_face_short_range` or `simulation`. */
    producer: z.string().min(1).max(80),
  })
  .meta({ id: 'MediaPyDetectFacesOutput', title: 'MediaPyDetectFacesOutput' });

const fraction = z.number().min(0).max(1);

/** One face in one picture: its box as fractions of the picture, and how sure the detector was. */
export const faceBox = z
  .strictObject({ x: fraction, y: fraction, w: fraction, h: fraction, score: fraction })
  .meta({ id: 'FaceBox' });

/** One picture: when (whole ms of the video) and the boxes in it, largest first. */
export const facePicture = z
  .strictObject({
    t: sourceMs,
    boxes: z.array(faceBox).max(MAX_FACES_PER_PICTURE),
  })
  .meta({ id: 'FacePicture' });

/**
 * The face file (a stored file both sides read): boxes and times, nothing
 * else. Pictures are in time order; a picture with no face has no boxes.
 */
export const faceTracksFile = z
  .strictObject({
    version: z.literal(1),
    sampleFps: z.literal(FACES_SAMPLE_FPS),
    frames: z.array(facePicture).max(MAX_FACE_PICTURES),
  })
  .meta({ id: 'FaceTracksFile', title: 'FaceTracksFile' });

export type MediaPyDetectFacesInput = z.infer<typeof mediaPyDetectFacesInput>;
export type MediaPyDetectFacesOutput = z.infer<typeof mediaPyDetectFacesOutput>;
export type FaceBox = z.infer<typeof faceBox>;
export type FacePicture = z.infer<typeof facePicture>;
export type FaceTracksFile = z.infer<typeof faceTracksFile>;
