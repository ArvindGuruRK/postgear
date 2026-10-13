import type { ResearchCache, ResearchProvider } from '../types';
import {
  createSimulatedResearch,
  normaliseTavilyResults,
  researchCacheKey,
  withResearchCache,
} from './tavily-search.tool';

describe('normaliseTavilyResults', () => {
  it('maps results, clips snippets and caps the count', () => {
    const sources = normaliseTavilyResults(
      {
        results: [
          { title: 'One', url: 'https://a', content: `${'word '.repeat(100)}end` },
          { title: '', url: 'https://b', content: 'short' },
          { url: 'https://c' },
          { title: 'no url' },
          { title: 'Four', url: 'https://d', content: 'x' },
        ],
      },
      3,
    );
    expect(sources).toHaveLength(3);
    expect(sources[0].title).toBe('One');
    expect(sources[0].snippet.length).toBeLessThanOrEqual(301);
    expect(sources[0].snippet.endsWith('…')).toBe(true);
    expect(sources[1]).toEqual({ title: 'https://b', url: 'https://b', snippet: 'short' });
    expect(sources[2]).toEqual({ title: 'https://c', url: 'https://c', snippet: '' });
  });

  it('turns a Tavily error payload into an unavailable error', () => {
    expect(() => normaliseTavilyResults({ error: 'quota exceeded' }, 3)).toThrow(
      expect.objectContaining({ kind: 'unavailable' }),
    );
    expect(normaliseTavilyResults(null, 3)).toEqual([]);
    expect(normaliseTavilyResults({ results: 'nope' }, 3)).toEqual([]);
  });
});

describe('researchCacheKey', () => {
  it('normalises case and whitespace into the same key', () => {
    const a = researchCacheKey('  Posting   Schedules\nfor teams ');
    const b = researchCacheKey('posting schedules for TEAMS');
    expect(a).toBe(b);
    expect(a).toMatch(/^ai:research:[0-9a-f]{40}$/);
    expect(researchCacheKey('other')).not.toBe(a);
  });
});

describe('withResearchCache', () => {
  const sources = [{ title: 'T', url: 'https://t', snippet: 's' }];

  function provider(): ResearchProvider & { search: jest.Mock } {
    return { name: 'inner', search: jest.fn(async () => sources) };
  }

  function memoryCache(): ResearchCache & { store: Map<string, string> } {
    const store = new Map<string, string>();
    return {
      store,
      get: async (key) => store.get(key) ?? null,
      set: async (key, value) => {
        store.set(key, value);
      },
    };
  }

  it('searches on a miss, stores, and serves the hit without searching', async () => {
    const inner = provider();
    const cache = memoryCache();
    const set = jest.spyOn(cache, 'set');
    const cached = withResearchCache(inner, cache, 120);

    await expect(cached.search('Topic one')).resolves.toEqual(sources);
    expect(inner.search).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith(researchCacheKey('Topic one'), JSON.stringify(sources), 120);

    await expect(cached.search('topic  ONE')).resolves.toEqual(sources);
    expect(inner.search).toHaveBeenCalledTimes(1);
    expect(cached.name).toBe('inner');
  });

  it('defaults the TTL to 600 seconds', async () => {
    const cache = memoryCache();
    const set = jest.spyOn(cache, 'set');
    await withResearchCache(provider(), cache).search('q');
    expect(set.mock.calls[0][2]).toBe(600);
  });

  it('ignores cache failures and still returns results', async () => {
    const inner = provider();
    const logger = { warn: jest.fn() };
    const broken: ResearchCache = {
      get: async () => {
        throw new Error('redis down');
      },
      set: async () => {
        throw new Error('redis down');
      },
    };
    await expect(withResearchCache(inner, broken, 60, logger).search('q')).resolves.toEqual(
      sources,
    );
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });

  it('ignores a corrupt cache entry', async () => {
    const inner = provider();
    const cache = memoryCache();
    cache.store.set(researchCacheKey('q'), 'not json');
    await expect(withResearchCache(inner, cache).search('q')).resolves.toEqual(sources);
    expect(inner.search).toHaveBeenCalledTimes(1);
  });

  it('passes the abort signal through and refuses when already aborted', async () => {
    const inner = provider();
    const controller = new AbortController();
    await withResearchCache(inner, memoryCache()).search('q', { signal: controller.signal });
    expect(inner.search).toHaveBeenCalledWith('q', { signal: controller.signal });
    controller.abort();
    await expect(
      withResearchCache(inner, memoryCache()).search('other', { signal: controller.signal }),
    ).rejects.toMatchObject({ kind: 'aborted' });
  });
});

describe('createSimulatedResearch', () => {
  it('returns three sources that mention the query', async () => {
    const sources = await createSimulatedResearch().search('remote onboarding');
    expect(sources).toHaveLength(3);
    for (const source of sources) {
      expect(source.title.toLowerCase()).toContain('remote onboarding');
      expect(source.url).toMatch(/^https:\/\/\w+\.example\.com\//);
      expect(source.snippet.length).toBeGreaterThan(20);
    }
  });

  it('keeps titles short for a long brief', async () => {
    const [first] = await createSimulatedResearch().search(
      'a very long brief about how a small marketing team can stay consistent on three platforms without burning out',
    );
    expect(first.title.length).toBeLessThan(90);
  });
});
