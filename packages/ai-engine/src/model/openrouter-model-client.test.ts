const invoke = jest.fn();
const constructorArgs: Array<Record<string, unknown>> = [];

jest.mock('@langchain/openai', () => ({
  ChatOpenAI: jest.fn().mockImplementation((args: Record<string, unknown>) => {
    constructorArgs.push(args);
    return {
      withStructuredOutput: jest.fn().mockReturnValue({ invoke }),
      bindTools: jest.fn(),
      stream: jest.fn(),
    };
  }),
}));

import { z } from 'zod';
import { createOpenAiModelClient } from './openai-model-client';
import {
  createOpenRouterModelClient,
  OPENROUTER_BASE_URL,
  openRouterHeaders,
  openRouterModelId,
} from './openrouter-model-client';

const last = () => constructorArgs[constructorArgs.length - 1] as Record<string, unknown>;

describe('createOpenRouterModelClient', () => {
  beforeEach(() => invoke.mockReset());

  it('points the OpenAI client at OpenRouter with the key and no SDK retries', () => {
    const client = createOpenRouterModelClient({
      apiKey: 'sk-or-test',
      model: 'anthropic/claude-x',
    });
    expect(client.name).toBe('openrouter:anthropic/claude-x');
    expect(last()).toMatchObject({
      apiKey: 'sk-or-test',
      model: 'anthropic/claude-x',
      maxRetries: 0,
      configuration: { baseURL: OPENROUTER_BASE_URL },
    });
    expect((last().configuration as Record<string, unknown>).defaultHeaders).toBeUndefined();
  });

  it('reads a bare OpenAI name as an openai/ id', () => {
    expect(openRouterModelId('gpt-4.1-mini')).toBe('openai/gpt-4.1-mini');
    expect(openRouterModelId(' google/gemini-x ')).toBe('google/gemini-x');
    createOpenRouterModelClient({ apiKey: 'k', model: 'gpt-4.1-mini' });
    expect(last().model).toBe('openai/gpt-4.1-mini');
  });

  it('sends the attribution headers only when they are configured', () => {
    expect(openRouterHeaders({})).toBeUndefined();
    expect(openRouterHeaders({ appUrl: ' ', appName: '' })).toBeUndefined();
    expect(openRouterHeaders({ appUrl: 'https://app.example', appName: 'PostGear' })).toEqual({
      'HTTP-Referer': 'https://app.example',
      'X-Title': 'PostGear',
    });
    createOpenRouterModelClient({ apiKey: 'k', model: 'm/x', appName: 'PostGear' });
    expect((last().configuration as Record<string, unknown>).defaultHeaders).toEqual({
      'X-Title': 'PostGear',
    });
  });

  it('keeps the structured repair policy of the OpenAI client', async () => {
    const schema = z.object({ ok: z.boolean() });
    invoke.mockResolvedValueOnce({ ok: 'nope' }).mockResolvedValueOnce({ ok: true });
    const client = createOpenRouterModelClient({ apiKey: 'k', model: 'm/x' });
    await expect(client.structured({ schema, system: 'S', user: 'U' })).resolves.toEqual({
      ok: true,
    });
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it('leaves the plain OpenAI client on OpenAI', () => {
    createOpenAiModelClient({ apiKey: 'sk', model: 'gpt-4.1-mini' });
    expect(last().configuration).toBeUndefined();
  });
});
