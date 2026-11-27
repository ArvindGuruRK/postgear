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

/**
 * One posting slot (Sprint 13 Module 13): its time, a window either side
 * (0, 5, 15 or 30 minutes) and the ISO weekdays it runs on (1 Monday to 7
 * Sunday, distinct, at least one). Both new fields are optional so an older
 * client's `{ time }` still saves, as every day with no window.
 */
const postingTimeSchema = z
  .object({
    time: z
      .number()
      .int()
      .min(0)
      .max(MINUTES_PER_DAY - 1),
    windowMinutes: z
      .union([z.literal(0), z.literal(5), z.literal(15), z.literal(30)])
      .optional()
      .default(0),
    days: z
      .array(z.number().int().min(1).max(7))
      .min(1, 'Pick at least one day')
      .max(7)
      .refine((days) => new Set(days).size === days.length, 'Each day once')
      .optional()
      .transform((days) => (days ? [...days].sort((a, b) => a - b) : [1, 2, 3, 4, 5, 6, 7])),
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

/**
 * `GET /channels/next-slot` (Sprint 13 Module 13): the chosen channels (the
 * first one's slots are used for the post), the browser's IANA zone (the
 * slots are read in it, as Add To Queue does), and an optional seed that
 * picks the natural minute inside the slot's window.
 */
export const nextSlotQuerySchema = z
  .object({
    /** Comma separated channel ids; `channelIdsOf` splits them. */
    channelIds: z
      .string()
      .max(2000)
      .regex(/^[A-Za-z0-9_-]{1,64}(,[A-Za-z0-9_-]{1,64}){0,29}$/, 'Choose up to 30 channels'),
    timeZone: z.string().min(1).max(64),
    seed: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,64}$/)
      .optional(),
  })
  .strict();
export type NextSlotQuery = z.infer<typeof nextSlotQuerySchema>;

/** The chosen channel ids in order, each once. */
export function channelIdsOf(query: NextSlotQuery): string[] {
  return [...new Set(query.channelIds.split(','))];
}

