/**
 * OpenRouter: one key for many models, through OpenAI's chat API.
 *
 * OpenRouter speaks the same chat completions API as OpenAI (tools,
 * structured output through JSON schema, streaming), so this is the OpenAI
 * client pointed at `https://openrouter.ai/api/v1`, with the same retry,
 * deadline and repair policy around every call. Model ids are OpenRouter's
 * `vendor/model` form (`openai/gpt-4.1-mini`, `anthropic/claude-...`); a bare
 * OpenAI name such as `gpt-4.1-mini` is read as `openai/gpt-4.1-mini`, so the
 * default `AI_MODEL` works unchanged.
 *
 * The app attribution headers OpenRouter reads (`HTTP-Referer`, `X-Title`)
 * are sent only when configured: nothing about the workspace or its people is
 * ever added to a request.
 *
 * Text only. OpenRouter has no DALL-E images endpoint, so images stay on
 * OpenAI (when its key is set) or are off.
 */
import type { ModelClient } from '../types';
import { createOpenAiModelClient, DEFAULT_MODEL_TIMEOUT_MS } from './openai-model-client';

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

export interface OpenRouterModelClientOptions {
  apiKey: string;
  /** `vendor/model`, or a bare OpenAI model name. */
  model: string;
  timeoutMs?: number;
  /** Optional attribution: your site's address (`HTTP-Referer`). */
  appUrl?: string;
  /** Optional attribution: the app's name (`X-Title`). */
  appName?: string;
}

/** A bare OpenAI model name as OpenRouter names it; a `vendor/model` id as given. */
export function openRouterModelId(model: string): string {
  const trimmed = model.trim();
  return trimmed.includes('/') ? trimmed : `openai/${trimmed}`;
}

/** The optional attribution headers, only those that are set. */
export function openRouterHeaders(options: {
  appUrl?: string;
  appName?: string;
}): Record<string, string> | undefined {
  const headers: Record<string, string> = {};
  if (options.appUrl?.trim()) headers['HTTP-Referer'] = options.appUrl.trim();
  if (options.appName?.trim()) headers['X-Title'] = options.appName.trim();
  return Object.keys(headers).length > 0 ? headers : undefined;
}

export function createOpenRouterModelClient(options: OpenRouterModelClientOptions): ModelClient {
  return createOpenAiModelClient({
    apiKey: options.apiKey,
    model: openRouterModelId(options.model),
    timeoutMs: options.timeoutMs ?? DEFAULT_MODEL_TIMEOUT_MS,
    baseURL: OPENROUTER_BASE_URL,
    defaultHeaders: openRouterHeaders(options),
    provider: 'openrouter',
  });
}
