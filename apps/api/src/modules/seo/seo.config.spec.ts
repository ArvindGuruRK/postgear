/**
 * Authority source selection from the environment: a real key wins, the
 * simulation flag stands in without one, and nothing means the heuristic.
 */
import { resolveSeoConfig, type SeoEnv } from './seo.config';

function env(overrides: Partial<SeoEnv> = {}): SeoEnv {
  return {
    SEO_CRAWL_TIMEOUT_MS: 30_000,
    SEO_MAX_CONCURRENT_AUDITS: 2,
    SEO_BROWSER: 'auto',
    SEO_USER_AGENT: 'PostGearBot/1.0',
    OPEN_PAGERANK_API_KEY: undefined,
    AI_SIMULATION: 'false',
    ...overrides,
  };
}

describe('resolveSeoConfig', () => {
  it('passes the limits through and estimates authority with no key and no simulation', () => {
    expect(resolveSeoConfig(env())).toEqual({
      timeoutMs: 30_000,
      maxConcurrent: 2,
      browser: 'auto',
      userAgent: 'PostGearBot/1.0',
      openPageRankKey: null,
      authority: 'heuristic',
    });
  });

  it('simulates authority under AI_SIMULATION when there is no key', () => {
    expect(resolveSeoConfig(env({ AI_SIMULATION: 'true' }))).toMatchObject({
      authority: 'simulation',
      openPageRankKey: null,
    });
  });

  it('uses Open PageRank with a real key, even under simulation', () => {
    expect(resolveSeoConfig(env({ OPEN_PAGERANK_API_KEY: ' opr-live ' }))).toMatchObject({
      authority: 'openpagerank',
      openPageRankKey: 'opr-live',
    });
    expect(
      resolveSeoConfig(env({ OPEN_PAGERANK_API_KEY: 'opr-live', AI_SIMULATION: 'true' })).authority,
    ).toBe('openpagerank');
  });

  it('ignores a placeholder or blank key', () => {
    expect(resolveSeoConfig(env({ OPEN_PAGERANK_API_KEY: 'your-api-key' })).authority).toBe(
      'heuristic',
    );
    expect(resolveSeoConfig(env({ OPEN_PAGERANK_API_KEY: '   ' })).authority).toBe('heuristic');
  });
});
