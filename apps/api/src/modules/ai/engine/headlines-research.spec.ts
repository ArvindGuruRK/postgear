/**
 * Discover's headlines as the research for one run (Sprint 11), through the
 * real engine wiring: the run cites exactly the headlines it was given, the
 * configured search (Tavily in production) is never asked, nothing touches
 * the network, and a language reaches the writing stages.
 */
import type { Logger } from '@nestjs/common';
import {
  createSimulatedModelClient,
  type GenerateEvent,
  type ResearchProvider,
} from '@postgear/ai-engine';
import type { MediaService } from '../../media/media.service';
import { buildAiEngine } from './engine.factory';
import { createHeadlinesResearch, HEADLINES_PROVIDER_NAME } from './headlines-research';

const SOURCES = [
  {
    title: 'Heavy rain alert for Coimbatore',
    url: 'https://www.thehindu.com/rain',
    snippet: 'The Hindu',
  },
  {
    title: 'Schools shut as rain continues',
    url: 'https://www.dinamalar.com/schools',
    snippet: 'Dinamalar',
  },
];

const logger = { warn: jest.fn(), log: jest.fn() } as unknown as Logger;

/** An engine in `openai` mode with a stand-in for Tavily, so a call to it would show. */
function engineWithSearch(search: jest.Mock) {
  const tavily: ResearchProvider = { name: 'tavily', search };
  return buildAiEngine(
    { mode: 'openai', model: createSimulatedModelClient(), research: tavily, images: null },
    { saveGenerated: jest.fn() } as unknown as Pick<MediaService, 'saveGenerated'>,
    logger,
  );
}

async function run(
  search: jest.Mock,
  options: { research?: boolean; language?: string },
): Promise<GenerateEvent[]> {
  const pipeline = engineWithSearch(search).createPipeline(
    { orgId: 'org_1' },
    { research: options.research, researchProvider: createHeadlinesResearch(SOURCES) },
  );
  if (!pipeline) throw new Error('The engine should build a pipeline.');
  const events: GenerateEvent[] = [];
  await pipeline.generate(
    {
      topic: 'Rising search in Tamil Nadu: "weather coimbatore" (500+ searches).',
      tone: 'personal',
      format: 'one_short',
      withImage: false,
      maxCharacters: 280,
      platforms: ['linkedin'],
      workspaceName: 'Bloom Bakery',
      ...(options.language ? { language: options.language } : {}),
    },
    { onEvent: (event) => events.push(event) },
  );
  return events;
}

describe('createHeadlinesResearch', () => {
  it('answers any query with copies of the headlines it was given', async () => {
    const provider = createHeadlinesResearch(SOURCES);
    const first = await provider.search('weather coimbatore');
    const second = await provider.search('something else entirely');

    expect(provider.name).toBe(HEADLINES_PROVIDER_NAME);
    expect(first).toEqual(SOURCES);
    expect(second).toEqual(SOURCES);
    first[0].title = 'changed';
    expect((await provider.search('again'))[0].title).toBe(SOURCES[0].title);
  });
});

describe('a run with headlines as its research', () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No network in tests.'));
  });

  afterEach(() => fetchSpy.mockRestore());

  it('cites the headlines and never asks the configured search', async () => {
    const search = jest.fn().mockResolvedValue([]);
    const events = await run(search, {});

    const research = events.find((event) => event.type === 'research');
    expect(research).toEqual({ type: 'research', sources: SOURCES });
    const done = events.find((event) => event.type === 'done');
    expect(done?.type === 'done' && done.result.researched).toBe(true);
    expect(done?.type === 'done' && done.result.sources).toEqual(SOURCES);
    expect(search).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('still runs no research at all when research is switched off', async () => {
    const search = jest.fn();
    const events = await run(search, { research: false });

    expect(events.some((event) => event.type === 'research')).toBe(false);
    expect(search).not.toHaveBeenCalled();
  });

  it('writes for the language it was asked for (the simulation says so on line two)', async () => {
    const events = await run(jest.fn(), { language: 'ta' });
    const content = events.find((event) => event.type === 'content');

    expect(content?.type).toBe('content');
    if (content?.type !== 'content') return;
    expect(content.parts[0].text.split('\n')[1]).toBe('(written in ta)');
  });

  it('writes no language line when none was asked for', async () => {
    const events = await run(jest.fn(), {});
    const content = events.find((event) => event.type === 'content');

    if (content?.type !== 'content') throw new Error('No content event.');
    expect(content.parts[0].text).not.toContain('(written in');
  });
});
