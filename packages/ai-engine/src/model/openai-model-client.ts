/**
 * The production model client: OpenAI through LangChain's `ChatOpenAI`.
 *
 * Two operations, each with the contract's safety net around it:
 *
 * - `structured` uses `withStructuredOutput(schema)` so the provider enforces
 *   the JSON shape at the API level; the Zod check in
 *   {@link structuredWithRepair} is the second line, and it is what buys the
 *   one repair attempt when the model's answer is shaped right but wrong
 *   (a category outside the list, a part with no text).
 * - `chat` binds the copilot's tools and *streams*: text deltas are yielded
 *   as they arrive so the browser sees words, not a spinner, and the
 *   `AIMessageChunk`s are concatenated so the tool calls, which only make
 *   sense once every argument chunk has landed, are yielded once, at the
 *   end, with their arguments parsed.
 *
 * `maxRetries: 0` on the SDK because the retry policy lives in
 * `resilience.ts`; two retry loops stacked would make a 429 take minutes.
 * One moderate `temperature` serves every stage: the classify stage's `z.enum`
 * schema constrains it at the provider, so a lower setting would buy nothing.
 */
import type { AIMessageChunk } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';
import type { z } from 'zod';
import type { ModelChunk, ModelClient, ModelMessage, ModelToolSpec } from '../types';
import {
  structuredWithRepair,
  textOfContent,
  toLangChainMessages,
  toModelToolCalls,
} from './model-client';
import { abortError, classifyError, throwIfAborted, withDeadline, withRetry } from './resilience';

export interface OpenAiModelClientOptions {
  apiKey: string;
  model: string;
  /** Per-call deadline. Default 60 000 ms. */
  timeoutMs?: number;
}

export const DEFAULT_MODEL_TIMEOUT_MS = 60_000;

export function createOpenAiModelClient(options: OpenAiModelClientOptions): ModelClient {
  const timeoutMs = options.timeoutMs ?? DEFAULT_MODEL_TIMEOUT_MS;
  const base = {
    apiKey: options.apiKey,
    model: options.model,
    timeout: timeoutMs,
    maxRetries: 0,
  };
  const model = new ChatOpenAI({ ...base, temperature: 0.7 });

  return {
    name: `openai:${options.model}`,

    async structured<T>(params: {
      schema: z.ZodType<T>;
      system: string;
      user: string;
      signal?: AbortSignal;
    }): Promise<T> {
      // The schema is Zod; LangChain accepts it directly and the provider
      // receives the derived JSON schema. `Record<string, any>` is what the
      // library wants for the output type, hence the cast on the way in.
      const runnable = model.withStructuredOutput(
        params.schema as unknown as z.ZodType<Record<string, unknown>>,
      );
      return structuredWithRepair<T>({
        schema: params.schema,
        system: params.system,
        user: params.user,
        signal: params.signal,
        ask: (prompt) =>
          withRetry(
            () =>
              withDeadline(
                (signal) =>
                  runnable.invoke(
                    toLangChainMessages([
                      { role: 'system', content: prompt.system },
                      { role: 'user', content: prompt.user },
                    ]),
                    { signal },
                  ),
                { timeoutMs, signal: params.signal },
              ),
            { signal: params.signal },
          ),
      });
    },

    async *chat(params: {
      messages: ModelMessage[];
      tools: ModelToolSpec[];
      signal?: AbortSignal;
    }): AsyncIterable<ModelChunk> {
      throwIfAborted(params.signal);
      const bound =
        params.tools.length > 0
          ? model.bindTools(
              params.tools.map((tool) => ({
                name: tool.name,
                description: tool.description,
                schema: tool.inputSchema,
              })),
            )
          : model;
      const input = toLangChainMessages(params.messages);

      // The whole stream shares one deadline: a model that stalls mid-answer
      // is as broken as one that never answers.
      const controller = new AbortController();
      const onAbort = () => controller.abort(params.signal?.reason);
      params.signal?.addEventListener('abort', onAbort, { once: true });
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);

      try {
        // Only opening the stream is retried; once tokens have been yielded a
        // retry would replay text the caller already forwarded.
        const stream = await withRetry(() => bound.stream(input, { signal: controller.signal }), {
          signal: params.signal,
        });
        let aggregate: AIMessageChunk | undefined;
        for await (const chunk of stream) {
          aggregate = aggregate ? aggregate.concat(chunk) : chunk;
          const text = textOfContent(chunk.content);
          if (text.length > 0) yield { type: 'text', text };
        }
        const calls = toModelToolCalls(aggregate?.tool_calls);
        if (calls.length > 0) yield { type: 'tool_calls', calls };
      } catch (error) {
        if (params.signal?.aborted) throw abortError(params.signal.reason);
        if (timedOut) throw classifyError({ name: 'TimeoutError', message: 'stream timed out' });
        throw classifyError(error);
      } finally {
        clearTimeout(timer);
        params.signal?.removeEventListener('abort', onAbort);
        if (!controller.signal.aborted) controller.abort();
      }
    },
  };
}
