/**
 * Web research: Tavily, a cache around it, and a key-free stand-in.
 *
 * Research is what makes a generated post say something true about this
 * week rather than something plausible about any week, so the pipeline runs
 * it first and feeds the sources to every later stage. It is also the stage
 * most likely to be missing (no `TAVILY_API_KEY`) or flaky (a third-party
 * search API), which is why the pipeline treats its failure as a `skipped`
 * or `failed` stage and carries on — a post without citations beats no post.
 *
 * {@link withResearchCache} exists for retries: the same brief submitted
 * twice in ten minutes (a regenerate, a retry after an image failure) should
 * not pay for the same search twice. The key normalises case and whitespace
 * so trivially different queries share an entry; the cache itself is
 * injected (the API backs it with Redis) and every cache error is swallowed,
 * because a cache that can take research down is worse than none.
 */
import { createHash } from 'node:crypto';
import { TavilySearch } from '@langchain/tavily';
import { providerError, throwIfAborted, withDeadline, withRetry } from '../model/resilience';
import type { ResearchCache, ResearchProvider, ResearchSource } from '../types';

export interface TavilyResearchOptions {
  apiKey: string;
  /** Sources per query. Default 4. */
  maxResults?: number;
  /** Default 20 000 ms. */
  timeoutMs?: number;
}

export const DEFAULT_RESEARCH_MAX_RESULTS = 4;
export const DEFAULT_RESEARCH_TIMEOUT_MS = 20_000;
export const DEFAULT_RESEARCH_CACHE_TTL_SECONDS = 600;
export const RESEARCH_CACHE_PREFIX = 'ai:research:';
export const SNIPPET_MAX_CHARS = 300;

interface TavilyResultLike {
  title?: unknown;
  url?: unknown;
  content?: unknown;
}

/** Turns Tavily's response into {@link ResearchSource}s, dropping anything malformed. */
export function normaliseTavilyResults(response: unknown, maxResults: number): ResearchSource[] {
  if (typeof response !== 'object' || response === null) return [];
  const record = response as { results?: unknown; error?: unknown };
  if (typeof record.error === 'string' && record.error.length > 0) {
    throw providerError('unavailable', { message: record.error });
  }
  if (!Array.isArray(record.results)) return [];

  const sources: ResearchSource[] = [];
  for (const item of record.results as TavilyResultLike[]) {
    if (typeof item?.url !== 'string' || item.url.length === 0) continue;
    const title =
      typeof item.title === 'string' && item.title.trim().length > 0 ? item.title.trim() : item.url;
    const content = typeof item.content === 'string' ? item.content : '';
    sources.push({ title, url: item.url, snippet: clipSnippet(content) });
    if (sources.length >= maxResults) break;
  }
  return sources;
}

function clipSnippet(content: string): string {
  const clean = content.replace(/\s+/g, ' ').trim();
  if (clean.length <= SNIPPET_MAX_CHARS) return clean;
  const cut = clean.slice(0, SNIPPET_MAX_CHARS);
  const space = cut.lastIndexOf(' ');
  return `${(space > 100 ? cut.slice(0, space) : cut).trim()}…`;
}

export function createTavilyResearch(options: TavilyResearchOptions): ResearchProvider {
  const maxResults = options.maxResults ?? DEFAULT_RESEARCH_MAX_RESULTS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_RESEARCH_TIMEOUT_MS;
  const tool = new TavilySearch({
    tavilyApiKey: options.apiKey,
    maxResults,
    includeAnswer: false,
  });

  return {
    name: 'tavily',
    search(query, searchOptions) {
      const signal = searchOptions?.signal;
      return withRetry(
        () =>
          withDeadline(
            async (deadlineSignal) => {
              const response: unknown = await tool.invoke({ query }, { signal: deadlineSignal });
              return normaliseTavilyResults(response, maxResults);
            },
            { timeoutMs, signal },
          ),
        { signal },
      );
    },
  };
}

export function researchCacheKey(query: string): string {
  const normalised = query.toLowerCase().replace(/\s+/g, ' ').trim();
  return `${RESEARCH_CACHE_PREFIX}${createHash('sha1').update(normalised).digest('hex')}`;
}

export interface ResearchCacheLogger {
  warn(message: string, meta?: Record<string, unknown>): void;
}

export function withResearchCache(
  provider: ResearchProvider,
  cache: ResearchCache,
  ttlSeconds: number = DEFAULT_RESEARCH_CACHE_TTL_SECONDS,
  logger?: ResearchCacheLogger,
): ResearchProvider {
  return {
    name: provider.name,
    async search(query, options) {
      const key = researchCacheKey(query);
      throwIfAborted(options?.signal);

      try {
        const hit = await cache.get(key);
        if (hit !== null) {
          const parsed: unknown = JSON.parse(hit);
          if (Array.isArray(parsed)) return parsed as ResearchSource[];
        }
      } catch (error) {
        logger?.warn('research cache read failed; searching', { key, error: String(error) });
      }

      const sources = await provider.search(query, options);

      try {
        await cache.set(key, JSON.stringify(sources), ttlSeconds);
      } catch (error) {
        logger?.warn('research cache write failed; ignoring', { key, error: String(error) });
      }
      return sources;
    },
  };
}

/**
 * Three canned sources that mention the query, so the "backed by research"
 * treatment can be seen — and the research-aware prompts exercised — with no
 * key. The URLs are on a reserved documentation domain and go nowhere.
 */
export function createSimulatedResearch(): ResearchProvider {
  return {
    name: 'simulation',
    async search(query, options) {
      throwIfAborted(options?.signal);
      const subject = shortSubject(query);
      const slug = subject
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 40);
      return [
        {
          title: `What the numbers say about ${subject}`,
          url: `https://research.example.com/reports/${slug || 'topic'}`,
          snippet: `teams that treat ${subject} as an ongoing practice rather than a one-off project report measurably better results within a quarter`,
        },
        {
          title: `A practical guide to ${subject}`,
          url: `https://guides.example.com/${slug || 'topic'}/getting-started`,
          snippet: `the most common mistake is starting with tooling instead of a clear definition of what good looks like`,
        },
        {
          title: `Why ${subject} is getting attention this year`,
          url: `https://news.example.com/2026/${slug || 'topic'}`,
          snippet: `interest has grown steadily this year, driven by smaller teams looking for repeatable ways to show up consistently`,
        },
      ];
    },
  };
}

/** Real titles are short; a 300-character brief should not become one. */
function shortSubject(query: string): string {
  const clean = query
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.!?]+$/, '');
  if (clean.length <= 50) return clean;
  const cut = clean.slice(0, 50);
  const space = cut.lastIndexOf(' ');
  return (space > 20 ? cut.slice(0, space) : cut).trim();
}
