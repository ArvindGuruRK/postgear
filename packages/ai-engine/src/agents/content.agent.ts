/**
 * The content pipeline: a LangGraph `StateGraph` that turns a brief into a
 * post in five stages.
 *
 * ```
 * START → research → classify → hook → content ─┬─(withImage)─→ image → END
 *                                               └─────────────────────→ END
 * ```
 *
 * Why a graph and not one prompt: each stage gets the previous stages' output
 * as *input*, so the hook is written knowing the category and the sources,
 * and the body is written knowing the hook it has to open with. That staged
 * structure (research first, hook before body) is what separates a post that
 * reads like it was written on purpose from a model's first paragraph — the
 * same reasoning the reference Postiz graph follows. Keeping it a real
 * `StateGraph` rather than a chain of awaits also gives the API a place to
 * attach LangGraph's streaming and tracing later without restructuring.
 *
 * Why events: a run takes tens of seconds. Every node reports `stage started
 * / done / skipped / failed` plus its data (`research`, `category`, `hook`,
 * `content`, `image`) through the run's `onEvent`, which the API relays as
 * SSE so the browser shows research arriving, then the hook, then the copy.
 *
 * Failure policy (contract §1, §2): research and image failures are reported
 * and survived — the post is still produced, just without citations or a
 * hero image. Classify, hook and content failures are the run's failure.
 * Every provider error reaches the caller as an {@link AiProviderError};
 * an abort surfaces as kind `aborted`.
 *
 * Per-run values that are not state (the event sink, the logger) travel in
 * LangGraph's typed runtime `context`; the abort signal is the runtime's.
 */
import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import {
  abortError,
  classifyError,
  normaliseRunError,
  providerError,
  redactSecrets,
} from '../model/resilience';
import { buildClassifyPrompt, classifySchema } from '../prompts/classify';
import {
  buildContentPrompt,
  cleanPartText,
  contentSchema,
  ensureHookLeads,
  partLimits,
  truncateAtSentence,
} from '../prompts/content';
import { buildHookPrompt, hookSchema } from '../prompts/hook';
import type {
  AiProviderError,
  ContentPipeline,
  GeneratedPart,
  GenerateEvent,
  GenerateOptions,
  GenerateRequest,
  GenerateResult,
  GenerateStage,
  ImageGenerator,
  ImageSink,
  ModelClient,
  ResearchProvider,
  ResearchSource,
  StageStatus,
} from '../types';

export interface ContentPipelineLogger {
  warn(message: string, meta?: Record<string, unknown>): void;
}

export interface ContentPipelineDeps {
  model: ModelClient;
  /** Null skips research with a `stage research skipped` event. */
  research: ResearchProvider | null;
  /** Both null skip images; one without the other is a configuration error. */
  images: ImageGenerator | null;
  imageSink: ImageSink | null;
  /** Optional structured logger; defaults to silence. */
  logger?: ContentPipelineLogger;
}

export const RESEARCH_QUERY_MAX_CHARS = 300;
export const IMAGE_NAME_MAX_CHARS = 60;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const last = <T>() => ({ reducer: (_current: T, update: T) => update });

const ContentState = Annotation.Root({
  request: Annotation<GenerateRequest>(),
  sources: Annotation<ResearchSource[]>({ ...last<ResearchSource[]>(), default: () => [] }),
  researched: Annotation<boolean>({ ...last<boolean>(), default: () => false }),
  category: Annotation<string>({ ...last<string>(), default: () => '' }),
  hookText: Annotation<string>({ ...last<string>(), default: () => '' }),
  parts: Annotation<GeneratedPart[]>({ ...last<GeneratedPart[]>(), default: () => [] }),
});

type ContentStateType = typeof ContentState.State;

interface RunContext {
  emit: (event: GenerateEvent) => void;
  logger: ContentPipelineLogger;
}

const RunContextSchema = Annotation.Root({
  run: Annotation<RunContext>(),
});

type Runtime = { context?: { run?: RunContext }; signal?: AbortSignal };

const SILENT: ContentPipelineLogger = { warn: () => undefined };

function runOf(runtime: Runtime): { ctx: RunContext; signal: AbortSignal | undefined } {
  const ctx = runtime.context?.run ?? { emit: () => undefined, logger: SILENT };
  return { ctx, signal: runtime.signal };
}

function stage(ctx: RunContext, name: GenerateStage, status: StageStatus, detail?: string): void {
  ctx.emit(
    detail === undefined
      ? { type: 'stage', stage: name, status }
      : { type: 'stage', stage: name, status, detail },
  );
}

/** A short, secret-free explanation for a `failed` stage detail. */
function failureDetail(error: AiProviderError): string {
  return redactSecrets(error.message);
}

export function researchQueryFor(topic: string): string {
  const trimmed = topic.replace(/\s+/g, ' ').trim();
  return trimmed.length > RESEARCH_QUERY_MAX_CHARS
    ? trimmed.slice(0, RESEARCH_QUERY_MAX_CHARS).trim()
    : trimmed;
}

export function imageNameFor(prompt: string): string {
  const clean = prompt.replace(/\s+/g, ' ').trim();
  return `AI image — ${clean.length > IMAGE_NAME_MAX_CHARS ? `${clean.slice(0, IMAGE_NAME_MAX_CHARS).trim()}…` : clean}`;
}

/**
 * The length guard, as a pure function: trims extra parts, cleans the text,
 * puts the hook first and reports which parts still exceed the ceiling so
 * the caller can decide between a repair pass and truncation.
 */
export function normaliseParts(
  raw: Array<{ text: string; imagePrompt?: string | null }>,
  hook: string,
  limits: { maxParts: number; maxChars: number },
): { parts: GeneratedPart[]; overflow: number[] } {
  const parts: GeneratedPart[] = raw.slice(0, limits.maxParts).map((part, index) => {
    const cleaned = cleanPartText(part.text);
    return {
      text: index === 0 ? ensureHookLeads(cleaned, cleanPartText(hook)) : cleaned,
      imagePrompt:
        index === 0 && typeof part.imagePrompt === 'string' && part.imagePrompt.trim().length > 0
          ? part.imagePrompt.trim()
          : null,
      image: null,
    };
  });
  const overflow: number[] = [];
  for (const [index, part] of parts.entries()) {
    if (part.text.length > limits.maxChars) overflow.push(index);
  }
  return { parts, overflow };
}

// ---------------------------------------------------------------------------
// The graph
// ---------------------------------------------------------------------------

export function createContentPipeline(deps: ContentPipelineDeps): ContentPipeline {
  if ((deps.images === null) !== (deps.imageSink === null)) {
    throw new Error(
      '@postgear/ai-engine: an image generator and an image sink must be configured together',
    );
  }
  const logger = deps.logger ?? SILENT;

  const research = async (state: ContentStateType, runtime: Runtime) => {
    const { ctx, signal } = runOf(runtime);
    if (deps.research === null) {
      stage(ctx, 'research', 'skipped', 'No research provider configured');
      return { sources: [], researched: false };
    }
    stage(ctx, 'research', 'started');
    try {
      const sources = await deps.research.search(researchQueryFor(state.request.topic), { signal });
      ctx.emit({ type: 'research', sources });
      stage(
        ctx,
        'research',
        'done',
        sources.length === 0
          ? 'No sources found'
          : `${sources.length} ${sources.length === 1 ? 'source' : 'sources'} found`,
      );
      return { sources, researched: sources.length > 0 };
    } catch (error) {
      const failure = classifyError(error);
      if (failure.kind === 'aborted' || signal?.aborted) throw failure;
      logger.warn('research failed; continuing without sources', {
        provider: deps.research.name,
        kind: failure.kind,
        message: failure.message,
      });
      stage(ctx, 'research', 'failed', failureDetail(failure));
      return { sources: [], researched: false };
    }
  };

  const classify = async (state: ContentStateType, runtime: Runtime) => {
    const { ctx, signal } = runOf(runtime);
    stage(ctx, 'classify', 'started');
    const prompt = buildClassifyPrompt({ topic: state.request.topic, sources: state.sources });
    const { category } = await deps.model.structured({ schema: classifySchema, ...prompt, signal });
    ctx.emit({ type: 'category', category });
    stage(ctx, 'classify', 'done', category);
    return { category };
  };

  const hook = async (state: ContentStateType, runtime: Runtime) => {
    const { ctx, signal } = runOf(runtime);
    stage(ctx, 'hook', 'started');
    const prompt = buildHookPrompt({
      topic: state.request.topic,
      tone: state.request.tone,
      category: state.category,
      sources: state.sources,
      platforms: state.request.platforms,
      workspaceName: state.request.workspaceName,
    });
    const output = await deps.model.structured({ schema: hookSchema, ...prompt, signal });
    const text = cleanPartText(output.hook)
      .replace(/^["“]|["”]$/g, '')
      .trim();
    if (text.length === 0) throw providerError('bad_output', { message: 'The hook was empty.' });
    ctx.emit({ type: 'hook', hook: text });
    stage(ctx, 'hook', 'done');
    return { hookText: text };
  };

  const content = async (state: ContentStateType, runtime: Runtime) => {
    const { ctx, signal } = runOf(runtime);
    stage(ctx, 'content', 'started');
    const { request } = state;
    const limits = partLimits(request.format, request.maxCharacters);
    const schema = contentSchema(request.withImage);
    const base = {
      topic: request.topic,
      tone: request.tone,
      format: request.format,
      category: state.category,
      hook: state.hookText,
      withImage: request.withImage,
      maxCharacters: request.maxCharacters,
      platforms: request.platforms,
      sources: state.sources,
      workspaceName: request.workspaceName,
    };

    const first = await deps.model.structured({ schema, ...buildContentPrompt(base), signal });
    let { parts, overflow } = normaliseParts(first.parts, state.hookText, limits);

    if (overflow.length > 0) {
      // One repair pass with the exact overflow in front of the model.
      const repairNote = overflow
        .map(
          (index) =>
            `Part ${index + 1} is ${parts[index].text.length} characters; the limit is ${limits.maxChars}. Shorten it without dropping the hook.`,
        )
        .join('\n');
      const repaired = await deps.model.structured({
        schema,
        ...buildContentPrompt({ ...base, repairNote }),
        signal,
      });
      const second = normaliseParts(repaired.parts, state.hookText, limits);
      if (second.overflow.length < overflow.length || second.overflow.length === 0) {
        parts = second.parts;
        overflow = second.overflow;
      }
    }

    if (overflow.length > 0) {
      // Last resort: never return an over-limit part when the limit is known.
      logger.warn('content exceeded the limit after repair; truncating', {
        parts: overflow.map((index) => index + 1),
        maxChars: limits.maxChars,
      });
      parts = parts.map((part, index) =>
        overflow.includes(index)
          ? { ...part, text: truncateAtSentence(part.text, limits.maxChars) }
          : part,
      );
    }

    if (parts.length < limits.minParts) {
      logger.warn('content returned fewer parts than the format asks for', {
        parts: parts.length,
        minParts: limits.minParts,
      });
    }

    ctx.emit({ type: 'content', parts });
    stage(ctx, 'content', 'done', `${parts.length} ${parts.length === 1 ? 'part' : 'parts'}`);
    return { parts };
  };

  const image = async (state: ContentStateType, runtime: Runtime) => {
    const { ctx, signal } = runOf(runtime);
    const generator = deps.images;
    const sink = deps.imageSink;
    if (generator === null || sink === null) {
      stage(ctx, 'image', 'skipped', 'Image generation is not configured');
      return {};
    }
    const first = state.parts[0];
    if (!first) {
      stage(ctx, 'image', 'skipped', 'No content to illustrate');
      return {};
    }
    stage(ctx, 'image', 'started');
    const prompt =
      first.imagePrompt ?? `An illustration for a social media post about: ${state.hookText}`;
    try {
      const generated = await generator.generate(prompt, { signal });
      const saved = await sink.save(generated, { prompt, name: imageNameFor(prompt) });
      ctx.emit({ type: 'image', index: 0, image: saved });
      stage(ctx, 'image', 'done');
      return { parts: [{ ...first, image: saved }, ...state.parts.slice(1)] };
    } catch (error) {
      const failure = classifyError(error);
      if (failure.kind === 'aborted' || signal?.aborted) throw failure;
      logger.warn('image generation failed; returning the post without one', {
        provider: generator.name,
        kind: failure.kind,
        message: failure.message,
      });
      stage(ctx, 'image', 'failed', failureDetail(failure));
      return {};
    }
  };

  const wantsImage = (state: ContentStateType, runtime: Runtime): 'image' | typeof END => {
    if (state.request.withImage) return 'image';
    const { ctx } = runOf(runtime);
    stage(ctx, 'image', 'skipped', 'No image requested');
    return END;
  };

  const graph = new StateGraph(ContentState, RunContextSchema)
    .addNode('research', research)
    .addNode('classify', classify)
    .addNode('hook', hook)
    .addNode('content', content)
    .addNode('image', image)
    .addEdge(START, 'research')
    .addEdge('research', 'classify')
    .addEdge('classify', 'hook')
    .addEdge('hook', 'content')
    .addConditionalEdges('content', wantsImage, { image: 'image', [END]: END })
    .addEdge('image', END)
    .compile();

  return {
    async generate(
      request: GenerateRequest,
      options: GenerateOptions = {},
    ): Promise<GenerateResult> {
      const emit = options.onEvent ?? (() => undefined);
      if (options.signal?.aborted) throw abortError(options.signal.reason);

      let final: ContentStateType;
      try {
        final = await graph.invoke(
          { request },
          { context: { run: { emit, logger } }, signal: options.signal },
        );
      } catch (error) {
        throw normaliseRunError(error, options.signal);
      }

      const result: GenerateResult = {
        tone: request.tone,
        format: request.format,
        category: final.category,
        hook: final.hookText,
        parts: final.parts,
        sources: final.sources,
        researched: final.researched,
      };
      emit({ type: 'done', result });
      return result;
    },
  };
}
