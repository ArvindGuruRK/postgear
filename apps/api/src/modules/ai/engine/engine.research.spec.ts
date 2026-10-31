/**
 * The `research` option on `createPipeline` (Sprint 10's Generate Text
 * switch), through the real factory in simulation mode: off means no
 * research event at all; on uses the simulated research, never Tavily,
 * even with a Tavily key in the environment.
 */

import type { ConfigService } from '@nestjs/config';
import type { GenerateEvent } from '@postgear/ai-engine';
import type { Env } from '../../../config/env';
import type { MediaService } from '../../media/media.service';
import type { RedisService } from '../../redis/redis.service';
import { createAiEngine } from './engine.factory';

function simulatedEngine() {
  const values: Record<string, string | undefined> = {
    AI_SIMULATION: 'true',
    OPENAI_API_KEY: undefined,
    TAVILY_API_KEY: 'tvly-a-real-looking-key-1234567890',
    AI_MODEL: 'gpt-4.1-mini',
    AI_IMAGE_MODEL: 'gpt-image-1',
  };
  const config = { get: (key: string) => values[key] } as unknown as ConfigService<Env, true>;
  return createAiEngine({
    config,
    redis: {} as RedisService,
    media: { saveGenerated: jest.fn() } as unknown as MediaService,
  });
}

async function eventsOf(research: boolean | undefined): Promise<GenerateEvent[]> {
  const engine = simulatedEngine();
  const pipeline = engine.createPipeline(
    { orgId: 'org_1' },
    research === undefined ? undefined : { research },
  );
  if (!pipeline) throw new Error('Simulation should build a pipeline.');
  const events: GenerateEvent[] = [];
  await pipeline.generate(
    {
      topic: 'Our new sourdough starter',
      tone: 'company',
      format: 'one_short',
      withImage: false,
      maxCharacters: 280,
      platforms: ['linkedin'],
      workspaceName: 'Bloom Bakery',
    },
    { onEvent: (event) => events.push(event) },
  );
  return events;
}

describe('createPipeline research option', () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No network in tests.'));
  });

  afterEach(() => fetchSpy.mockRestore());

  it('runs no research when the step turns it off', async () => {
    const events = await eventsOf(false);

    expect(events.some((event) => event.type === 'research')).toBe(false);
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'stage', stage: 'research', status: 'skipped' }),
    );
  });

  it('uses the simulated research under AI_SIMULATION, never Tavily', async () => {
    const events = await eventsOf(true);
    const research = events.find((event) => event.type === 'research');

    expect(research).toBeDefined();
    if (research?.type !== 'research') return;
    expect(research.sources.length).toBeGreaterThan(0);
    for (const source of research.sources) expect(source.url).toMatch(/\.example\.com\//);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('keeps researching by default, as the AI page always has', async () => {
    const events = await eventsOf(undefined);
    expect(events.some((event) => event.type === 'research')).toBe(true);
  });

  it('builds a snippet writer on the same model', async () => {
    const writer = simulatedEngine().createSnippetWriter({ orgId: 'org_1' });
    await expect(
      writer?.rewrite({ text: 'I bake.', platform: 'x', voice: 'company' }),
    ).resolves.toEqual({ text: 'We bake.', shortened: false });
  });
});
