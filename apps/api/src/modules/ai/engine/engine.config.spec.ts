/**
 * Mode selection from the environment: simulation beats a key, a placeholder
 * is not a key, and every ignored variable is named once.
 */
import { type AiEnv, isPlaceholderKey, resolveAiConfig } from './engine.config';

function env(overrides: Partial<AiEnv> = {}): AiEnv {
  return {
    AI_SIMULATION: 'false',
    OPENAI_API_KEY: undefined,
    TAVILY_API_KEY: undefined,
    AI_MODEL: 'gpt-4.1-mini',
    AI_IMAGE_MODEL: 'dall-e-3',
    ...overrides,
  };
}

describe('resolveAiConfig', () => {
  it('is unconfigured with no key at all', () => {
    expect(resolveAiConfig(env())).toMatchObject({
      mode: 'unconfigured',
      openAiKey: null,
      tavilyKey: null,
      warnings: [],
    });
  });

  it('selects OpenAI with a real key, and Tavily only when its key is real too', () => {
    expect(resolveAiConfig(env({ OPENAI_API_KEY: ' sk-live-1 ' }))).toMatchObject({
      mode: 'openai',
      openAiKey: 'sk-live-1',
      tavilyKey: null,
      model: 'gpt-4.1-mini',
      imageModel: 'dall-e-3',
    });
    expect(
      resolveAiConfig(env({ OPENAI_API_KEY: 'sk-live-1', TAVILY_API_KEY: 'tvly-live' })).tavilyKey,
    ).toBe('tvly-live');
  });

  it('treats the documented placeholders and blanks as unset, and says so', () => {
    const resolved = resolveAiConfig(
      env({ OPENAI_API_KEY: 'sk-proj-openai-api-key', TAVILY_API_KEY: '   ' }),
    );

    expect(resolved.mode).toBe('unconfigured');
    expect(resolved.warnings).toEqual([
      'OPENAI_API_KEY holds the .env.example placeholder and is being ignored.',
    ]);
    expect(isPlaceholderKey('TVLY-TAVILY-WEB-SEARCH-API-KEY')).toBe(true);
    expect(isPlaceholderKey('sk-live-1')).toBe(false);
  });

  it('warns about a Tavily key that has no model to feed', () => {
    const resolved = resolveAiConfig(env({ TAVILY_API_KEY: 'tvly-live' }));

    expect(resolved.mode).toBe('unconfigured');
    expect(resolved.warnings).toHaveLength(1);
    expect(resolved.warnings[0]).toContain('OPENAI_API_KEY is not');
  });

  it('lets simulation win over a real key, keeping the keys out of the result', () => {
    const resolved = resolveAiConfig(
      env({ AI_SIMULATION: 'true', OPENAI_API_KEY: 'sk-live-1', TAVILY_API_KEY: 'tvly-live' }),
    );

    expect(resolved).toMatchObject({ mode: 'simulation', openAiKey: null, tavilyKey: null });
  });
});
