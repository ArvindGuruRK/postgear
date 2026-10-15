/**
 * Builds the engine from the configuration, once, at boot.
 *
 * The only file in the module that calls `@postgear/seo-engine`'s functions,
 * and the only one that loads its runtime (Playwright among it). It has no
 * unit test of its own, for the reason `engine.factory.ts` in the AI module
 * gives: every line is a wiring of real providers that a test could only
 * mock into meaninglessness. The config decision it acts on is tested in
 * `seo.config.spec.ts`; what the service does with the engine is tested
 * against a fake in `seo.service.spec.ts`.
 */
import type { Logger } from '@nestjs/common';
import {
  assertSafeUrl,
  createOpenPageRankProvider,
  createSeoCrawler,
  createSimulatedAuthorityProvider,
  evaluateAll,
  findingsFromReport,
  normaliseUrl,
  summariseForAdvice,
} from '@postgear/seo-engine';
import { redact } from '../../common/logging/security-logger';
import { AUTHORITY_TIMEOUT_MS, SEO_MAX_LINK_CHECKS, type SeoConfig } from './seo.config';
import type { SeoEngine } from './seo.engine';

export function createSeoEngine(config: SeoConfig, logger: Logger): SeoEngine {
  const line = (message: string, meta?: Record<string, unknown>): string =>
    meta ? `${message} ${JSON.stringify(redact(meta))}` : message;
  // Built as a value rather than inline so the crawler's own logger shape,
  // whatever subset of these it declares, is satisfied structurally.
  const crawlerLogger = {
    debug: (message: string, meta?: Record<string, unknown>) => logger.debug(line(message, meta)),
    info: (message: string, meta?: Record<string, unknown>) => logger.log(line(message, meta)),
    log: (message: string, meta?: Record<string, unknown>) => logger.log(line(message, meta)),
    warn: (message: string, meta?: Record<string, unknown>) => logger.warn(line(message, meta)),
    error: (message: string, meta?: Record<string, unknown>) => logger.error(line(message, meta)),
  };

  const crawler = createSeoCrawler({
    browser: config.browser,
    userAgent: config.userAgent,
    timeoutMs: config.timeoutMs,
    maxLinkChecks: SEO_MAX_LINK_CHECKS,
    maxPages: 1,
    logger: crawlerLogger,
  });

  const authority =
    config.authority === 'openpagerank' && config.openPageRankKey
      ? createOpenPageRankProvider({
          apiKey: config.openPageRankKey,
          timeoutMs: AUTHORITY_TIMEOUT_MS,
        })
      : config.authority === 'simulation'
        ? createSimulatedAuthorityProvider()
        : null;

  switch (config.authority) {
    case 'openpagerank':
      logger.log('SEO authority scores come from Open PageRank.');
      break;
    case 'simulation':
      logger.warn('AI_SIMULATION=true — SEO authority scores are simulated. Not for production.');
      break;
    case 'heuristic':
      logger.log(
        'OPEN_PAGERANK_API_KEY is not set — SEO authority is estimated from on-page signals.',
      );
      break;
  }

  if (config.browser === 'off') {
    logger.log('SEO_BROWSER=off — every crawl is a plain HTML fetch.');
  }

  return {
    crawler,
    authority,
    evaluate: evaluateAll,
    findings: findingsFromReport,
    summarise: summariseForAdvice,
    normaliseUrl,
    assertSafeUrl: (input) => assertSafeUrl(input),
  };
}
