/**
 * `@postgear/ai-engine`: the content pipeline, the copilot, and the
 * providers they run on.
 *
 * A pure library: no Nest, no Prisma, no environment reads, no storage.
 * The API composes it from these factories according to its configuration:
 *
 * - a model client: {@link createOpenAiModelClient} with a key, or
 *   {@link createSimulatedModelClient} without one (`AI_SIMULATION=true`);
 * - optionally research: {@link createTavilyResearch} with a key, wrapped
 *   in {@link withResearchCache} over Redis, or {@link createSimulatedResearch};
 * - optionally images: {@link createOpenAiImageGenerator} plus the API's
 *   own `ImageSink` into the media library;
 *
 * then {@link createContentPipeline} and {@link createCopilotAgent} take
 * those seams and the API's tools, and {@link createSeoAdvisor} (Sprint 7)
 * takes the model alone. Everything the API programs against is re-exported
 * from `./types`.
 */
import {
  createContentPipeline as buildContentPipeline,
  type ContentPipelineDeps,
} from './agents/content.agent';
import {
  createCopilotAgent as buildCopilotAgent,
  type CopilotAgentDeps,
} from './agents/copilot.agent';
import {
  createSeoAdvisor as buildSeoAdvisor,
  type SeoAdvisorDeps,
} from './agents/seo-advisor.agent';
import {
  createOpenAiModelClient as buildOpenAiModelClient,
  type OpenAiModelClientOptions,
} from './model/openai-model-client';
import { createSimulatedModelClient as buildSimulatedModelClient } from './model/simulated-model-client';
import {
  createOpenAiImageGenerator as buildOpenAiImageGenerator,
  type OpenAiImageGeneratorOptions,
} from './tools/dalle-image.tool';
import {
  createSimulatedResearch as buildSimulatedResearch,
  createTavilyResearch as buildTavilyResearch,
  type ResearchCacheLogger,
  type TavilyResearchOptions,
  withResearchCache as wrapResearchCache,
} from './tools/tavily-search.tool';
import type {
  ContentPipeline,
  CopilotAgent,
  ImageGenerator,
  ModelClient,
  ResearchCache,
  ResearchProvider,
  SeoAdvisor,
} from './types';

export type { ContentPipelineDeps, ContentPipelineLogger } from './agents/content.agent';
export type { CopilotAgentDeps } from './agents/copilot.agent';
export {
  normaliseAdvice,
  SEO_ADVICE_MAX_RETURNED,
  type SeoAdvisorDeps,
  type SeoAdvisorLogger,
} from './agents/seo-advisor.agent';
export {
  classifyError,
  isRetryableKind,
  normaliseRunError,
  redactSecrets,
  withDeadline,
  withRetry,
  withTimeout,
} from './model/resilience';
export { type PartLimits, partLimits } from './prompts/content';
export {
  buildSeoAdvicePrompt,
  formatFindingLine,
  parseFindingLine,
  SEO_ADVICE_MAX_RECOMMENDATIONS,
  seoAdviceSchema,
} from './prompts/seo-advice';
export { researchCacheKey } from './tools/tavily-search.tool';
export * from './types';

export type OpenAiModelOptions = OpenAiModelClientOptions;
export type OpenAiImageOptions = OpenAiImageGeneratorOptions;
export type TavilyOptions = TavilyResearchOptions;

export function createContentPipeline(deps: ContentPipelineDeps): ContentPipeline {
  return buildContentPipeline(deps);
}

export function createCopilotAgent(deps: CopilotAgentDeps): CopilotAgent {
  return buildCopilotAgent(deps);
}

/** The SEO analyzer's advice (Sprint 7): one structured call over the audit's findings. */
export function createSeoAdvisor(deps: SeoAdvisorDeps): SeoAdvisor {
  return buildSeoAdvisor(deps);
}

export function createOpenAiModelClient(options: OpenAiModelOptions): ModelClient {
  return buildOpenAiModelClient(options);
}

/** Deterministic, key-free model for local development and tests. */
export function createSimulatedModelClient(): ModelClient {
  return buildSimulatedModelClient();
}

export function createTavilyResearch(options: TavilyOptions): ResearchProvider {
  return buildTavilyResearch(options);
}

/** Canned sources, so the "backed by research" treatment can be seen without a key. */
export function createSimulatedResearch(): ResearchProvider {
  return buildSimulatedResearch();
}

/** Caches results by normalized query so a retry does not pay for the same search twice. */
export function withResearchCache(
  provider: ResearchProvider,
  cache: ResearchCache,
  ttlSeconds?: number,
  /** Receives cache read/write failures, which are ignored otherwise. */
  logger?: ResearchCacheLogger,
): ResearchProvider {
  return wrapResearchCache(provider, cache, ttlSeconds, logger);
}

export function createOpenAiImageGenerator(options: OpenAiImageOptions): ImageGenerator {
  return buildOpenAiImageGenerator(options);
}
