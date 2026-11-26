/**
 * Pieces every activity shape is built from.
 *
 * Written with Zod's version 4 API (`zod/v4`), the only one whose shapes
 * `z.toJSONSchema` can export. Never mixed with the repo's version 3 shapes.
 */
import { z } from 'zod/v4';
import { MEDIA_CONTRACT_VERSION } from '../names';

/**
 * A private Clips storage key, the same allowlist as `@postgear/storage`'s
 * `isValidClipKey` (the `fixtures/keys/examples.json` list is checked by Jest
 * against that function and by pytest against the Python copy). Keys cross
 * the boundary; paths and addresses never do.
 */
export const CLIP_KEY_PATTERN_SOURCE =
  '^clips/[a-z0-9]{1,36}(?:-[a-z0-9]{1,36}){0,7}/(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[a-z][a-z0-9]*(?:-[a-z0-9]+){0,4}-[0-9a-f]{32}|(?:exports|proofs|downloads)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[a-z0-9]+(?:[-_][a-z0-9]+){0,7}|library/[0-9a-f]{32})\\.(?:mp4|webm|mkv|mov|m4a|mp3|wav|ogg|opus|aac|jpg|png|apng|gif|webp|json|json\\.gz|ass|vtt)$';

export const storageKey = z
  .string()
  .max(512)
  .regex(new RegExp(CLIP_KEY_PATTERN_SOURCE))
  .meta({ id: 'StorageKey', description: 'A private Clips storage key, never a path' });

/** The contract version every input carries. */
export const contractVersion = z.literal(MEDIA_CONTRACT_VERSION);

/** A lowercase UUID (job, video, workspace ids that are UUIDs). */
export const uuid = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  .meta({ id: 'Uuid' });

/** A workspace id: a UUID, or a seeded slug such as `seed-demo-org`. */
export const orgId = z
  .string()
  .max(64)
  .regex(/^[a-z0-9]{1,36}(?:-[a-z0-9]{1,36}){0,7}$/)
  .meta({ id: 'OrgId' });

/** Whole milliseconds of the video's own time. */
export const sourceMs = z
  .number()
  .int()
  .min(0)
  .max(24 * 60 * 60 * 1000);

/** A stretch of the video, in its own time. */
export const timeRange = z
  .strictObject({ fromMs: sourceMs, toMs: sourceMs })
  .refine((range) => range.fromMs < range.toMs, 'A range must end after it starts')
  .meta({ id: 'TimeRange', description: 'A stretch of the video, in its own milliseconds' });
