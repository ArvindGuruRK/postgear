/**
 * Media passed between steps (Sprint 10, Module 10).
 *
 * Generate Image (Module 11) outputs `image: MediaRef`; Get Post outputs a
 * list of them; Create Draft, Add To Queue and Publish To take one or a
 * list in their Media field. The id is a `Media` row of the workspace, so
 * the API attaches it exactly as the composer would (and refuses a foreign
 * one with the composer's own words).
 *
 * Built-in sample data uses `SAMPLE_MEDIA_ID`: it is not a real row, so a
 * posting step drops it (and says so) instead of failing a test run.
 */
import { z } from 'zod';

export const SAMPLE_MEDIA_ID = 'sample';

export const mediaRefSchema = z
  .object({
    kind: z.literal('media'),
    id: z.string().min(1).max(64),
    url: z.string().max(2_048).optional(),
    type: z.enum(['image', 'video']),
    alt: z.string().max(1_000).optional(),
  })
  .passthrough();

export type MediaRef = z.infer<typeof mediaRefSchema>;

export const MEDIA_FIELD_MESSAGE = 'The media field needs an image or video from an earlier step.';

export function isMediaRef(value: unknown): value is MediaRef {
  return mediaRefSchema.safeParse(value).success;
}

/**
 * The media a resolved Media field holds: nothing for empty text, the refs
 * of a `MediaRef` or a list of them (empty entries skipped). Anything else
 * (plain text, a link, a number) is `{ ok: false }` with the sentence the
 * step fails with.
 */
export function mediaRefsFrom(
  value: unknown,
): { ok: true; refs: MediaRef[] } | { ok: false; message: string } {
  if (value === undefined || value === null) return { ok: true, refs: [] };
  if (typeof value === 'string' && value.trim() === '') return { ok: true, refs: [] };

  const items = Array.isArray(value) ? value : [value];
  const refs: MediaRef[] = [];
  for (const item of items) {
    if (item === null || item === undefined || item === '') continue;
    const parsed = mediaRefSchema.safeParse(item);
    if (!parsed.success) return { ok: false, message: MEDIA_FIELD_MESSAGE };
    refs.push(parsed.data);
  }
  return { ok: true, refs };
}
