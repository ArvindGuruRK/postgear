/**
 * `mediaPyMotion` and `mediaPyStills`: how much the picture moves, and a few
 * still pictures of the moments it moved most (Sprint 13, Module 06).
 *
 * Both read the video's light copy (`PROXY`), named by its storage key.
 *
 * - **Motion** decodes it once, forward, at two pictures a second on a small
 *   grey copy, and measures the mean absolute difference between neighbouring
 *   pictures (0 to 255 grey levels). The answer is a key to the **motion
 *   file**: the values on the signals grid, from the start of the video, null
 *   where nothing was measured. The Node side merges it into the video's
 *   SIGNALS file and removes it.
 * - **Stills** cuts one JPEG at each asked moment, about 768 px wide, under
 *   the video's own key space. Keys are made from the job's id and the
 *   moment's place in the list, so the Node side can remove every still of a
 *   run whatever happened to it. Stills never outlive their run.
 */
import { z } from 'zod/v4';
import { contractVersion, orgId, sourceMs, storageKey, timeRange, uuid } from './common';

/** The most stretches one motion call may measure. */
export const MAX_MOTION_RANGES = 64;
/** The most stills one call may cut: 12 bursts of four. */
export const MAX_STILLS = 48;
/** Pictures a second the motion measure samples: the signals grid. */
export const MOTION_SAMPLE_FPS = 2;

/** Read only by the simulated bindings: the sample to answer from, and a forcing switch. */
export const VISUAL_SIMULATION_FORCES = ['fail', 'slow'] as const;

export const visualSimulationHint = z
  .strictObject({
    /** A sample's name (`talk`, `stream`, `two-speakers`, `verideck`); null for any other video. */
    sample: z
      .string()
      .regex(/^[a-z0-9-]{1,32}$/)
      .nullable(),
    force: z.enum(VISUAL_SIMULATION_FORCES).nullable(),
  })
  .meta({ id: 'VisualSimulationHint' });

export const mediaPyMotionInput = z
  .strictObject({
    version: contractVersion,
    jobId: uuid,
    orgId,
    videoId: uuid,
    /** The light copy. */
    proxyKey: storageKey,
    /** The video's whole length: the motion file's grid covers it. */
    durationMs: sourceMs,
    /** The stretches to measure, in the video's time; in order, never overlapping. */
    ranges: z.array(timeRange).min(1).max(MAX_MOTION_RANGES),
    sampleFps: z.literal(MOTION_SAMPLE_FPS),
    simulation: visualSimulationHint.nullable(),
  })
  .meta({ id: 'MediaPyMotionInput', title: 'MediaPyMotionInput' });

export const mediaPyMotionOutput = z
  .strictObject({
    /** The motion file. */
    trackKey: storageKey,
    /** Pictures looked at. */
    sampled: z.number().int().min(0),
    /** What measured, such as `opencv` or `simulation`. */
    producer: z.string().min(1).max(80),
  })
  .meta({ id: 'MediaPyMotionOutput', title: 'MediaPyMotionOutput' });

/**
 * The motion file (a stored file both sides read). Values are grey levels, 0
 * to 255, two a second from the start of the video; null where no stretch
 * was measured.
 */
export const motionFile = z
  .strictObject({
    version: z.literal(1),
    producer: z.string().min(1).max(80),
    ranges: z.array(timeRange).min(1).max(MAX_MOTION_RANGES),
    sampleRateHz: z.literal(MOTION_SAMPLE_FPS),
    values: z.array(z.number().min(0).max(255).nullable()).max(24 * 3600 * MOTION_SAMPLE_FPS),
  })
  .meta({ id: 'MotionFile', title: 'MotionFile' });

export const mediaPyStillsInput = z
  .strictObject({
    version: contractVersion,
    jobId: uuid,
    orgId,
    videoId: uuid,
    /** The light copy. */
    proxyKey: storageKey,
    durationMs: sourceMs,
    /** One still at each moment, in the video's time; a moment past the end is refused. */
    momentsMs: z.array(sourceMs).min(1).max(MAX_STILLS),
    /** The stills' width in pixels (the height keeps the picture's shape). */
    width: z.number().int().min(160).max(1280),
    simulation: visualSimulationHint.nullable(),
  })
  .meta({ id: 'MediaPyStillsInput', title: 'MediaPyStillsInput' });

export const mediaPyStillsOutput = z
  .strictObject({
    /** One JPEG key a moment, in the order asked. */
    keys: z.array(storageKey).min(1).max(MAX_STILLS),
  })
  .meta({ id: 'MediaPyStillsOutput', title: 'MediaPyStillsOutput' });

export type MediaPyMotionInput = z.infer<typeof mediaPyMotionInput>;
export type MediaPyMotionOutput = z.infer<typeof mediaPyMotionOutput>;
export type MotionFile = z.infer<typeof motionFile>;
export type MediaPyStillsInput = z.infer<typeof mediaPyStillsInput>;
export type MediaPyStillsOutput = z.infer<typeof mediaPyStillsOutput>;
