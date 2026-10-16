/**
 * Request schemas for `/v1` (Sprint 8, contract §5.3).
 *
 * `.strict()` like every schema in this API: an unknown key is refused, not
 * stripped — for a public API that is also the kindest behaviour, because a
 * misspelled `publishAt` that was silently dropped would queue a post for
 * five minutes from now and nobody would know why.
 *
 * These schemas are also the source of the OpenAPI request bodies
 * (`openapi.document.ts` runs them through `zod-to-json-schema`), so every
 * bound here is a bound the documentation states.
 */
import { z } from 'zod';
import { MAX_CHANNELS_PER_POST, MAX_MEDIA_PER_PART } from '../../../posts/dto/posts.schema';

/** The same ceiling the composer's document schema enforces per text node. */
export const MAX_PUBLIC_TEXT_LENGTH = 70_000;

/** The states an integrator may ask for when creating a post. */
export const PUBLIC_CREATE_STATES = ['draft', 'queue'] as const;

/** The states the list may be filtered by. Lowercase, like the create body. */
export const PUBLIC_STATE_FILTERS = ['draft', 'queue', 'published', 'error'] as const;

export const MAX_PUBLIC_PAGE = 10_000;

const channelIdSchema = z.string().min(1).max(64);

export const createPublicPostSchema = z
  .object({
    text: z
      .string()
      .min(1)
      .max(MAX_PUBLIC_TEXT_LENGTH)
      .describe(
        'The post as plain text. A blank line starts a new paragraph; a single newline is a line break within one.',
      ),
    channelIds: z
      .array(channelIdSchema)
      .min(1)
      .max(MAX_CHANNELS_PER_POST)
      .refine(
        (ids) => new Set(ids).size === ids.length,
        'channelIds must not list the same channel twice',
      )
      .describe('Ids from GET /v1/channels.'),
    publishAt: z
      .string()
      .datetime({ offset: true })
      .optional()
      .describe('ISO 8601. Defaults to five minutes from now. A queued post must be in the future.'),
    state: z
      .enum(PUBLIC_CREATE_STATES)
      .default('queue')
      .describe('`queue` schedules the post; `draft` saves it without scheduling.'),
    mediaIds: z
      .array(z.string().uuid())
      .max(MAX_MEDIA_PER_PART)
      .optional()
      .describe('Media library ids to attach to the post.'),
  })
  .strict();

export const listPublicPostsQuerySchema = z
  .object({
    state: z
      .preprocess(
        (value) => (typeof value === 'string' ? value.toLowerCase() : value),
        z.enum(PUBLIC_STATE_FILTERS),
      )
      .optional(),
    page: z.coerce.number().int().min(1).max(MAX_PUBLIC_PAGE).default(1),
  })
  .strict();

export type CreatePublicPostInput = z.infer<typeof createPublicPostSchema>;
export type ListPublicPostsQuery = z.infer<typeof listPublicPostsQuerySchema>;
export type PublicStateFilter = (typeof PUBLIC_STATE_FILTERS)[number];
