import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import { z } from 'zod';
import {
  structuredWithRepair,
  textOfContent,
  toLangChainMessages,
  toModelToolCalls,
} from './model-client';

describe('toLangChainMessages', () => {
  it('maps every role, carrying tool calls and tool ids', () => {
    const messages = toLangChainMessages([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'c1', name: 'list_channels', input: {} }],
      },
      { role: 'tool', content: '{"ok":true}', toolCallId: 'c1', name: 'list_channels' },
    ]);
    expect(messages[0]).toBeInstanceOf(SystemMessage);
    expect(messages[1]).toBeInstanceOf(HumanMessage);
    expect(messages[2]).toBeInstanceOf(AIMessage);
    expect((messages[2] as AIMessage).tool_calls?.[0]).toMatchObject({
      id: 'c1',
      name: 'list_channels',
      args: {},
    });
    expect(messages[3]).toBeInstanceOf(ToolMessage);
    expect((messages[3] as ToolMessage).tool_call_id).toBe('c1');
  });
});

describe('textOfContent', () => {
  it('reads strings and text blocks, ignoring other block types', () => {
    expect(textOfContent('plain')).toBe('plain');
    expect(
      textOfContent([
        { type: 'text', text: 'a' },
        { type: 'image_url', image_url: 'x' },
        { type: 'text', text: 'b' },
      ]),
    ).toBe('ab');
    expect(textOfContent(undefined)).toBe('');
  });
});

describe('toModelToolCalls', () => {
  it('keeps provider ids and invents one when missing', () => {
    const calls = toModelToolCalls([
      { id: 'abc', name: 'x', args: { a: 1 } },
      { name: 'y', args: {} },
    ]);
    expect(calls[0]).toEqual({ id: 'abc', name: 'x', input: { a: 1 } });
    expect(calls[1].id).toMatch(/^call-/);
    expect(toModelToolCalls(undefined)).toEqual([]);
  });
});

describe('structuredWithRepair', () => {
  const schema = z.object({ category: z.enum(['Tips', 'News']) });

  it('returns a valid first answer without a second call', async () => {
    const ask = jest.fn(async () => ({ category: 'Tips' }));
    const result = await structuredWithRepair({ schema, system: 's', user: 'u', ask });
    expect(result).toEqual({ category: 'Tips' });
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it('re-asks once with the validation error, then accepts the repair', async () => {
    const ask = jest
      .fn<Promise<unknown>, [{ system: string; user: string }]>()
      .mockResolvedValueOnce({ category: 'Gossip' })
      .mockResolvedValueOnce({ category: 'News' });
    const result = await structuredWithRepair({ schema, system: 's', user: 'u', ask });
    expect(result).toEqual({ category: 'News' });
    expect(ask).toHaveBeenCalledTimes(2);
    const repairPrompt = ask.mock.calls[1][0].user;
    expect(repairPrompt).toContain('<<<Repair');
    expect(repairPrompt).toContain('category');
  });

  it('treats a parse exception from the provider as a failed attempt', async () => {
    const parseError = Object.assign(new Error('Unparseable'), { name: 'OutputParserException' });
    const ask = jest
      .fn<Promise<unknown>, [{ system: string; user: string }]>()
      .mockRejectedValueOnce(parseError)
      .mockResolvedValueOnce({ category: 'Tips' });
    await expect(structuredWithRepair({ schema, system: 's', user: 'u', ask })).resolves.toEqual({
      category: 'Tips',
    });
  });

  it('fails as bad_output after the one repair', async () => {
    const ask = jest.fn(async () => ({ category: 'Gossip' }));
    await expect(
      structuredWithRepair({ schema, system: 's', user: 'u', ask }),
    ).rejects.toMatchObject({ kind: 'bad_output', retryable: false });
    expect(ask).toHaveBeenCalledTimes(2);
  });

  it('lets provider errors through untouched', async () => {
    const ask = jest.fn(async () => {
      throw { status: 429, message: 'slow down' };
    });
    await expect(
      structuredWithRepair({ schema, system: 's', user: 'u', ask }),
    ).rejects.toMatchObject({ status: 429 });
    expect(ask).toHaveBeenCalledTimes(1);
  });
});
