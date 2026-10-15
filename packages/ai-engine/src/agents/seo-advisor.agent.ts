/**
 * The SEO advisor: one structured model call that turns an audit into a
 * prioritised plan.
 *
 * Deliberately not a graph. The content pipeline earns its stages because
 * each one feeds the next; here there is one question ("what should this
 * site fix, in what order?") with one answer, and the model client already
 * does the single repair re-ask when the answer does not fit the schema.
 * What this agent adds is the part a schema cannot express: the answer is
 * post-processed so the API and the UI can rely on its shape — ids are
 * unique, the order is critical → warning → info, there are at most twelve,
 * strings are trimmed, and a `checkId` is either one of the findings' or
 * null. A model that cites a check it was never shown is making something
 * up, and nulling it is cheaper than trusting it.
 *
 * Failure policy: every provider error reaches the caller as an
 * {@link AiProviderError}; an abort surfaces as kind `aborted`. The API
 * decides what a failure means (it falls back to the rule-based findings and
 * refunds the credits), not this agent.
 */
import { normaliseRunError, throwIfAborted } from '../model/resilience';
import { buildSeoAdvicePrompt, seoAdviceSchema } from '../prompts/seo-advice';
import type {
  ModelClient,
  SeoAdviceOutput,
  SeoAdviceRecommendation,
  SeoAdviceRequest,
  SeoAdviceSeverity,
  SeoAdvisor,
} from '../types';

export interface SeoAdvisorLogger {
  warn(message: string, meta?: Record<string, unknown>): void;
}

export interface SeoAdvisorDeps {
  model: ModelClient;
  /** Optional structured logger; defaults to silence. */
  logger?: SeoAdvisorLogger;
}

/** What the UI shows at most. More than this is a list nobody works through. */
export const SEO_ADVICE_MAX_RETURNED = 12;

const SEVERITY_RANK: Record<SeoAdviceSeverity, number> = { critical: 0, warning: 1, info: 2 };

const SILENT: SeoAdvisorLogger = { warn: () => undefined };

/**
 * The post-processing, as a pure function with its own tests: de-duplicate
 * by id (first wins), null any `checkId` the request did not contain, trim
 * every string, sort by severity (stable, so the model's own order survives
 * within a band) and cap the list.
 */
export function normaliseAdvice(
  output: SeoAdviceOutput,
  request: Pick<SeoAdviceRequest, 'findings'>,
  logger: SeoAdvisorLogger = SILENT,
): SeoAdviceOutput {
  const knownChecks = new Set<string>();
  for (const finding of request.findings) {
    if (finding.checkId !== null) knownChecks.add(finding.checkId);
  }

  const seen = new Set<string>();
  const recommendations: SeoAdviceRecommendation[] = [];
  let unknownChecks = 0;

  for (const raw of output.recommendations) {
    const id = raw.id.trim();
    if (id.length === 0 || seen.has(id)) continue;
    seen.add(id);

    const checkId = raw.checkId === null ? null : raw.checkId.trim();
    const known = checkId !== null && knownChecks.has(checkId);
    if (checkId !== null && !known) unknownChecks += 1;

    recommendations.push({
      id,
      severity: raw.severity,
      category: raw.category,
      title: raw.title.trim(),
      issue: raw.issue.trim(),
      fix: raw.fix.trim(),
      impact: raw.impact,
      checkId: known ? checkId : null,
      docsUrl: raw.docsUrl === null ? null : raw.docsUrl.trim(),
    });
  }

  if (unknownChecks > 0) {
    logger.warn('seo advice cited checks the audit does not contain; cleared them', {
      unknownChecks,
    });
  }

  // `Array.prototype.sort` is stable, so equal severities keep the model's order.
  recommendations.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);

  return {
    summary: output.summary.trim(),
    recommendations: recommendations.slice(0, SEO_ADVICE_MAX_RETURNED),
  };
}

export function createSeoAdvisor(deps: SeoAdvisorDeps): SeoAdvisor {
  const logger = deps.logger ?? SILENT;

  return {
    async advise(request, options = {}): Promise<SeoAdviceOutput> {
      throwIfAborted(options.signal);
      const prompt = buildSeoAdvicePrompt(request);

      let output: SeoAdviceOutput;
      try {
        output = await deps.model.structured({
          schema: seoAdviceSchema,
          ...prompt,
          signal: options.signal,
        });
      } catch (error) {
        throw normaliseRunError(error, options.signal);
      }

      return normaliseAdvice(output, request, logger);
    },
  };
}
