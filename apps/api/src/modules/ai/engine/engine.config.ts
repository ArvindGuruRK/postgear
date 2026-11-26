/**
 * Which engine to build, decided from the environment, and nothing else.
 *
 * Separate from the factory so the decision is a pure function with a test,
 * and so it can be imported without pulling the engine's dependencies in.
 *
 * ## Placeholders count as unset
 *
 * `.env.example` used to ship `sk-proj-openai-api-key` and
 * `tvly-tavily-web-search-api-key`; a copied `.env` still carries them. Taken
 * at face value they would select OpenAI mode and fail on the first call with
 * `invalid_key`, which reads as a bug rather than a missing key. So they are
 * treated as absent, and the boot log says which variable was ignored and
 * why, once.
 *
 * ## Precedence
 *
 * `AI_SIMULATION=true` wins over any key: a developer who turns simulation on
 * wants no bill, even with a real key in the same file. Then the provider:
 * `AI_PROVIDER` when it names one whose key is set; otherwise a real OpenAI
 * key means `openai` and a real OpenRouter key alone means `openrouter`;
 * otherwise `unconfigured`, which the UI explains.
 *
 * ## OpenRouter
 *
 * OpenRouter serves text models only through this engine. Images (hero
 * images, the copilot's `generate_image`) stay on OpenAI: in `openrouter` mode
 * they are on only when an OpenAI key is also set (`imagesKey`).
 */
import type { Env } from '../../../config/env';
import type { AiMode } from './engine.types';

/** The documented placeholders, plus the obvious variants. Case-insensitive. */
const PLACEHOLDERS = new Set([
  'sk-proj-openai-api-key',
  'sk-openai-api-key',
  'tvly-tavily-web-search-api-key',
  'tvly-tavily-api-key',
  'your-api-key',
  'changeme',
]);

export interface ResolvedAiConfig {
  mode: AiMode;
  /** Present only in `openai` mode. */
  openAiKey: string | null;
  /** Present only in `openrouter` mode. */
  openRouterKey: string | null;
  /** The key images are made with: OpenAI's, in either live mode, when it is set. */
  imagesKey: string | null;
  /** OpenRouter's optional attribution, only in `openrouter` mode. */
  openRouterApp: { url?: string; name?: string };
  /** Present only in `openai` mode with a usable Tavily key. */
  tavilyKey: string | null;
  model: string;
  imageModel: string;
  /** One line per ignored variable, for the boot log. */
  warnings: string[];
}

export type AiEnv = Pick<
  Env,
  'AI_SIMULATION' | 'OPENAI_API_KEY' | 'TAVILY_API_KEY' | 'AI_MODEL' | 'AI_IMAGE_MODEL'
> &
  Partial<
    Pick<Env, 'OPENROUTER_API_KEY' | 'AI_PROVIDER' | 'OPENROUTER_APP_URL' | 'OPENROUTER_APP_NAME'>
  >;

export function resolveAiConfig(env: AiEnv): ResolvedAiConfig {
  const warnings: string[] = [];
  const openAiKey = usableKey('OPENAI_API_KEY', env.OPENAI_API_KEY, warnings);
  const openRouterKey = usableKey('OPENROUTER_API_KEY', env.OPENROUTER_API_KEY, warnings);
  const tavilyKey = usableKey('TAVILY_API_KEY', env.TAVILY_API_KEY, warnings);
  const none = {
    openAiKey: null,
    openRouterKey: null,
    imagesKey: null,
    tavilyKey: null,
    openRouterApp: {},
    model: env.AI_MODEL,
    imageModel: env.AI_IMAGE_MODEL,
  };

  if (env.AI_SIMULATION === 'true') {
    return { mode: 'simulation', ...none, warnings };
  }

  let provider: 'openai' | 'openrouter' | null = null;
  if (env.AI_PROVIDER === 'openrouter' && openRouterKey) provider = 'openrouter';
  else if (env.AI_PROVIDER === 'openai' && openAiKey) provider = 'openai';
  else {
    if (env.AI_PROVIDER) {
      warnings.push(
        `AI_PROVIDER is ${env.AI_PROVIDER} but its key is not set, so the other key is used if there is one.`,
      );
    }
    provider = openAiKey ? 'openai' : openRouterKey ? 'openrouter' : null;
  }

  if (!provider) {
    if (tavilyKey) {
      warnings.push(
        'TAVILY_API_KEY is set but neither OPENAI_API_KEY nor OPENROUTER_API_KEY is, and research needs a model.',
      );
    }
    return { mode: 'unconfigured', ...none, warnings };
  }

  if (provider === 'openrouter') {
    if (!openAiKey) {
      warnings.push('OpenRouter makes text only: images are off until OPENAI_API_KEY is set.');
    }
    return {
      mode: 'openrouter',
      ...none,
      openRouterKey,
      imagesKey: openAiKey,
      tavilyKey,
      openRouterApp: {
        ...(env.OPENROUTER_APP_URL ? { url: env.OPENROUTER_APP_URL } : {}),
        ...(env.OPENROUTER_APP_NAME ? { name: env.OPENROUTER_APP_NAME } : {}),
      },
      warnings,
    };
  }

  return { mode: 'openai', ...none, openAiKey, imagesKey: openAiKey, tavilyKey, warnings };
}

/** A key worth sending: set, non-blank, and not a placeholder. */
export function isPlaceholderKey(value: string): boolean {
  return PLACEHOLDERS.has(value.trim().toLowerCase());
}

function usableKey(name: string, value: string | undefined, warnings: string[]): string | null {
  const trimmed = value?.trim() ?? '';

  if (trimmed === '') {
    return null;
  }

  if (isPlaceholderKey(trimmed)) {
    warnings.push(`${name} holds the .env.example placeholder and is being ignored.`);
    return null;
  }

  return trimmed;
}
