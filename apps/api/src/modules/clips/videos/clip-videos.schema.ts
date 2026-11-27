/**
 * Request bodies and queries for videos and uploads (Sprint 12, Module 04).
 * Every object is `.strict()`: an unknown key is refused, not ignored.
 *
 * `rightsConfirmed` is optional here on purpose: a missing tick is not a
 * malformed request but a refusal with its own sentence (422
 * `rights_required`), which the service raises.
 */
import { z } from 'zod';

export const VIDEOS_PAGE_SIZE = 24;

/** Larger than any plan's upload cap (50 GB is the registry's ceiling). */
const MAX_DECLARED_BYTES = 60_000_000_000;
/** S3 numbers parts 1 to 10,000. */
const MAX_PART_NUMBER = 10_000;
/** Part addresses asked for at once: a browser uploads a few parts in parallel. */
const MAX_PARTS_PER_REQUEST = 100;

const importLinkSchema = z
  .object({
    url: z.string().trim().min(1).max(2_048),
    rightsConfirmed: z.boolean().optional(),
  })
  .strict();

/**
 * Try A Sample (Module 06): the server picks the link. Exactly one of `url`
 * or `sample`: both shapes are strict, so a body with both matches neither.
 */
const importSampleSchema = z.object({ sample: z.literal(true) }).strict();

export const importVideoSchema = z.union([importLinkSchema, importSampleSchema]);
export type ImportVideoInput = z.infer<typeof importVideoSchema>;
export type ImportLinkInput = z.infer<typeof importLinkSchema>;

export const listVideosQuerySchema = z
  .object({
    cursor: z
      .string()
      .max(200)
      .regex(/^[A-Za-z0-9_-]+$/)
      .optional(),
    // Module 19: `size` lists the biggest first (See What Uses Space).
    sort: z.enum(['newest', 'oldest', 'size']).default('newest'),
  })
  .strict();
export type ListVideosQuery = z.infer<typeof listVideosQuerySchema>;

export const startUploadSchema = z
  .object({
    name: z.string().trim().min(1).max(255),
    bytes: z.number().int().positive().max(MAX_DECLARED_BYTES),
    mimeType: z.string().trim().min(1).max(100),
  })
  .strict();
export type StartUploadInput = z.infer<typeof startUploadSchema>;

/**
 * Module 12 (D13-09): one file picked in Google's Drive picker. The access
 * token is short-lived and only good for the files the person picked
 * (`drive.file`); the Zod pipe logs field paths only, never values.
 */
export const driveImportSchema = z
  .object({
    fileId: z.string().regex(/^[A-Za-z0-9_-]{10,200}$/),
    accessToken: z.string().min(1).max(4096),
  })
  .strict();
export type DriveImportInput = z.infer<typeof driveImportSchema>;

const partNumber = z.number().int().min(1).max(MAX_PART_NUMBER);

export const signPartsSchema = z
  .object({
    partNumbers: z
      .array(partNumber)
      .min(1)
      .max(MAX_PARTS_PER_REQUEST)
      .refine((numbers) => new Set(numbers).size === numbers.length, 'A part is listed twice'),
  })
  .strict();
export type SignPartsInput = z.infer<typeof signPartsSchema>;

export const completeUploadSchema = z
  .object({
    parts: z
      .array(z.object({ partNumber, etag: z.string().trim().min(1).max(200) }).strict())
      .min(1)
      .max(MAX_PART_NUMBER),
  })
  .strict();
export type CompleteUploadInput = z.infer<typeof completeUploadSchema>;

/** An upload id as the private storage bindings make them (S3 and local). */
export const UPLOAD_ID_PATTERN = /^[A-Za-z0-9._~-]{1,1024}$/;
