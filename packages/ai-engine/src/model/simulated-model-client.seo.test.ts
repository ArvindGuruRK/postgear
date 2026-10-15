/**
 * The simulation's answer to the SEO advice schema (Sprint 7): the findings
 * it was shown, read back and ranked, under a deterministic verdict.
 */
import { buildSeoAdvicePrompt, seoAdviceSchema } from '../prompts/seo-advice';
import type { SeoAdviceFinding, SeoAdviceRequest } from '../types';
import {
  composeSeoSummary,
  createSimulatedModelClient,
  readFindings,
} from './simulated-model-client';

const model = createSimulatedModelClient();

function finding(patch: Partial<SeoAdviceFinding>): SeoAdviceFinding {
  return {
    id: 'meta-description',
    severity: 'warning',
    category: 'onPage',
    title: 'Write a meta description',
    issue: 'The page has no meta description.',
    fix: 'Add one of 120–155 characters.',
    impact: 'medium',
    checkId: 'meta-description',
    docsUrl: 'https://developers.google.com/search/docs/appearance/snippet',
    ...patch,
  };
}

const request: SeoAdviceRequest = {
  url: 'https://example.com/pricing',
  overall: 71,
  grade: 'C',
  digest: 'example.com/pricing answered in 380 ms over HTTPS.',
  findings: [
    finding({}),
    finding({
      id: 'h1-count',
      severity: 'info',
      title: 'Use a single H1',
      checkId: 'h1-count',
      impact: 'low',
      docsUrl: null,
    }),
    finding({
      id: 'noindex',
      severity: 'critical',
      category: 'technical',
      title: 'Remove the noindex directive',
      issue: 'The robots meta tag says noindex.',
      checkId: 'noindex',
      impact: 'high',
      docsUrl: null,
    }),
  ],
};

describe('structured: seo advice', () => {
  it('answers the schema with the findings, ranked, and a verdict naming the score', async () => {
    const output = await model.structured({
      schema: seoAdviceSchema,
      ...buildSeoAdvicePrompt(request),
    });

    expect(output.recommendations.map((item) => item.id)).toEqual([
      'noindex',
      'meta-description',
      'h1-count',
    ]);
    expect(output.recommendations[1]).toEqual(request.findings[0]);
    expect(output.summary).toContain('71/100');
    expect(output.summary).toContain('grade C');
    expect(output.summary).toContain('1 critical, 1 warning and 1 informational');
    expect(output.summary).toContain('"Remove the noindex directive"');
    expect(output.summary.length).toBeLessThanOrEqual(600);
  });

  it('is deterministic for the same prompt', async () => {
    const prompt = buildSeoAdvicePrompt(request);
    const a = await model.structured({ schema: seoAdviceSchema, ...prompt });
    const b = await model.structured({ schema: seoAdviceSchema, ...prompt });
    expect(a).toEqual(b);
  });

  it('still returns one recommendation for a page with nothing to fix', async () => {
    const output = await model.structured({
      schema: seoAdviceSchema,
      ...buildSeoAdvicePrompt({ ...request, overall: 98, grade: 'A', findings: [] }),
    });
    expect(output.recommendations).toHaveLength(1);
    expect(output.recommendations[0].severity).toBe('info');
    expect(output.summary).toContain('Every check passed');
  });

  it('honours an already-aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      model.structured({
        schema: seoAdviceSchema,
        ...buildSeoAdvicePrompt(request),
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ kind: 'aborted' });
  });
});

describe('readFindings / composeSeoSummary', () => {
  it('reads nothing from a prompt without a findings block', () => {
    expect(readFindings('Score: 10/100')).toEqual([]);
  });

  it('keeps the summary inside the schema bound for a long URL', () => {
    const summary = composeSeoSummary(`https://example.com/${'a'.repeat(600)}`, '12/100', 'F', [
      finding({ severity: 'critical', issue: 'x'.repeat(500) }),
    ]);
    expect(summary.length).toBeLessThanOrEqual(600);
    expect(summary).toContain('12/100');
  });
});
