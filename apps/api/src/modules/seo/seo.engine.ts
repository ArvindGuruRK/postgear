/**
 * The engine as the SEO module sees it: one object behind a token.
 *
 * `@postgear/seo-engine` exports a crawler factory, two authority providers,
 * the evaluators and a few pure helpers. This interface is what they add up
 * to once the environment has been read, and the service depends on this
 * and only this — behind `SEO_ENGINE`, like `AI_ENGINE` in the AI module —
 * so every test hands in a fake. That matters more here than usual: the
 * real crawler drives Playwright, and a unit test that loads a browser is
 * not a unit test.
 *
 * This file carries only *types* from the engine, on purpose. The factory
 * that calls the engine's functions is `seo.engine.factory.ts`, imported by
 * the module alone, so importing the service never pulls the crawler in.
 */
import type {
  AuthorityEstimate,
  AuthorityProvider,
  CrawlResult,
  SeoAudit,
  SeoCrawler,
  SeoRecommendation,
  SeoScoreReport,
  UrlSafetyResult,
} from '@postgear/seo-engine';

export interface SeoEngine {
  readonly crawler: SeoCrawler;
  /** Null means the backlink category is estimated from on-page signals. */
  readonly authority: AuthorityProvider | null;
  /** The four evaluators and the composite, as one pure call. */
  evaluate(crawl: CrawlResult, authority: AuthorityEstimate | null): SeoScoreReport;
  /** The rule-based recommendations a report implies: the advice when AI is off, the model's input when on. */
  findings(report: SeoScoreReport): SeoRecommendation[];
  /** The audit in prose, for the advice prompt. */
  summarise(audit: SeoAudit): string;
  /** Throws a `SeoCrawlError` of kind `unsafe_url` for an address that is not a URL at all. */
  normaliseUrl(input: string): string;
  /** Never throws: refuses private, reserved and unresolvable hosts with a reason. */
  assertSafeUrl(input: string): Promise<UrlSafetyResult>;
}

/** Nest injection token for the configured engine. */
export const SEO_ENGINE = Symbol('SEO_ENGINE');
