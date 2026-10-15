/**
 * The SEO routes' logic: analyse a URL as a stream, report status, and
 * read, list and delete the history.
 *
 * ## Two phases, because a stream cannot change its status code
 *
 * `prepareAnalyze` does everything that can refuse — is the address a URL
 * (400), is it safe to fetch (422), is there a free slot (429), can the
 * cycle afford the advice (402) — and *charges*, then creates the row. It
 * throws ordinary HTTP exceptions, because nothing has been written yet. It
 * returns a `PreparedRun`; the controller opens the stream and runs it. From
 * that point nothing throws: every outcome, including a dead site, a model
 * failure or a disconnect, is an event, and the row says what happened.
 * The same shape as `ai.service.ts`, for the same reason.
 *
 * ## What is charged, and when it comes back
 *
 * Only the AI advice costs credits, and only when an advisor is configured.
 * The charge is made before the crawl, so a workspace with one credit left
 * cannot start ten analyses at once; it is refunded whenever the advice did
 * not happen — the crawl failed, the model failed, the person left. A
 * failed model call does *not* fail the audit: the evaluators' findings are
 * shown instead, the stage says why, and the credits come back.
 *
 * ## Every external call has a deadline
 *
 * The crawl has the configured ceiling and the stream's abort signal; the
 * authority lookup has five seconds, after which the backlink score is the
 * heuristic one and the log says so; the model call has the client's own
 * timeout and the stream's signal. A hung site cannot hold a slot forever,
 * and a closed tab stops all three.
 */
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { SeoAdvisor } from '@postgear/ai-engine';
import { SEOAuditStatus } from '@postgear/db';
import type { AuthorityEstimate, SeoAdvice, SeoAudit } from '@postgear/seo-engine';
import { securityLogger } from '../../common/logging/security-logger';
import { isAbortError } from '../ai/ai.errors';
import type { PreparedRun, StreamSink } from '../ai/ai.service';
import { AI_CREDIT_COSTS, type AiCredits } from '../ai/credits/credits.policy';
import { type CreditContext, CreditsService } from '../ai/credits/credits.service';
import { AI_ENGINE, type AiEngine } from '../ai/engine/engine.types';
import type { AnalyzeInput, ListAuditsQuery } from './dto/seo.schema';
import { AUTHORITY_TIMEOUT_MS, SEO_CONFIG, type SeoConfig } from './seo.config';
import { SEO_ENGINE, type SeoEngine } from './seo.engine';
import { describeSeoFailure, isCrawlError } from './seo.errors';
import { type Release, SeoGate } from './seo.gate';
import {
  crawlStageDetail,
  hostOf,
  rulesAdvice,
  toCategoryScores,
  toCrawlSummary,
  toDetail,
  toSummary,
} from './seo.mappers';
import { SEO_MESSAGES } from './seo.messages';
import { type SeoAuditRow, SeoRepository } from './seo.repository';
import type {
  SeoAuditDetail,
  SeoAuditSummary,
  SeoStage,
  SeoStageStatus,
  SeoStatus,
  SeoStreamEvent,
} from './seo.types';

/** How long `GET /seo/status` waits for the browser probe before answering "no". */
export const BROWSER_PROBE_TIMEOUT_MS = 10_000;

export class TooManyRequestsException extends HttpException {
  constructor(message: string) {
    super(message, HttpStatus.TOO_MANY_REQUESTS);
  }
}

/** Everything a run needs, resolved and charged by `prepareAnalyze`. */
interface AnalyzeRun {
  orgId: string;
  url: string;
  row: SeoAuditRow;
  advisor: SeoAdvisor | null;
  /** Set when the advice was charged. */
  context: CreditContext | null;
  charged: AiCredits | null;
  release: Release;
}

@Injectable()
export class SeoService {
  private readonly logger = new Logger(SeoService.name);
  private browserProbe: Promise<boolean> | null = null;

  constructor(
    @Inject(SEO_ENGINE) private readonly engine: SeoEngine,
    @Inject(SEO_CONFIG) private readonly config: SeoConfig,
    private readonly gate: SeoGate,
    private readonly repository: SeoRepository,
    private readonly credits: CreditsService,
    @Inject(AI_ENGINE) private readonly ai: AiEngine,
  ) {}

  /** `GET /seo/status`. */
  async status(): Promise<SeoStatus> {
    const ai = this.aiEnabled();

    return {
      browser: await this.browserAvailable(),
      ai,
      authority: this.config.authority,
      timeoutMs: this.config.timeoutMs,
      maxConcurrent: this.config.maxConcurrent,
      adviceCost: ai ? AI_CREDIT_COSTS.seo_advice : 0,
    };
  }

  /** `GET /seo/audits`. An unparseable `url` filter matches nothing rather than failing. */
  async list(orgId: string, query: ListAuditsQuery): Promise<{ audits: SeoAuditSummary[] }> {
    let url: string | undefined;

    if (query.url !== undefined) {
      try {
        url = this.engine.normaliseUrl(query.url);
      } catch {
        return { audits: [] };
      }
    }

    const rows = await this.repository.list(orgId, { url, limit: query.limit });
    return { audits: rows.map(toSummary) };
  }

  /** `GET /seo/audits/:id`. Another workspace's audit is a 404, not a 403: it does not exist here. */
  async get(orgId: string, id: string): Promise<{ audit: SeoAuditDetail }> {
    const row = await this.repository.findById(orgId, id);

    if (!row) {
      throw new NotFoundException(SEO_MESSAGES.NOT_FOUND);
    }

    const previous = await this.repository.findPreviousDone(
      orgId,
      row.targetUrl,
      row.createdAt,
      row.id,
    );

    return { audit: toDetail(row, previous) };
  }

  /** `DELETE /seo/audits/:id`. */
  async remove(orgId: string, id: string): Promise<void> {
    const deleted = await this.repository.delete(orgId, id);

    if (!deleted) {
      throw new NotFoundException(SEO_MESSAGES.NOT_FOUND);
    }
  }

  /**
   * `POST /seo/audits`, phase one: the address, the guard, the slot, the
   * charge, the row — in the order a person would want to hear about them,
   * and with the charge last so a refused request never costs anything.
   */
  async prepareAnalyze(orgId: string, input: AnalyzeInput): Promise<PreparedRun> {
    const url = this.normalise(orgId, input.url);

    const safety = await this.engine.assertSafeUrl(url);
    if (!safety.ok) {
      if (safety.reason === 'invalid' || safety.reason === 'scheme') {
        throw new BadRequestException(SEO_MESSAGES.INVALID_URL);
      }
      securityLogger.warn('seo.unsafe_url', { orgId, reason: safety.reason, host: hostOf(url) });
      throw new UnprocessableEntityException(safety.message);
    }

    const release = this.gate.tryAcquire(orgId);
    if (!release) {
      throw new TooManyRequestsException(SEO_MESSAGES.BUSY);
    }

    const advisor = this.ai.createSeoAdvisor({ orgId });
    let context: CreditContext | null = null;
    let charged: AiCredits | null = null;

    try {
      if (advisor) {
        context = await this.credits.context(orgId);
        charged = await this.credits.charge(orgId, 'seo_advice', undefined, context);
      }

      const row = await this.repository.create(orgId, url);
      const run: AnalyzeRun = { orgId, url, row, advisor, context, charged, release };

      return (stream) => this.runAnalyze(run, stream);
    } catch (error) {
      release();
      if (charged) {
        await this.refundAdvice(orgId);
      }
      throw error;
    }
  }

  private async runAnalyze(run: AnalyzeRun, stream: StreamSink): Promise<void> {
    const { orgId, url, advisor } = run;
    const startedAt = Date.now();
    let row = run.row;
    let refunded = run.charged === null;
    const refund = async (): Promise<void> => {
      if (refunded) {
        return;
      }
      refunded = true;
      await this.refundAdvice(orgId);
    };

    const send = (event: SeoStreamEvent): void => stream.send(event.type, event);
    const stage = (name: SeoStage, status: SeoStageStatus, detail?: string): void =>
      send(
        detail === undefined
          ? { type: 'stage', stage: name, status }
          : { type: 'stage', stage: name, status, detail },
      );

    try {
      send({ type: 'audit', audit: toSummary(row) });
      stage('validate', 'done', hostOf(url));

      // Crawl.
      stage('crawl', 'started');
      row = await this.repository.patch(orgId, row.id, { status: SEOAuditStatus.CRAWLING });
      const crawl = await this.engine.crawler.crawl(url, {
        signal: stream.signal,
        timeoutMs: this.config.timeoutMs,
        onStage: (name, status) => {
          const detail = crawlStageDetail(name, status);
          if (detail !== null) {
            stage('crawl', 'started', detail);
          }
        },
      });
      send({ type: 'crawl', crawl: toCrawlSummary(crawl, null) });
      row = await this.repository.patch(orgId, row.id, {
        status: SEOAuditStatus.SCORING,
        finalUrl: crawl.finalUrl,
        crawlMode: crawl.mode,
      });
      stage(
        'crawl',
        'done',
        `${crawl.mode === 'browser' ? 'Rendered in a browser' : 'Fetched as HTML'} in ${crawl.responseTimeMs} ms`,
      );

      // Score.
      stage('score', 'started');
      const authority = await this.estimateAuthority(hostOf(crawl.finalUrl), stream.signal);
      const report = this.engine.evaluate(crawl, authority);
      const audit: SeoAudit = { crawl, report, authority };
      send({
        type: 'scores',
        overallScore: report.overall,
        grade: report.grade,
        scores: report.scores,
        categories: toCategoryScores(report),
      });
      row = await this.repository.patch(orgId, row.id, {
        status: SEOAuditStatus.ADVISING,
        overallScore: report.overall,
        grade: report.grade,
        onPageScore: report.scores.onPage,
        technicalScore: report.scores.technical,
        contentScore: report.scores.content,
        backlinkScore: report.scores.backlink,
        auditData: audit,
      });
      stage('score', 'done', `${report.overall}/100, grade ${report.grade}`);

      // Advise.
      const advice = await this.advise({
        url,
        audit,
        advisor,
        signal: stream.signal,
        stage,
        refund,
      });
      send({ type: 'advice', advice });

      // Done.
      row = await this.repository.patch(orgId, row.id, {
        status: SEOAuditStatus.DONE,
        aiAdvice: advice,
        completedAt: new Date(),
        durationMs: Date.now() - startedAt,
      });
      const previous = await this.repository.findPreviousDone(orgId, url, row.createdAt, row.id);
      send({
        type: 'done',
        audit: toDetail(row, previous),
        credits: await this.freshCredits(run),
      });
    } catch (error) {
      await refund();

      const failure = describeSeoFailure(error);
      const aborted = failure.kind === 'aborted' || stream.signal.aborted;
      row = await this.markFailed(orgId, row, {
        failureReason: aborted ? SEO_MESSAGES.STOPPED_BEFORE_FINISH : failure.message,
        durationMs: Date.now() - startedAt,
      });
      this.logFailure(orgId, row.id, aborted ? 'aborted' : failure.kind, error);

      send({
        type: 'error',
        ...(aborted
          ? { kind: 'aborted', message: SEO_MESSAGES.ABORTED, retryable: false }
          : failure),
        audit: toSummary(row),
        credits: await this.freshCredits(run),
      });
    } finally {
      run.release();
    }
  }

  /**
   * The advice stage. A model failure is survived: the stage says so, the
   * credits come back and the rule-based findings stand in. An abort is not
   * survived — it is the person leaving, and the run ends as a whole.
   */
  private async advise(params: {
    url: string;
    audit: SeoAudit;
    advisor: SeoAdvisor | null;
    signal: AbortSignal;
    stage: (name: SeoStage, status: SeoStageStatus, detail?: string) => void;
    refund: () => Promise<void>;
  }): Promise<SeoAdvice> {
    const { url, audit, advisor, signal, stage } = params;
    const { report } = audit;
    const findings = this.engine.findings(report);

    if (!advisor) {
      stage('advise', 'skipped', SEO_MESSAGES.ADVICE_NOT_CONFIGURED);
      return rulesAdvice(report, findings);
    }

    stage('advise', 'started');

    try {
      const output = await advisor.advise(
        {
          url,
          overall: report.overall,
          grade: report.grade,
          digest: this.engine.summarise(audit),
          findings,
        },
        { signal },
      );
      const count = output.recommendations.length;
      stage('advise', 'done', `${count} ${count === 1 ? 'recommendation' : 'recommendations'}`);

      return {
        source: 'ai',
        model: this.ai.modelName,
        summary: output.summary,
        recommendations: output.recommendations,
      };
    } catch (error) {
      if (signal.aborted || isAbortError(error) || describeSeoFailure(error).kind === 'aborted') {
        throw error;
      }

      await params.refund();
      const failure = describeSeoFailure(error);
      this.logger.warn(
        JSON.stringify({
          event: 'seo.advice_failed',
          kind: failure.kind,
          reason: reasonOf(error),
        }),
      );
      stage('advise', 'failed', SEO_MESSAGES.ADVICE_FAILED);

      return rulesAdvice(report, findings);
    }
  }

  /**
   * The backlink signal, under a deadline. Any failure — provider down, slow,
   * no key quota left — means the heuristic score, logged once; a crawl that
   * succeeded is not failed over a lookup that is optional.
   */
  private async estimateAuthority(
    hostname: string,
    signal: AbortSignal,
  ): Promise<AuthorityEstimate | null> {
    const provider = this.engine.authority;

    if (!provider || hostname === '') {
      return null;
    }

    try {
      return await withDeadline(
        (linked) => provider.estimate(hostname, { signal: linked }),
        AUTHORITY_TIMEOUT_MS,
        signal,
      );
    } catch (error) {
      if (signal.aborted) {
        throw error;
      }
      this.logger.warn(
        JSON.stringify({
          event: 'seo.authority_failed',
          provider: provider.name,
          reason: reasonOf(error),
        }),
      );
      return null;
    }
  }

  /**
   * Whether a headless browser can launch, probed once and cached by the
   * crawler; the race is per call so a probe that is still running answers
   * "no" now and "yes" later, rather than caching a timeout for good.
   */
  private async browserAvailable(): Promise<boolean> {
    if (this.config.browser === 'off') {
      return false;
    }

    const probe =
      this.browserProbe ??
      this.engine.crawler.browserAvailable().catch((error: unknown) => {
        this.logger.warn(`Browser probe failed: ${reasonOf(error)}`);
        return false;
      });
    this.browserProbe = probe;

    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), BROWSER_PROBE_TIMEOUT_MS);
      timer.unref();
    });

    try {
      return await Promise.race([probe, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  private aiEnabled(): boolean {
    return this.ai.mode !== 'unconfigured';
  }

  /** The address as the analyzer spells it, or a 400 for one that is not an address at all. */
  private normalise(orgId: string, input: string): string {
    try {
      return this.engine.normaliseUrl(input);
    } catch (error) {
      if (isCrawlError(error) && error.kind === 'unsafe_url') {
        const reason = (error as { reason?: string }).reason;
        if (reason !== 'invalid' && reason !== 'scheme') {
          securityLogger.warn('seo.unsafe_url', { orgId, reason, host: hostOf(input) });
          throw new UnprocessableEntityException(error.message);
        }
      }
      throw new BadRequestException(SEO_MESSAGES.INVALID_URL);
    }
  }

  private async refundAdvice(orgId: string): Promise<void> {
    try {
      await this.credits.refund(orgId, 'seo_advice', AI_CREDIT_COSTS.seo_advice);
    } catch (error) {
      this.logger.error(`Could not refund the SEO advice credits for ${orgId}: ${reasonOf(error)}`);
    }
  }

  /** A failed run still ends in a row that says why, even if that last write fails too. */
  private async markFailed(
    orgId: string,
    row: SeoAuditRow,
    patch: { failureReason: string; durationMs: number },
  ): Promise<SeoAuditRow> {
    try {
      return await this.repository.patch(orgId, row.id, {
        status: SEOAuditStatus.FAILED,
        ...patch,
      });
    } catch (error) {
      this.logger.error(`Could not mark audit ${row.id} as failed: ${reasonOf(error)}`);
      return { ...row, status: SEOAuditStatus.FAILED, failureReason: patch.failureReason };
    }
  }

  /**
   * The credits for a terminal event, read fresh so refunds are reflected;
   * null when AI is off (nothing was charged); the post-charge snapshot
   * when the read fails, because a stream that has delivered a result must
   * still end properly.
   */
  private async freshCredits(run: AnalyzeRun): Promise<AiCredits | null> {
    if (!run.context || !run.charged) {
      return null;
    }

    try {
      return await this.credits.summaryFor(run.orgId, run.context);
    } catch (error) {
      this.logger.warn(`Could not re-read credits for ${run.orgId}: ${reasonOf(error)}`);
      return run.charged;
    }
  }

  private logFailure(orgId: string, auditId: string, kind: string, error: unknown): void {
    // A stopped analysis is a person changing their mind, not a fault.
    if (kind === 'aborted') {
      this.logger.log(JSON.stringify({ event: 'seo.audit_stopped', orgId, auditId }));
      return;
    }

    securityLogger.warn('seo.audit_failed', { orgId, auditId, kind, reason: reasonOf(error) });
  }
}

/**
 * Runs `fn` with a signal that fires when the caller's does **or** when
 * `timeoutMs` elapses, so a slow provider is cancelled at the socket rather
 * than left running after the score has moved on.
 */
export async function withDeadline<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  parent?: AbortSignal,
): Promise<T> {
  if (parent?.aborted) {
    throw abortError();
  }

  const controller = new AbortController();
  const onParentAbort = () => controller.abort(parent?.reason);
  parent?.addEventListener('abort', onParentAbort, { once: true });
  const timer = setTimeout(
    () => controller.abort(Object.assign(new Error('Timed out'), { name: 'TimeoutError' })),
    timeoutMs,
  );

  try {
    return await new Promise<T>((resolve, reject) => {
      controller.signal.addEventListener(
        'abort',
        () => reject(parent?.aborted ? abortError() : controller.signal.reason),
        { once: true },
      );
      fn(controller.signal).then(resolve, reject);
    });
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener('abort', onParentAbort);
  }
}

function abortError(): Error {
  return Object.assign(new Error('The request was cancelled.'), { name: 'AbortError' });
}

/** The name and message only — never a page body or a provider response. */
function reasonOf(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
