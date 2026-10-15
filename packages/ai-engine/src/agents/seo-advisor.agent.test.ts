import type { z } from 'zod';
import { createSimulatedModelClient } from '../model/simulated-model-client';
import {
  AiProviderError,
  type ModelClient,
  type SeoAdviceFinding,
  type SeoAdviceOutput,
  type SeoAdviceRequest,
} from '../types';
import { createSeoAdvisor, normaliseAdvice, SEO_ADVICE_MAX_RETURNED } from './seo-advisor.agent';

function finding(patch: Partial<SeoAdviceFinding>): SeoAdviceFinding {
  return {
    id: 'title-length',
    severity: 'warning',
    category: 'onPage',
    title: 'Shorten the title',
    issue: 'The title is 84 characters.',
    fix: 'Cut it to 60.',
    impact: 'medium',
    checkId: 'title-length',
    docsUrl: null,
    ...patch,
  };
}

const request: SeoAdviceRequest = {
  url: 'https://example.com/',
  overall: 58,
  grade: 'F',
  digest: 'The page answered over HTTP in 2.1 s.',
  findings: [
    finding({}),
    finding({
      id: 'ssl',
      severity: 'critical',
      category: 'technical',
      title: 'Serve over HTTPS',
      checkId: 'ssl',
      impact: 'high',
    }),
    finding({
      id: 'word-count',
      severity: 'info',
      category: 'content',
      title: 'Add more copy',
      checkId: 'word-count',
      impact: 'low',
    }),
  ],
};

/** A model that answers with whatever the test hands it, or throws it. */
function fakeModel(answer: unknown | (() => never)): ModelClient & { structured: jest.Mock } {
  const structured = jest.fn(
    async (params: { schema: z.ZodTypeAny; signal?: AbortSignal }): Promise<unknown> => {
      if (params.signal?.aborted) {
        throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      }
      if (typeof answer === 'function') (answer as () => never)();
      const parsed = params.schema.safeParse(answer);
      if (!parsed.success) throw new AiProviderError('bad_output', 'bad', false);
      return parsed.data;
    },
  );
  return {
    name: 'fake',
    structured,
    chat: async function* () {
      yield { type: 'text' as const, text: '' };
    },
  } as unknown as ModelClient & { structured: jest.Mock };
}

describe('createSeoAdvisor', () => {
  it('asks once with the prompt and returns the normalised answer', async () => {
    const model = fakeModel({
      summary: '  Fix HTTPS first.  ',
      recommendations: [
        {
          id: 'word-count',
          severity: 'info',
          category: 'content',
          title: ' Add more copy ',
          issue: 'Thin.',
          fix: 'Write 300 more words.',
          impact: 'low',
          checkId: 'word-count',
          docsUrl: null,
        },
        {
          id: 'ssl',
          severity: 'critical',
          category: 'technical',
          title: 'Serve over HTTPS',
          issue: 'HTTP.',
          fix: 'Get a certificate.',
          impact: 'high',
          checkId: 'ssl',
          docsUrl: 'https://developers.google.com/search/docs/crawling-indexing/https',
        },
      ],
    });
    const advisor = createSeoAdvisor({ model });

    const output = await advisor.advise(request);

    expect(model.structured).toHaveBeenCalledTimes(1);
    const call = model.structured.mock.calls[0][0];
    expect(call.user).toContain('URL: https://example.com/');
    expect(call.user).toContain('<<<Findings');
    expect(output.summary).toBe('Fix HTTPS first.');
    expect(output.recommendations.map((item) => item.id)).toEqual(['ssl', 'word-count']);
    expect(output.recommendations[1].title).toBe('Add more copy');
  });

  it('surfaces the client’s provider error unchanged', async () => {
    const model = fakeModel(() => {
      throw new AiProviderError('rate_limited', 'slow down', true);
    });
    const advisor = createSeoAdvisor({ model });

    await expect(advisor.advise(request)).rejects.toMatchObject({
      name: 'AiProviderError',
      kind: 'rate_limited',
      retryable: true,
    });
  });

  it('reports output the schema refuses as bad_output', async () => {
    const model = fakeModel({ summary: 'ok', recommendations: [] });
    const advisor = createSeoAdvisor({ model });

    await expect(advisor.advise(request)).rejects.toMatchObject({ kind: 'bad_output' });
  });

  it('surfaces an abort as kind aborted, before and during the call', async () => {
    const model = fakeModel({ summary: 'ok', recommendations: [] });
    const advisor = createSeoAdvisor({ model });
    const controller = new AbortController();
    controller.abort();

    await expect(advisor.advise(request, { signal: controller.signal })).rejects.toMatchObject({
      kind: 'aborted',
    });
    expect(model.structured).not.toHaveBeenCalled();

    const during = new AbortController();
    const slow: ModelClient = {
      name: 'slow',
      structured: async (params) =>
        new Promise((_resolve, reject) => {
          params.signal?.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
          );
        }),
      chat: async function* () {
        yield { type: 'text' as const, text: '' };
      },
    };
    const pending = createSeoAdvisor({ model: slow }).advise(request, { signal: during.signal });
    during.abort();
    await expect(pending).rejects.toMatchObject({ kind: 'aborted' });
  });

  it('works end to end against the simulated model', async () => {
    const advisor = createSeoAdvisor({ model: createSimulatedModelClient() });
    const output = await advisor.advise(request);
    expect(output.recommendations.map((item) => item.severity)).toEqual([
      'critical',
      'warning',
      'info',
    ]);
    expect(output.summary).toContain('58/100');
  });
});

describe('normaliseAdvice', () => {
  const item = (patch: Partial<SeoAdviceOutput['recommendations'][number]>) => ({
    id: 'a',
    severity: 'info' as const,
    category: 'content' as const,
    title: 'T',
    issue: 'I',
    fix: 'F',
    impact: 'low' as const,
    checkId: null,
    docsUrl: null,
    ...patch,
  });

  it('de-duplicates by id, keeping the first', () => {
    const output = normaliseAdvice(
      {
        summary: 's',
        recommendations: [item({ id: 'a', title: 'first' }), item({ id: 'a', title: 'second' })],
      },
      { findings: [] },
    );
    expect(output.recommendations).toHaveLength(1);
    expect(output.recommendations[0].title).toBe('first');
  });

  it('sorts critical → warning → info and keeps the model’s order within a band', () => {
    const output = normaliseAdvice(
      {
        summary: 's',
        recommendations: [
          item({ id: 'i1', severity: 'info' }),
          item({ id: 'w1', severity: 'warning' }),
          item({ id: 'c1', severity: 'critical' }),
          item({ id: 'w2', severity: 'warning' }),
          item({ id: 'c2', severity: 'critical' }),
        ],
      },
      { findings: [] },
    );
    expect(output.recommendations.map((r) => r.id)).toEqual(['c1', 'c2', 'w1', 'w2', 'i1']);
  });

  it('caps the list', () => {
    const output = normaliseAdvice(
      {
        summary: 's',
        recommendations: Array.from({ length: 15 }, (_, i) => item({ id: `r${i}` })),
      },
      { findings: [] },
    );
    expect(output.recommendations).toHaveLength(SEO_ADVICE_MAX_RETURNED);
  });

  it('keeps known checkIds and clears unknown ones, with a warning', () => {
    const logger = { warn: jest.fn() };
    const output = normaliseAdvice(
      {
        summary: 's',
        recommendations: [
          item({ id: 'a', checkId: 'ssl' }),
          item({ id: 'b', checkId: 'made-up' }),
          item({ id: 'c', checkId: ' ssl ' }),
        ],
      },
      { findings: [finding({ checkId: 'ssl' })] },
      logger,
    );
    expect(output.recommendations.map((r) => r.checkId)).toEqual(['ssl', null, 'ssl']);
    expect(logger.warn).toHaveBeenCalledWith(expect.any(String), { unknownChecks: 1 });
  });

  it('trims every string and drops blank ids', () => {
    const output = normaliseAdvice(
      {
        summary: '  verdict  ',
        recommendations: [
          item({ id: '  ', title: 'dropped' }),
          item({ id: ' x ', title: ' T ', issue: ' I ', fix: ' F ', docsUrl: ' https://d ' }),
        ],
      },
      { findings: [] },
    );
    expect(output.summary).toBe('verdict');
    expect(output.recommendations).toEqual([
      item({ id: 'x', title: 'T', issue: 'I', fix: 'F', docsUrl: 'https://d' }),
    ]);
  });
});
