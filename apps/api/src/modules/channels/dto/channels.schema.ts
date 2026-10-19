/**
 * Request schemas for the channels module.
 *
 * Every object is `.strict()`, which is the mass-assignment guard the whole API
 * relies on: an unknown key is rejected rather than quietly dropped.
 */
import { z } from 'zod';
import { nameSchema } from '../../auth/dto/common.schema';
import { CHANNEL_COLOR_COUNT } from '../channel-colors';

/**
 * A provider identifier as it appears in a URL segment.
 *
 * Deliberately narrow: the registry rejects anything unknown anyway, but
 * validating the shape first keeps arbitrary strings out of log lines and error
 * messages.
 */
export const providerParamSchema = z
  .string()
  .min(1)
  .max(32)
  .regex(/^[a-z0-9-]+$/, 'Invalid provider');

/** Minutes since local midnight, which is what `Integration.postingTimes` stores. */
const MINUTES_PER_DAY = 24 * 60;

const postingTimeSchema = z
  .object({
    time: z
      .number()
      .int()
      .min(0)
      .max(MINUTES_PER_DAY - 1),
  })
  .strict();

export const updateChannelSchema = z
  .object({
    name: nameSchema.optional(),
    postingTimes: z
      .array(postingTimeSchema)
      // A channel with no slots would be silently unschedulable, and the cap
      // stops an unbounded array being written into a String column.
      .min(1, 'Add at least one posting time')
      .max(48)
      .optional(),
    // The avatar palette slot: one of the `CHANNEL_COLOR_COUNT` colours.
    color: z
      .number()
      .int()
      .min(0)
      .max(CHANNEL_COLOR_COUNT - 1, 'Pick one of the palette colours')
      .optional(),
    // Postiz's "Disable channel" (UI revamp, 2026-10-19). Disabling keeps the
    // queued posts; they fail at publish with the worker's "disabled" reason
    // until the channel is enabled again. Enabling is never refused: a
    // disabled channel already counts toward the plan's limit.
    disabled: z.boolean().optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.name !== undefined ||
      value.postingTimes !== undefined ||
      value.color !== undefined ||
      value.disabled !== undefined,
    'Nothing to update',
  );

/**
 * `PUT /channels/order`: the workspace's channel ids in the order an admin
 * dragged them into. Usually every live channel; any left out keep their
 * place after these. No repeats, and capped so the body stays small (no plan
 * comes near it).
 */
export const reorderChannelsSchema = z
  .object({
    ids: z
      .array(z.string().min(1).max(64))
      .min(1, 'Send at least one channel')
      .max(500)
      .refine((ids) => new Set(ids).size === ids.length, 'A channel appears twice'),
  })
  .strict();

export const selectEntitySchema = z
  .object({
    entityId: z.string().min(1).max(200),
  })
  .strict();

export const connectQuerySchema = z
  .object({
    // PostGear's own Integration.id, never the provider's account id. The
    // reference conflates the two and its reconnect check silently never fires.
    reconnect: z.string().min(1).max(64).optional(),
  })
  .strict();

/**
 * A test publish.
 *
 * Sprint 4 owns the real composer; this exists so the sprint's "publish a test
 * post" requirement is checkable against each provider's `post()` today.
 */
export const testPostSchema = z
  .object({
    message: z.string().min(1).max(25_000),
    media: z
      .array(
        z
          .object({
            type: z.enum(['image', 'video']),
            path: z.string().url(),
            alt: z.string().max(1_000).optional(),
          })
          .strict(),
      )
      .max(10)
      .optional(),
    settings: z.record(z.unknown()).optional(),
  })
  .strict();

export type UpdateChannelInput = z.infer<typeof updateChannelSchema>;
export type ReorderChannelsInput = z.infer<typeof reorderChannelsSchema>;
export type SelectEntityInput = z.infer<typeof selectEntitySchema>;
export type TestPostInput = z.infer<typeof testPostSchema>;
