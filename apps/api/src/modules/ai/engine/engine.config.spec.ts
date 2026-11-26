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
    expect(resolved.warnings[0]).toContain('neither OPENAI_API_KEY nor OPENROUTER_API_KEY is');
  });

  describe('OpenRouter', () => {
    it('selects OpenRouter when only its key is set, with images off and a warning saying so', () => {
      const resolved = resolveAiConfig(env({ OPENROUTER_API_KEY: ' sk-or-live ' }));
      expect(resolved).toMatchObject({
        mode: 'openrouter',
        openRouterKey: 'sk-or-live',
        openAiKey: null,
        imagesKey: null,
        model: 'gpt-4.1-mini',
      });
      expect(resolved.warnings).toEqual([
        'OpenRouter makes text only: images are off until OPENAI_API_KEY is set.',
      ]);
    });

    it('keeps OpenAI when both keys are set and nothing picks', () => {
      const resolved = resolveAiConfig(
        env({ OPENAI_API_KEY: 'sk-live-1', OPENROUTER_API_KEY: 'sk-or-live' }),
      );
      expect(resolved).toMatchObject({
        mode: 'openai',
        openAiKey: 'sk-live-1',
        openRouterKey: null,
      });
      expect(resolved.imagesKey).toBe('sk-live-1');
    });

    it('follows AI_PROVIDER=openrouter with both keys, keeping images on OpenAI', () => {
      const resolved = resolveAiConfig(
        env({
          OPENAI_API_KEY: 'sk-live-1',
          OPENROUTER_API_KEY: 'sk-or-live',
          AI_PROVIDER: 'openrouter',
          TAVILY_API_KEY: 'tvly-live',
          OPENROUTER_APP_NAME: 'PostGear',
        }),
      );
      expect(resolved).toMatchObject({
        mode: 'openrouter',
        openRouterKey: 'sk-or-live',
        openAiKey: null,
        imagesKey: 'sk-live-1',
        tavilyKey: 'tvly-live',
        openRouterApp: { name: 'PostGear' },
        warnings: [],
      });
    });

    it('falls back to the key that is set when AI_PROVIDER names the other, and says so', () => {
      const resolved = resolveAiConfig(
        env({ OPENAI_API_KEY: 'sk-live-1', AI_PROVIDER: 'openrouter' }),
      );
      expect(resolved.mode).toBe('openai');
      expect(resolved.warnings[0]).toContain('AI_PROVIDER is openrouter but its key is not set');
    });

    it('ignores an OpenRouter placeholder and lets simulation win over a real key', () => {
      expect(resolveAiConfig(env({ OPENROUTER_API_KEY: 'changeme' })).mode).toBe('unconfigured');
      const simulated = resolveAiConfig(
        env({ AI_SIMULATION: 'true', OPENROUTER_API_KEY: 'sk-or-live' }),
      );
      expect(simulated).toMatchObject({ mode: 'simulation', openRouterKey: null, imagesKey: null });
    });
  });

  it('lets simulation win over a real key, keeping the keys out of the result', () => {
    const resolved = resolveAiConfig(
      env({ AI_SIMULATION: 'true', OPENAI_API_KEY: 'sk-live-1', TAVILY_API_KEY: 'tvly-live' }),
    );

    expect(resolved).toMatchObject({ mode: 'simulation', openAiKey: null, tavilyKey: null });
  });
});
