/**
 * The engine as the AI module sees it.
 *
 * `@postgear/ai-engine` exports factories that each take a key, a model, a
 * cache, a sink. This interface is what they add up to once the environment
 * has been read: a mode, what the mode can do, and three things to build per
 * request. The service, the controller and the copilot tools depend on this
 * and only this (behind the `AI_ENGINE` token, like `TEMPORAL_CONNECT` in
 * the scheduling module), so every one of their tests hands in a fake instead
 * of constructing the real factories.
 *
 * ## Why the pipeline is built per request
 *
 * The engine's `ImageSink` saves bytes it is given and knows nothing about
 * workspaces, while the media library needs an `orgId` on every write. So a
 * pipeline cannot be shared: each request gets one whose sink is bound to the
 * caller's workspace. Compiling the graph is cheap; a cross-tenant image
 * would not be.
 */
import type {
  ContentPipeline,
  CopilotAgent,
  CopilotContext,
  CopilotTool,
  SavedImage,
  SeoAdvisor,
  SnippetWriter,
} from '@postgear/ai-engine';

export type AiMode = 'openai' | 'simulation' | 'unconfigured';

/** `GET /ai/status`. */
export interface AiStatus {
  /** False when `mode` is `unconfigured`: generation endpoints answer 503. */
  configured: boolean;
  mode: AiMode;
  /** "openai:gpt-4.1-mini", "simulation", or null. */
  model: string | null;
  /** Web research is available (a Tavily key, or simulation). */
  research: boolean;
  /** Image generation is available (an OpenAI key, or simulation). */
  images: boolean;
}

/** Which workspace a request belongs to. Everything the engine stores is scoped by it. */
export interface EngineScope {
  orgId: string;
}

export interface PipelineOptions {
  /**
   * Run web research first (Sprint 10's Generate Text step has a switch for
   * it). Research still needs a provider: a Tavily key, or the simulated one
   * under `AI_SIMULATION`. Defaults to true, which is how the AI page and the
   * copilot have always run.
   */
  research?: boolean;
}

/** A tool as the engine's agent accepts it, whatever its input type. */
export type AnyCopilotTool = CopilotTool<never, unknown>;

export interface GeneratedImageOutput extends SavedImage {
  revisedPrompt: string | null;
}

export interface AiEngine {
  readonly mode: AiMode;
  readonly modelName: string | null;
  readonly researchEnabled: boolean;
  readonly imagesEnabled: boolean;

  /** Null when unconfigured. */
  createPipeline(scope: EngineScope, options?: PipelineOptions): ContentPipeline | null;

  /** Hashtags and rewrites in a voice (Sprint 10's workflow steps). Null when unconfigured. */
  createSnippetWriter(scope: EngineScope): SnippetWriter | null;

  /** Null when unconfigured. */
  createCopilot(
    scope: EngineScope,
    tools: AnyCopilotTool[],
    context: CopilotContext,
  ): CopilotAgent | null;

  /**
   * The SEO analyzer's advisor (Sprint 7). Null when unconfigured, in which
   * case the analyzer shows the evaluators' rule-based findings instead.
   */
  createSeoAdvisor(scope: EngineScope): SeoAdvisor | null;

  /**
   * One image, generated and saved to the workspace's media library. Rejects
   * with an `AiProviderError` of kind `not_configured` when images are off.
   */
  generateImage(
    scope: EngineScope,
    prompt: string,
    options?: { signal?: AbortSignal },
  ): Promise<GeneratedImageOutput>;
}

/** Nest injection token for the configured engine. */
export const AI_ENGINE = Symbol('AI_ENGINE');

/** The name a saved AI image gets in the library: the prompt, cut to a label. */
export function imageNameFor(prompt: string): string {
  const label = prompt.replace(/\s+/g, ' ').trim();
  return `AI image: ${label.length > 60 ? `${label.slice(0, 60).trimEnd()}…` : label}`;
}
