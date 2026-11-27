/**
 * Auto-Edit Video (Sprint 13, Module 10, CA-6.4): one press makes one clip
 * over a whole video (up to 30 minutes, `CLIP_MAX_MS`) with a recipe applied.
 *
 * The recipe is a starter (`starter-...`) or the workspace's own `ClipRecipe`
 * row (another workspace's reads as 404 `recipe_not_found`); none named is
 * Auto-Edit Talking Video. The stretch is the whole video when it is at most
 * 30 minutes; a longer video needs a range of at most 30 minutes inside it
 * (422 `auto_edit_too_long` otherwise, with its sentence).
 *
 * Words are needed when the recipe turns on captions, silences, filler words
 * or bleeps. The price is what listening to the part of the stretch nobody
 * listened to yet costs (`ClipTranscriptsService.quote`): a covered video, a
 * silent one, or a recipe that needs no words costs 0.
 *
 * The order, the same as Find Clips with a setup:
 * 1. The video is live and READY, and no AUTO_EDIT job of it is open
 *    (409 `auto_edit_running`), before anything is charged.
 * 2. The total is checked against what is left (402 `clips_ai_minutes_used`,
 *    the same refusal Find Clips builds).
 * 3. Nothing to listen to: `ClipRecipeApplierService.createAutoEditClip`
 *    makes the clip at once, 200 `{ clipId, job: null, aiMinutes: 0, ... }`.
 * 4. Otherwise the job id comes first, Module 02's `ensure` listens (its own
 *    TRANSCRIBE job and charge, key `clips.ai:listen:<listenJobId>`; or it
 *    joins one already listening), then one serializable transaction
 *    re-checks no AUTO_EDIT of the video is open and the video is live and
 *    READY, and writes the AUTO_EDIT job (`listenJobId`, `listenStarted`).
 *    The job is started; 202 `{ clipId, job, aiMinutes, skipped: [], noSpeech: false }`.
 *
 * Anything failing before the row lands gives the charges back: the job's own
 * (`reverseAllFor`, none today) and the listening it started (cancelled
 * through that job's own path, which reverses its charge). A listen job it
 * only joined is someone else's and is left alone.
 */
import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ClipJobKind } from '@postgear/db';
import { refusalMessage } from '@postgear/entitlements';
import {
  CLIP_MAX_MS,
  CLIP_MIN_MS,
  type RecipeSettings,
  type RecipeSkip,
  isStarterRecipeId,
  recipeSettingsSchema,
  starterRecipe,
} from '@postgear/video-engine';
import { EntitlementRefusedException } from '../../entitlements/entitlement-refused.exception';
import { EntitlementResolver } from '../../entitlements/entitlement-resolver';
import { UsageService } from '../../entitlements/usage.service';
import { ClipErrorException } from '../clip-error.exception';
import { isUuid } from '../clips.ids';
import { CLIPS_MESSAGES } from '../clips.messages';
import { serializable } from '../clips.tx';
import { AI_MINUTES_METER } from '../highlights/clip-highlights.service';
import { type ClipJobView, toJobView } from '../jobs/clip-job-view';
import { ClipJobsRepository, OPEN_JOB_STATUSES } from '../jobs/clip-jobs.repository';
import { ClipJobsService } from '../jobs/clip-jobs.service';
import { ClipLimitsGuard } from '../limits/clip-limits.guard';
import { ClipRecipeApplierService } from '../recipes/clip-recipe-applier.service';
import { ClipTranscriptsService } from '../transcripts/clip-transcripts.service';
import { ClipVideosRepository } from '../videos/clip-videos.repository';
import type { AutoEditBody } from './clip-auto-edit.schema';
import { ClipAutoEditRepository } from './clip-auto-edit.repository';

/** `POST /clips/videos/:videoId/auto-edit/price` (mirrors the web's `AutoEditPriceView`). */
export interface AutoEditPriceView {
  aiMinutes: number;
  range: { fromMs: number; toMs: number };
  needsRange: boolean;
  remaining: number | null;
  limit: number | null;
  cycleEnd: string;
}

/** `POST /clips/videos/:videoId/auto-edit` (mirrors the web's `AutoEditStarted`). */
export interface AutoEditStarted {
  clipId: string;
  job: ClipJobView | null;
  aiMinutes: number;
  skipped: RecipeSkip[];
  noSpeech: boolean;
}

/** Whether the recipe turns on a part that reads the words of what is said. */
export function recipeNeedsWords(settings: RecipeSettings): boolean {
  return Boolean(
    settings.captions?.on || settings.silences?.on || settings.fillers?.on || settings.bleep?.on,
  );
}

type LiveVideo = NonNullable<Awaited<ReturnType<ClipVideosRepository['findLive']>>>;

@Injectable()
export class ClipAutoEditService {
  private readonly logger = new Logger(ClipAutoEditService.name);

  constructor(
    private readonly videos: ClipVideosRepository,
    private readonly jobs: ClipJobsService,
    private readonly jobsRepository: ClipJobsRepository,
    private readonly limits: ClipLimitsGuard,
    private readonly usage: UsageService,
    private readonly resolver: EntitlementResolver,
    private readonly transcripts: ClipTranscriptsService,
    private readonly applier: ClipRecipeApplierService,
    private readonly repository: ClipAutoEditRepository,
  ) {}

  /** The price (no charge), the stretch it covers and what is left this month. */
  async price(orgId: string, videoId: string, body: AutoEditBody): Promise<AutoEditPriceView> {
    const video = await this.requireReadyVideo(orgId, videoId);
    const settings = await this.recipeSettings(orgId, body.recipeId);
    const durationMs = video.durationMs as number;
    const needsRange = durationMs > CLIP_MAX_MS;
    // The dialog asks for the price before any handle moved: the first 30 minutes.
    const range = this.rangeOf(
      durationMs,
      body.range ?? (needsRange ? { fromMs: 0, toMs: CLIP_MAX_MS } : undefined),
    );
    const aiMinutes = await this.listenPrice(orgId, video, settings, range);
    const meter = await this.resolver.meter(orgId, AI_MINUTES_METER);
    return {
      aiMinutes,
      range,
      needsRange,
      remaining: meter.remaining,
      limit: meter.limit,
      cycleEnd: meter.cycleEnd.toISOString(),
    };
  }

  /** See the file comment for the order. `job` null means the clip was made at once (200). */
  async start(
    orgId: string,
    userId: string,
    videoId: string,
    body: AutoEditBody,
  ): Promise<AutoEditStarted> {
    await this.limits.assertEnabled(orgId);
    const video = await this.requireReadyVideo(orgId, videoId);
    if ((await this.jobsRepository.countOpenForVideo(orgId, video.id, ClipJobKind.AUTO_EDIT)) > 0) {
      throw running();
    }
    const settings = await this.recipeSettings(orgId, body.recipeId);
    const range = this.rangeOf(video.durationMs as number, body.range);
    const price = await this.listenPrice(orgId, video, settings, range);

    // Nothing is charged unless the whole edit fits what is left.
    if (price > 0) {
      const meter = await this.resolver.meter(orgId, AI_MINUTES_METER);
      if (meter.remaining !== null && meter.remaining < price) {
        throw new EntitlementRefusedException(
          'clips_ai_minutes_used',
          refusalMessage('clips_ai_minutes_used', {
            n: meter.remaining,
            need: price,
            date: meter.cycleEnd,
          }),
          { limit: meter.limit, used: meter.used, needed: price, remaining: meter.remaining },
        );
      }
    }

    const clipId = randomUUID();
    if (price === 0) return this.makeNow(orgId, userId, video.id, clipId, body.recipeId, range);

    const jobId = this.jobs.newJobId();
    let listenJobId: string | null = null;
    let listenStarted = false;
    let written = false;
    let keepListen = false;
    try {
      const listen = await this.transcripts.ensure(orgId, userId, video.id, {
        fromMs: range.fromMs,
        toMs: range.toMs,
      });
      // Listened to meanwhile (another caller finished first): nothing to wait for.
      if (listen.covered) {
        written = true;
        return await this.makeNow(orgId, userId, video.id, clipId, body.recipeId, range);
      }
      listenJobId = listen.job.id;
      listenStarted = !listen.joined;
      const aiMinutes = listen.price;

      const jobRow = await this.jobs.build({
        id: jobId,
        orgId,
        userId,
        kind: 'AUTO_EDIT',
        videoId: video.id,
        clipId,
        input: {
          videoId: video.id,
          clipId,
          recipeId: body.recipeId,
          range,
          listenJobId,
          listenStarted,
        },
      });

      const outcome = await serializable(async (tx) => {
        const open = await tx.clipJob.count({
          where: {
            organizationId: orgId,
            videoId: video.id,
            kind: ClipJobKind.AUTO_EDIT,
            status: { in: [...OPEN_JOB_STATUSES] },
          },
        });
        if (open > 0) return { kind: 'running' as const };
        // The video may have gone, or left READY, since the first look.
        const live = await this.videos.findLive(orgId, video.id, tx);
        if (!live) return { kind: 'gone' as const };
        if (live.status !== 'READY') return { kind: 'not_ready' as const };
        const job = await this.jobsRepository.create(jobRow, tx);
        return { kind: 'created' as const, job };
      });
      if (outcome.kind === 'running') {
        // Another press won the race and may be waiting on this same listen
        // job (it joined it): keep listening. The words are kept for the
        // workspace either way, so a later Auto-Edit of this stretch is free.
        keepListen = true;
        throw running();
      }
      if (outcome.kind === 'gone') throw videoNotFound();
      if (outcome.kind === 'not_ready') throw notReady();
      written = true;

      await this.jobs.start(outcome.job);
      const job = (await this.jobsRepository.find(orgId, outcome.job.id)) ?? outcome.job;
      this.logger.log(
        JSON.stringify({
          event: 'clips.auto_edit.started',
          orgId,
          videoId: video.id,
          jobId,
          clipId,
          listenJobId,
          listenStarted,
          aiMinutes,
        }),
      );
      return { clipId, job: toJobView(job), aiMinutes, skipped: [], noSpeech: false };
    } finally {
      if (!written) {
        await this.giveBack(orgId, jobId, listenStarted && !keepListen ? listenJobId : null);
      }
    }
  }

  /** The clip made at once, with no job (nothing to listen to). */
  private async makeNow(
    orgId: string,
    userId: string,
    videoId: string,
    clipId: string,
    recipeId: string,
    range: { fromMs: number; toMs: number },
  ): Promise<AutoEditStarted> {
    const made = await this.applier.createAutoEditClip(orgId, userId, {
      clipId,
      videoId,
      recipeId,
      range,
    });
    this.logger.log(
      JSON.stringify({
        event: 'clips.auto_edit.made',
        orgId,
        videoId,
        clipId: made.clipId,
        skipped: made.skipped.length,
        noSpeech: made.noSpeech,
      }),
    );
    return {
      clipId: made.clipId,
      job: null,
      aiMinutes: 0,
      skipped: made.skipped,
      noSpeech: made.noSpeech,
    };
  }

  /** The rows never landed: the job's own charges and the listening it started go back. */
  private async giveBack(orgId: string, jobId: string, listenJobId: string | null): Promise<void> {
    await this.usage.reverseAllFor(orgId, jobId);
    if (!listenJobId) return;
    try {
      await this.jobs.cancel(orgId, listenJobId);
    } catch (error) {
      // A listen job that ended meanwhile keeps its words; nothing else to give back.
      this.logger.warn(
        JSON.stringify({
          event: 'clips.auto_edit.listen_give_back_failed',
          jobId,
          listenJobId,
          reason: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }

  /** AI minutes to listen to what the stretch still lacks; 0 when the recipe needs no words. */
  private async listenPrice(
    orgId: string,
    video: LiveVideo,
    settings: RecipeSettings,
    range: { fromMs: number; toMs: number },
  ): Promise<number> {
    // A video with no sound has nothing to listen to: the clip is made, the word parts skipped.
    if (!recipeNeedsWords(settings) || !video.hasAudio) return 0;
    const quote = await this.transcripts.quote(orgId, video.id, {
      fromMs: range.fromMs,
      toMs: range.toMs,
    });
    return quote.price;
  }

  /**
   * The stretch to edit: the whole video up to 30 minutes (any range sent is
   * ignored); a longer video needs a range of at most 30 minutes, held inside
   * the video. 422 `auto_edit_too_long`, or `clip_range_invalid` for a range
   * shorter than a clip may be.
   */
  private rangeOf(
    durationMs: number,
    asked: { fromMs: number; toMs: number } | undefined,
  ): { fromMs: number; toMs: number } {
    if (durationMs <= CLIP_MAX_MS) return { fromMs: 0, toMs: durationMs };
    if (!asked) throw tooLong();
    const range = { fromMs: asked.fromMs, toMs: Math.min(asked.toMs, durationMs) };
    if (range.toMs - range.fromMs > CLIP_MAX_MS) throw tooLong();
    if (range.toMs - range.fromMs < CLIP_MIN_MS) {
      throw new ClipErrorException(HttpStatus.UNPROCESSABLE_ENTITY, 'clip_range_invalid');
    }
    return range;
  }

  /** A starter's settings, or the workspace's own recipe's; 404 `recipe_not_found` otherwise. */
  private async recipeSettings(orgId: string, recipeId: string): Promise<RecipeSettings> {
    if (isStarterRecipeId(recipeId)) {
      const starter = starterRecipe(recipeId);
      if (starter) return starter.settings;
      throw recipeNotFound();
    }
    const row = isUuid(recipeId) ? await this.repository.findRecipe(orgId, recipeId) : null;
    if (!row) throw recipeNotFound();
    const parsed = recipeSettingsSchema.safeParse(row.settings);
    if (!parsed.success) {
      this.logger.error(
        JSON.stringify({ event: 'clips.auto_edit.recipe_unreadable', orgId, recipeId }),
      );
      throw recipeNotFound();
    }
    return parsed.data;
  }

  /** A live, READY video of the workspace with a known length. */
  private async requireReadyVideo(orgId: string, videoId: string): Promise<LiveVideo> {
    const video = isUuid(videoId) ? await this.videos.findLive(orgId, videoId) : null;
    if (!video) throw videoNotFound();
    if (video.status !== 'READY' || video.durationMs === null) throw notReady();
    return video;
  }
}

function running(): ClipErrorException {
  return new ClipErrorException(HttpStatus.CONFLICT, 'auto_edit_running');
}

function tooLong(): ClipErrorException {
  return new ClipErrorException(HttpStatus.UNPROCESSABLE_ENTITY, 'auto_edit_too_long');
}

function notReady(): ClipErrorException {
  return new ClipErrorException(HttpStatus.CONFLICT, 'video_not_ready');
}

function recipeNotFound(): ClipErrorException {
  return new ClipErrorException(HttpStatus.NOT_FOUND, 'recipe_not_found');
}

function videoNotFound(): NotFoundException {
  return new NotFoundException({
    message: CLIPS_MESSAGES.VIDEO_NOT_FOUND,
    code: 'video_not_found',
  });
}
