/**
 * Builds the engine from the environment, once, at boot.
 *
 * Three modes, decided by `engine.config.ts`:
 *
 * - **openai**: the real model, DALL-E, and Tavily research when its key is
 *   set (cached in Redis so a retry does not pay for the same search twice).
 * - **simulation**: the engine's deterministic model and canned research,
 *   plus this module's sharp-drawn images. Everything downstream of the
 *   providers (credits, SSE, tool calling, the media library) runs for real.
 * - **unconfigured**: no model. `/ai/status` says so and the generation
 *   routes answer 503; the UI explains how to fix it.
 *
 * The result is an `AiEngine` behind the `AI_ENGINE` token. This file is the
 * only one in the module that calls the engine's factories, and it has no
 * unit test of its own: every branch here is a wiring of real providers that
 * a test could only mock into meaninglessness. What it wires (the config
 * decision, the image sink, the simulated generator) is tested where it is
 * defined.
 */
import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import {
  AiProviderError,
  createSeoAdvisor as buildSeoAdvisor,
  type ContentPipeline,
  type CopilotAgent,
  type CopilotContext,
  createContentPipeline,
  createCopilotAgent,
  createOpenAiImageGenerator,
  createOpenAiModelClient,
  createSimulatedModelClient,
  createSimulatedResearch,
  createTavilyResearch,
  type ImageGenerator,
  type ModelClient,
  type ResearchProvider,
  type SeoAdvisor,
  withResearchCache,
} from '@postgear/ai-engine';
import { redact } from '../../../common/logging/security-logger';
import type { Env } from '../../../config/env';
import type { MediaService } from '../../media/media.service';
import type { RedisService } from '../../redis/redis.service';
import { AI_MESSAGES } from '../ai.messages';
import { resolveAiConfig } from './engine.config';
import {
  type AiEngine,
  type AiMode,
  type AnyCopilotTool,
  type EngineScope,
  type GeneratedImageOutput,
  imageNameFor,
} from './engine.types';
import { imageSinkFor } from './image-sink';
import { createSimulatedImageGenerator } from './simulated-image.generator';

/** How long a research result stays cached. Short: it is a retry shield, not a corpus. */
const RESEARCH_CACHE_TTL_SECONDS = 600;

export interface EngineFactoryDeps {
  config: ConfigService<Env, true>;
  redis: RedisService;
  media: MediaService;
}

/** The providers a mode supplies. Null means the capability is off. */
export interface EngineProviders {
  mode: AiMode;
  model: ModelClient | null;
  research: ResearchProvider | null;
  images: ImageGenerator | null;
}

export function createAiEngine(deps: EngineFactoryDeps): AiEngine {
  const logger = new Logger('AiEngine');
  const resolved = resolveAiConfig({
    AI_SIMULATION: deps.config.get('AI_SIMULATION', { infer: true }),
    OPENAI_API_KEY: deps.config.get('OPENAI_API_KEY', { infer: true }),
    TAVILY_API_KEY: deps.config.get('TAVILY_API_KEY', { infer: true }),
    AI_MODEL: deps.config.get('AI_MODEL', { infer: true }),
    AI_IMAGE_MODEL: deps.config.get('AI_IMAGE_MODEL', { infer: true }),
  });

  for (const warning of resolved.warnings) {
    logger.warn(warning);
  }

  let providers: EngineProviders;

  switch (resolved.mode) {
    case 'simulation':
      logger.warn(
        'AI_SIMULATION=true: the model, research and images are simulated. ' +
          'Credits, streaming and the media library are real. Not for production.',
      );
      providers = {
        mode: 'simulation',
        model: createSimulatedModelClient(),
        research: createSimulatedResearch(),
        images: createSimulatedImageGenerator(),
      };
      break;
    case 'openai': {
      // `resolved.openAiKey` is non-null in this mode by construction.
      const apiKey = resolved.openAiKey ?? '';
      providers = {
        mode: 'openai',
        model: createOpenAiModelClient({ apiKey, model: resolved.model }),
        research: resolved.tavilyKey
          ? withResearchCache(
              createTavilyResearch({ apiKey: resolved.tavilyKey }),
              // RedisService already has the cache's shape: get, and set with a TTL.
              deps.redis,
              RESEARCH_CACHE_TTL_SECONDS,
            )
          : null,
        images: createOpenAiImageGenerator({ apiKey, model: resolved.imageModel }),
      };
      if (!resolved.tavilyKey) {
        logger.log('TAVILY_API_KEY is not set, so posts will be written without web research.');
      }
      break;
    }
    case 'unconfigured':
      logger.warn(
        'Neither OPENAI_API_KEY nor AI_SIMULATION=true is set, so AI features are off. ' +
          'The /ai routes answer 503 until one of them is.',
      );
      providers = { mode: 'unconfigured', model: null, research: null, images: null };
      break;
  }

  return buildAiEngine(providers, deps.media, logger);
}

/**
 * Assembles an engine from providers. Exported for the module's own wiring
 * only; the service never sees providers, just the engine.
 */
export function buildAiEngine(
  providers: EngineProviders,
  media: Pick<MediaService, 'saveGenerated'>,
  logger: Logger,
): AiEngine {
  const { mode, model, research, images } = providers;
  const engineLogger = {
    warn(message: string, meta?: Record<string, unknown>): void {
      logger.warn(meta ? `${message} ${JSON.stringify(redact(meta))}` : message);
    },
  };

  return {
    mode,
    modelName: model?.name ?? null,
    researchEnabled: research !== null,
    imagesEnabled: images !== null,

    createPipeline(scope: EngineScope): ContentPipeline | null {
      if (!model) {
        return null;
      }

      return createContentPipeline({
        model,
        research,
        images,
        imageSink: images ? imageSinkFor(media, scope.orgId) : null,
        logger: engineLogger,
      });
    },

    createCopilot(
      _scope: EngineScope,
      tools: AnyCopilotTool[],
      context: CopilotContext,
    ): CopilotAgent | null {
      if (!model) {
        return null;
      }

      return createCopilotAgent({ model, tools, context });
    },

    createSeoAdvisor(_scope: EngineScope): SeoAdvisor | null {
      if (!model) {
        return null;
      }

      return buildSeoAdvisor({ model, logger: engineLogger });
    },

    async generateImage(scope, prompt, options): Promise<GeneratedImageOutput> {
      if (!images) {
        throw new AiProviderError('not_configured', AI_MESSAGES.NOT_CONFIGURED, false);
      }

      const image = await images.generate(prompt, options);
      const saved = await imageSinkFor(media, scope.orgId).save(image, {
        prompt,
        name: imageNameFor(prompt),
      });

      return { ...saved, revisedPrompt: image.revisedPrompt };
    },
  };
}
