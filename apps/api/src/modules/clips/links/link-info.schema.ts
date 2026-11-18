/**
 * The shape a probe answer must have before the API caches it or answers
 * with it. The worker is ours, but its answer crosses a process boundary and
 * sits in Redis for ten minutes, so it is read like any outside input: known
 * fields only (unknown ones are dropped), bounded strings and lists, whole
 * milliseconds.
 */
import { CLIP_PLATFORMS, LINK_KINDS, type LinkInfo } from '@postgear/video-engine';
import { z } from 'zod';

const formatSchema = z.object({
  id: z.string().min(1).max(32),
  label: z.string().min(1).max(64),
  height: z.number().int().nonnegative().nullable(),
  fps: z.number().nonnegative().nullable(),
  ext: z.enum(['mp4', 'm4a']),
  bytes: z.number().int().nonnegative().nullable(),
  audioOnly: z.boolean(),
});

const replayedSchema = z.object({
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  value: z.number().min(0).max(1),
});

export const linkInfoSchema = z.object({
  platform: z.enum(CLIP_PLATFORMS),
  kind: z.enum(LINK_KINDS),
  externalId: z.string().min(1).max(128),
  canonicalUrl: z.string().url().max(2_000),
  channel: z.string().min(1).max(64).optional(),
  title: z.string().max(1_000),
  channelName: z.string().max(500).nullable(),
  durationMs: z.number().int().nonnegative(),
  live: z.boolean(),
  thumbnailUrl: z.string().max(2_048).nullable(),
  formats: z.array(formatSchema).max(32),
  replayed: z.array(replayedSchema).max(2_000).optional(),
});

/** The answer as `LinkInfo`, or null when it does not have the shape. */
export function parseLinkInfo(value: unknown): LinkInfo | null {
  const parsed = linkInfoSchema.safeParse(value);
  return parsed.success ? (parsed.data as LinkInfo) : null;
}
