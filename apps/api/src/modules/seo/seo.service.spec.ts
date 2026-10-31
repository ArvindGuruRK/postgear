/**
 * The SEO service against a fake engine, a fake ledger and a fake
 * repository: the pre-stream refusals (400, 422, 429, 402) and their order
 * relative to the charge, the stage events and row writes of a full run,
 * the fallbacks (no advisor, a failing advisor, a failing authority
 * provider), and the refund on every failure path: crawl error, abort.
 */
import {
  BadRequestException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { SeoAdvisor } from '@postgear/ai-engine';
import { SEOAuditStatus } from '@postgear/db';
import type { AuthorityProvider, SeoCrawler, UrlSafetyResult } from '@postgear/seo-engine';
import { securityLogger } from '../../common/logging/security-logger';
import type { StreamSink } from '../ai/ai.service';
import type { AiCredits } from '../ai/credits/credits.policy';
import {
  type CreditContext,
  type CreditsService,
  PaymentRequiredException,
} from '../ai/credits/credits.service';
import type { AiEngine } from '../ai/engine/engine.types';
import type { SeoConfig } from './seo.config';
import type { SeoEngine } from './seo.engine';
import { auditRow, crawlResult, findings, scoreReport } from './seo.fixtures';
import { SeoGate } from './seo.gate';
import { SEO_MESSAGES } from './seo.messages';
import type { SeoAuditPatch, SeoAuditRow, SeoRepository } from './seo.repository';
import { SeoService, TooManyRequestsException, withDeadline } from './seo.service';
import type { SeoStreamEvent } from './seo.types';

const RESETS_AT = new Date('2026-11-13T00:00:00Z');

function credits(used: number): AiCredits {
  return {
    allowance: 100,
    used,
    remaining: 100 - used,
    resetsAt: RESETS_AT.toISOString(),
    tier: 'STANDARD',
    low: false,
    costs: {
      generate_post: 5,
      generate_image: 10,
      copilot_message: 1,
      seo_advice: 3,
      generate_snippet: 2,
    },
  };
}

const context: CreditContext = {
  workspaceName: 'PostGear Demo Org',
  tier: 'STANDARD',
  allowance: 100,
  cycleStart: new Date('2026-10-13T00:00:00Z'),
  resetsAt: RESETS_AT,
};

const config: SeoConfig = {
  timeoutMs: 30_000,
  maxConcurrent: 2,
  browser: 'auto',
  userAgent: 'PostGearBot/1.0',
  openPageRankKey: null,
  authority: 'simulation',
};

function crawlError(kind: string, retryable: boolean, reason?: string) {
  return Object.assign(new Error('site said something'), {
    name: 'SeoCrawlError',
    kind,
    retryable,
    reason,
  });
}

function recorder(): StreamSink & { events: SeoStreamEvent[]; abort(): void } {
  const controller = new AbortController();
  const events: SeoStreamEvent[] = [];
  return {
    events,
    signal: controller.signal,
    send: (_type, data) => {
      events.push(data as SeoStreamEvent);
    },
    abort: () => controller.abort(),
  };
}

function stagesOf(events: SeoStreamEvent[]): string[] {
  return events.flatMap((event) =>
    event.type === 'stage' ? [`${event.stage}:${event.status}`] : [],
  );
}

/** An in-memory audit table, scoped by organization like the real one. */
function fakeRepository() {
  const rows = new Map<string, SeoAuditRow & { organizationId: string }>();
  let counter = 0;
  const repository = {
    rows,
    create: jest.fn(async (orgId: string, targetUrl: string) => {
      counter += 1;
      const row = {
        ...auditRow({ id: `audit_${counter}`, targetUrl, createdAt: new Date() }),
        organizationId: orgId,
      };
      rows.set(row.id, row);
      return row;
    }),
    patch: jest.fn(async (orgId: string, id: string, patch: SeoAuditPatch) => {
      const row = rows.get(id);
      if (!row || row.organizationId !== orgId) throw new Error('not found');
      const next = { ...row, ...patch } as SeoAuditRow & { organizationId: string };
      rows.set(id, next);
      return next;
    }),
    findById: jest.fn(async (orgId: string, id: string) => {
      const row = rows.get(id);
      return row && row.organizationId === orgId ? row : null;
    }),
    list: jest.fn(async () => [...rows.values()]),
    findPreviousDone: jest.fn(async (): Promise<SeoAuditRow | null> => null),
    delete: jest.fn(async (orgId: string, id: string) => {
      const row = rows.get(id);
      if (!row || row.organizationId !== orgId) return false;
      rows.delete(id);
      return true;
    }),
  };
  return repository;
}

describe('SeoService', () => {
  let crawler: jest.Mocked<SeoCrawler>;
  let authority: jest.Mocked<AuthorityProvider>;
  let engine: SeoEngine;
  let advisor: jest.Mocked<SeoAdvisor>;
  let ai: AiEngine;
  let ledger: jest.Mocked<
    Pick<CreditsService, 'context' | 'summary' | 'summaryFor' | 'charge' | 'tryCharge' | 'refund'>
  >;
  let repository: ReturnType<typeof fakeRepository>;
  let gate: SeoGate;
  let service: SeoService;
  let securityWarn: jest.SpyInstance;

  beforeEach(() => {
    crawler = {
      crawl: jest.fn(async (_url, options) => {
        options?.onStage?.('fetch', 'started');
        options?.onStage?.('fetch', 'done');
        options?.onStage?.('links', 'skipped', 'no internal links');
        return crawlResult();
      }),
      browserAvailable: jest.fn().mockResolvedValue(true),
      close: jest.fn().mockResolvedValue(undefined),
    };
    authority = {
      name: 'simulation',
      estimate: jest.fn().mockResolvedValue({
        source: 'simulation',
        domainAuthority: 42,
        pageRank: 3.1,
      }),
    };
    engine = {
      crawler,
      authority,
      evaluate: jest.fn().mockReturnValue(scoreReport()),
      findings: jest.fn().mockReturnValue(findings()),
      summarise: jest.fn().mockReturnValue('example.com answered in 412 ms.'),
      normaliseUrl: jest.fn((input: string) => {
        if (!/^https?:\/\//.test(input)) throw crawlError('unsafe_url', false, 'invalid');
        return input.replace(/#.*$/, '');
      }),
      assertSafeUrl: jest.fn(
        async (input: string): Promise<UrlSafetyResult> => ({
          ok: true,
          url: new URL(input),
          addresses: ['93.184.216.34'],
        }),
      ),
    };
    advisor = {
      advise: jest.fn().mockResolvedValue({
        summary: 'Fix the description first.',
        recommendations: findings(),
      }),
    };
    ai = {
      mode: 'simulation',
      modelName: 'simulation',
      researchEnabled: true,
      imagesEnabled: true,
      createPipeline: jest.fn(),
      createCopilot: jest.fn(),
      createSeoAdvisor: jest.fn().mockReturnValue(advisor),
      createSnippetWriter: jest.fn().mockReturnValue(null),
      generateImage: jest.fn(),
    };
    ledger = {
      context: jest.fn().mockResolvedValue(context),
      summary: jest.fn().mockResolvedValue(credits(23)),
      summaryFor: jest.fn().mockResolvedValue(credits(26)),
      charge: jest.fn().mockResolvedValue(credits(26)),
      tryCharge: jest.fn(),
      refund: jest.fn().mockResolvedValue(undefined),
    };
    repository = fakeRepository();
    gate = new SeoGate(2);
    securityWarn = jest.spyOn(securityLogger, 'warn').mockImplementation(() => undefined);
    service = new SeoService(
      engine,
      config,
      gate,
      repository as unknown as SeoRepository,
      ledger as unknown as CreditsService,
      ai,
    );
  });

  afterEach(() => {
    securityWarn.mockRestore();
  });

  describe('status', () => {
    it('reports the browser, the AI mode and the advice cost', async () => {
      await expect(service.status()).resolves.toEqual({
        browser: true,
        ai: true,
        authority: 'simulation',
        timeoutMs: 30_000,
        maxConcurrent: 2,
        adviceCost: 3,
      });
      expect(crawler.browserAvailable).toHaveBeenCalledTimes(1);
      await service.status();
      expect(crawler.browserAvailable).toHaveBeenCalledTimes(1);
    });

    it('answers "no browser" when it is off, and a zero cost when AI is off', async () => {
      const off = new SeoService(
        engine,
        { ...config, browser: 'off' },
        gate,
        repository as unknown as SeoRepository,
        ledger as unknown as CreditsService,
        { ...ai, mode: 'unconfigured', modelName: null },
      );
      await expect(off.status()).resolves.toMatchObject({
        browser: false,
        ai: false,
        adviceCost: 0,
      });
      expect(crawler.browserAvailable).not.toHaveBeenCalled();
    });

    it('treats a failing probe as no browser', async () => {
      crawler.browserAvailable.mockRejectedValue(new Error('no chromium'));
      await expect(service.status()).resolves.toMatchObject({ browser: false });
    });
  });

  describe('prepareAnalyze', () => {
    it('answers 400 for an address that is not a URL, before anything else', async () => {
      await expect(
        service.prepareAnalyze('org_1', { url: 'example dot com' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(engine.assertSafeUrl).not.toHaveBeenCalled();
      expect(ledger.charge).not.toHaveBeenCalled();
      expect(gate.running).toBe(0);
    });

    it('answers 422 with the guard’s message for an unsafe URL, logs it, charges nothing', async () => {
      (engine.assertSafeUrl as jest.Mock).mockResolvedValue({
        ok: false,
        reason: 'private_address',
        message: 'The host resolves to a private or reserved address.',
      });

      await expect(
        service.prepareAnalyze('org_1', { url: 'http://169.254.169.254/latest' }),
      ).rejects.toMatchObject({
        constructor: UnprocessableEntityException,
        message: 'The host resolves to a private or reserved address.',
      });
      expect(securityWarn).toHaveBeenCalledWith('seo.unsafe_url', {
        orgId: 'org_1',
        reason: 'private_address',
        host: '169.254.169.254',
      });
      expect(ledger.charge).not.toHaveBeenCalled();
      expect(repository.create).not.toHaveBeenCalled();
      expect(gate.running).toBe(0);
    });

    it('answers 429 when the gate is full, without charging', async () => {
      gate.tryAcquire('org_1');

      await expect(
        service.prepareAnalyze('org_1', { url: 'https://example.com/' }),
      ).rejects.toMatchObject({
        constructor: TooManyRequestsException,
        message: SEO_MESSAGES.BUSY,
      });
      expect(ledger.charge).not.toHaveBeenCalled();
    });

    it('lets the 402 through and frees the slot', async () => {
      ledger.charge.mockRejectedValue(new PaymentRequiredException('spent'));

      await expect(
        service.prepareAnalyze('org_1', { url: 'https://example.com/' }),
      ).rejects.toBeInstanceOf(PaymentRequiredException);
      expect(gate.running).toBe(0);
      expect(repository.create).not.toHaveBeenCalled();
      expect(ledger.refund).not.toHaveBeenCalled();
    });

    it('refunds and frees the slot when the row cannot be created after the charge', async () => {
      repository.create.mockRejectedValue(new Error('db down'));

      await expect(
        service.prepareAnalyze('org_1', { url: 'https://example.com/' }),
      ).rejects.toThrow('db down');
      expect(ledger.refund).toHaveBeenCalledWith('org_1', 'seo_advice', 3);
      expect(gate.running).toBe(0);
    });

    it('charges the advice, creates a PENDING row with the normalised URL and holds the slot', async () => {
      const run = await service.prepareAnalyze('org_1', { url: 'https://example.com/#top' });

      expect(ledger.charge).toHaveBeenCalledWith('org_1', 'seo_advice', undefined, context);
      expect(repository.create).toHaveBeenCalledWith('org_1', 'https://example.com/');
      expect(gate.isBusy('org_1')).toBe(true);
      expect(crawler.crawl).not.toHaveBeenCalled();
      expect(typeof run).toBe('function');
    });

    it('charges nothing when no advisor is configured', async () => {
      (ai.createSeoAdvisor as jest.Mock).mockReturnValue(null);
      await service.prepareAnalyze('org_1', { url: 'https://example.com/' });
      expect(ledger.context).not.toHaveBeenCalled();
      expect(ledger.charge).not.toHaveBeenCalled();
    });
  });

  describe('run', () => {
    it('streams every stage, writes the row at each step and ends with the detail and credits', async () => {
      repository.findPreviousDone.mockResolvedValue(
        auditRow({ id: 'audit_0', overallScore: 64, grade: 'D', status: SEOAuditStatus.DONE }),
      );
      const run = await service.prepareAnalyze('org_1', { url: 'https://example.com/' });
      const stream = recorder();

      await run(stream);

      expect(stagesOf(stream.events)).toEqual([
        'validate:done',
        'crawl:started',
        'crawl:started',
        'crawl:started',
        'crawl:done',
        'score:started',
        'score:done',
        'advise:started',
        'advise:done',
      ]);
      expect(stream.events.map((event) => event.type)).toEqual([
        'audit',
        'stage',
        'stage',
        'stage',
        'stage',
        'crawl',
        'stage',
        'stage',
        'scores',
        'stage',
        'stage',
        'stage',
        'advice',
        'done',
      ]);

      expect(crawler.crawl).toHaveBeenCalledWith(
        'https://example.com/',
        expect.objectContaining({ signal: stream.signal, timeoutMs: 30_000 }),
      );
      expect(authority.estimate).toHaveBeenCalledWith('example.com', expect.anything());
      expect(engine.evaluate).toHaveBeenCalledWith(crawlResult(), {
        source: 'simulation',
        domainAuthority: 42,
        pageRank: 3.1,
      });
      expect(advisor.advise).toHaveBeenCalledWith(
        {
          url: 'https://example.com/',
          overall: 71,
          grade: 'C',
          digest: 'example.com answered in 412 ms.',
          findings: findings(),
        },
        { signal: stream.signal },
      );

      const statuses = repository.patch.mock.calls.map(([, , patch]) => patch.status);
      expect(statuses).toEqual([
        SEOAuditStatus.CRAWLING,
        SEOAuditStatus.SCORING,
        SEOAuditStatus.ADVISING,
        SEOAuditStatus.DONE,
      ]);
      expect(repository.patch.mock.calls[2][2]).toMatchObject({
        overallScore: 71,
        grade: 'C',
        onPageScore: 68,
        technicalScore: 82,
        contentScore: 60,
        backlinkScore: 70,
        auditData: { crawl: crawlResult(), report: scoreReport() },
      });
      expect(repository.patch.mock.calls[3][2]).toMatchObject({
        aiAdvice: { source: 'ai', model: 'simulation', summary: 'Fix the description first.' },
        completedAt: expect.any(Date),
        durationMs: expect.any(Number),
      });

      const done = stream.events[stream.events.length - 1];
      expect(done.type).toBe('done');
      if (done.type === 'done') {
        expect(done.audit).toMatchObject({
          status: 'done',
          grade: 'C',
          scores: { onPage: 68, technical: 82, content: 60, backlink: 70 },
          crawlMode: 'html',
          finalUrl: 'https://example.com/',
          previous: { id: 'audit_0', overallScore: 64, grade: 'D' },
        });
        expect(done.audit.advice?.source).toBe('ai');
        expect(done.credits).toEqual(credits(26));
      }
      expect(ledger.refund).not.toHaveBeenCalled();
      expect(gate.running).toBe(0);
    });

    it('relays the crawler’s sub-stages as crawl details', async () => {
      const run = await service.prepareAnalyze('org_1', { url: 'https://example.com/' });
      const stream = recorder();
      await run(stream);
      const details = stream.events.flatMap((event) =>
        event.type === 'stage' && event.stage === 'crawl' && event.detail ? [event.detail] : [],
      );
      expect(details).toEqual([
        'Fetching the page…',
        'Checking links: skipped',
        'Fetched as HTML in 412 ms',
      ]);
    });

    it('falls back to the heuristic score when the authority provider fails or hangs', async () => {
      authority.estimate.mockRejectedValue(new Error('quota exceeded, key opr-secret'));
      const run = await service.prepareAnalyze('org_1', { url: 'https://example.com/' });
      await run(recorder());
      expect(engine.evaluate).toHaveBeenCalledWith(crawlResult(), null);

      jest.useFakeTimers();
      try {
        authority.estimate.mockImplementation(
          (_host, options) =>
            new Promise((_resolve, reject) => {
              options?.signal?.addEventListener('abort', () =>
                reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
              );
            }),
        );
        const second = await service.prepareAnalyze('org_1', { url: 'https://example.com/' });
        const pending = second(recorder());
        await jest.advanceTimersByTimeAsync(5_000);
        await pending;
        expect(engine.evaluate).toHaveBeenLastCalledWith(crawlResult(), null);
      } finally {
        jest.useRealTimers();
      }
    });

    it('skips advice when no advisor is configured and uses the rules, charging nothing', async () => {
      (ai.createSeoAdvisor as jest.Mock).mockReturnValue(null);
      const run = await service.prepareAnalyze('org_1', { url: 'https://example.com/' });
      const stream = recorder();
      await run(stream);

      expect(stagesOf(stream.events)).toContain('advise:skipped');
      const skipped = stream.events.find(
        (event) => event.type === 'stage' && event.stage === 'advise',
      );
      expect(skipped).toMatchObject({ detail: SEO_MESSAGES.ADVICE_NOT_CONFIGURED });
      const advice = stream.events.find((event) => event.type === 'advice');
      expect(advice).toMatchObject({
        advice: { source: 'rules', model: null, recommendations: findings() },
      });
      const done = stream.events[stream.events.length - 1];
      expect(done.type === 'done' && done.credits).toBeNull();
      expect(ledger.charge).not.toHaveBeenCalled();
      expect(ledger.refund).not.toHaveBeenCalled();
    });

    it('survives a model failure: refunds, marks the stage failed, falls back to the rules', async () => {
      advisor.advise.mockRejectedValue(
        Object.assign(new Error('openai said sk-abc'), {
          name: 'AiProviderError',
          kind: 'unavailable',
          retryable: true,
        }),
      );
      const run = await service.prepareAnalyze('org_1', { url: 'https://example.com/' });
      const stream = recorder();
      await run(stream);

      expect(stagesOf(stream.events)).toContain('advise:failed');
      const failed = stream.events.find(
        (event) => event.type === 'stage' && event.stage === 'advise' && event.status === 'failed',
      );
      expect(failed).toMatchObject({ detail: SEO_MESSAGES.ADVICE_FAILED });
      expect(JSON.stringify(stream.events)).not.toContain('sk-abc');
      expect(ledger.refund).toHaveBeenCalledWith('org_1', 'seo_advice', 3);
      const done = stream.events[stream.events.length - 1];
      expect(done.type).toBe('done');
      if (done.type === 'done') {
        expect(done.audit.status).toBe('done');
        expect(done.audit.advice?.source).toBe('rules');
      }
      expect(repository.rows.get('audit_1')?.status).toBe(SEOAuditStatus.DONE);
    });

    it('fails the audit on a crawl error: refunds, writes FAILED with a safe reason, sends error', async () => {
      crawler.crawl.mockRejectedValue(crawlError('timeout', true));
      const run = await service.prepareAnalyze('org_1', { url: 'https://example.com/' });
      const stream = recorder();
      await run(stream);

      expect(ledger.refund).toHaveBeenCalledWith('org_1', 'seo_advice', 3);
      expect(advisor.advise).not.toHaveBeenCalled();
      const row = repository.rows.get('audit_1');
      expect(row).toMatchObject({
        status: SEOAuditStatus.FAILED,
        failureReason: SEO_MESSAGES.TIMEOUT,
        durationMs: expect.any(Number),
      });
      const last = stream.events[stream.events.length - 1];
      expect(last).toMatchObject({
        type: 'error',
        kind: 'timeout',
        message: SEO_MESSAGES.TIMEOUT,
        retryable: true,
        audit: { id: 'audit_1', status: 'failed', failureReason: SEO_MESSAGES.TIMEOUT },
        credits: credits(26),
      });
      expect(JSON.stringify(stream.events)).not.toContain('site said something');
      expect(securityWarn).toHaveBeenCalledWith('seo.audit_failed', {
        orgId: 'org_1',
        auditId: 'audit_1',
        kind: 'timeout',
        reason: 'SeoCrawlError: site said something',
      });
      expect(gate.running).toBe(0);
    });

    it('treats a disconnect as a stop: refunds and marks the row FAILED without a security warning', async () => {
      const stream = recorder();
      crawler.crawl.mockImplementation(
        (_url, options) =>
          new Promise((_resolve, reject) => {
            const stop = () => reject(crawlError('aborted', false));
            if (options?.signal?.aborted) stop();
            options?.signal?.addEventListener('abort', stop);
          }),
      );
      const run = await service.prepareAnalyze('org_1', { url: 'https://example.com/' });
      const pending = run(stream);
      // The tab closes while the row is being marked CRAWLING, before the crawl starts.
      stream.abort();
      await pending;

      expect(ledger.refund).toHaveBeenCalledWith('org_1', 'seo_advice', 3);
      expect(repository.rows.get('audit_1')).toMatchObject({
        status: SEOAuditStatus.FAILED,
        failureReason: SEO_MESSAGES.STOPPED_BEFORE_FINISH,
      });
      expect(securityWarn).not.toHaveBeenCalledWith('seo.audit_failed', expect.anything());
      expect(stream.events[stream.events.length - 1]).toMatchObject({
        type: 'error',
        kind: 'aborted',
      });
      expect(gate.running).toBe(0);
    });

    it('does not fall back when the advisor was aborted', async () => {
      const stream = recorder();
      advisor.advise.mockImplementation(async () => {
        stream.abort();
        throw Object.assign(new Error('aborted'), {
          name: 'AiProviderError',
          kind: 'aborted',
          retryable: false,
        });
      });
      const run = await service.prepareAnalyze('org_1', { url: 'https://example.com/' });
      await run(stream);

      expect(stagesOf(stream.events)).not.toContain('advise:failed');
      expect(repository.rows.get('audit_1')?.status).toBe(SEOAuditStatus.FAILED);
      expect(ledger.refund).toHaveBeenCalledTimes(1);
    });

    it('still ends the stream when a row write fails mid-run', async () => {
      repository.patch.mockRejectedValueOnce(new Error('db down'));
      const run = await service.prepareAnalyze('org_1', { url: 'https://example.com/' });
      const stream = recorder();
      await run(stream);

      expect(stream.events[stream.events.length - 1]).toMatchObject({
        type: 'error',
        kind: 'unexpected',
        message: SEO_MESSAGES.UNEXPECTED,
      });
      expect(ledger.refund).toHaveBeenCalledTimes(1);
      expect(gate.running).toBe(0);
    });
  });

  describe('history', () => {
    it('lists with the URL filter normalised, and matches nothing for a bad filter', async () => {
      await service.list('org_1', { url: 'https://example.com/#x', limit: 5 });
      expect(repository.list).toHaveBeenCalledWith('org_1', {
        url: 'https://example.com/',
        limit: 5,
      });
      await expect(service.list('org_1', { url: 'nope', limit: 5 })).resolves.toEqual({
        audits: [],
      });
    });

    it('answers 404 for an audit from another workspace, on get and delete', async () => {
      await service.prepareAnalyze('org_1', { url: 'https://example.com/' });
      await expect(service.get('org_2', 'audit_1')).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.remove('org_2', 'audit_1')).rejects.toBeInstanceOf(NotFoundException);
      expect(repository.rows.has('audit_1')).toBe(true);

      const { audit } = await service.get('org_1', 'audit_1');
      expect(audit).toMatchObject({
        id: 'audit_1',
        status: 'pending',
        crawl: null,
        previous: null,
      });
      expect(repository.findPreviousDone).toHaveBeenCalledWith(
        'org_1',
        'https://example.com/',
        expect.any(Date),
        'audit_1',
      );
      await service.remove('org_1', 'audit_1');
      expect(repository.rows.has('audit_1')).toBe(false);
    });
  });
});

describe('withDeadline', () => {
  it('cancels a slow call at the deadline and reports a timeout', async () => {
    jest.useFakeTimers();
    try {
      let aborted = false;
      const pending = withDeadline(
        (signal) =>
          new Promise<never>((_resolve, reject) => {
            signal.addEventListener('abort', () => {
              aborted = true;
              reject(signal.reason);
            });
          }),
        1_000,
      );
      const outcome = pending.catch((error: unknown) => error);
      await jest.advanceTimersByTimeAsync(1_000);
      await expect(outcome).resolves.toMatchObject({ name: 'TimeoutError' });
      expect(aborted).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it('propagates the parent abort as an AbortError, and a value when in time', async () => {
    const parent = new AbortController();
    const pending = withDeadline(
      (signal) =>
        new Promise<never>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason));
        }),
      10_000,
      parent.signal,
    );
    parent.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await expect(withDeadline(async () => 'ok', 1_000)).resolves.toBe('ok');
    const already = new AbortController();
    already.abort();
    await expect(withDeadline(async () => 'late', 1_000, already.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
});
