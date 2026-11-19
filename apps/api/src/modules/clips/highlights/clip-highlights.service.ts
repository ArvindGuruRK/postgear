/**
 * Find Clips (Sprint 12, Module 16): one highlights run of a video.
 *
 * The order, the same as every Clips charge:
 * 1. The video must be live and READY; another run of it must not be open
 *    (409 `highlights_running`, checked before any charge).
 * 2. The job id is made first, then the AI minutes are charged through
 *    `UsageService.consume('clips.ai_minutes_per_month', price)` with the
 *    key `clips.ai:signals:<jobId>` and the job as `refId` (402
 *    `clips_ai_minutes_used` with the "needs {need} and you have {n}"
 *    sentence when short). The price is `aiMinutesCost('signals', length)`.
 * 3. One serializable transaction re-checks that no run is open and writes
 *    the `ClipHighlightRun` (engine version, tuning, minutes, ledger entry)
 *    and its HIGHLIGHTS job. A request that lost the race is a 409.
 * 4. The workflow is started; 202 `{ run, job, meter }`.
 *
 * Whatever happens before the rows land, the charge is given back
 * (`reverseAllFor`), so a double click charges once. A failed or cancelled
 * run is given back by the worker's bookkeeping (or by the cancel and the
 * reconcile for a job that never ran); a run that found nothing keeps its
 * charge: the price was for looking.
 */
import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ClipJobKind, ClipJobStatus, type Prisma } from '@postgear/db';
import {
  SIGNALS_ENGINE_VERSION,
  SIGNALS_TUNING,
  SIGNALS_TUNING_VALUES,
} from '@postgear/video-engine';
import type { MeterState } from '../../entitlements/entitlement-resolver';
import { UsageService } from '../../entitlements/usage.service';
import { ClipErrorException } from '../clip-error.exception';
import { isUuid } from '../clips.ids';
import { CLIPS_MESSAGES } from '../clips.messages';
import { serializable } from '../clips.tx';
import { type ClipJobView, toJobView } from '../jobs/clip-job-view';
import { ClipJobsRepository, OPEN_JOB_STATUSES } from '../jobs/clip-jobs.repository';
import { ClipJobsService } from '../jobs/clip-jobs.service';
import { ClipLimitsGuard } from '../limits/clip-limits.guard';
import { ClipVideosRepository } from '../videos/clip-videos.repository';
import {
  type HighlightRunView,
  type HighlightsView,
  highlightsOf,
  highlightsPrice,
  toHighlightRunView,
} from './clip-highlights.view';

export const AI_MINUTES_METER = 'clips.ai_minutes_per_month' as const;

/** The AI step's charge key (research 12 section 7.2). */
export function signalsChargeKey(jobId: string): string {
  return `clips.ai:signals:${jobId}`;
}

export interface MeterView {
  used: number;
  remaining: number | null;
  limit: number | null;
  cycleEnd: string;
}

export interface StartHighlightsOutcome {
  run: HighlightRunView;
  job: ClipJobView;
  meter: MeterView;
}

function toMeterView(state: MeterState): MeterView {
  return {
    used: state.used,
    remaining: state.remaining,
    limit: state.limit,
    cycleEnd: state.cycleEnd.toISOString(),
  };
}

@Injectable()
export class ClipHighlightsService {
  private readonly logger = new Logger(ClipHighlightsService.name);

  constructor(
    private readonly videos: ClipVideosRepository,
    private readonly jobs: ClipJobsService,
    private readonly jobsRepository: ClipJobsRepository,
    private readonly limits: ClipLimitsGuard,
    private readonly usage: UsageService,
  ) {}

  /** `GET /clips/videos/:videoId/highlights`: the price and the latest run. */
  async latest(orgId: string, videoId: string): Promise<HighlightsView> {
    const video = await this.requireVideo(orgId, videoId);
    return highlightsOf(orgId, video);
  }

  /** `POST /clips/videos/:videoId/highlights`: see the file comment. */
  async start(orgId: string, userId: string, videoId: string): Promise<StartHighlightsOutcome> {
    await this.limits.assertEnabled(orgId);
    const video = await this.requireVideo(orgId, videoId);
    if (video.status !== 'READY' || video.durationMs === null) {
      throw new ClipErrorException(HttpStatus.CONFLICT, 'video_not_ready');
    }
    if ((await this.openRuns(orgId, video.id)) > 0) throw running();

    const price = highlightsPrice(video.durationMs);
    const jobId = this.jobs.newJobId();
    const runId = randomUUID();
    const jobRow = await this.jobs.build({
      id: jobId,
      orgId,
      userId,
      kind: 'HIGHLIGHTS',
      videoId: video.id,
      highlightRunId: runId,
      input: { videoId: video.id, runId },
    });

    let written = false;
    try {
      const charge = await this.usage.consume(orgId, AI_MINUTES_METER, price, {
        idempotencyKey: signalsChargeKey(jobId),
        refId: jobId,
        meta: { step: 'signals', videoId: video.id },
      });

      const rows = await serializable(async (tx) => {
        const open = await tx.clipJob.count({
          where: {
            organizationId: orgId,
            videoId: video.id,
            kind: ClipJobKind.HIGHLIGHTS,
            status: { in: [...OPEN_JOB_STATUSES] },
          },
        });
        if (open > 0) return null;
        const live = await this.videos.findLive(orgId, video.id, tx);
        if (live?.status !== 'READY') return null;

        const run = await tx.clipHighlightRun.create({
          data: {
            id: runId,
            organizationId: orgId,
            videoId: video.id,
            status: ClipJobStatus.QUEUED,
            engineVersion: SIGNALS_ENGINE_VERSION,
            params: {
              tuning: SIGNALS_TUNING,
              maxClips: SIGNALS_TUNING_VALUES.maxClips,
            } satisfies Prisma.InputJsonValue,
            aiMinutesCharged: price,
            usageEntryId: charge.entryId,
            createdById: userId,
          },
        });
        const job = await this.jobsRepository.create(jobRow, tx);
        return { run, job };
      });
      if (!rows) throw running();
      written = true;

      await this.jobs.start(rows.job);
      const job = (await this.jobsRepository.find(orgId, rows.job.id)) ?? rows.job;
      this.logger.log(
        JSON.stringify({
          event: 'clips.highlights.started',
          orgId,
          videoId: video.id,
          runId,
          jobId,
          aiMinutes: price,
        }),
      );
      return {
        run: toHighlightRunView(rows.run, job),
        job: toJobView(job),
        meter: toMeterView(charge.state),
      };
    } finally {
      if (!written) {
        // Refused, lost the race, or the rows never landed: nothing ran, so nothing is kept.
        await this.usage.reverseAllFor(orgId, jobId);
      }
    }
  }

  private openRuns(orgId: string, videoId: string): Promise<number> {
    return this.jobsRepository.countOpenForVideo(orgId, videoId, ClipJobKind.HIGHLIGHTS);
  }

  /** A live video of the workspace; a plain 404 otherwise (another workspace's reads the same). */
  private async requireVideo(orgId: string, videoId: string) {
    const video = isUuid(videoId) ? await this.videos.findLive(orgId, videoId) : null;
    if (!video) {
      throw new NotFoundException({
        message: CLIPS_MESSAGES.VIDEO_NOT_FOUND,
        code: 'video_not_found',
      });
    }
    return video;
  }
}

function running(): ClipErrorException {
  return new ClipErrorException(HttpStatus.CONFLICT, 'highlights_running');
}
