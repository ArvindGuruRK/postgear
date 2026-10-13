import { z } from 'zod';
import { createSimulatedModelClient } from '../model/simulated-model-client';
import { decodeToolResult } from '../prompts/copilot';
import {
  AiProviderError,
  type CopilotEvent,
  type CopilotTool,
  type ModelChunk,
  type ModelClient,
  type ModelMessage,
  type ModelToolCall,
} from '../types';
import { createCopilotAgent, executeTool, summariseToolOutcome } from './copilot.agent';

const context = {
  workspaceName: 'Acme Marketing',
  today: '2026-10-14',
  channelSummary: 'Acme Marketing (LinkedIn, connected)',
};

const channels = [
  { id: 'ch-1', name: 'Acme Marketing', platform: 'LinkedIn', health: 'connected' },
  { id: 'ch-2', name: 'Acme on X', platform: 'X', health: 'connected' },
];

function listChannelsTool(): CopilotTool<never, unknown> & { execute: jest.Mock } {
  return {
    name: 'list_channels',
    description: 'List the connected channels',
    inputSchema: z.object({}).strict() as unknown as z.ZodType<never>,
    readOnly: true,
    execute: jest.fn(async () => ({ channels })),
  };
}

function imageTool(): CopilotTool<never, unknown> & { execute: jest.Mock } {
  return {
    name: 'generate_image',
    description: 'Generate an image',
    inputSchema: z.object({ prompt: z.string().min(3) }) as unknown as z.ZodType<never>,
    readOnly: false,
    execute: jest.fn(async (input: { prompt: string }) => ({
      mediaId: 'm1',
      url: 'https://cdn/m1.png',
      thumbnailUrl: null,
      prompt: input.prompt,
    })),
  };
}

/** A model that follows a script: each entry is what `chat` yields on that call. */
function scriptedModel(script: Array<{ text?: string; calls?: ModelToolCall[] }>): ModelClient & {
  calls: Array<{ messages: ModelMessage[]; toolNames: string[] }>;
} {
  const calls: Array<{ messages: ModelMessage[]; toolNames: string[] }> = [];
  return {
    name: 'scripted',
    calls,
    structured: async () => {
      throw new Error('not used');
    },
    async *chat(params): AsyncIterable<ModelChunk> {
      calls.push({ messages: params.messages, toolNames: params.tools.map((tool) => tool.name) });
      const step = script[Math.min(calls.length - 1, script.length - 1)];
      for (const word of (step.text ?? 'ok').split(' ')) yield { type: 'text', text: `${word} ` };
      if (step.calls && step.calls.length > 0) yield { type: 'tool_calls', calls: step.calls };
    },
  };
}

async function runAgent(
  model: ModelClient,
  tools: CopilotTool<never, unknown>[],
  content: string,
  options: { maxToolRounds?: number; signal?: AbortSignal } = {},
) {
  const events: CopilotEvent[] = [];
  const agent = createCopilotAgent({ model, tools, context, maxToolRounds: options.maxToolRounds });
  const result = await agent.run([{ role: 'user', content }], {
    signal: options.signal,
    onEvent: (event) => events.push(event),
  });
  return { result, events };
}

describe('copilot agent with the simulated model', () => {
  it('calls list_channels and puts the channel names in the answer', async () => {
    const tool = listChannelsTool();
    const { result, events } = await runAgent(
      createSimulatedModelClient(),
      [tool],
      'What channels do I have connected?',
    );

    expect(tool.execute).toHaveBeenCalledTimes(1);
    expect(tool.execute).toHaveBeenCalledWith({}, { signal: expect.any(AbortSignal) });
    expect(result.toolCalls).toBe(1);
    expect(result.message).toContain('Acme Marketing');
    expect(result.message).toContain('Acme on X');

    const types = events.map((event) => event.type);
    expect(types[0]).toBe('token');
    expect(types).toContain('tool_call');
    expect(types).toContain('tool_result');
    expect(types[types.length - 1]).toBe('done');
    expect(types.indexOf('tool_call')).toBeLessThan(types.indexOf('tool_result'));

    const toolResult = events.find((event) => event.type === 'tool_result');
    expect(toolResult).toMatchObject({
      name: 'list_channels',
      ok: true,
      summary: 'Found 2 channels',
    });
    const tokens = events
      .filter((event) => event.type === 'token')
      .map((event) => (event.type === 'token' ? event.text : ''));
    expect(tokens.join('')).toContain(result.message);
    expect(events[events.length - 1]).toEqual({
      type: 'done',
      message: result.message,
      toolCalls: 1,
    });
  });

  it('runs the image tool with the extracted prompt', async () => {
    const tool = imageTool();
    const { result } = await runAgent(
      createSimulatedModelClient(),
      [tool],
      'Generate an image of a sunrise over a city skyline',
    );
    expect(tool.execute).toHaveBeenCalledWith(
      { prompt: 'a sunrise over a city skyline' },
      expect.anything(),
    );
    expect(result.message).toContain('a sunrise over a city skyline');
  });

  it('answers without tools when none apply', async () => {
    const tool = listChannelsTool();
    const { result } = await runAgent(createSimulatedModelClient(), [tool], 'hello');
    expect(tool.execute).not.toHaveBeenCalled();
    expect(result.toolCalls).toBe(0);
    expect(result.message).toContain('Acme Marketing');
  });
});

describe('copilot agent with a scripted model', () => {
  it('feeds invalid tool input back as ok:false and lets the model retry', async () => {
    const tool = imageTool();
    const model = scriptedModel([
      { text: 'Drawing', calls: [{ id: 'c1', name: 'generate_image', input: { prompt: 7 } }] },
      {
        text: 'Retrying',
        calls: [{ id: 'c2', name: 'generate_image', input: { prompt: 'a red fox' } }],
      },
      { text: 'Here is your fox.' },
    ]);
    const { result, events } = await runAgent(model, [tool], 'draw a fox');

    expect(tool.execute).toHaveBeenCalledTimes(1);
    expect(tool.execute).toHaveBeenCalledWith({ prompt: 'a red fox' }, expect.anything());
    const results = events.filter((event) => event.type === 'tool_result');
    expect(results[0]).toMatchObject({
      id: 'c1',
      ok: false,
      summary: expect.stringContaining('failed'),
    });
    expect(results[0].type === 'tool_result' && results[0].output).toMatchObject({
      issues: [expect.stringContaining('prompt')],
    });
    expect(results[1]).toMatchObject({ id: 'c2', ok: true, summary: 'Generated an image' });

    // The model saw the failure as a tool message with the issues.
    const secondCallMessages = model.calls[1].messages;
    const toolMessage = secondCallMessages[secondCallMessages.length - 1];
    expect(toolMessage.role).toBe('tool');
    expect(toolMessage.toolCallId).toBe('c1');
    expect(decodeToolResult(toolMessage.content)).toMatchObject({ ok: false });
    expect(result.toolCalls).toBe(2);
    expect(result.message.trim()).toBe('Here is your fox.');
  });

  it('turns a tool exception into ok:false instead of failing the run', async () => {
    const tool = listChannelsTool();
    tool.execute.mockRejectedValue(new Error('database unavailable (key sk-abcdefgh1234)'));
    const model = scriptedModel([
      { text: 'Checking', calls: [{ id: 'c1', name: 'list_channels', input: {} }] },
      { text: 'I could not reach your channels.' },
    ]);
    const { result, events } = await runAgent(model, [tool], 'channels?');
    const failure = events.find((event) => event.type === 'tool_result');
    expect(failure).toMatchObject({ ok: false, summary: expect.stringContaining('failed') });
    expect(JSON.stringify(failure)).not.toContain('sk-abcdefgh1234');
    expect(result.message.trim()).toBe('I could not reach your channels.');
  });

  it('reports an unknown tool as ok:false', async () => {
    const model = scriptedModel([
      { text: 'Trying', calls: [{ id: 'c1', name: 'teleport', input: {} }] },
      { text: 'That tool does not exist.' },
    ]);
    const { events } = await runAgent(model, [listChannelsTool()], 'teleport me');
    expect(events.find((event) => event.type === 'tool_result')).toMatchObject({
      name: 'teleport',
      ok: false,
    });
  });

  it('caps the tool rounds and asks for a final answer with no tools', async () => {
    const tool = listChannelsTool();
    const model = scriptedModel([
      { text: 'Again', calls: [{ id: 'c', name: 'list_channels', input: {} }] },
    ]);
    const { result } = await runAgent(model, [tool], 'loop forever', { maxToolRounds: 2 });

    expect(tool.execute).toHaveBeenCalledTimes(2);
    expect(model.calls).toHaveLength(3);
    expect(model.calls[0].toolNames).toEqual(['list_channels']);
    expect(model.calls[1].toolNames).toEqual(['list_channels']);
    expect(model.calls[2].toolNames).toEqual([]);
    expect(result.toolCalls).toBe(2);
  });

  it("prefers the tool's own summary when it has one", async () => {
    const tool = { ...listChannelsTool(), summarize: () => 'Checked your channels' };
    const model = scriptedModel([
      { text: 'Checking', calls: [{ id: 'c1', name: 'list_channels', input: {} }] },
      { text: 'Done.' },
    ]);
    const { events } = await runAgent(model, [tool], 'channels?');
    expect(events.find((event) => event.type === 'tool_result')).toMatchObject({
      summary: 'Checked your channels',
    });
  });

  it('gives the system prompt and the history to the model', async () => {
    const model = scriptedModel([{ text: 'Hi' }]);
    const agent = createCopilotAgent({ model, tools: [listChannelsTool()], context });
    await agent.run([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'reply' },
      { role: 'user', content: 'second' },
    ]);
    const messages = model.calls[0].messages;
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('Acme Marketing (LinkedIn, connected)');
    expect(messages[0].content).toContain('list_channels (read-only)');
    expect(messages.slice(1)).toEqual([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'reply' },
      { role: 'user', content: 'second' },
    ]);
  });

  it('rejects with the provider error when the model fails', async () => {
    const model: ModelClient = {
      name: 'failing',
      structured: async () => {
        throw new Error('unused');
      },
      chat: () => ({
        [Symbol.asyncIterator]: () => ({
          next: () => Promise.reject(new AiProviderError('invalid_key', 'bad key', false)),
        }),
      }),
    };
    await expect(runAgent(model, [], 'hi')).rejects.toMatchObject({ kind: 'invalid_key' });
  });

  it('stops everything on abort', async () => {
    const controller = new AbortController();
    const tool = listChannelsTool();
    tool.execute.mockImplementation(
      (_input: unknown, ctx: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          ctx.signal?.addEventListener('abort', () => reject(new Error('cancelled')));
        }),
    );
    const model = scriptedModel([
      { text: 'Checking', calls: [{ id: 'c1', name: 'list_channels', input: {} }] },
      { text: 'never reached' },
    ]);
    const events: CopilotEvent[] = [];
    const agent = createCopilotAgent({ model, tools: [tool], context });
    const settled = agent
      .run([{ role: 'user', content: 'channels' }], {
        signal: controller.signal,
        onEvent: (e) => events.push(e),
      })
      .catch((error: unknown) => error);
    await new Promise((resolve) => setTimeout(resolve, 10));
    controller.abort();
    expect(await settled).toMatchObject({ kind: 'aborted' });
    expect(events.map((event) => event.type)).not.toContain('done');
    expect(model.calls).toHaveLength(1);
  });

  it('rejects immediately when already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const model = scriptedModel([{ text: 'Hi' }]);
    await expect(runAgent(model, [], 'hi', { signal: controller.signal })).rejects.toMatchObject({
      kind: 'aborted',
    });
    expect(model.calls).toHaveLength(0);
  });
});

describe('executeTool / summariseToolOutcome', () => {
  it('derives summaries by tool name', () => {
    expect(
      summariseToolOutcome(undefined, 'list_channels', { ok: true, output: { channels: [1] } }),
    ).toBe('Found 1 channel');
    expect(
      summariseToolOutcome(undefined, 'generate_post', {
        ok: true,
        output: { format: 'thread_short' },
      }),
    ).toBe('Wrote a thread short post');
    expect(
      summariseToolOutcome(undefined, 'draft_post', {
        ok: true,
        output: { channelNames: ['A', 'B'] },
      }),
    ).toBe('Drafted a post for A, B');
    expect(summariseToolOutcome(undefined, 'other_tool', { ok: true, output: {} })).toBe(
      'Ran other tool',
    );
    expect(summariseToolOutcome(undefined, 'draft_post', { ok: false, error: 'no' })).toBe(
      'draft post failed: no',
    );
  });

  it('validates input with the tool schema before executing', async () => {
    const tool = imageTool();
    const outcome = await executeTool(
      tool,
      { id: 'x', name: 'generate_image', input: {} },
      undefined,
    );
    expect(outcome.envelope).toMatchObject({
      ok: false,
      issues: [expect.stringContaining('prompt')],
    });
    expect(tool.execute).not.toHaveBeenCalled();
  });
});
