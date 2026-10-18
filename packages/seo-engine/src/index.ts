/**
 * `@postgear/seo-engine`: crawl a URL safely, score what came back.
 *
 * The API composes three things from here: a crawler (`createSeoCrawler`),
 * the scoring (`evaluateAll` + `findingsFromReport`) and an authority
 * provider chosen by configuration. Everything is exported through this file
 * so the API never reaches into the package's folders; `types.ts` is the
 * contract the web app mirrors.
 */

export { createHeuristicAuthorityProvider } from './authority/heuristic.provider';
export {
  AuthorityProviderError,
  createOpenPageRankProvider,
  DEFAULT_OPEN_PAGERANK_TIMEOUT_MS,
  OPEN_PAGERANK_ENDPOINT,
  type OpenPageRankOptions,
} from './authority/open-pagerank.provider';
export {
  createSimulatedAuthorityProvider,
  hashHostname,
  SIMULATED_AUTHORITY_MAX,
  SIMULATED_AUTHORITY_MIN,
  simulatedAuthorityFor,
} from './authority/simulated.provider';
export {
  type BrowserPool,
  type BrowserPoolLogger,
  type BrowserPoolOptions,
  createBrowserPool,
  DEFAULT_LAUNCH_TIMEOUT_MS,
  DEFAULT_MAX_PAGES,
  type PooledPage,
} from './crawler/browser.pool';
export {
  crawlStageLabels,
  createSeoCrawler,
  DEFAULT_CRAWL_TIMEOUT_MS,
  DEFAULT_MAX_LINK_CHECKS,
  FALLBACK_MIN_REMAINING_MS,
  FALLBACK_RESERVE_MS,
  type SeoCrawlerLogger,
  type SeoCrawlerOptions,
} from './crawler/crawler';
export {
  countSentences,
  countSyllables,
  countWords,
  decodeEntities,
  fleschReadingEase,
  parseHtml,
  STOP_WORDS,
  siteKey,
  tokenize,
  topKeywords,
} from './crawler/html.parser';
export {
  isPathBlocked,
  parseRobotsTxt,
  type RobotsRules,
  robotsPathMatches,
} from './crawler/robots';
export {
  classifyFetchError,
  DEFAULT_MAX_HTML_BYTES,
  DEFAULT_MAX_REDIRECTS,
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_USER_AGENT,
  fetchUrlSafely,
  headUrlSafely,
  isHtmlContentType,
  type SafeFetchOptions,
  type SafeFetchResponse,
  type SafeProbeOptions,
  type SafeProbeResponse,
} from './crawler/safe-fetch';
export {
  assertSafeUrl,
  bareHostname,
  isPrivateAddress,
  normaliseUrl,
  urlRejectMessage,
} from './crawler/url-guard';
export {
  type AuthoritySignal,
  authoritySignals,
  ESTIMATE_CAP,
  estimateAuthority,
  evaluateBacklink,
} from './scoring/backlink.evaluator';
export { band, buildCategory, check, ramp, scoreCategory } from './scoring/checks';
export { evaluateContent } from './scoring/content.evaluator';
export { countSkippedHeadingLevels, evaluateOnPage } from './scoring/on-page.evaluator';
export {
  ADVICE_DIGEST_MAX_CHARS,
  calculateScore,
  evaluateAll,
  findingsFromReport,
  gradeFor,
  summariseForAdvice,
} from './scoring/score.calculator';
export { evaluateTechnical, isNoindex } from './scoring/technical.evaluator';
export * from './types';
