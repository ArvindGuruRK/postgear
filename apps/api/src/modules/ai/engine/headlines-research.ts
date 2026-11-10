/**
 * Research that is already done: the headlines a caller hands in (Sprint 11).
 *
 * Discover's Create Post sends the trend's or story's related coverage as
 * `sources`. Rather than search the web for what the card already shows,
 * the run is given this provider in place of Tavily or the simulated one:
 * its `search` ignores the query and returns those sources unchanged. So
 * "Backed By Research" lists exactly the headlines the person saw, the
 * pipeline's research stage runs as it always does (a `research` event,
 * `researched: true`), and no search is made or paid for.
 *
 * The sources were validated by the request schema (http or https
 * addresses, one line each, at most six). Copies go out, so nothing the
 * engine does to a result can reach back into the request.
 */
import type { ResearchProvider, ResearchSource } from '@postgear/ai-engine';

export const HEADLINES_PROVIDER_NAME = 'discover-headlines';

export function createHeadlinesResearch(sources: readonly ResearchSource[]): ResearchProvider {
  const kept = sources.map(({ title, url, snippet }) => ({ title, url, snippet }));

  return {
    name: HEADLINES_PROVIDER_NAME,
    async search(_query, options) {
      if (options?.signal?.aborted) {
        throw options.signal.reason ?? new DOMException('Aborted', 'AbortError');
      }
      return kept.map((source) => ({ ...source }));
    },
  };
}
