/**
 * Bodies of the posts gateway routes (Module 10): the binding plus the
 * step's data, already resolved by the worker (tokens filled in, media
 * references turned into Media library ids, a chosen time turned into an
 * ISO instant). Strict, like every body.
 */
import { PUBLISH_PLATFORM_IDS } from '@postgear/automation';
import { z } from 'zod';
import { MAX_CHANNELS_PER_POST, MAX_TAGS_PER_POST } from '../../posts/dto/posts.schema';
import { gatewayBindingSchema } from './gateway.schema';

/** Media one step may attach (the first part's), as the composer allows on one part. */
export const MAX_STEP_MEDIA = 20;

/** Text one step may send; the posts schema checks each part again. */
const MAX_STEP_TEXT = 70_000;

const postContent = {
  channels: z.array(z.string().min(1).max(64)).min(1).max(MAX_CHANNELS_PER_POST),
  text: z.string().max(MAX_STEP_TEXT),
  mediaIds: z.array(z.string().uuid()).max(MAX_STEP_MEDIA),
  tags: z.array(z.string().min(1).max(64)).max(MAX_TAGS_PER_POST).optional(),
};

export const draftBodySchema = gatewayBindingSchema
  .extend({ ...postContent, parts: z.enum(['single', 'splitOnBlankLines']).optional() })
  .strict();

export const queueBodySchema = gatewayBindingSchema
  .extend({
    ...postContent,
    when: z.enum(['nextSlot', 'at']),
    /** Only with `at`: the instant, resolved by the worker in the step's zone. */
    at: z.string().datetime({ offset: true }).optional(),
    timeZone: z.string().min(1).max(64),
  })
  .strict()
  .refine((body) => body.when !== 'at' || body.at !== undefined, 'A chosen time needs `at`');

export const publishBodySchema = gatewayBindingSchema
  .extend({
    ...postContent,
    provider: z.enum(PUBLISH_PLATFORM_IDS),
    /** The platform's settings form; judged per channel by the posts service. */
    settings: z.record(z.string().max(64), z.unknown()).optional(),
  })
  .strict();

export const getPostBodySchema = gatewayBindingSchema
  .extend({ post: z.string().max(200) })
  .strict();

export type DraftBody = z.infer<typeof draftBodySchema>;
export type QueueBody = z.infer<typeof queueBodySchema>;
export type PublishBody = z.infer<typeof publishBodySchema>;
export type GetPostBody = z.infer<typeof getPostBodySchema>;
