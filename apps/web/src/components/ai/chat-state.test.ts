/**
 * The copilot reducer and the history it hands the API.
 *
 * Pins the rules that would be silent if wrong: tokens land in the reply that
 * is streaming, tool rows update by id, an empty reply disappears on error or
 * stop, the history sent back is capped and ends with the user, and a stored
 * conversation that is not what we wrote is ignored rather than trusted.
 */
import type { AiCredits, CopilotStreamEvent } from '@/types/ai';
import {
  type ChatState,
  chatReducer,
  describeTool,
  draftOutput,
  historyFor,
  imageOutput,
  initialChatState,
  lastUserMessage,
  parseHistory,
  serializeHistory,
  toolFailureReason,
} from './chat-state';

const credits: AiCredits = {
  allowance: 100,
  used: 24,
  remaining: 76,
  resetsAt: '2026-11-01T00:00:00.000Z',
  tier: 'STANDARD',
  low: false,
  costs: {
    generate_post: 5,
    generate_image: 10,
    copilot_message: 1,
    seo_advice: 3,
    generate_snippet: 2,
  },
};

function sent(content = 'What channels do I have?'): ChatState {
  return chatReducer(initialChatState(credits), { type: 'send', id: 'u1', content, replyId: 'a1' });
}

function run(state: ChatState, ...events: CopilotStreamEvent[]): ChatState {
  return events.reduce((current, event) => chatReducer(current, { type: 'event', event }), state);
}

describe('chatReducer', () => {
  it('send appends the user message and an empty streaming reply', () => {
    const state = sent();

    expect(state.streaming).toBe(true);
    expect(state.entries).toEqual([
      { id: 'u1', role: 'user', content: 'What channels do I have?' },
      { id: 'a1', role: 'assistant', content: '', tools: [], streaming: true },
    ]);
  });

  it('ignores a send while a reply is streaming', () => {
    const state = chatReducer(sent(), { type: 'send', id: 'u2', content: 'again', replyId: 'a2' });
    expect(state.entries).toHaveLength(2);
  });

  it('streams tokens into the reply and settles it on done', () => {
    const state = run(
      sent(),
      { type: 'token', text: 'You have ' },
      { type: 'token', text: 'three channels.' },
      { type: 'done', message: 'You have three channels.', toolCalls: 0, credits },
    );

    expect(state.streaming).toBe(false);
    expect(state.entries[1]).toMatchObject({
      content: 'You have three channels.',
      streaming: false,
    });
    expect(state.credits).toBe(credits);
  });

  it('fills the reply from done when nothing streamed', () => {
    const state = run(sent(), { type: 'done', message: 'Final answer.', toolCalls: 0, credits });
    expect(state.entries[1]).toMatchObject({ content: 'Final answer.' });
  });

  it('records tool calls and updates them by id', () => {
    const state = run(
      sent(),
      { type: 'tool_call', id: 't1', name: 'list_channels', input: {} },
      {
        type: 'tool_result',
        id: 't1',
        name: 'list_channels',
        ok: true,
        output: { channels: [] },
        summary: 'Found 3 channels',
      },
    );

    expect(state.entries[1]).toMatchObject({
      tools: [{ id: 't1', status: 'ok', summary: 'Found 3 channels' }],
    });
  });

  it('drops an empty reply on error and keeps the user message for a retry', () => {
    const state = run(sent(), {
      type: 'error',
      kind: 'unavailable',
      message: 'The model is unavailable.',
      retryable: true,
      credits,
    });

    expect(state.streaming).toBe(false);
    expect(state.entries).toHaveLength(1);
    expect(state.error).toEqual({
      kind: 'unavailable',
      message: 'The model is unavailable.',
      retryable: true,
    });
    expect(lastUserMessage(state.entries)?.content).toBe('What channels do I have?');
  });

  it('retry opens a new reply under the failed user message, and only then', () => {
    const failed = run(sent(), {
      type: 'error',
      kind: 'unavailable',
      message: 'Down.',
      retryable: true,
      credits,
    });
    const retried = chatReducer(failed, { type: 'retry', replyId: 'a2' });

    expect(retried.streaming).toBe(true);
    expect(retried.error).toBeNull();
    expect(retried.entries.map((entry) => entry.id)).toEqual(['u1', 'a2']);

    const answered = run(retried, { type: 'done', message: 'Up.', toolCalls: 0, credits });
    expect(chatReducer(answered, { type: 'retry', replyId: 'a3' })).toBe(answered);
  });

  it('keeps a reply that had already produced something on error', () => {
    const state = run(
      sent(),
      { type: 'token', text: 'Partial' },
      { type: 'error', kind: 'timeout', message: 'Timed out.', retryable: true, credits },
    );

    expect(state.entries[1]).toMatchObject({ content: 'Partial', streaming: false });
  });

  it('abort settles the reply, marks the state stopped, and a send clears it', () => {
    const stopped = chatReducer(run(sent(), { type: 'token', text: 'Half' }), { type: 'abort' });

    expect(stopped.stopped).toBe(true);
    expect(stopped.streaming).toBe(false);
    expect(stopped.entries[1]).toMatchObject({ content: 'Half', streaming: false });

    const next = chatReducer(stopped, { type: 'send', id: 'u2', content: 'More', replyId: 'a2' });
    expect(next.stopped).toBe(false);
  });

  it('a refused request becomes an error by status', () => {
    const state = chatReducer(sent(), { type: 'fail', message: 'No credits.', status: 402 });

    expect(state.error).toMatchObject({ kind: 'out_of_credits', retryable: false });
    expect(state.entries).toHaveLength(1);
  });

  it('clear and restore are refused while streaming', () => {
    const state = sent();
    expect(chatReducer(state, { type: 'clear' })).toBe(state);
    expect(chatReducer(state, { type: 'restore', entries: [] })).toBe(state);
    expect(chatReducer(initialChatState(), { type: 'clear' }).entries).toEqual([]);
  });

  it('is hydrated only by a restore, even one that found nothing', () => {
    // Persisting is gated on `hydrated`, so the mount render (which StrictMode
    // runs twice) can never write its empty state over the stored session.
    const fresh = initialChatState();
    expect(fresh.hydrated).toBe(false);

    const empty = chatReducer(fresh, { type: 'restore', entries: null });
    expect(empty.hydrated).toBe(true);
    expect(empty.entries).toEqual([]);

    const stored = chatReducer(fresh, {
      type: 'restore',
      entries: [{ id: 'u1', role: 'user', content: 'hi' }],
    });
    expect(stored.hydrated).toBe(true);
    expect(stored.entries).toHaveLength(1);
  });
});

describe('historyFor', () => {
  it('sends role and text only, skipping the empty streaming reply, capped at the limit', () => {
    let state = initialChatState();
    for (let index = 0; index < 15; index += 1) {
      state = chatReducer(state, {
        type: 'send',
        id: `u${index}`,
        content: `q${index}`,
        replyId: `a${index}`,
      });
      state = run(state, { type: 'done', message: `r${index}`, toolCalls: 0, credits });
    }
    state = chatReducer(state, { type: 'send', id: 'last', content: 'final', replyId: 'a-last' });

    const history = historyFor(state.entries);
    expect(history).toHaveLength(20);
    expect(history.at(-1)).toEqual({ role: 'user', content: 'final' });
    expect(history.every((message) => message.content.length > 0)).toBe(true);
  });
});

describe('storage', () => {
  it('round-trips a conversation, settling an interrupted reply', () => {
    const state = run(
      sent(),
      { type: 'token', text: 'Working' },
      { type: 'tool_call', id: 't1', name: 'generate_image', input: { prompt: 'x' } },
    );

    const restored = parseHistory(serializeHistory(state.entries));
    expect(restored).toEqual([
      { id: 'u1', role: 'user', content: 'What channels do I have?' },
      {
        id: 'a1',
        role: 'assistant',
        content: 'Working',
        streaming: false,
        tools: [
          {
            id: 't1',
            name: 'generate_image',
            input: { prompt: 'x' },
            status: 'failed',
            output: null,
            summary: 'Interrupted',
          },
        ],
      },
    ]);
  });

  it('drops an empty streaming reply from what is stored', () => {
    expect(parseHistory(serializeHistory(sent().entries))).toHaveLength(1);
  });

  it('rejects storage that is not a conversation', () => {
    expect(parseHistory(null)).toBeNull();
    expect(parseHistory('not json')).toBeNull();
    expect(parseHistory('{"entries":[]}')).toBeNull();
    expect(parseHistory('[{"id":"x","role":"system","content":"hi"}]')).toBeNull();
    expect(
      parseHistory('[{"id":"x","role":"assistant","content":"hi","tools":[{"id":1}]}]'),
    ).toBeNull();
    expect(parseHistory('[]')).toEqual([]);
  });
});

describe('tool presentation', () => {
  const base = { id: 't', input: null, output: null, summary: null } as const;

  it('words each tool by its state, preferring the API summary once done', () => {
    expect(describeTool({ ...base, name: 'list_channels', status: 'running' })).toBe(
      'Checking your channels…',
    );
    expect(
      describeTool({
        ...base,
        name: 'draft_post',
        status: 'ok',
        summary: 'Drafted a post for Acme',
      }),
    ).toBe('Drafted a post for Acme');
    expect(describeTool({ ...base, name: 'generate_image', status: 'failed' })).toBe(
      "Couldn't generate the image",
    );
  });

  it('reads a failure reason and typed outputs from the tool output', () => {
    expect(
      toolFailureReason({
        ...base,
        name: 'generate_post',
        status: 'failed',
        output: { message: 'No credits' },
      }),
    ).toBe('No credits');
    expect(
      draftOutput({
        ...base,
        name: 'draft_post',
        status: 'ok',
        output: { group: 'g1', channelNames: ['Acme Marketing'], parts: 2 },
      }),
    ).toEqual({ group: 'g1', channelNames: ['Acme Marketing'], parts: 2 });
    expect(
      draftOutput({ ...base, name: 'draft_post', status: 'failed', output: { group: 'g1' } }),
    ).toBeNull();
    expect(
      imageOutput({
        ...base,
        name: 'generate_image',
        status: 'ok',
        output: { mediaId: 'm', url: 'https://u', thumbnailUrl: null, prompt: 'p' },
      }),
    ).toEqual({ mediaId: 'm', url: 'https://u', thumbnailUrl: null, prompt: 'p' });
  });
});
