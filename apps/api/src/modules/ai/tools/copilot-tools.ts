/**
 * The four things the copilot can do, as the engine's `CopilotTool`s.
 *
 * The engine knows a tool's name, description and input schema and calls
 * `execute`; everything a tool touches (channels, posts, credits, the
 * engine's own pipeline and image generator) comes from the API through
 * `CopilotToolDeps`, bound to one workspace for one request. The names are
 * fixed: the web app renders each by name (`tool-activity.tsx`).
 *
 * ## Credits inside a tool
 *
 * `generate_post` and `generate_image` cost what their standalone routes
 * cost, charged when the tool runs. A tool that cannot be afforded *throws*
 * the out-of-credits message rather than returning something; the engine
 * turns a thrown tool error into `tool_result ok:false` carrying the message,
 * so the model can tell the person why it stopped. `list_channels` and
 * `draft_post` are free.
 *
 * ## What a tool error may say
 *
 * Only this API's own copy. A provider failure is mapped by kind
 * (`ai.errors.ts`); the posts service's refusals are already written for a
 * person; anything else becomes the generic message, with the original in
 * the log.
 */
import { Logger } from '@nestjs/common';
import type {
  CopilotTool,
  GenerateEvent,
  GenerateResult,
  PostFormat,
  SavedImage,
} from '@postgear/ai-engine';
import { documentFromText } from '@postgear/social-core';
import { z } from 'zod';
import type { ChannelsService, ChannelView } from '../../channels/channels.service';
import { MAX_CHANNELS_PER_POST, MAX_THREAD_PARTS } from '../../posts/dto/posts.schema';
import type { PostsService } from '../../posts/posts.service';
import { CopilotToolError, describeFailure } from '../ai.errors';
import { AI_MESSAGES } from '../ai.messages';
import { AI_CREDIT_COSTS, generateCost } from '../credits/credits.policy';
import type { CreditContext, CreditsService } from '../credits/credits.service';
import {
  cleanText,
  FORMAT_VALUES,
  MAX_TOPIC_LENGTH,
  MIN_TOPIC_LENGTH,
  TONE_VALUES,
} from '../dto/ai.schema';
import type { AiEngine, AnyCopilotTool } from '../engine/engine.types';

export interface CopilotToolDeps {
  orgId: string;
  workspaceName: string;
  engine: Pick<AiEngine, 'createPipeline' | 'generateImage'>;
  credits: Pick<CreditsService, 'tryCharge' | 'refund'>;
  /** Read once per request by the service; the tools charge inside it. */
  creditContext: CreditContext;
  channels: Pick<ChannelsService, 'list'>;
  posts: Pick<PostsService, 'create'>;
}

// --- Inputs ---------------------------------------------------------------

export const listChannelsInputSchema = z.object({}).strict();

/**
 * Optional rather than `.default()`: a default makes the schema's input and
 * output types differ, and the engine's `CopilotTool` wants one type for
 * both. The defaults (personal, short, no image) are applied in `execute`.
 */
export const generatePostInputSchema = z
  .object({
    topic: cleanText(MIN_TOPIC_LENGTH, MAX_TOPIC_LENGTH),
    tone: z.enum(TONE_VALUES).optional(),
    format: z.enum(FORMAT_VALUES).optional(),
    withImage: z.boolean().optional(),
  })
  .strict();

/** The longest a single part may be: Facebook's limit, like `posts.schema.ts`. */
const MAX_PART_LENGTH = 70_000;

export const draftPostInputSchema = z
  .object({
    channelIds: z
      .array(z.string().min(1).max(64))
      .min(1)
      .max(MAX_CHANNELS_PER_POST)
      .refine((ids) => new Set(ids).size === ids.length, 'A channel is listed twice'),
    parts: z.array(cleanText(1, MAX_PART_LENGTH)).min(1).max(MAX_THREAD_PARTS),
    /** Attached to the first part only; comment parts cannot carry media. */
    mediaIds: z.array(z.string().min(1).max(64)).max(20).optional(),
  })
  .strict();

export const generateImageInputSchema = z
  .object({
    prompt: cleanText(3, 1_000),
  })
  .strict();

// --- Outputs --------------------------------------------------------------

export interface ListChannelsOutput {
  channels: {
    id: string;
    name: string;
    platform: string;
    providerIdentifier: string;
    health: ChannelView['health'];
    profile: string | null;
  }[];
  summary: string;
}

export interface GeneratePostOutput extends GenerateResult {
  summary: string;
}

export interface DraftPostOutput {
  group: string;
  channelNames: string[];
  parts: number;
  summary: string;
}

export interface GenerateImageOutput extends SavedImage {
  prompt: string;
  summary: string;
}

const FORMAT_LABELS: Record<PostFormat, string> = {
  one_short: 'short post',
  one_long: 'long post',
  thread_short: 'short thread',
  thread_long: 'long thread',
};

const logger = new Logger('CopilotTools');

export function createCopilotTools(deps: CopilotToolDeps): AnyCopilotTool[] {
  return [
    defineTool(listChannelsTool(deps)),
    defineTool(generatePostTool(deps)),
    defineTool(draftPostTool(deps)),
    defineTool(generateImageTool(deps)),
  ];
}

/**
 * Erases a tool's input type for the engine's list. The engine validates
 * every call against `inputSchema` before `execute` sees it, which is what
 * makes the erasure safe.
 */
function defineTool<Input, Output>(tool: CopilotTool<Input, Output>): AnyCopilotTool {
  return tool as unknown as AnyCopilotTool;
}

function listChannelsTool(
  deps: CopilotToolDeps,
): CopilotTool<z.infer<typeof listChannelsInputSchema>, ListChannelsOutput> {
  return {
    name: 'list_channels',
    description:
      'Lists the social channels connected to this workspace: their ids, names, platforms and whether each is healthy. Call it before drafting to a channel by name.',
    inputSchema: listChannelsInputSchema,
    readOnly: true,
    summarize: (output) => output.summary,
    async execute() {
      const channels = await deps.channels.list(deps.orgId);

      return {
        channels: channels.map((channel) => ({
          id: channel.id,
          name: channel.name,
          platform: channel.providerName,
          providerIdentifier: channel.providerIdentifier,
          health: channel.health,
          profile: channel.profile,
        })),
        summary: `Found ${channels.length} ${channels.length === 1 ? 'channel' : 'channels'}`,
      };
    },
  };
}

function generatePostTool(
  deps: CopilotToolDeps,
): CopilotTool<z.infer<typeof generatePostInputSchema>, GeneratePostOutput> {
  return {
    name: 'generate_post',
    description:
      'Writes a social post about a topic through the full pipeline (research, category, hook, copy, optional hero image). Costs 5 credits, plus 10 with an image. Returns the parts to draft.',
    inputSchema: generatePostInputSchema,
    readOnly: false,
    summarize: (output) => output.summary,
    async execute(raw, context) {
      const input = {
        topic: raw.topic,
        tone: raw.tone ?? 'personal',
        format: raw.format ?? 'one_short',
        withImage: raw.withImage ?? false,
      };
      const cost = generateCost(input.withImage);
      const charge = await deps.credits.tryCharge(
        deps.orgId,
        'generate_post',
        cost,
        deps.creditContext,
      );

      if (!charge.ok) {
        throw new CopilotToolError(AI_MESSAGES.outOfCredits(new Date(charge.credits.resetsAt)));
      }

      const pipeline = deps.engine.createPipeline({ orgId: deps.orgId });

      if (!pipeline) {
        await deps.credits.refund(deps.orgId, 'generate_post', cost);
        throw new CopilotToolError(AI_MESSAGES.NOT_CONFIGURED);
      }

      // An image failure is non-fatal to the pipeline, so it is refunded as it
      // happens rather than on the way out. Tracked so a later total failure
      // does not refund it twice.
      let imageRefunded = 0;
      const refunds: Promise<void>[] = [];
      const onEvent = (event: GenerateEvent): void => {
        if (
          input.withImage &&
          imageRefunded === 0 &&
          event.type === 'stage' &&
          event.stage === 'image' &&
          event.status === 'failed'
        ) {
          imageRefunded = AI_CREDIT_COSTS.generate_image;
          refunds.push(deps.credits.refund(deps.orgId, 'generate_image', imageRefunded));
        }
      };

      try {
        const result = await pipeline.generate(
          {
            topic: input.topic,
            tone: input.tone,
            format: input.format,
            withImage: input.withImage,
            maxCharacters: null,
            platforms: [],
            workspaceName: deps.workspaceName,
          },
          { signal: context.signal, onEvent },
        );

        await Promise.all(refunds);

        return { ...result, summary: `Wrote a ${FORMAT_LABELS[input.format]}` };
      } catch (error) {
        refunds.push(deps.credits.refund(deps.orgId, 'generate_post', cost - imageRefunded));
        await Promise.all(refunds);
        throw toToolError('generate_post', deps.orgId, error);
      }
    },
  };
}

function draftPostTool(
  deps: CopilotToolDeps,
): CopilotTool<z.infer<typeof draftPostInputSchema>, DraftPostOutput> {
  return {
    name: 'draft_post',
    description:
      'Saves a post as a draft in the composer for the given channel ids, one entry per part (a thread has several). Plain text only. Media ids attach to the first part. Free. Returns the draft id for the person to open.',
    inputSchema: draftPostInputSchema,
    readOnly: false,
    summarize: (output) => output.summary,
    async execute(input) {
      const available = new Map(
        (await deps.channels.list(deps.orgId)).map((channel) => [channel.id, channel]),
      );
      const chosen = input.channelIds.map((id) => available.get(id));

      if (chosen.some((channel) => channel === undefined)) {
        throw new CopilotToolError(AI_MESSAGES.CHANNEL_UNAVAILABLE);
      }

      const channels = chosen as ChannelView[];

      try {
        const detail = await deps.posts.create(deps.orgId, {
          state: 'DRAFT',
          publishDate: nextFullHour().toISOString(),
          shared: input.parts.map((text, index) => ({
            content: documentFromText(text),
            media: index === 0 ? (input.mediaIds ?? []).map((id) => ({ id })) : [],
          })),
          channels: channels.map((channel) => ({ channelId: channel.id, customized: false })),
        });

        const channelNames = channels.map((channel) => channel.name);

        return {
          group: detail.group,
          channelNames,
          parts: input.parts.length,
          summary: `Drafted a post for ${listNames(channelNames)}`,
        };
      } catch (error) {
        throw toToolError('draft_post', deps.orgId, error);
      }
    },
  };
}

function generateImageTool(
  deps: CopilotToolDeps,
): CopilotTool<z.infer<typeof generateImageInputSchema>, GenerateImageOutput> {
  return {
    name: 'generate_image',
    description:
      'Generates one image from a prompt and saves it to the media library. Costs 10 credits. Returns the media id to attach when drafting.',
    inputSchema: generateImageInputSchema,
    readOnly: false,
    summarize: (output) => output.summary,
    async execute(input, context) {
      const cost = AI_CREDIT_COSTS.generate_image;
      const charge = await deps.credits.tryCharge(
        deps.orgId,
        'generate_image',
        cost,
        deps.creditContext,
      );

      if (!charge.ok) {
        throw new CopilotToolError(AI_MESSAGES.outOfCredits(new Date(charge.credits.resetsAt)));
      }

      try {
        const image = await deps.engine.generateImage({ orgId: deps.orgId }, input.prompt, {
          signal: context.signal,
        });

        return {
          mediaId: image.mediaId,
          url: image.url,
          thumbnailUrl: image.thumbnailUrl,
          prompt: input.prompt,
          summary: 'Generated an image',
        };
      } catch (error) {
        await deps.credits.refund(deps.orgId, 'generate_image', cost);
        throw toToolError('generate_image', deps.orgId, error);
      }
    },
  };
}

/** The top of the next hour, where a copilot draft is parked, like the composer's default. */
export function nextFullHour(now: Date = new Date()): Date {
  const date = new Date(now);
  date.setUTCMinutes(0, 0, 0);
  date.setUTCHours(date.getUTCHours() + 1);
  return date;
}

/** "Acme Marketing", "Acme Marketing and Acme on X", "A, B and C". */
export function listNames(names: string[]): string {
  if (names.length <= 1) {
    return names[0] ?? '';
  }

  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** Logs the real failure and returns the one the model may see. */
function toToolError(tool: string, orgId: string, error: unknown): CopilotToolError {
  if (error instanceof CopilotToolError) {
    return error;
  }

  const described = describeFailure(error);

  logger.warn(
    JSON.stringify({
      event: 'ai.tool_failed',
      tool,
      orgId,
      kind: described.kind,
      reason: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    }),
  );

  return new CopilotToolError(described.message);
}
