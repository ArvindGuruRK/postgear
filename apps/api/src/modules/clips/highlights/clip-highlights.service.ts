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
 * 3. One serializable transaction re-checks that no run is open and the
 *    video is still live and READY, and writes the `ClipHighlightRun`
 *    (engine version, tuning, minutes, ledger entry) and its HIGHLIGHTS job.
 *    A request that lost the race is a 409 `highlights_running`; a video
 *    that left READY meanwhile is a 409 `video_not_ready` (404 when deleted).
 * 4. The workflow is started; 202 `{ run, job, meter }`.
 *
 * Sprint 13, Module 05: with a **setup** (Clip Setup) the run also listens
 * and reads. The total is checked against what is left before anything is
 * charged; then the run's own steps are charged under its job
 * (`clips.ai:read:<jobId>`, and `clips.ai:signals:<jobId>` only when the run
 * does not listen), and listening goes through Module 02's `ensure`, which
 * starts (or joins) a TRANSCRIBE job charged under that job's own key. The
 * worker waits for it at the `listening` stage.
 *
 * Whatever happens before the rows land, the charge is given back
 * (`reverseAllFor`), so a double click charges once. A failed or cancelled
 * run is given back by the worker's bookkeeping (or by the cancel and the
 * reconcile for a job that never ran); a run that found nothing keeps its
 * charge: the price was for looking.
 */
import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClipJobKind, ClipJobStatus, type Prisma } from '@postgear/db';
import { refusalMessage } from '@postgear/entitlements';
import {
  type ClipSetup,
  type SetupPrice,
  SIGNALS_ENGINE_VERSION,
  SIGNALS_TUNING,
  SIGNALS_TUNING_VALUES,
  setupPrice,
} from '@postgear/video-engine';
import type { Env } from '../../../config/env';
import { EntitlementRefusedException } from '../../entitlements/entitlement-refused.exception';
import { EntitlementResolver, type MeterState } from '../../entitlements/entitlement-resolver';
import { UsageService } from '../../entitlements/usage.service';
import { ClipErrorException } from '../clip-error.exception';
import { isUuid } from '../clips.ids';
import { CLIPS_MESSAGES } from '../clips.messages';
import { serializable } from '../clips.tx';
import { type ClipJobView, toJobView } from '../jobs/clip-job-view';
import { ClipJobsRepository, OPEN_JOB_STATUSES } from '../jobs/clip-jobs.repository';
import { ClipJobsService } from '../jobs/clip-jobs.service';
import { ClipLimitsGuard } from '../limits/clip-limits.guard';
import { ClipTranscriptsService } from '../transcripts/clip-transcripts.service';
import { ClipVideosRepository } from '../videos/clip-videos.repository';
import { assertSetupReferences } from '../recipes/setup-references';
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

/** Look For Action's charge (Sprint 13, Module 06). */
export function actionChargeKey(jobId: string): string {
  return `clips.ai:action:${jobId}`;
}

/** The run's own reading charge (Sprint 13, Module 05). */
export function readChargeKey(jobId: string): string {
  return `clips.ai:read:${jobId}`;
}

/** `POST /clips/videos/:videoId/setup/price`. */
export interface SetupPriceView extends SetupPrice {
  /** What is left this month, or null for no limit. */
  remaining: number | null;
  limit: number | null;
  /** When the month's AI minutes come back. */
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
    private readonly resolver: EntitlementResolver,
    private readonly transcripts: ClipTranscriptsService,
    @Optional() private readonly config?: ConfigService<Env, true>,
  ) {}

  /** Module 06: whether a run starting now shows stills to the AI model (kept on the run). */
  private actionVision(): boolean {
    return this.config?.get('CLIPS_ACTION_VISION', { infer: true }) === 'true';
  }

  /** The setup's stretch held inside the video (422 when nothing of 3 seconds is left). */
  private setupRange(setup: ClipSetup, durationMs: number): { fromMs: number; toMs: number } {
    const range = { fromMs: setup.range.fromMs, toMs: Math.min(setup.range.toMs, durationMs) };
    if (range.toMs - range.fromMs < 3_000) {
      throw new ClipErrorException(HttpStatus.UNPROCESSABLE_ENTITY, 'clip_range_invalid');
    }
    return range;
  }

  /** The price lines of a setup (no charge), with what is left this month. */
  async price(orgId: string, videoId: string, setup: ClipSetup): Promise<SetupPriceView> {
    const video = await this.requireVideo(orgId, videoId);
    if (video.status !== 'READY' || video.durationMs === null) throw notReady();
    const range = this.setupRange(setup, video.durationMs);
    // Module 10: the recipe and kit the setup names must be this workspace's.
    await assertSetupReferences(orgId, setup);
    const listen = await this.transcripts.quote(orgId, video.id, {
      fromMs: range.fromMs,
      toMs: range.toMs,
      language: setup.language,
    });
    const meter = await this.resolver.meter(orgId, AI_MINUTES_METER);
    return {
      ...setupPrice({ ...setup, range }, listen.price),
      remaining: meter.remaining,
      limit: meter.limit,
      cycleEnd: meter.cycleEnd.toISOString(),
    };
  }

  /** `GET /clips/videos/:videoId/highlights`: the price and the latest run. */
  async latest(orgId: string, videoId: string): Promise<HighlightsView> {
    const video = await this.requireVideo(orgId, videoId);
    return highlightsOf(orgId, video);
  }

  /** `POST /clips/videos/:videoId/highlights`: see the file comment. */
  async start(
    orgId: string,
    userId: string,
    videoId: string,
    setup?: ClipSetup,
  ): Promise<StartHighlightsOutcome> {
    await this.limits.assertEnabled(orgId);
    const video = await this.requireVideo(orgId, videoId);
    if (video.status !== 'READY' || video.durationMs === null) throw notReady();
    if ((await this.openRuns(orgId, video.id)) > 0) throw running();
    if (setup) return this.startWithSetup(orgId, userId, video, setup);

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
        meta: { step: 'signals', videoId: video.id, by: userId },
      });

      const outcome = await serializable(async (tx) => {
        const open = await tx.clipJob.count({
          where: {
            organizationId: orgId,
            videoId: video.id,
            kind: ClipJobKind.HIGHLIGHTS,
            status: { in: [...OPEN_JOB_STATUSES] },
          },
        });
        if (open > 0) return { kind: 'running' as const };
        // The video may have gone, or left READY, since the first look.
        const live = await this.videos.findLive(orgId, video.id, tx);
        if (!live) return { kind: 'gone' as const };
        if (live.status !== 'READY') return { kind: 'not_ready' as const };

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
        return { kind: 'created' as const, run, job };
      });
      if (outcome.kind === 'running') throw running();
      if (outcome.kind === 'gone') throw videoNotFound();
      if (outcome.kind === 'not_ready') throw notReady();
      const rows = outcome;
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

  /**
   * A run with a setup (Module 05): the total checked first, the run's own
   * steps charged under its job, listening through `ensure`, then the rows.
   */
  private async startWithSetup(
    orgId: string,
    userId: string,
    video: Awaited<ReturnType<ClipHighlightsService['requireVideo']>>,
    setup: ClipSetup,
  ): Promise<StartHighlightsOutcome> {
    const durationMs = video.durationMs as number;
    const range = this.setupRange(setup, durationMs);
    // Module 10: the recipe and kit the setup names must be this workspace's (the run keeps
    // `recipeId` and `brandKitId` with the setup in its params, for `applyToRun`).
    await assertSetupReferences(orgId, setup);
    const chosen: ClipSetup = { ...setup, range };
    const listen = await this.transcripts.quote(orgId, video.id, {
      fromMs: range.fromMs,
      toMs: range.toMs,
      language: setup.language,
    });
    const price = setupPrice(chosen, listen.price);
    const line = (step: string) => price.lines.find((one) => one.step === step)?.aiMinutes ?? 0;

    // Nothing is charged unless the whole run fits what is left.
    const meter = await this.resolver.meter(orgId, AI_MINUTES_METER);
    if (meter.remaining !== null && meter.remaining < price.total) {
      throw new EntitlementRefusedException(
        'clips_ai_minutes_used',
        refusalMessage('clips_ai_minutes_used', {
          n: meter.remaining,
          need: price.total,
          date: meter.cycleEnd,
        }),
        {
          limit: meter.limit,
          used: meter.used,
          needed: price.total,
          remaining: meter.remaining,
        },
      );
    }

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
      const read = await this.usage.consume(orgId, AI_MINUTES_METER, line('read'), {
        idempotencyKey: readChargeKey(jobId),
        refId: jobId,
        meta: { step: 'read', videoId: video.id, by: userId },
      });
      let state = read.state;
      let signalsEntry: string | null = null;
      if (line('signals') > 0) {
        const signals = await this.usage.consume(orgId, AI_MINUTES_METER, line('signals'), {
          idempotencyKey: signalsChargeKey(jobId),
          refId: jobId,
          meta: { step: 'signals', videoId: video.id, by: userId },
        });
        signalsEntry = signals.entryId;
        state = signals.state;
      }
      // Module 06: Look For Action, the same price with the still check on or off.
      let actionEntry: string | null = null;
      if (chosen.action && line('action') > 0) {
        const action = await this.usage.consume(orgId, AI_MINUTES_METER, line('action'), {
          idempotencyKey: actionChargeKey(jobId),
          refId: jobId,
          meta: { step: 'action', videoId: video.id, by: userId },
        });
        actionEntry = action.entryId;
        state = action.state;
      }

      // Listening: Module 02's door (its own job and key). Covered: nothing to wait for.
      let listenJobId: string | null = null;
      if (listen.price > 0) {
        const outcome = await this.transcripts.ensure(orgId, userId, video.id, {
          fromMs: range.fromMs,
          toMs: range.toMs,
          language: setup.language,
        });
        if (!outcome.covered) {
          listenJobId = outcome.job.id;
          if ('meter' in outcome && outcome.meter) {
            state = {
              ...state,
              used: outcome.meter.used,
              remaining: outcome.meter.remaining,
            };
          }
        }
      }

      const outcome = await serializable(async (tx) => {
        const open = await tx.clipJob.count({
          where: {
            organizationId: orgId,
            videoId: video.id,
            kind: ClipJobKind.HIGHLIGHTS,
            status: { in: [...OPEN_JOB_STATUSES] },
          },
        });
        if (open > 0) return { kind: 'running' as const };
        const live = await this.videos.findLive(orgId, video.id, tx);
        if (!live) return { kind: 'gone' as const };
        if (live.status !== 'READY') return { kind: 'not_ready' as const };

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
              setup: chosen,
              listenJobId,
              charges: { read: read.entryId, signals: signalsEntry, action: actionEntry },
              // Module 06: decided once, when the run starts.
              actionVision: chosen.action && this.actionVision(),
            } as unknown as Prisma.InputJsonValue,
            aiMinutesCharged: price.total,
            usageEntryId: read.entryId,
            createdById: userId,
          },
        });
        const job = await this.jobsRepository.create(jobRow, tx);
        return { kind: 'created' as const, run, job };
      });
      if (outcome.kind === 'running') throw running();
      if (outcome.kind === 'gone') throw videoNotFound();
      if (outcome.kind === 'not_ready') throw notReady();
      written = true;

      await this.jobs.start(outcome.job);
      const job = (await this.jobsRepository.find(orgId, outcome.job.id)) ?? outcome.job;
      this.logger.log(
        JSON.stringify({
          event: 'clips.highlights.started',
          orgId,
          videoId: video.id,
          runId,
          jobId,
          aiMinutes: price.total,
          listens: listenJobId !== null,
          genre: setup.genre,
          action: chosen.action,
        }),
      );
      return {
        run: toHighlightRunView(outcome.run, job),
        job: toJobView(job),
        meter: toMeterView({ ...state, cycleEnd: meter.cycleEnd, cycleStart: meter.cycleStart }),
      };
    } finally {
      if (!written) await this.usage.reverseAllFor(orgId, jobId);
    }
  }

  private openRuns(orgId: string, videoId: string): Promise<number> {
    return this.jobsRepository.countOpenForVideo(orgId, videoId, ClipJobKind.HIGHLIGHTS);
  }

  /** A live video of the workspace; a plain 404 otherwise (another workspace's reads the same). */
  private async requireVideo(orgId: string, videoId: string) {
    const video = isUuid(videoId) ? await this.videos.findLive(orgId, videoId) : null;
    if (!video) throw videoNotFound();
    return video;
  }
}

function running(): ClipErrorException {
  return new ClipErrorException(HttpStatus.CONFLICT, 'highlights_running');
}

function notReady(): ClipErrorException {
  return new ClipErrorException(HttpStatus.CONFLICT, 'video_not_ready');
}

function videoNotFound(): NotFoundException {
  return new NotFoundException({
    message: CLIPS_MESSAGES.VIDEO_NOT_FOUND,
    code: 'video_not_found',
  });
}
