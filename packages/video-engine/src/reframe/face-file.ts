/**
 * The face file as the engine reads it, and the `FACE_TRACKS` asset's `meta`
 * (Sprint 13, Module 07).
 *
 * The file's shape is written once in `@postgear/media-contract`
 * (`faceTracksFile`); the engine imports nothing, so it keeps this strict
 * copy for the browser and the worker to check a file before using it. Boxes
 * and times only: anything more is refused.
 *
 * `meta` is what the API needs without opening the file: the stretch of the
 * video it covers (so a second clip of the same stretch reuses it), the rate,
 * and how many boxes were found.
 */
import { z } from 'zod';
import type { FacePictureInput } from './people';

const DAY_MS = 24 * 60 * 60 * 1000;
const ms = z.number().int().min(0).max(DAY_MS);
const fraction = z.number().min(0).max(1);

export const FACE_FILE_SAMPLE_FPS = 5;

export const faceFileSchema = z
  .object({
    version: z.literal(1),
    sampleFps: z.literal(FACE_FILE_SAMPLE_FPS),
    frames: z
      .array(
        z
          .object({
            t: ms,
            boxes: z
              .array(
                z
                  .object({ x: fraction, y: fraction, w: fraction, h: fraction, score: fraction })
                  .strict(),
              )
              .max(8),
          })
          .strict(),
      )
      .max(3 * 3600 * FACE_FILE_SAMPLE_FPS),
  })
  .strict();

export type FaceFile = z.infer<typeof faceFileSchema>;

/** The pictures of a face file, or null for anything that is not one. Never throws. */
export function readFaceFile(value: unknown): FacePictureInput[] | null {
  const parsed = faceFileSchema.safeParse(value);
  return parsed.success ? parsed.data.frames : null;
}

export const faceTracksAssetMetaSchema = z
  .object({
    fromMs: ms,
    toMs: ms,
    sampleFps: z.literal(FACE_FILE_SAMPLE_FPS),
    /** Boxes in the whole file (0: no face anywhere in the stretch). */
    found: z.number().int().min(0),
    /** What looked, such as `simulation`. */
    producer: z.string().min(1).max(80),
  })
  .strict()
  .refine((meta) => meta.fromMs < meta.toMs, 'A stretch must end after it starts');

export type FaceTracksAssetMeta = z.infer<typeof faceTracksAssetMetaSchema>;

/** A row's `meta`, or null when it is not a face file's. */
export function readFaceTracksAssetMeta(meta: unknown): FaceTracksAssetMeta | null {
  const parsed = faceTracksAssetMetaSchema.safeParse(meta);
  return parsed.success ? parsed.data : null;
}

/** Whether a face file covering `meta` already holds the stretch `fromMs` to `toMs`. */
export function faceFileCovers(
  meta: Pick<FaceTracksAssetMeta, 'fromMs' | 'toMs'>,
  fromMs: number,
  toMs: number,
): boolean {
  return meta.fromMs <= fromMs && meta.toMs >= toMs;
}
