/**
 * The Emote Maker's shapes (Module 14, B2 and B3): what the page asks for,
 * the bounds it must keep, and the EMOTE job's input and output.
 *
 * The bounds are checked twice, like every Clips input: the API refuses a
 * request outside them (422 with the code) before any charge, and the job's
 * input schema refuses a row the API should never have written. Every value
 * that reaches an FFmpeg graph is a number or a `#rrggbb` colour, so nothing a
 * person types can become a filter.
 */
import { z } from 'zod';
import {
  EMOTE_FORMATS,
  EMOTE_MAX_CROP,
  EMOTE_MAX_MS,
  EMOTE_MIN_CROP,
  EMOTE_PLATFORMS,
  EMOTE_STEP_MS,
} from './profiles';

const uuid = z.string().uuid();
const wholeMs = z.number().int().min(0);

/** A square in source pixels (the light copy's frame): top left corner and side. */
export const emoteCropSchema = z
  .object({
    x: z.number().int().min(0),
    y: z.number().int().min(0),
    size: z.number().int().min(EMOTE_MIN_CROP).max(EMOTE_MAX_CROP),
  })
  .strict();
export type EmoteCrop = z.infer<typeof emoteCropSchema>;

/** Remove Background: the colour picked with the eyedropper and how much around it goes. */
export const emoteKeySchema = z
  .object({
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .transform((value) => value.toLowerCase()),
    similarity: z.number().min(0.01).max(1),
  })
  .strict();
export type EmoteKey = z.infer<typeof emoteKeySchema>;

/** The frame the crop is measured in: the light copy the page plays. */
export const emoteFrameSchema = z
  .object({
    width: z.number().int().min(EMOTE_MIN_CROP).max(8_192),
    height: z.number().int().min(EMOTE_MIN_CROP).max(8_192),
  })
  .strict();
export type EmoteFrame = z.infer<typeof emoteFrameSchema>;

/** `POST /clips/emotes/export`'s body, shape only (the bounds need the video: `checkEmoteBounds`). */
export const emoteRequestSchema = z
  .object({
    videoId: uuid,
    platform: z.enum(EMOTE_PLATFORMS),
    startMs: wholeMs,
    endMs: wholeMs,
    crop: emoteCropSchema,
    key: emoteKeySchema.nullable(),
    flip: z.boolean(),
    still: z.boolean(),
    /** The frame under the playhead for the still PNGs; the stretch's start when absent. */
    stillAtMs: wholeMs.nullable().optional(),
  })
  .strict();
export type EmoteRequest = z.infer<typeof emoteRequestSchema>;

export type EmoteBoundsCode = 'emote_too_long' | 'emote_range_invalid';

/** What the bounds are checked against: the video's length and the light copy's frame. */
export interface EmoteBoundsContext {
  durationMs: number;
  frame: EmoteFrame;
}

export interface EmoteBoundsProblem {
  code: EmoteBoundsCode;
  path: string;
}

/**
 * Every bound a request breaks, most important first: longer than 3 seconds
 * is `emote_too_long`; a stretch that does not start before it ends, is not
 * on a tenth of a second, or leaves the video, a crop outside the picture, or
 * a still frame outside the stretch is `emote_range_invalid`.
 */
export function emoteBoundsProblems(
  request: Pick<EmoteRequest, 'startMs' | 'endMs' | 'crop' | 'stillAtMs'>,
  context: EmoteBoundsContext,
): EmoteBoundsProblem[] {
  const problems: EmoteBoundsProblem[] = [];
  const { startMs, endMs, crop } = request;
  if (endMs - startMs > EMOTE_MAX_MS) problems.push({ code: 'emote_too_long', path: 'endMs' });
  if (startMs >= endMs) problems.push({ code: 'emote_range_invalid', path: 'endMs' });
  if (startMs % EMOTE_STEP_MS !== 0 || endMs % EMOTE_STEP_MS !== 0) {
    problems.push({ code: 'emote_range_invalid', path: 'startMs' });
  }
  if (!Number.isFinite(context.durationMs) || endMs > context.durationMs) {
    problems.push({ code: 'emote_range_invalid', path: 'endMs' });
  }
  if (crop.x + crop.size > context.frame.width || crop.y + crop.size > context.frame.height) {
    problems.push({ code: 'emote_range_invalid', path: 'crop' });
  }
  const still = request.stillAtMs;
  if (still !== null && still !== undefined && (still < startMs || still > endMs)) {
    problems.push({ code: 'emote_range_invalid', path: 'stillAtMs' });
  }
  return problems;
}

/** The request schema with the bounds added: each broken bound is an issue carrying `params.code`. */
export function emoteBoundsSchema(context: EmoteBoundsContext) {
  return emoteRequestSchema.superRefine((request, ctx) => {
    for (const problem of emoteBoundsProblems(request, context)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [problem.path],
        message: problem.code,
        params: { code: problem.code },
      });
    }
  });
}

/**
 * The first broken bound's code, or null when the request keeps every
 * bound. The API turns the code into its 422 and our sentence.
 */
export function checkEmoteBounds(
  request: Pick<EmoteRequest, 'startMs' | 'endMs' | 'crop' | 'stillAtMs'>,
  context: EmoteBoundsContext,
): EmoteBoundsCode | null {
  return emoteBoundsProblems(request, context)[0]?.code ?? null;
}

// --- The EMOTE job -----------------------------------------------------------------

/**
 * One press of an export button (Module 14, B3). The API checked the bounds
 * and charged one download before the row was written; the worker reads the
 * covering sharp range or the light copy and makes the files. No AI minutes,
 * no watermark (a mark would make a 28 px emote useless).
 */
export const emoteInputSchema = z
  .object({
    videoId: uuid,
    platform: z.enum(EMOTE_PLATFORMS),
    startMs: wholeMs,
    endMs: wholeMs,
    crop: emoteCropSchema,
    /** The frame `crop` is measured in; the worker scales it to the file it reads. */
    frame: emoteFrameSchema,
    key: emoteKeySchema.nullable(),
    flip: z.boolean(),
    still: z.boolean(),
    stillAtMs: wholeMs.nullable(),
  })
  .strict()
  .refine(
    (input) => input.startMs < input.endMs && input.endMs - input.startMs <= EMOTE_MAX_MS,
    'An emote is a stretch of at most 3 seconds',
  )
  .refine(
    (input) =>
      input.crop.x + input.crop.size <= input.frame.width &&
      input.crop.y + input.crop.size <= input.frame.height,
    'The crop must be inside the picture',
  );
export type EmoteJobInput = z.infer<typeof emoteInputSchema>;

/** `emote-twitch-112.gif`: the only names a file of an emote job can have. */
export const EMOTE_FILE_NAME = /^emote-[a-z]{2,16}-\d{2,3}\.(?:gif|webp|apng|png)$/;
export const EMOTE_ZIP_NAME = /^emote-[a-z]{2,16}\.zip$/;

/** One file the job made, as the files table reads it. */
export const emoteFileSchema = z
  .object({
    name: z.string().regex(EMOTE_FILE_NAME),
    size: z.number().int().min(16).max(1_000),
    format: z.enum(EMOTE_FORMATS),
    bytes: z.number().int().min(0),
    maxBytes: z.number().int().positive(),
    /** Under the byte cap and the frame limit. A required file that does not fit fails the job. */
    fits: z.boolean(),
    /** The ladder rung it was made at, 1 the best. */
    rung: z.number().int().min(1).max(12),
    frames: z.number().int().min(0),
    /** Frames a second; 0 for a still. */
    fps: z.number().min(0).max(60),
    extra: z.boolean(),
  })
  .strict();
export type EmoteFile = z.infer<typeof emoteFileSchema>;

/**
 * A finished emote: its files (an extra that could not fit is listed with
 * `fits: false` and was not kept), the zip of every kept file, and whether
 * it was read from a sharp range or the light copy. Names, never keys: the
 * API derives each key from the workspace, the job and the name.
 */
export const emoteOutputSchema = z
  .object({
    platform: z.enum(EMOTE_PLATFORMS),
    files: z.array(emoteFileSchema).min(1).max(12),
    zip: z
      .object({ name: z.string().regex(EMOTE_ZIP_NAME), bytes: z.number().int().min(0) })
      .strict(),
    sharp: z.boolean(),
  })
  .strict();
export type EmoteJobOutput = z.infer<typeof emoteOutputSchema>;
