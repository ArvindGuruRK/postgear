/**
 * Request schemas for posts.
 *
 * ## The document schema is the security boundary for post content
 *
 * `Post.content` holds a structured document (see
 * `packages/social-core/src/composer/document.ts` for why not HTML). This file
 * is where that document is held to a closed allowlist: six node types, three
 * marks, `http`/`https` links only, and no attribute the renderer does not read.
 * Every object is `.strict()`, so an unknown key — an `onclick`, a `style`, a
 * node type from an editor extension nobody reviewed — is rejected rather than
 * stored and trusted later.
 *
 * ## Why the schema is built to a fixed depth
 *
 * A recursive document would naturally use `z.lazy`, and a recursive validator
 * walks as deep as the input goes. Inside the 1 MB body limit an attacker can
 * nest a list tens of thousands of levels deep and overflow the stack. Built
 * explicitly to `MAX_LIST_DEPTH` instead, the schema simply has no shape for a
 * deeper document, and validation cost is bounded by the schema, not the input.
 */
import {
  type BlockNode,
  isSafeHref,
  MAX_LIST_DEPTH,
  type PostDocument,
} from '@postgear/social-core';
import { z } from 'zod';

/** Parts in one thread. Past this, a thread is a blog post. */
export const MAX_THREAD_PARTS = 25;

/** Channels one post may target. */
export const MAX_CHANNELS_PER_POST = 20;

/** Attachments on one part — LinkedIn's twenty-image post is the most generous rule. */
export const MAX_MEDIA_PER_PART = 20;

/** Facebook's 63,206-character limit is the longest any platform allows; this leaves room. */
const MAX_TEXT_LENGTH = 70_000;

const MAX_BLOCKS = 500;
const MAX_INLINE_NODES = 2_000;
const MAX_LIST_ITEMS = 200;
const MAX_ITEM_BLOCKS = 50;

const markSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('bold') }).strict(),
  z.object({ type: z.literal('italic') }).strict(),
  z
    .object({
      type: z.literal('link'),
      attrs: z
        .object({
          href: z.string().max(2_048).refine(isSafeHref, 'Links must be http or https'),
        })
        .strict(),
    })
    .strict(),
]);

const inlineSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('text'),
      text: z.string().min(1).max(MAX_TEXT_LENGTH),
      marks: z.array(markSchema).max(3).optional(),
    })
    .strict(),
  z.object({ type: z.literal('hardBreak') }).strict(),
]);

const inlineContentSchema = z.array(inlineSchema).max(MAX_INLINE_NODES).optional();

const paragraphSchema = z
  .object({ type: z.literal('paragraph'), content: inlineContentSchema })
  .strict();

const headingSchema = z
  .object({
    type: z.literal('heading'),
    attrs: z.object({ level: z.union([z.literal(1), z.literal(2), z.literal(3)]) }).strict(),
    content: inlineContentSchema,
  })
  .strict();

/** Block nodes that may appear `depth` lists deep. Lists are offered only above the limit. */
function blockSchema(depth: number): z.ZodType<BlockNode> {
  if (depth >= MAX_LIST_DEPTH) {
    return z.discriminatedUnion('type', [paragraphSchema, headingSchema]) as z.ZodType<BlockNode>;
  }

  const listItemSchema = z
    .object({
      type: z.literal('listItem'),
      content: z
        .array(blockSchema(depth + 1))
        .min(1)
        .max(MAX_ITEM_BLOCKS)
        // TipTap refuses to load a list item that does not open with a
        // paragraph, so a stored one would be an unopenable draft.
        .refine((blocks) => blocks[0]?.type === 'paragraph', 'List items start with a paragraph'),
    })
    .strict();

  const items = z.array(listItemSchema).min(1).max(MAX_LIST_ITEMS);

  return z.discriminatedUnion('type', [
    paragraphSchema,
    headingSchema,
    z.object({ type: z.literal('bulletList'), content: items }).strict(),
    z
      .object({
        type: z.literal('orderedList'),
        attrs: z
          .object({ start: z.number().int().min(0).max(10_000) })
          .strict()
          .optional(),
        content: items,
      })
      .strict(),
  ]) as z.ZodType<BlockNode>;
}

export const postDocumentSchema: z.ZodType<PostDocument> = z
  .object({
    type: z.literal('doc'),
    content: z.array(blockSchema(0)).min(1).max(MAX_BLOCKS),
  })
  .strict();

const mediaReferenceSchema = z.object({ id: z.string().uuid() }).strict();

export const postPartSchema = z
  .object({
    content: postDocumentSchema,
    media: z
      .array(mediaReferenceSchema)
      .max(MAX_MEDIA_PER_PART)
      .refine(
        (media) => new Set(media.map((item) => item.id)).size === media.length,
        'The same media is attached twice',
      ),
  })
  .strict();

const channelEntrySchema = z
  .object({
    channelId: z.string().min(1).max(64),
    /**
     * True when this channel has its own content. Its parts are then sent in
     * `parts`; otherwise it takes the shared parts and `parts` must be absent.
     */
    customized: z.boolean(),
    parts: z.array(postPartSchema).min(1).max(MAX_THREAD_PARTS).optional(),
  })
  .strict()
  .refine(
    (entry) => entry.customized === (entry.parts !== undefined),
    'Parts are sent for a channel exactly when it is customized',
  );

const postBodyShape = {
  /**
   * Only the states a person may set. `PUBLISHED` and `ERROR` are written by
   * the publisher in Sprint 5, never by a client.
   */
  state: z.enum(['DRAFT', 'QUEUE']),
  publishDate: z.string().datetime({ offset: true }),
  shared: z.array(postPartSchema).min(1).max(MAX_THREAD_PARTS),
  channels: z
    .array(channelEntrySchema)
    .min(1, 'Choose at least one channel')
    .max(MAX_CHANNELS_PER_POST)
    .refine(
      (channels) => new Set(channels.map((entry) => entry.channelId)).size === channels.length,
      'A channel is listed twice',
    ),
};

export const createPostSchema = z.object(postBodyShape).strict();

export const updatePostSchema = z
  .object({
    ...postBodyShape,
    /**
     * The `updatedAt` the editor loaded. A save made against an older version
     * is refused rather than silently overwriting a colleague's changes.
     */
    expectedUpdatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const listPostsQuerySchema = z
  .object({
    state: z.enum(['DRAFT', 'QUEUE', 'PUBLISHED', 'ERROR']).optional(),
  })
  .strict();

export type PostPartInput = z.infer<typeof postPartSchema>;
export type CreatePostInput = z.infer<typeof createPostSchema>;
export type UpdatePostInput = z.infer<typeof updatePostSchema>;
export type ListPostsQuery = z.infer<typeof listPostsQuerySchema>;
