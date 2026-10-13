/**
 * The generate reducer, against the event sequence the API streams.
 *
 * These pin what would be silent if wrong: the tracker follows the stage
 * events, a mid-stream error keeps what was produced, a stop marks the
 * running stage as stopped rather than failed, and a finished run closes
 * every stage that never ran.
 */
import type { AiCredits, GenerateRequestBody, GenerateStreamEvent } from '@/types/ai';
import type { Channel, ProviderSummary } from '@/types/channel';
import {
  type GenerateState,
  generateCost,
  generateReducer,
  hasPartialResult,
  initialGenerateState,
  nextFullHour,
  partsAsText,
  strictestLimit,
} from './generate-state';

const credits: AiCredits = {
  allowance: 100,
  used: 23,
  remaining: 77,
  resetsAt: '2026-11-01T00:00:00.000Z',
  tier: 'STANDARD',
  low: false,
  costs: { generate_post: 5, generate_image: 10, copilot_message: 1 },
};

const request: GenerateRequestBody = {
  topic: 'Our new release',
  tone: 'company',
  format: 'one_short',
  withImage: true,
  channelIds: ['seed-channel-linkedin'],
};

function run(state: GenerateState, ...events: GenerateStreamEvent[]): GenerateState {
  return events.reduce(
    (current, event) => generateReducer(current, { type: 'event', event }),
    state,
  );
}

function started(): GenerateState {
  return generateReducer(initialGenerateState(credits), { type: 'start', request });
}

const part = { text: 'Hello world', imagePrompt: null, image: null };

describe('generateReducer', () => {
  it('starts with every stage pending and the image stage skipped when none was asked for', () => {
    const state = generateReducer(initialGenerateState(credits), {
      type: 'start',
      request: { ...request, withImage: false },
    });

    expect(state.phase).toBe('running');
    expect(state.stages.research.status).toBe('pending');
    expect(state.stages.image).toEqual({ status: 'skipped', detail: 'No image requested' });
    expect(state.credits).toBe(credits);
  });

  it('follows the stage events and derives a research detail from the sources', () => {
    const state = run(
      started(),
      { type: 'stage', stage: 'research', status: 'started' },
      {
        type: 'research',
        sources: [
          { title: 'A', url: 'https://a', snippet: 'a' },
          { title: 'B', url: 'https://b', snippet: 'b' },
        ],
      },
      { type: 'stage', stage: 'research', status: 'done' },
      { type: 'stage', stage: 'classify', status: 'started' },
    );

    expect(state.stages.research).toEqual({ status: 'done', detail: '2 sources found' });
    expect(state.stages.classify.status).toBe('active');
    expect(state.sources).toHaveLength(2);
  });

  it("keeps the API's own detail over the derived one", () => {
    const state = run(started(), {
      type: 'stage',
      stage: 'research',
      status: 'skipped',
      detail: 'Research skipped — no TAVILY_API_KEY',
    });

    expect(state.stages.research.detail).toBe('Research skipped — no TAVILY_API_KEY');
  });

  it('collects category, hook, parts and the image on its part', () => {
    const image = { mediaId: 'm1', url: 'https://img', thumbnailUrl: null };
    const state = run(
      started(),
      { type: 'category', category: 'Product' },
      { type: 'hook', hook: 'Big news.' },
      { type: 'content', parts: [part, { ...part, text: 'Second' }] },
      { type: 'image', index: 0, image },
    );

    expect(state.category).toBe('Product');
    expect(state.hook).toBe('Big news.');
    expect(state.parts?.[0].image).toEqual(image);
    expect(state.parts?.[1].image).toBeNull();
    expect(hasPartialResult(state)).toBe(true);
  });

  it('on done takes the result, the credits, and closes stages that never ran', () => {
    const result = {
      tone: 'company' as const,
      format: 'one_short' as const,
      category: 'Product',
      hook: 'Big news.',
      parts: [part],
      sources: [],
      researched: false,
    };
    const state = run(
      started(),
      { type: 'stage', stage: 'content', status: 'started' },
      { type: 'done', result, credits: { ...credits, used: 38, remaining: 62 } },
    );

    expect(state.phase).toBe('done');
    expect(state.result).toBe(result);
    expect(state.parts).toBe(result.parts);
    expect(state.credits?.used).toBe(38);
    expect(state.stages.content.status).toBe('done');
    expect(state.stages.research.status).toBe('skipped');
    expect(state.stages.image.status).toBe('skipped');
  });

  it('keeps partial results on a mid-stream error and fails the running stage', () => {
    const state = run(
      started(),
      { type: 'hook', hook: 'Big news.' },
      { type: 'content', parts: [part] },
      { type: 'stage', stage: 'image', status: 'started' },
      {
        type: 'error',
        kind: 'rate_limited',
        message: 'The model is busy.',
        retryable: true,
        credits: { ...credits, remaining: 72 },
      },
    );

    expect(state.phase).toBe('error');
    expect(state.error).toEqual({
      kind: 'rate_limited',
      message: 'The model is busy.',
      retryable: true,
      beforeStream: false,
    });
    expect(state.parts).toHaveLength(1);
    expect(state.stages.image.status).toBe('failed');
    expect(state.credits?.remaining).toBe(72);
  });

  it('marks the running stage as stopped on abort, and ignores later events', () => {
    const aborted = generateReducer(
      run(started(), { type: 'stage', stage: 'hook', status: 'started' }),
      { type: 'abort' },
    );

    expect(aborted.phase).toBe('aborted');
    expect(aborted.stages.hook).toEqual({ status: 'skipped', detail: 'Stopped' });

    const after = run(aborted, { type: 'hook', hook: 'Late' });
    expect(after).toBe(aborted);
  });

  it('records a refused request as an error before the stream, by status', () => {
    const refused = generateReducer(started(), {
      type: 'fail',
      message: 'Out of credits.',
      status: 402,
    });

    expect(refused.phase).toBe('error');
    expect(refused.error).toMatchObject({
      kind: 'out_of_credits',
      beforeStream: true,
      retryable: false,
    });

    const network = generateReducer(started(), { type: 'fail', message: 'Offline.' });
    expect(network.error).toMatchObject({ kind: 'unexpected', retryable: true });
  });

  it('reset clears everything but the credits', () => {
    const state = generateReducer(run(started(), { type: 'hook', hook: 'x' }), { type: 'reset' });

    expect(state.phase).toBe('idle');
    expect(state.hook).toBeNull();
    expect(state.credits).toBe(credits);
  });
});

describe('helpers', () => {
  const channels = [
    { id: 'c-x', providerIdentifier: 'x', providerName: 'X' },
    { id: 'c-li', providerIdentifier: 'linkedin', providerName: 'LinkedIn' },
  ] as Channel[];
  const providers = [
    { identifier: 'x', name: 'X', rules: { maxLength: 280, lengthMethod: 'x-weighted' } },
    { identifier: 'linkedin', name: 'LinkedIn', rules: { maxLength: 3000, lengthMethod: 'utf16' } },
  ] as ProviderSummary[];

  it('finds the strictest limit among the selected channels', () => {
    expect(strictestLimit(['c-li'], channels, providers)).toMatchObject({
      platform: 'LinkedIn',
      maxLength: 3000,
    });
    expect(strictestLimit(['c-li', 'c-x'], channels, providers)).toMatchObject({
      platform: 'X',
      maxLength: 280,
      lengthMethod: 'x-weighted',
    });
    expect(strictestLimit([], channels, providers)).toBeNull();
    expect(strictestLimit(['c-x'], channels, [])).toBeNull();
  });

  it('prices a generation from the API costs', () => {
    expect(generateCost(credits, false)).toBe(5);
    expect(generateCost(credits, true)).toBe(15);
  });

  it('rounds up to the next full hour', () => {
    expect(nextFullHour(new Date('2026-10-14T13:41:12')).toISOString()).toBe(
      new Date('2026-10-14T14:00:00').toISOString(),
    );
    expect(nextFullHour(new Date('2026-10-14T13:00:00')).getHours()).toBe(14);
  });

  it('joins parts with a blank line for the clipboard', () => {
    expect(partsAsText([part, { ...part, text: 'Two' }])).toBe('Hello world\n\nTwo');
  });
});
