/**
 * Bodies of the AI gateway routes (Module 11): the binding plus the step's
 * settings with its data already filled in by the worker. The worker clips
 * long text to these limits before it calls, so a step never fails on a
 * length the person cannot see.
 */
import { PUBLISH_PLATFORM_IDS } from '@postgear/automation';
import { z } from 'zod';
import { gatewayBindingSchema } from './gateway.schema';

/** The longest prompt or text an AI step sends (the worker clips to these). */
export const AI_STEP_PROMPT_MAX = 8_000;
export const AI_STEP_TEXT_MAX = 10_000;

const platform = z.enum(['generic', ...PUBLISH_PLATFORM_IDS]);
const voice = z.enum(['personal', 'company']);

export const gatewayAiTextSchema = gatewayBindingSchema
  .extend({
    prompt: z.string().trim().min(1).max(AI_STEP_PROMPT_MAX),
    platform,
    voice,
    format: z.enum(['one_short', 'one_long', 'thread_short', 'thread_long']),
    research: z.boolean(),
    withImage: z.boolean(),
  })
  .strict();

export const gatewayAiImageSchema = gatewayBindingSchema
  .extend({
    prompt: z.string().trim().min(1).max(AI_STEP_PROMPT_MAX),
    style: z.enum(['photo', 'illustration', 'flat']).optional(),
  })
  .strict();

export const gatewayAiHashtagsSchema = gatewayBindingSchema
  .extend({
    text: z.string().trim().min(1).max(AI_STEP_TEXT_MAX),
    platform,
    count: z.number().int().min(3).max(15),
  })
  .strict();

export const gatewayAiRewriteSchema = gatewayBindingSchema
  .extend({
    text: z.string().trim().min(1).max(AI_STEP_TEXT_MAX),
    platform,
    voice,
  })
  .strict();

export type GatewayAiTextInput = z.infer<typeof gatewayAiTextSchema>;
export type GatewayAiImageInput = z.infer<typeof gatewayAiImageSchema>;
export type GatewayAiHashtagsInput = z.infer<typeof gatewayAiHashtagsSchema>;
export type GatewayAiRewriteInput = z.infer<typeof gatewayAiRewriteSchema>;
