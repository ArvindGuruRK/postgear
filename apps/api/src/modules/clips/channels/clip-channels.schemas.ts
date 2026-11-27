/**
 * Bodies, queries and path values of the channel routes. Strict: an unknown
 * key is refused. The handle is only trimmed and bounded here; whether it can
 * be a channel (and whether it is really a video link) is `validateHandle`'s
 * answer in the service, so the person gets one of our sentences.
 */
import {
  CHANNEL_PLATFORMS,
  LINK_MAX_LENGTH,
  LIST_KINDS,
  LIST_PERIODS,
  LIST_SORTS,
} from '@postgear/video-engine';
import { z } from 'zod';
import { CURSOR_MAX_LENGTH } from './channel-cursor';

/** `TWITCH` (the database's spelling, as the web sends it) or `twitch`, read as the engine's id. */
const platformSchema = z
  .string()
  .max(16)
  .transform((value) => value.toLowerCase())
  .pipe(z.enum(CHANNEL_PLATFORMS));

export const addChannelSchema = z
  .object({
    platform: platformSchema,
    handle: z.string().trim().min(1).max(LINK_MAX_LENGTH),
  })
  .strict();

export type AddChannelInput = z.infer<typeof addChannelSchema>;

export const listStreamsQuerySchema = z
  .object({
    kind: z.enum(LIST_KINDS).optional(),
    cursor: z.string().min(1).max(CURSOR_MAX_LENGTH).optional(),
    sort: z.enum(LIST_SORTS).optional(),
    period: z.enum(LIST_PERIODS).optional(),
    hidden: z.enum(['true', 'false']).optional(),
  })
  .strict();

export type ListStreamsQuery = z.infer<typeof listStreamsQuerySchema>;

/** A listed item's id: what Twitch, YouTube and Kick use, nothing that could be a path. */
export const LISTED_ID = /^[A-Za-z0-9_-]{1,128}$/;
