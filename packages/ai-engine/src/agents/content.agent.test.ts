import type { z } from 'zod';
import { createSimulatedModelClient } from '../model/simulated-model-client';
import { createSimulatedResearch } from '../tools/tavily-search.tool';
import {
  AiProviderError,
  type GeneratedPart,
  type GenerateEvent,
  type GenerateRequest,
  type ImageGenerator,
  type ImageSink,
  type ModelClient,
  type ResearchProvider,
} from '../types';
import {
  createContentPipeline,
  imageNameFor,
  normaliseParts,
  researchQueryFor,
} from './content.agent';

const request: GenerateRequest = {
  topic: 'Three tips for keeping a posting schedule without burning out',
  tone: 'personal',
  format: 'one_short',
  withImage: false,
  maxCharacters: 280,
  platforms: ['x'],
  workspaceName: 'Acme Marketing',
};

const savedImage = {
  mediaId: 'media-1',
  url: 'https://cdn/1.png',
  thumbnailUrl: 'https://cdn/1-t.png',
};

function fakeImages(): ImageGenerator & { generate: jest.Mock } {
  return {
    name: 'fake-images',
    generate: jest.fn(async () => ({
      data: Buffer.from('png'),
      mimeType: 'image/png' as const,
      revisedPrompt: 'revised',
    })),
  };
}

function fakeSink(): ImageSink & { save: jest.Mock } {
  return { save: jest.fn(async () => savedImage) };
}

function stageEvents(events: GenerateEvent[]): string[] {
  return events.flatMap((event) =>
    event.type === 'stage' ? [`${event.stage}:${event.status}`] : [],
  );
}

async function run(
  deps: Partial<Parameters<typeof createContentPipeline>[0]> = {},
  overrides: Partial<GenerateRequest> = {},
  signal?: AbortSignal,
) {
  const events: GenerateEvent[] = [];
  const pipeline = createContentPipeline({
    model: createSimulatedModelClient(),
    research: createSimulatedResearch(),
    images: null,
    imageSink: null,
    ...deps,
  });
  const result = await pipeline.generate(
    { ...request, ...overrides },
    { onEvent: (e) => events.push(e), signal },
  );
  return { result, events };
}

describe('content pipeline', () => {
  it('runs research → classify → hook → content and reports every stage', async () => {
    const { result, events } = await run();
    expect(stageEvents(events)).toEqual([
      'research:started',
      'research:done',
      'classify:started',
      'classify:done',
      'hook:started',
      'hook:done',
      'content:started',
      'content:done',
      'image:skipped',
    ]);
    const types = events.map((event) => event.type);
    expect(types.indexOf('research')).toBeLessThan(types.indexOf('category'));
    expect(types.indexOf('category')).toBeLessThan(types.indexOf('hook'));
    expect(types.indexOf('hook')).toBeLessThan(types.indexOf('content'));
    expect(types[types.length - 1]).toBe('done');

    expect(result.category).toBe('Tips');
    expect(result.researched).toBe(true);
    expect(result.sources).toHaveLength(3);
    expect(result.parts).toHaveLength(1);
    expect(result.parts[0].text.startsWith(result.hook)).toBe(true);
    expect(result.parts[0].image).toBeNull();
    expect(result.tone).toBe('personal');
    expect(result.format).toBe('one_short');
    const done = events[events.length - 1];
    expect(done.type === 'done' && done.result).toEqual(result);
  });

  it('skips research when no provider is configured', async () => {
    const { result, events } = await run({ research: null });
    expect(events[0]).toEqual({
      type: 'stage',
      stage: 'research',
      status: 'skipped',
      detail: 'No research provider configured',
    });
    expect(events.some((event) => event.type === 'research')).toBe(false);
    expect(result.researched).toBe(false);
    expect(result.sources).toEqual([]);
    expect(result.parts[0].text.length).toBeGreaterThan(0);
  });

  it('reports a research failure and keeps going', async () => {
    const logger = { warn: jest.fn() };
    const research: ResearchProvider = {
      name: 'broken',
      search: async () => {
        throw { status: 503, message: 'tavily down, key tvly-abcdefgh' };
      },
    };
    const { result, events } = await run({ research, logger });
    const failed = events.find(
      (event) => event.type === 'stage' && event.stage === 'research' && event.status === 'failed',
    );
    expect(failed).toBeDefined();
    expect(failed?.type === 'stage' && failed.detail).not.toContain('tvly-abcdefgh');
    expect(result.researched).toBe(false);
    expect(result.parts).toHaveLength(1);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('generates, saves and attaches a hero image to the first part only', async () => {
    const images = fakeImages();
    const imageSink = fakeSink();
    const { result, events } = await run(
      { images, imageSink },
      { withImage: true, format: 'thread_short' },
    );
    expect(stageEvents(events).slice(-2)).toEqual(['image:started', 'image:done']);
    expect(images.generate).toHaveBeenCalledTimes(1);
    const [prompt] = images.generate.mock.calls[0];
    expect(prompt).toBe(result.parts[0].imagePrompt);
    expect(imageSink.save).toHaveBeenCalledWith(
      expect.objectContaining({ mimeType: 'image/png' }),
      {
        prompt,
        name: imageNameFor(prompt),
      },
    );
    expect(result.parts[0].image).toEqual(savedImage);
    for (const part of result.parts.slice(1)) expect(part.image).toBeNull();
    expect(events).toContainEqual({ type: 'image', index: 0, image: savedImage });
    const contentEvent = events.find((event) => event.type === 'content');
    expect(contentEvent?.type === 'content' && contentEvent.parts[0].image).toBeNull();
  });

  it('reports an image failure and returns the post without one', async () => {
    const images = fakeImages();
    images.generate.mockRejectedValue({ status: 500, message: 'dall-e down' });
    const { result, events } = await run({ images, imageSink: fakeSink() }, { withImage: true });
    expect(stageEvents(events).slice(-2)).toEqual(['image:started', 'image:failed']);
    expect(result.parts[0].image).toBeNull();
    expect(result.parts[0].imagePrompt).toEqual(expect.any(String));
    expect(events[events.length - 1].type).toBe('done');
  });

  it('skips the image when requested but not configured', async () => {
    const { events } = await run({}, { withImage: true });
    expect(events).toContainEqual({
      type: 'stage',
      stage: 'image',
      status: 'skipped',
      detail: 'Image generation is not configured',
    });
  });

  it('refuses a generator without a sink', () => {
    expect(() =>
      createContentPipeline({
        model: createSimulatedModelClient(),
        research: null,
        images: fakeImages(),
        imageSink: null,
      }),
    ).toThrow(/together/);
  });

  it('tone changes the prompts and the copy', async () => {
    const model = createSimulatedModelClient();
    const structured = jest.spyOn(model, 'structured');

    const personal = await run({ model, research: null });
    const personalPrompts = structured.mock.calls.map((call) => call[0].system).join('\n');
    expect(personalPrompts).toContain('first person singular');
    expect(personalPrompts).not.toContain('first person plural');
    expect(personal.result.parts[0].text).toMatch(/\b(I|me|my)\b/);
    expect(personal.result.parts[0].text).not.toMatch(/\b(we|us|our)\b/i);

    structured.mockClear();
    const company = await run({ model, research: null }, { tone: 'company' });
    const companyPrompts = structured.mock.calls.map((call) => call[0].system).join('\n');
    expect(companyPrompts).toContain('first person plural');
    expect(companyPrompts).toContain('as Acme Marketing');
    expect(company.result.parts[0].text).toMatch(/\b(we|us|our)\b/i);
    expect(company.result.parts[0].text).not.toMatch(/\b(I|me|my)\b/);
  });

  it('respects maxCharacters for every part of a thread', async () => {
    const { result } = await run({}, { format: 'thread_long', maxCharacters: 400 });
    expect(result.parts.length).toBeGreaterThanOrEqual(3);
    for (const part of result.parts) expect(part.text.length).toBeLessThanOrEqual(400);
  });

  it('repairs an over-limit part once, then truncates at a sentence boundary', async () => {
    const logger = { warn: jest.fn() };
    const long = `${'A sentence that goes on. '.repeat(30)}`.trim();
    const slightlyLong = `${'A shorter sentence. '.repeat(16)}`.trim();
    let contentCalls = 0;
    const model: ModelClient = {
      name: 'scripted',
      async structured<T>(params: { schema: z.ZodType<T>; user: string }): Promise<T> {
        if (params.user.includes('<<<Hook')) {
          contentCalls += 1;
          const text = params.user.includes('<<<Repair') ? slightlyLong : long;
          return params.schema.parse({ parts: [{ text }] });
        }
        if (params.user.includes('Category:'))
          return params.schema.parse({ hook: 'A hook that fits.' });
        return params.schema.parse({ category: 'Tips' });
      },
      async *chat() {
        yield { type: 'text', text: '' };
      },
    };
    const { result } = await run({ model, research: null, logger }, { maxCharacters: 200 });
    expect(contentCalls).toBe(2);
    expect(result.parts[0].text.length).toBeLessThanOrEqual(200);
    expect(result.parts[0].text.startsWith('A hook that fits.')).toBe(true);
    expect(result.parts[0].text.endsWith('.')).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('truncating'),
      expect.objectContaining({ maxChars: 200 }),
    );
  });

  it('rejects with the provider error when the copy cannot be produced', async () => {
    const model: ModelClient = {
      name: 'failing',
      structured: async () => {
        throw new AiProviderError('rate_limited', 'slow down', true);
      },
      async *chat() {
        yield { type: 'text', text: '' };
      },
    };
    const events: GenerateEvent[] = [];
    const pipeline = createContentPipeline({
      model,
      research: null,
      images: null,
      imageSink: null,
    });
    await expect(
      pipeline.generate(request, { onEvent: (e) => events.push(e) }),
    ).rejects.toMatchObject({ kind: 'rate_limited' });
    expect(stageEvents(events)).toEqual(['research:skipped', 'classify:started']);
  });

  it('rejects with aborted when the signal fires mid-run', async () => {
    const controller = new AbortController();
    const research: ResearchProvider = {
      name: 'slow',
      search: (_query, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
          );
        }),
    };
    const events: GenerateEvent[] = [];
    const pipeline = createContentPipeline({
      model: createSimulatedModelClient(),
      research,
      images: null,
      imageSink: null,
    });
    const settled = pipeline
      .generate(request, { signal: controller.signal, onEvent: (e) => events.push(e) })
      .catch((error: unknown) => error);
    controller.abort();
    expect(await settled).toMatchObject({ kind: 'aborted' });
    expect(events.map((event) => event.type)).not.toContain('done');
  });

  it('rejects immediately when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(run({}, {}, controller.signal)).rejects.toMatchObject({ kind: 'aborted' });
  });
});

describe('helpers', () => {
  it('researchQueryFor trims and caps the topic', () => {
    expect(researchQueryFor('  a   b  ')).toBe('a b');
    expect(researchQueryFor('x'.repeat(400))).toHaveLength(300);
  });

  it('imageNameFor keeps the first 60 characters of the prompt', () => {
    expect(imageNameFor('short prompt')).toBe('AI image: short prompt');
    expect(imageNameFor('p'.repeat(100))).toBe(`AI image: ${'p'.repeat(60)}…`);
  });

  it('normaliseParts cleans, leads with the hook, caps the count and flags overflow', () => {
    const { parts, overflow } = normaliseParts(
      [
        { text: '**Body** #tag', imagePrompt: 'img' },
        { text: 'x'.repeat(50), imagePrompt: 'ignored' },
        { text: 'dropped' },
      ],
      'The hook',
      { maxParts: 2, maxChars: 20 },
    );
    expect(parts).toHaveLength(2);
    expect(parts[0]).toEqual<GeneratedPart>({
      text: 'The hook\nBody',
      imagePrompt: 'img',
      image: null,
    });
    expect(parts[1].imagePrompt).toBeNull();
    expect(overflow).toEqual([1]);
  });
});
