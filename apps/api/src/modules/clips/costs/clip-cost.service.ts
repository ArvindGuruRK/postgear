/**
 * What each Clips job cost us (Sprint 13, Module 15 section 3).
 *
 * - **record(orgId, jobId)**: called when a job ends (the worker's `settled`
 *   call). For a DONE, FAILED or CANCELLED job it works out the facts
 *   (`costFacts`), prices them with the table (`estimate`) and writes
 *   `ClipJob.cost` (the facts and the exact `cents`) and `ClipJob.costCents`
 *   (whole cents). A job that already has `costCents` is left alone, and the
 *   write is conditional on it still being null, so two calls at once write
 *   once. It never throws: a cost is bookkeeping, never a reason for the
 *   worker's call to fail.
 * - **recordMissing(since, take)**: the maintenance pass's safety net, for
 *   finished jobs since a date whose cost was never written (a lost
 *   `settled` call). Answers how many it wrote.
 *
 * What it reads beside the row: the AI engine's name (which model read or
 * translated), the video's length, an import's or a sharp copy's stored
 * bytes, and for a Find Clips run its setup (the stretch read, the vision
 * check, its own listening job). Logs carry ids and counts only: never a
 * prompt, an answer or a word that was said.
 *
 * Nothing about cost is ever shown to a workspace.
 */
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ClipAssetKind, type ClipJobKind, ClipJobStatus, type Prisma, prisma } from '@postgear/db';
import { AI_ENGINE, type AiEngine } from '../../ai/engine/engine.types';
import { readSetupParams } from '../highlights/clip-moments.service';
import { type CostContext, type CostRun, costFacts } from './clip-cost.facts';
import { estimate } from './clip-prices';

const FINISHED: ClipJobStatus[] = [
  ClipJobStatus.DONE,
  ClipJobStatus.FAILED,
  ClipJobStatus.CANCELLED,
];

/** The files an import keeps for its video. */
const IMPORT_ASSET_KINDS: ClipAssetKind[] = [
  ClipAssetKind.ORIGINAL,
  ClipAssetKind.PROXY,
  ClipAssetKind.ANALYSIS_AUDIO,
  ClipAssetKind.FILMSTRIP,
  ClipAssetKind.WAVEFORM,
  ClipAssetKind.POSTER,
  ClipAssetKind.SIGNALS,
];

/** Jobs one `recordMissing` pass looks at when the caller does not say. */
export const RECORD_MISSING_TAKE = 100;

const COST_JOB_SELECT = {
  id: true,
  organizationId: true,
  kind: true,
  status: true,
  stage: true,
  input: true,
  output: true,
  startedAt: true,
  finishedAt: true,
  costCents: true,
  videoId: true,
  highlightRunId: true,
  video: { select: { durationMs: true } },
} satisfies Prisma.ClipJobSelect;

type CostRow = Prisma.ClipJobGetPayload<{ select: typeof COST_JOB_SELECT }>;

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown';
}

/** Seconds two runs overlapped. */
function overlapSeconds(
  a: { startedAt: Date | null; finishedAt: Date | null },
  b: { startedAt: Date | null; finishedAt: Date | null },
): number {
  if (!a.startedAt || !a.finishedAt || !b.startedAt || !b.finishedAt) return 0;
  const start = Math.max(a.startedAt.getTime(), b.startedAt.getTime());
  const end = Math.min(a.finishedAt.getTime(), b.finishedAt.getTime());
  return end > start ? (end - start) / 1000 : 0;
}

@Injectable()
export class ClipCostService {
  private readonly logger = new Logger(ClipCostService.name);

  constructor(@Optional() @Inject(AI_ENGINE) private readonly ai?: AiEngine) {}

  /** Writes a finished job's cost once. Never throws. */
  async record(orgId: string, jobId: string): Promise<void> {
    await this.recordOne(orgId, jobId);
  }

  /**
   * Costs finished jobs since `since` that have none yet, oldest first, at
   * most `take`. Never throws; answers how many were written.
   */
  async recordMissing(since: Date, take = RECORD_MISSING_TAKE): Promise<number> {
    let jobs: Array<{ id: string; organizationId: string }>;
    try {
      jobs = await prisma.clipJob.findMany({
        where: { costCents: null, status: { in: FINISHED }, finishedAt: { gte: since } },
        select: { id: true, organizationId: true },
        orderBy: { finishedAt: 'asc' },
        take: Math.max(1, Math.min(take, 1_000)),
      });
    } catch (error) {
      this.logger.warn(
        JSON.stringify({ event: 'clips.cost.missing_failed', reason: errorName(error) }),
      );
      return 0;
    }
    let written = 0;
    for (const job of jobs) {
      if (await this.recordOne(job.organizationId, job.id)) written += 1;
    }
    if (written > 0) {
      this.logger.log(
        JSON.stringify({ event: 'clips.cost.missing_recorded', looked: jobs.length, written }),
      );
    }
    return written;
  }

  /** True when this call wrote the cost. */
  private async recordOne(orgId: string, jobId: string): Promise<boolean> {
    try {
      const job = await prisma.clipJob.findFirst({
        where: { id: jobId, organizationId: orgId },
        select: COST_JOB_SELECT,
      });
      if (!job || job.costCents !== null || !FINISHED.includes(job.status)) return false;

      const facts = costFacts(job, await this.contextOf(job));
      const cents = estimate(facts, job.kind);
      const cost = { ...facts, cents } as unknown as Prisma.InputJsonValue;
      const written = await prisma.clipJob.updateMany({
        where: { id: job.id, organizationId: orgId, costCents: null },
        data: { costCents: Math.round(cents), cost },
      });
      return written.count > 0;
    } catch (error) {
      this.logger.warn(
        JSON.stringify({
          event: 'clips.cost.record_failed',
          jobId,
          orgId,
          reason: errorName(error),
        }),
      );
      return false;
    }
  }

  private async contextOf(job: CostRow): Promise<CostContext> {
    const context: CostContext = {
      aiModel: this.ai?.modelName ?? null,
      videoDurationMs: job.video?.durationMs ?? null,
      storedBytes: null,
      run: null,
    };
    const kind: ClipJobKind = job.kind;
    if (kind === 'IMPORT' && job.status === ClipJobStatus.DONE && job.videoId) {
      context.storedBytes = await this.importBytes(job);
    } else if (kind === 'SEGMENT' && job.status === ClipJobStatus.DONE) {
      context.storedBytes = await this.segmentBytes(job);
    } else if (kind === 'HIGHLIGHTS') {
      context.run = await this.runOf(job);
    }
    return context;
  }

  /** An import's files, as they stood when it ended (a later job's files are not its own). */
  private async importBytes(job: CostRow): Promise<number | null> {
    const sum = await prisma.clipAsset.aggregate({
      where: {
        organizationId: job.organizationId,
        videoId: job.videoId,
        kind: { in: IMPORT_ASSET_KINDS },
        ...(job.finishedAt ? { createdAt: { lte: job.finishedAt } } : {}),
      },
      _sum: { bytes: true },
    });
    const bytes = sum._sum.bytes;
    return bytes === null || bytes === undefined ? null : Number(bytes);
  }

  private async segmentBytes(job: CostRow): Promise<number | null> {
    const output = job.output as { assetId?: unknown } | null;
    const assetId = typeof output?.assetId === 'string' ? output.assetId : null;
    if (!assetId) return null;
    const asset = await prisma.clipAsset.findFirst({
      where: { id: assetId, organizationId: job.organizationId },
      select: { bytes: true },
    });
    return asset ? Number(asset.bytes) : null;
  }

  /** A Find Clips run's setup facts, or null for Quick Find (no setup). */
  private async runOf(job: CostRow): Promise<CostRun | null> {
    if (!job.highlightRunId) return null;
    const run = await prisma.clipHighlightRun.findFirst({
      where: { id: job.highlightRunId, organizationId: job.organizationId },
      select: { params: true },
    });
    const params = run ? readSetupParams(run.params) : null;
    if (!params) return null;
    const { fromMs, toMs } = params.setup.range;
    const duration = job.video?.durationMs ?? null;
    const end = duration !== null ? Math.min(toMs, duration) : toMs;
    let listenOverlapSeconds = 0;
    if (params.listenJobId) {
      const listen = await prisma.clipJob.findFirst({
        where: { id: params.listenJobId, organizationId: job.organizationId },
        select: { startedAt: true, finishedAt: true },
      });
      if (listen) listenOverlapSeconds = overlapSeconds(job, listen);
    }
    return {
      readMs: Math.max(0, end - fromMs),
      vision: params.setup.action && params.actionVision,
      listenOverlapSeconds,
    };
  }
}
