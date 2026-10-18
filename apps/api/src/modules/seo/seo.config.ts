/**
 * The analyzer's configuration, read from the environment once, and the
 * one decision it embodies: where the authority (backlink) signal comes from.
 *
 * Separate from the engine factory so the decision is a pure function with
 * a test, as `engine.config.ts` is for the AI module.
 *
 * ## Three authority sources
 *
 * - **openpagerank**: a real backlink index, when `OPEN_PAGERANK_API_KEY`
 *   is set. The one external call the analyzer makes besides the crawl.
 * - **simulation**: a deterministic stand-in, when `AI_SIMULATION=true` and
 *   no key is set. The crawler itself needs no key and crawls real public
 *   pages for free, so the authority provider is the only part of the
 *   analyzer that has a stand-in; tying it to the AI flag keeps "simulated"
 *   one switch rather than two.
 * - **heuristic**: when neither is set, the backlink category is estimated from
 *   on-page signals by the evaluators and the UI says so.
 *
 * A real key beats the simulation flag, unlike the AI engine where the flag
 * wins: Open PageRank is free and read-only, so a developer who went to the
 * trouble of setting a key wants to see real numbers.
 */
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';
import { isPlaceholderKey } from '../ai/engine/engine.config';
import type { SeoAuthorityMode } from './seo.types';

/** How long the authority provider may take; the score stage falls back to the heuristic after it. */
export const AUTHORITY_TIMEOUT_MS = 5_000;

/** How many of the page's internal links are probed for a 4xx/5xx. */
export const SEO_MAX_LINK_CHECKS = 20;

export interface SeoConfig {
  timeoutMs: number;
  maxConcurrent: number;
  browser: 'auto' | 'on' | 'off';
  userAgent: string;
  /** Present only when `authority` is `openpagerank`. */
  openPageRankKey: string | null;
  authority: SeoAuthorityMode;
}

export type SeoEnv = Pick<
  Env,
  | 'SEO_CRAWL_TIMEOUT_MS'
  | 'SEO_MAX_CONCURRENT_AUDITS'
  | 'SEO_BROWSER'
  | 'SEO_USER_AGENT'
  | 'OPEN_PAGERANK_API_KEY'
  | 'AI_SIMULATION'
>;

export function resolveSeoConfig(env: SeoEnv): SeoConfig {
  const key = env.OPEN_PAGERANK_API_KEY?.trim() ?? '';
  const usableKey = key !== '' && !isPlaceholderKey(key) ? key : null;

  const authority: SeoAuthorityMode = usableKey
    ? 'openpagerank'
    : env.AI_SIMULATION === 'true'
      ? 'simulation'
      : 'heuristic';

  return {
    timeoutMs: env.SEO_CRAWL_TIMEOUT_MS,
    maxConcurrent: env.SEO_MAX_CONCURRENT_AUDITS,
    browser: env.SEO_BROWSER,
    userAgent: env.SEO_USER_AGENT,
    openPageRankKey: usableKey,
    authority,
  };
}

export function readSeoConfig(config: ConfigService<Env, true>): SeoConfig {
  return resolveSeoConfig({
    SEO_CRAWL_TIMEOUT_MS: config.get('SEO_CRAWL_TIMEOUT_MS', { infer: true }),
    SEO_MAX_CONCURRENT_AUDITS: config.get('SEO_MAX_CONCURRENT_AUDITS', { infer: true }),
    SEO_BROWSER: config.get('SEO_BROWSER', { infer: true }),
    SEO_USER_AGENT: config.get('SEO_USER_AGENT', { infer: true }),
    OPEN_PAGERANK_API_KEY: config.get('OPEN_PAGERANK_API_KEY', { infer: true }),
    AI_SIMULATION: config.get('AI_SIMULATION', { infer: true }),
  });
}

/** Nest injection token for the resolved configuration. */
export const SEO_CONFIG = Symbol('SEO_CONFIG');
