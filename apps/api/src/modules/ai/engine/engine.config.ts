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
 * wants no bill, even with a real key in the same file. Then a real OpenAI
 * key means `openai`; otherwise `unconfigured`, which the UI explains.
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
>;

export function resolveAiConfig(env: AiEnv): ResolvedAiConfig {
  const warnings: string[] = [];
  const openAiKey = usableKey('OPENAI_API_KEY', env.OPENAI_API_KEY, warnings);
  const tavilyKey = usableKey('TAVILY_API_KEY', env.TAVILY_API_KEY, warnings);

  if (env.AI_SIMULATION === 'true') {
    return {
      mode: 'simulation',
      openAiKey: null,
      tavilyKey: null,
      model: env.AI_MODEL,
      imageModel: env.AI_IMAGE_MODEL,
      warnings,
    };
  }

  if (!openAiKey) {
    if (tavilyKey) {
      warnings.push('TAVILY_API_KEY is set but OPENAI_API_KEY is not, and research needs a model.');
    }

    return {
      mode: 'unconfigured',
      openAiKey: null,
      tavilyKey: null,
      model: env.AI_MODEL,
      imageModel: env.AI_IMAGE_MODEL,
      warnings,
    };
  }

  return {
    mode: 'openai',
    openAiKey,
    tavilyKey,
    model: env.AI_MODEL,
    imageModel: env.AI_IMAGE_MODEL,
    warnings,
  };
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
