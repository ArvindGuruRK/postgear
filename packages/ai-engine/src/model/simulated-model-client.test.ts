import { z } from 'zod';
import { buildClassifyPrompt, classifySchema } from '../prompts/classify';
import { buildContentPrompt, contentSchema, partLimits } from '../prompts/content';
import { encodeToolResult } from '../prompts/copilot';
import { buildHookPrompt, hookSchema } from '../prompts/hook';
import { AI_CATEGORIES, type ModelChunk, type ModelMessage, type ModelToolSpec } from '../types';
import {
  classifyTopic,
  createSimulatedModelClient,
  hashText,
  subjectOf,
} from './simulated-model-client';

const model = createSimulatedModelClient();

const SYSTEM: ModelMessage = {
  role: 'system',
  content: 'Workspace: Acme Marketing\nToday: 2026-10-14',
};

const TOOLS: ModelToolSpec[] = [
  { name: 'list_channels', description: 'list', inputSchema: z.object({}) },
  { name: 'generate_post', description: 'write', inputSchema: z.object({ topic: z.string() }) },
  {
    name: 'draft_post',
    description: 'draft',
    inputSchema: z.object({ channelIds: z.array(z.string()), parts: z.array(z.string()) }),
  },
  { name: 'generate_image', description: 'image', inputSchema: z.object({ prompt: z.string() }) },
];

async function collect(messages: ModelMessage[], tools = TOOLS) {
  let text = '';
  const chunks: ModelChunk[] = [];
  for await (const chunk of model.chat({ messages, tools })) {
    chunks.push(chunk);
    if (chunk.type === 'text') text += chunk.text;
  }
  const calls = chunks.flatMap((chunk) => (chunk.type === 'tool_calls' ? chunk.calls : []));
  return { text, calls, chunks };
}

const COMPANY_WORDS = /\b(we|us|our)\b/i;
const PERSONAL_WORDS = /\b(I|me|my)\b/;

describe('classifyTopic', () => {
  it('uses keyword heuristics and defaults to Educational', () => {
    expect(classifyTopic('How to set up a posting calendar')).toBe('Tutorial');
    expect(classifyTopic('5 tips for better hooks')).toBe('Tips');
    expect(classifyTopic('Introducing our new scheduling feature')).toBe('Announcement');
    expect(classifyTopic('Join us for a webinar on Thursday')).toBe('Event');
    expect(classifyTopic('What our customers said about onboarding')).toBe('Testimonial');
    expect(classifyTopic('Something plain')).toBe('Educational');
    expect(AI_CATEGORIES).toContain(classifyTopic('celebrating our anniversary'));
  });
});

describe('subjectOf', () => {
  it('strips the request wrapper and dangling function words', () => {
    expect(subjectOf('Write a LinkedIn post about remote onboarding')).toBe('remote onboarding');
    expect(subjectOf('Write about Spring sourdough')).toBe('spring sourdough');
    expect(subjectOf('Write an article on onboarding')).toBe('onboarding');
    expect(subjectOf('Draft threads about xylophones')).toBe('xylophones');
    expect(
      subjectOf('How small teams can keep a consistent posting schedule without burning out'),
    ).toBe('how small teams can keep a consistent posting schedule');
    expect(subjectOf('')).toBe('this');
    expect(subjectOf('Acme Rockets')).toBe('Acme Rockets');
  });
});

describe('hashText', () => {
  it('is stable and sensitive to input', () => {
    expect(hashText('abc')).toBe(hashText('abc'));
    expect(hashText('abc')).not.toBe(hashText('abd'));
  });
});

describe('structured: classify / hook / content', () => {
  const topic = 'Three tips for keeping a posting schedule without burning out';
  const sources = [
    { title: 'A report', url: 'https://r', snippet: 'teams with a cadence post twice as often' },
  ];

  it('classifies from the brief in the prompt', async () => {
    const prompt = buildClassifyPrompt({ topic, sources: [] });
    const output = await model.structured({ schema: classifySchema, ...prompt });
    expect(output.category).toBe('Tips');
  });

  it('writes a hook in the asked voice that is not the brief', async () => {
    const personal = await model.structured({
      schema: hookSchema,
      ...buildHookPrompt({ topic, tone: 'personal', category: 'Tips', sources, platforms: [] }),
    });
    expect(personal.hook).not.toBe(topic);
    expect(personal.hook.length).toBeLessThanOrEqual(200);
    expect(personal.hook.split(/(?<=[.!?])\s+/).length).toBeLessThanOrEqual(2);
    expect(PERSONAL_WORDS.test(personal.hook) || /\bmy\b/.test(personal.hook)).toBe(true);
    expect(COMPANY_WORDS.test(personal.hook)).toBe(false);

    const company = await model.structured({
      schema: hookSchema,
      ...buildHookPrompt({
        topic,
        tone: 'company',
        category: 'Tips',
        sources,
        platforms: [],
        workspaceName: 'Acme',
      }),
    });
    expect(COMPANY_WORDS.test(company.hook) || company.hook.includes('Acme')).toBe(true);
    expect(PERSONAL_WORDS.test(company.hook)).toBe(false);
  });

  it('is deterministic for the same prompt', async () => {
    const prompt = buildHookPrompt({
      topic,
      tone: 'personal',
      category: 'Tips',
      sources,
      platforms: [],
    });
    const a = await model.structured({ schema: hookSchema, ...prompt });
    const b = await model.structured({ schema: hookSchema, ...prompt });
    expect(a).toEqual(b);
  });

  const hook = 'Nobody warns you that the schedule is the easy part.';

  const content = (
    tone: 'personal' | 'company',
    format: 'one_short' | 'one_long' | 'thread_short' | 'thread_long',
    maxCharacters: number | null,
    withImage = false,
  ) =>
    model.structured({
      schema: contentSchema(withImage),
      ...buildContentPrompt({
        topic,
        tone,
        format,
        category: 'Tips',
        hook,
        withImage,
        maxCharacters,
        platforms: ['x'],
        sources,
        workspaceName: 'Acme',
      }),
    });

  it('one_short is a single part under the limit, led by the hook, in first person', async () => {
    const { parts } = await content('personal', 'one_short', 280);
    expect(parts).toHaveLength(1);
    expect(parts[0].text.length).toBeLessThanOrEqual(280);
    expect(parts[0].text.startsWith(hook)).toBe(true);
    expect(parts[0].text).toContain('\n');
    expect(PERSONAL_WORDS.test(parts[0].text)).toBe(true);
    expect(COMPANY_WORDS.test(parts[0].text)).toBe(false);
    expect(parts[0].text).not.toMatch(/#\w+/);
    expect(parts[0].imagePrompt ?? null).toBeNull();
  });

  it('respects a platform limit lower than the format default', async () => {
    const { parts } = await content('personal', 'one_short', 150);
    expect(parts[0].text.length).toBeLessThanOrEqual(150);
  });

  it('one_long lands between the floor and the cap, in company voice', async () => {
    const limits = partLimits('one_long', null);
    const { parts } = await content('company', 'one_long', null);
    expect(parts).toHaveLength(1);
    expect(parts[0].text.length).toBeGreaterThanOrEqual(limits.minChars);
    expect(parts[0].text.length).toBeLessThanOrEqual(limits.maxChars);
    expect(COMPANY_WORDS.test(parts[0].text)).toBe(true);
    expect(PERSONAL_WORDS.test(parts[0].text)).toBe(false);
    expect(parts[0].text).toContain('A report');
  });

  it('threads have the right number of parts, each within the limit', async () => {
    const short = await content('personal', 'thread_short', 280);
    expect(short.parts.length).toBeGreaterThanOrEqual(3);
    expect(short.parts.length).toBeLessThanOrEqual(5);
    for (const part of short.parts) expect(part.text.length).toBeLessThanOrEqual(280);
    expect(short.parts[0].text.startsWith(hook)).toBe(true);

    const long = await content('company', 'thread_long', 700);
    expect(long.parts.length).toBeGreaterThanOrEqual(3);
    expect(long.parts.length).toBeLessThanOrEqual(6);
    for (const part of long.parts) expect(part.text.length).toBeLessThanOrEqual(700);
  });

  it('writes an image prompt for the first part only when asked', async () => {
    const { parts } = await content('personal', 'thread_short', 280, true);
    expect(parts[0].imagePrompt).toEqual(expect.stringContaining('no'));
    expect(parts[0].imagePrompt?.toLowerCase()).toContain('posting schedule');
    for (const part of parts.slice(1)) expect(part.imagePrompt ?? null).toBeNull();
  });

  it('rejects a schema it does not know as bad_output', async () => {
    await expect(
      model.structured({ schema: z.object({ mystery: z.string() }), system: '', user: '' }),
    ).rejects.toMatchObject({ kind: 'bad_output' });
  });

  it('honours an already-aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      model.structured({
        schema: classifySchema,
        ...buildClassifyPrompt({ topic, sources: [] }),
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ kind: 'aborted' });
  });
});

describe('chat: tool decisions', () => {
  it('streams word by word and calls list_channels for a channels question', async () => {
    const { text, calls, chunks } = await collect([
      SYSTEM,
      { role: 'user', content: 'What channels do I have connected?' },
    ]);
    expect(chunks.filter((chunk) => chunk.type === 'text').length).toBeGreaterThan(2);
    expect(text.trim().length).toBeGreaterThan(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ name: 'list_channels', input: {} });
    expect(chunks[chunks.length - 1].type).toBe('tool_calls');
  });

  it('calls generate_image for image requests with the subject as the prompt', async () => {
    const { calls } = await collect([
      SYSTEM,
      { role: 'user', content: 'Generate an image of a sunrise over a city skyline' },
    ]);
    expect(calls[0]).toMatchObject({
      name: 'generate_image',
      input: { prompt: 'a sunrise over a city skyline' },
    });
  });

  it('calls generate_post for writing requests, reading format and tone hints', async () => {
    const { calls } = await collect([
      SYSTEM,
      { role: 'user', content: 'Write a long thread about remote onboarding in our company voice' },
    ]);
    expect(calls[0]).toMatchObject({
      name: 'generate_post',
      input: {
        topic: expect.stringContaining('remote onboarding'),
        format: 'thread_long',
        tone: 'company',
      },
    });
  });

  it('never calls a tool that was not offered', async () => {
    const { calls, text } = await collect(
      [SYSTEM, { role: 'user', content: 'What channels do I have connected?' }],
      [],
    );
    expect(calls).toHaveLength(0);
    expect(text.length).toBeGreaterThan(0);
  });

  it('answers a greeting with the workspace name and no tools', async () => {
    const { calls, text } = await collect([SYSTEM, { role: 'user', content: 'hello there' }]);
    expect(calls).toHaveLength(0);
    expect(text).toContain('Acme Marketing');
  });
});

describe('chat: tool results', () => {
  const user: ModelMessage = { role: 'user', content: 'What channels do I have connected?' };
  const assistant: ModelMessage = {
    role: 'assistant',
    content: 'Checking.',
    toolCalls: [{ id: 'c1', name: 'list_channels', input: {} }],
  };

  it('summarises channels by name in prose', async () => {
    const { text, calls } = await collect([
      SYSTEM,
      user,
      assistant,
      {
        role: 'tool',
        toolCallId: 'c1',
        name: 'list_channels',
        content: encodeToolResult({
          ok: true,
          output: {
            channels: [
              { id: 'a', name: 'Acme Marketing', platform: 'LinkedIn', health: 'connected' },
              { id: 'b', name: 'Acme on X', platform: 'X' },
            ],
          },
        }),
      },
    ]);
    expect(calls).toHaveLength(0);
    expect(text).toContain('2 channels');
    expect(text).toContain('Acme Marketing (LinkedIn, connected)');
    expect(text).toContain('Acme on X');
  });

  it('explains a failed tool', async () => {
    const { text } = await collect([
      SYSTEM,
      user,
      assistant,
      {
        role: 'tool',
        toolCallId: 'c1',
        name: 'list_channels',
        content: encodeToolResult({ ok: false, error: 'Channels are unavailable right now.' }),
      },
    ]);
    expect(text).toContain("I couldn't list your channels");
    expect(text).toContain('Channels are unavailable right now.');
  });

  it('after a generation with a draft request, looks up channels then drafts to the named one', async () => {
    const post = {
      format: 'one_short',
      category: 'Tips',
      parts: [{ text: 'Hook line\nBody.', imagePrompt: null, image: null }],
      sources: [],
    };
    const turn: ModelMessage[] = [
      SYSTEM,
      {
        role: 'user',
        content: 'Write a post about onboarding and save it as a draft for Acme on X',
      },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'g1', name: 'generate_post', input: {} }],
      },
      {
        role: 'tool',
        toolCallId: 'g1',
        name: 'generate_post',
        content: encodeToolResult({ ok: true, output: post }),
      },
    ];
    const first = await collect(turn);
    expect(first.calls[0]).toMatchObject({ name: 'list_channels' });

    const second = await collect([
      ...turn,
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'l1', name: 'list_channels', input: {} }],
      },
      {
        role: 'tool',
        toolCallId: 'l1',
        name: 'list_channels',
        content: encodeToolResult({
          ok: true,
          output: {
            channels: [
              { id: 'a', name: 'Acme Marketing', platform: 'LinkedIn' },
              { id: 'b', name: 'Acme on X', platform: 'X' },
            ],
          },
        }),
      },
    ]);
    expect(second.calls[0]).toMatchObject({
      name: 'draft_post',
      input: { channelIds: ['b'], parts: ['Hook line\nBody.'] },
    });

    const third = await collect([
      ...turn,
      { role: 'assistant', content: '', toolCalls: [{ id: 'd1', name: 'draft_post', input: {} }] },
      {
        role: 'tool',
        toolCallId: 'd1',
        name: 'draft_post',
        content: encodeToolResult({
          ok: true,
          output: { group: 'grp', channelNames: ['Acme on X'], parts: 1 },
        }),
      },
    ]);
    expect(third.calls).toHaveLength(0);
    expect(third.text).toContain('drafted for Acme on X');
    expect(third.text).toContain('Hook line');
    expect(third.text).toContain('composer');
  });

  it('describes a generated image', async () => {
    const { text } = await collect([
      SYSTEM,
      { role: 'user', content: 'Generate an image of a cat' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'i1', name: 'generate_image', input: {} }],
      },
      {
        role: 'tool',
        toolCallId: 'i1',
        name: 'generate_image',
        content: encodeToolResult({
          ok: true,
          output: { mediaId: 'm', url: 'u', thumbnailUrl: null, prompt: 'a cat' },
        }),
      },
    ]);
    expect(text).toContain('"a cat"');
    expect(text).toContain('media library');
  });

  it('stops streaming when aborted', async () => {
    const controller = new AbortController();
    const iterator = model
      .chat({
        messages: [SYSTEM, { role: 'user', content: 'hello there' }],
        tools: TOOLS,
        signal: controller.signal,
      })
      [Symbol.asyncIterator]();
    await iterator.next();
    controller.abort();
    await expect(iterator.next()).rejects.toMatchObject({ kind: 'aborted' });
  });
});
