/**
 * Request schemas for the AI routes.
 *
 * Both bodies are `.strict()`, as every schema in this API is: an unknown key
 * is refused, not stripped. Free text — the topic, each chat message — has
 * its control and direction-override characters removed before the length
 * check, so a prompt cannot carry an invisible instruction and a stripped
 * one cannot sneak under the minimum.
 *
 * The tone and format enums are spelled out here rather than imported from
 * the engine so this file, and the pipe that uses it, never load the engine
 * at runtime; the `satisfies` clauses keep them in step with its types.
 */
import type { PostFormat, Tone } from '@postgear/ai-engine';
import { z } from 'zod';
import { stripControlChars } from '../../../common/sanitize';
import { MAX_CHANNELS_PER_POST } from '../../posts/dto/posts.schema';

export const TONE_VALUES = ['personal', 'company'] as const satisfies readonly Tone[];

export const FORMAT_VALUES = [
  'one_short',
  'one_long',
  'thread_short',
  'thread_long',
] as const satisfies readonly PostFormat[];

export const MIN_TOPIC_LENGTH = 3;
export const MAX_TOPIC_LENGTH = 2_000;

/** Messages the client sends per turn. The API is stateless; this bounds the prompt. */
export const MAX_CHAT_MESSAGES = 40;
export const MAX_CHAT_MESSAGE_LENGTH = 4_000;

/**
 * Free text, cleaned then bounded. The outer `max` stops a huge body being
 * cleaned at all. Shared with the copilot tools' input schemas.
 */
export function cleanText(min: number, max: number) {
  return z
    .string()
    .max(max)
    .transform((text) => stripControlChars(text).trim())
    .pipe(z.string().min(min).max(max));
}

export const generateSchema = z
  .object({
    topic: cleanText(MIN_TOPIC_LENGTH, MAX_TOPIC_LENGTH),
    tone: z.enum(TONE_VALUES),
    format: z.enum(FORMAT_VALUES),
    withImage: z.boolean(),
    channelIds: z
      .array(z.string().min(1).max(64))
      .min(1, 'Choose at least one channel')
      .max(MAX_CHANNELS_PER_POST)
      .refine((ids) => new Set(ids).size === ids.length, 'A channel is listed twice'),
  })
  .strict();

const chatMessageSchema = z
  .object({
    role: z.enum(['user', 'assistant']),
    content: cleanText(1, MAX_CHAT_MESSAGE_LENGTH),
  })
  .strict();

export const copilotChatSchema = z
  .object({
    messages: z
      .array(chatMessageSchema)
      .min(1)
      .max(MAX_CHAT_MESSAGES)
      .refine(
        (messages) => messages[messages.length - 1]?.role === 'user',
        'The last message must be from the user',
      ),
  })
  .strict();

export type GenerateInput = z.infer<typeof generateSchema>;
export type CopilotChatInput = z.infer<typeof copilotChatSchema>;
