const invoke = jest.fn();
const stream = jest.fn();
const bindTools = jest.fn();
const withStructuredOutput = jest.fn();
const constructorArgs: unknown[] = [];

jest.mock('@langchain/openai', () => ({
  ChatOpenAI: jest.fn().mockImplementation((args: unknown) => {
    constructorArgs.push(args);
    return { withStructuredOutput, bindTools, stream };
  }),
}));

import { AIMessageChunk } from '@langchain/core/messages';
import { z } from 'zod';
import { createOpenAiModelClient } from './openai-model-client';

async function* chunks(items: AIMessageChunk[]) {
  for (const item of items) yield item;
}

describe('createOpenAiModelClient', () => {
  beforeEach(() => {
    invoke.mockReset();
    stream.mockReset();
    bindTools.mockReset();
    withStructuredOutput.mockReset();
    withStructuredOutput.mockReturnValue({ invoke });
    bindTools.mockReturnValue({ stream });
  });

  it('names itself after the model and disables SDK retries', () => {
    const client = createOpenAiModelClient({ apiKey: 'sk-test', model: 'gpt-4.1-mini' });
    expect(client.name).toBe('openai:gpt-4.1-mini');
    expect(constructorArgs[constructorArgs.length - 1]).toMatchObject({
      apiKey: 'sk-test',
      model: 'gpt-4.1-mini',
      maxRetries: 0,
      timeout: 60_000,
    });
  });

  describe('structured', () => {
    const schema = z.object({ category: z.enum(['Tips', 'News']) });

    it('invokes the structured runnable with system and user messages and a signal', async () => {
      invoke.mockResolvedValue({ category: 'Tips' });
      const client = createOpenAiModelClient({ apiKey: 'sk-test', model: 'm' });
      await expect(client.structured({ schema, system: 'S', user: 'U' })).resolves.toEqual({
        category: 'Tips',
      });
      expect(withStructuredOutput).toHaveBeenCalledWith(schema);
      const [messages, options] = invoke.mock.calls[0];
      expect(messages).toHaveLength(2);
      expect(messages[0].content).toBe('S');
      expect(messages[1].content).toBe('U');
      expect(options.signal).toBeInstanceOf(AbortSignal);
    });

    it('repairs once and then reports bad_output', async () => {
      invoke.mockResolvedValue({ category: 'Gossip' });
      const client = createOpenAiModelClient({ apiKey: 'sk-test', model: 'm' });
      await expect(client.structured({ schema, system: 'S', user: 'U' })).rejects.toMatchObject({
        kind: 'bad_output',
      });
      expect(invoke).toHaveBeenCalledTimes(2);
      expect(invoke.mock.calls[1][0][1].content).toContain('<<<Repair');
    });

    it('does not retry an invalid key', async () => {
      invoke.mockRejectedValue({ status: 401, message: 'Incorrect API key provided: sk-abcdefgh' });
      const client = createOpenAiModelClient({ apiKey: 'sk-test', model: 'm' });
      const error = await client
        .structured({ schema, system: 'S', user: 'U' })
        .catch((e: unknown) => e);
      expect(error).toMatchObject({ kind: 'invalid_key', retryable: false });
      expect((error as Error).message).not.toContain('sk-abcdefgh');
      expect(invoke).toHaveBeenCalledTimes(1);
    });

    it('retries a rate limit and reports it when it persists', async () => {
      jest.useFakeTimers();
      try {
        invoke.mockRejectedValue({ status: 429, message: 'rate limited' });
        const client = createOpenAiModelClient({ apiKey: 'sk-test', model: 'm' });
        const settled = client
          .structured({ schema, system: 'S', user: 'U' })
          .catch((e: unknown) => e);
        await jest.advanceTimersByTimeAsync(20_000);
        expect(await settled).toMatchObject({ kind: 'rate_limited', retryable: true });
        expect(invoke).toHaveBeenCalledTimes(3);
      } finally {
        jest.useRealTimers();
      }
    });

    it('turns a hung call into a timeout', async () => {
      jest.useFakeTimers();
      try {
        invoke.mockImplementation(() => new Promise(() => undefined));
        const client = createOpenAiModelClient({ apiKey: 'sk-test', model: 'm', timeoutMs: 1_000 });
        const settled = client
          .structured({ schema, system: 'S', user: 'U' })
          .catch((e: unknown) => e);
        await jest.advanceTimersByTimeAsync(40_000);
        expect(await settled).toMatchObject({ kind: 'timeout' });
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('chat', () => {
    const tools = [{ name: 'list_channels', description: 'd', inputSchema: z.object({}) }];

    it('streams text deltas and emits parsed tool calls once at the end', async () => {
      stream.mockResolvedValue(
        chunks([
          new AIMessageChunk({ content: 'Let me ' }),
          new AIMessageChunk({ content: 'check.' }),
          new AIMessageChunk({
            content: '',
            tool_call_chunks: [
              {
                name: 'list_channels',
                args: '{"a":',
                id: 'call_1',
                index: 0,
                type: 'tool_call_chunk',
              },
            ],
          }),
          new AIMessageChunk({
            content: '',
            tool_call_chunks: [{ args: '1}', index: 0, type: 'tool_call_chunk' }],
          }),
        ]),
      );
      const client = createOpenAiModelClient({ apiKey: 'sk-test', model: 'm' });
      const received = [];
      for await (const chunk of client.chat({
        messages: [{ role: 'user', content: 'hi' }],
        tools,
      })) {
        received.push(chunk);
      }
      expect(bindTools).toHaveBeenCalledWith([
        { name: 'list_channels', description: 'd', schema: tools[0].inputSchema },
      ]);
      expect(received).toEqual([
        { type: 'text', text: 'Let me ' },
        { type: 'text', text: 'check.' },
        { type: 'tool_calls', calls: [{ id: 'call_1', name: 'list_channels', input: { a: 1 } }] },
      ]);
    });

    it('uses the bare model when no tools are offered', async () => {
      stream.mockResolvedValue(chunks([new AIMessageChunk({ content: 'Plain answer' })]));
      const client = createOpenAiModelClient({ apiKey: 'sk-test', model: 'm' });
      const received = [];
      for await (const chunk of client.chat({
        messages: [{ role: 'user', content: 'hi' }],
        tools: [],
      })) {
        received.push(chunk);
      }
      expect(bindTools).not.toHaveBeenCalled();
      expect(received).toEqual([{ type: 'text', text: 'Plain answer' }]);
    });

    it('maps a provider failure while opening the stream', async () => {
      stream.mockRejectedValue({ status: 403, message: 'forbidden' });
      const client = createOpenAiModelClient({ apiKey: 'sk-test', model: 'm' });
      const iterate = async () => {
        for await (const _chunk of client.chat({ messages: [], tools: [] })) {
          // drain
        }
      };
      await expect(iterate()).rejects.toMatchObject({ kind: 'invalid_key' });
    });

    it('reports an abort as aborted', async () => {
      const controller = new AbortController();
      stream.mockImplementation(async () =>
        (async function* () {
          yield new AIMessageChunk({ content: 'first' });
          controller.abort();
          throw Object.assign(new Error('The user aborted a request.'), { name: 'AbortError' });
        })(),
      );
      const client = createOpenAiModelClient({ apiKey: 'sk-test', model: 'm' });
      const iterate = async () => {
        for await (const _chunk of client.chat({
          messages: [],
          tools: [],
          signal: controller.signal,
        })) {
          // drain
        }
      };
      await expect(iterate()).rejects.toMatchObject({ kind: 'aborted' });
    });
  });
});
