/**
 * Emote Maker (Sprint 13, Module 14): one export press is one EMOTE job.
 *
 * ## An export, in order
 *
 * 1. **The video**: live and READY in the workspace (404, 409), with a light
 *    copy whose frame the crop was drawn in.
 * 2. **The bounds** (`checkEmoteBounds`): at most 3 seconds (422
 *    `emote_too_long`), a stretch inside the video on tenths of a second and
 *    a square inside the picture (422 `emote_range_invalid`). Nothing is
 *    charged for a refused request.
 * 3. **The charge**, once the job id exists: one unit of
 *    `clips.downloads_per_day` (`clips.download:<jobId>`, `meta.by` the
 *    person), the typed 402 past the day's allowance. No AI minutes.
 * 4. **The row**, then **start**. The charge is reversed in a `finally`
 *    whenever the row was not written; a job that fails or is cancelled
 *    later gives it back through the worker's bookkeeping.
 * 5. **The answer**: the request waits up to 25 seconds
 *    (`CLIP_WAIT_FOR_ANSWER_MS`) and answers 200 with the files (or the
 *    failure), else 202 with the job for the page to follow.
 *
 * `GET /clips/emotes/:jobId` answers the job and, once it is done, each file
 * with a five minute signed address named after the file. The files live 24
 * hours (`expiresAt`, set when the row is made; the orphan sweep removes the
 * objects), after which the files are listed without addresses.
 *
 * Logs carry ids and counts only.
 */
import { HttpStatus, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { ClipJob } from '@postgear/db';
import { CLIP_SHORT_LIVED_MS, CLIP_WAIT_FOR_ANSWER_MS } from '@postgear/scheduling';
import { type ClipExtension, clipKeys, type PrivateStorage } from '@postgear/storage';
import {
  checkEmoteBounds,
  type EmoteFile,
  type EmoteJobOutput,
  type EmotePlatform,
  emoteOutputSchema,
} from '@postgear/video-engine';
import { UsageService } from '../../entitlements/usage.service';
import { PRIVATE_STORAGE } from '../../media/storage/storage.interface';
import { ClipErrorException } from '../clip-error.exception';
import { isUuid } from '../clips.ids';
import { CLIPS_MESSAGES } from '../clips.messages';
import { type ClipJobView, TERMINAL_JOB_STATUSES, toJobView } from '../jobs/clip-job-view';
import { ClipJobsRepository } from '../jobs/clip-jobs.repository';
import { ClipJobsService } from '../jobs/clip-jobs.service';
import { ClipLimitsGuard } from '../limits/clip-limits.guard';
import { latestAsset, proxyMetaOf } from '../videos/clip-video-view';
import { ClipVideosRepository } from '../videos/clip-videos.repository';
import type { EmoteExportBody } from './clip-emotes.schema';
import { EMOTE_LINK_SECONDS, EMOTE_POLL_MS, EMOTES_MESSAGES } from './emotes.messages';

export interface EmoteFileView extends EmoteFile {
  /** A five minute address; null for a file left out (an extra over its cap) or once expired. */
  url: string | null;
}

export interface EmoteResultView {
  platform: EmotePlatform;
  files: EmoteFileView[];
  zip: { name: string; bytes: number; url: string | null };
  sharp: boolean;
  expiresAt: string | null;
  expired: boolean;
}

export interface EmoteView {
  job: ClipJobView;
  /** Null until the job is done. */
  emote: EmoteResultView | null;
}

export interface EmoteExportOutcome extends EmoteView {
  /** The job finished (done, failed or cancelled) while the request waited. */
  finished: boolean;
}

/** How long the request waits, how often it looks, and how it sleeps (tests shorten them). */
export interface EmoteWaitTiming {
  waitMs: number;
  pollMs: number;
  sleep(ms: number): Promise<void>;
  now(): number;
}

const DEFAULT_TIMING: EmoteWaitTiming = {
  waitMs: CLIP_WAIT_FOR_ANSWER_MS,
  pollMs: EMOTE_POLL_MS,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
};

@Injectable()
export class ClipEmotesService {
  private readonly logger = new Logger(ClipEmotesService.name);
  /** Replaced by specs; never by configuration. */
  timing: EmoteWaitTiming = DEFAULT_TIMING;

  constructor(
    private readonly videos: ClipVideosRepository,
    private readonly jobs: ClipJobsService,
    private readonly jobsRepository: ClipJobsRepository,
    private readonly limits: ClipLimitsGuard,
    private readonly usage: UsageService,
    @Inject(PRIVATE_STORAGE) private readonly storage: PrivateStorage,
  ) {}

  async export(orgId: string, userId: string, body: EmoteExportBody): Promise<EmoteExportOutcome> {
    const video = isUuid(body.videoId) ? await this.videos.findLive(orgId, body.videoId) : null;
    if (!video) throw videoNotFound();
    if (video.status !== 'READY' || video.durationMs === null) throw notReady();
    const proxy = latestAsset(await this.videos.assetsOf(orgId, video.id), 'PROXY');
    const meta = proxy ? proxyMetaOf(proxy.meta) : null;
    if (!meta) throw notReady();
    const frame = { width: meta.width, height: meta.height };

    const bounds = checkEmoteBounds(body, { durationMs: video.durationMs, frame });
    if (bounds) throw new ClipErrorException(HttpStatus.UNPROCESSABLE_ENTITY, bounds);

    const jobId = this.jobs.newJobId();
    const row = await this.jobs.build({
      id: jobId,
      orgId,
      userId,
      kind: 'EMOTE',
      videoId: video.id,
      expiresAt: new Date(this.timing.now() + CLIP_SHORT_LIVED_MS),
      input: {
        videoId: video.id,
        platform: body.platform,
        startMs: body.startMs,
        endMs: body.endMs,
        crop: body.crop,
        frame,
        key: body.key,
        flip: body.flip,
        still: body.still,
        stillAtMs: body.still ? (body.stillAtMs ?? null) : null,
      },
    });

    let written = false;
    let job: ClipJob;
    try {
      // One press, one download, whatever the number of files.
      await this.limits.chargeDownload(orgId, jobId, userId);
      job = await this.jobsRepository.create(row);
      written = true;
    } finally {
      if (!written) await this.usage.reverseAllFor(orgId, jobId);
    }
    await this.jobs.start(job);
    this.logger.log(
      JSON.stringify({ event: 'clips.emote.started', orgId, jobId, platform: body.platform }),
    );

    const answered = await this.waitForAnswer(orgId, job);
    const finished = TERMINAL_JOB_STATUSES.has(answered.status);
    return { ...(await this.viewOf(answered)), finished };
  }

  async get(orgId: string, jobId: string): Promise<EmoteView> {
    const job = isUuid(jobId) ? await this.jobsRepository.find(orgId, jobId) : null;
    if (job?.kind !== 'EMOTE') throw emoteNotFound();
    return this.viewOf(job);
  }

  /** Looks at the job every half second until it is over or the wait is up. */
  private async waitForAnswer(orgId: string, job: ClipJob): Promise<ClipJob> {
    const deadline = this.timing.now() + this.timing.waitMs;
    let current = job;
    while (!TERMINAL_JOB_STATUSES.has(current.status) && this.timing.now() < deadline) {
      await this.timing.sleep(this.timing.pollMs);
      current = (await this.jobsRepository.find(orgId, job.id)) ?? current;
    }
    return current;
  }

  private async viewOf(job: ClipJob): Promise<EmoteView> {
    const view = toJobView(job);
    if (job.status !== 'DONE') return { job: view, emote: null };
    const parsed = emoteOutputSchema.safeParse(job.output);
    if (!parsed.success) return { job: view, emote: null };
    return { job: view, emote: await this.resultOf(job, parsed.data) };
  }

  private async resultOf(job: ClipJob, output: EmoteJobOutput): Promise<EmoteResultView> {
    const expired = job.expiresAt !== null && job.expiresAt.getTime() <= this.timing.now();
    const link = async (name: string): Promise<string | null> => {
      if (expired) return null;
      const dot = name.lastIndexOf('.');
      const key = clipKeys.exportFile(
        job.organizationId,
        job.id,
        name.slice(0, dot),
        name.slice(dot + 1) as ClipExtension,
      );
      return this.storage.signedUrl(key, {
        expiresInSeconds: EMOTE_LINK_SECONDS,
        downloadName: name,
      });
    };
    const files: EmoteFileView[] = [];
    for (const file of output.files) {
      files.push({ ...file, url: file.fits ? await link(file.name) : null });
    }
    return {
      platform: output.platform,
      files,
      zip: { ...output.zip, url: await link(output.zip.name) },
      sharp: output.sharp,
      expiresAt: job.expiresAt?.toISOString() ?? null,
      expired,
    };
  }
}

function videoNotFound(): NotFoundException {
  return new NotFoundException({
    message: CLIPS_MESSAGES.VIDEO_NOT_FOUND,
    code: 'video_not_found',
  });
}

function emoteNotFound(): NotFoundException {
  return new NotFoundException({ message: EMOTES_MESSAGES.NOT_FOUND, code: 'emote_not_found' });
}

function notReady(): ClipErrorException {
  return new ClipErrorException(HttpStatus.CONFLICT, 'video_not_ready');
}
