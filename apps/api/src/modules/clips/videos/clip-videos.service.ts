/**
 * Videos (Sprint 12, Module 04): a link becomes an import, and the reads,
 * retry, cancel and delete around it. Uploads are `ClipUploadsService`.
 *
 * ## Import, in order
 *
 * 1. **Probe again on the server** (`CLIP_LINK_PROBER`): the browser's
 *    `LinkInfo` is never trusted. The probe throws our refusal for a bad link.
 * 2. **The rights tick** (422 `rights_required` without `rightsConfirmed: true`).
 * 3. **Dedup, early**: a live video with the same platform and id answers 200
 *    `{ existing: true }` and nothing is checked or charged.
 * 4. **The limits** (`ClipLimitsGuard`): the switch, the length, the space.
 * 5. **The charge**: the job id is made first, then the import minutes are
 *    charged with `clips.import:<jobId>`.
 * 6. **The rows**, in one serializable transaction that looks for the video
 *    again (two pastes at once: one creates, the other answers `existing`).
 *    The charge is reversed in a `finally` whenever the rows were not
 *    written, so a lost race or a database error never keeps the minutes.
 * 7. **Start** the job (it may wait its turn under the import cap).
 *
 * Retry makes a new job and so a new charge key; the rights record is kept.
 * A delete never gives import minutes back (that would allow an import and
 * delete loop); a cancel or a failure does, through the job.
 */
import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { type ClipJob, ClipJobKind, type ClipVideo, Prisma } from '@postgear/db';
import { clipKeys, type PrivateStorage } from '@postgear/storage';
import {
  type HighlightReason,
  isHighlightReason,
  type LinkRef,
  MAX_REPLAYED_POINTS,
  type ReplayedPoint,
  type VideoOrigin,
  videoOriginSchema,
} from '@postgear/video-engine';
import { stripControlChars } from '../../../common/sanitize';
import { UsageService } from '../../entitlements/usage.service';
import { PRIVATE_STORAGE } from '../../media/storage/storage.interface';
import { type ClipPublishedPost, publishedPostsOf } from '../clip/clip-posts.service';
import { type ClipState, clipStateOf, scheduledClipIds } from '../clip/clip-state';
import { exportProgressOf } from '../clip/export-progress';
import { storedDocumentRange } from '../clip/sharp-source';
import { ClipErrorException } from '../clip-error.exception';
import { isUuid } from '../clips.ids';
import { CLIPS_MESSAGES } from '../clips.messages';
import { serializable } from '../clips.tx';
import { type HighlightsView, highlightsOf } from '../highlights/clip-highlights.view';
import { type ClipJobView, toJobView } from '../jobs/clip-job-view';
import { ClipJobsRepository } from '../jobs/clip-jobs.repository';
import { ClipJobsService } from '../jobs/clip-jobs.service';
import { ClipLimitsGuard, estimateImport } from '../limits/clip-limits.guard';
import { CLIP_LINK_PROBER, type ClipLinkProber } from '../links/clip-links.types';
import { ClipRetentionService } from '../retention/clip-retention.service';
import { ClipPlaybackService } from './clip-playback.service';
import { CLIP_RIGHTS_TEXT_VERSION } from './clip-rights';
import { ClipSampleLink } from './clip-sample';
import { NO_VIDEO_MEDIA, signVideoMedia, type VideoMedia } from './clip-video-media';
import { type ClipVideoView, KIND_ENUM, PLATFORM_ENUM, toVideoView } from './clip-video-view';
import {
  type ClipSummaryRow,
  ClipVideosRepository,
  type SizeCursor,
  type VideoCursor,
  type VideoWithCard,
} from './clip-videos.repository';
import {
  type ImportVideoInput,
  type ListVideosQuery,
  VIDEOS_PAGE_SIZE,
} from './clip-videos.schema';

const MAX_TITLE_LENGTH = 300;
const MAX_CHANNEL_LENGTH = 120;

/** A video with its newest import job, as a card shows it. */
export interface ClipVideoCard {
  video: ClipVideoView;
  /** The newest import, so an IMPORTING card can show its step and follow it live. */
  job: ClipJobView | null;
  /** Module 06: the video's clips that are not hidden (what the Clips tab's All counts). */
  clipCount: number;
  /** Module 19: bytes the video keeps (every file but Preview Exports), on list cards. */
  storedBytes?: number;
}

/** A clip on its video's page: never the document. */
export interface ClipSummaryView {
  id: string;
  /** Module 07: new, draft, exported, scheduled or hidden (see `clip/clip-state.ts`). */
  state: ClipState;
  /** Module 07: the part of the video the clip plays, in the video's time; null if unreadable. */
  range: { fromMs: number; toMs: number } | null;
  title: string;
  status: ClipSummaryRow['status'];
  origin: ClipSummaryRow['origin'];
  ratio: string;
  durationMs: number;
  score: number | null;
  /** Module 16: why an AI clip was picked, as reason codes (best first, up to three). */
  reasons: HighlightReason[];
  revision: number;
  /** The last export drew this very revision. */
  exported: boolean;
  exportedMediaId: string | null;
  /**
   * Module 15: the progress (0 to 100) of the clip's newest QUEUED or RUNNING
   * export (Preview Export left out), for the card's ring; null when none is open.
   */
  exportProgress: number | null;
  createdAt: string;
  updatedAt: string;
}

/** The video, its signed light copy, filmstrip and waveform (`VideoMedia`), its import and clips. */
export interface ClipVideoDetail extends VideoMedia {
  video: ClipVideoView;
  job: ClipJobView | null;
  /** Each with the live posts it went out in (Module 17, View Post). */
  clips: (ClipSummaryView & { posts: ClipPublishedPost[] })[];
  /** Module 16: Find Clips' price and the latest run. */
  highlights: HighlightsView;
}

export interface ImportOutcome {
  video: ClipVideoView;
  job: ClipJobView | null;
  existing: boolean;
  /** Module 06: "You already have the sample video." on a repeated Try A Sample. */
  message?: string;
}

@Injectable()
export class ClipVideosService {
  private readonly logger = new Logger(ClipVideosService.name);

  constructor(
    private readonly repository: ClipVideosRepository,
    private readonly jobs: ClipJobsService,
    private readonly jobsRepository: ClipJobsRepository,
    private readonly limits: ClipLimitsGuard,
    private readonly usage: UsageService,
    private readonly playback: ClipPlaybackService,
    @Inject(CLIP_LINK_PROBER) private readonly prober: ClipLinkProber,
    @Inject(PRIVATE_STORAGE) private readonly storage: PrivateStorage,
    private readonly sample: ClipSampleLink,
    private readonly retention: ClipRetentionService,
  ) {}

  // ---- Import ----------------------------------------------------------------

  async importLink(orgId: string, userId: string, body: ImportVideoInput): Promise<ImportOutcome> {
    // Try A Sample: our own video, so no rights tick; every limit and the charge still apply.
    const sample = 'sample' in body;
    const url = sample ? this.sample.url : body.url;
    if (!url) {
      throw new NotFoundException({
        message: CLIPS_MESSAGES.SAMPLE_UNAVAILABLE,
        code: 'sample_unavailable',
      });
    }

    const probe = await this.prober.probe(orgId, url);
    if (!sample && body.rightsConfirmed !== true) {
      throw new ClipErrorException(HttpStatus.UNPROCESSABLE_ENTITY, 'rights_required');
    }
    const existing = (video: ClipVideo): Promise<ImportOutcome> =>
      this.videoView(video).then((view) => ({
        video: view,
        job: null,
        existing: true,
        ...(sample ? { message: CLIPS_MESSAGES.SAMPLE_EXISTS } : {}),
      }));

    const platform = PLATFORM_ENUM[probe.link.platform];
    const already = await this.repository.findLiveByLink(orgId, platform, probe.link.externalId);
    if (already) return existing(already);

    const durationMs = Math.max(0, Math.round(probe.info.durationMs));
    const estimate = estimateImport(probe.info);
    await this.limits.checkLinkImport(orgId, durationMs, estimate.storedBytes);
    const limits = await this.limits.importLimits(orgId);

    const videoId = randomUUID();
    const jobId = this.jobs.newJobId();
    const jobRow = await this.jobs.build({
      id: jobId,
      orgId,
      userId,
      kind: 'IMPORT',
      videoId,
      input: {
        videoId,
        origin: { type: 'link', link: linkRefOf(probe.link) },
        limits,
        expectedBytes: estimate.expectedBytes,
        ...replayedOf(probe.info.replayed),
      },
    });

    let written = false;
    try {
      await this.limits.chargeImport(orgId, jobId, durationMs);

      const outcome = await serializable(async (tx) => {
        const found = await this.repository.findLiveByLink(
          orgId,
          platform,
          probe.link.externalId,
          tx,
        );
        if (found) return { kind: 'existing' as const, video: found };

        const now = new Date();
        const video = await tx.clipVideo.create({
          data: {
            id: videoId,
            organizationId: orgId,
            platform,
            kind: KIND_ENUM[probe.link.kind],
            externalId: probe.link.externalId,
            canonicalUrl: probe.link.canonicalUrl,
            title: cleanText(probe.info.title, MAX_TITLE_LENGTH) || 'Untitled Video',
            channelName: probe.info.channelName
              ? cleanText(probe.info.channelName, MAX_CHANNEL_LENGTH) || null
              : null,
            durationMs,
            // The sample is ours: nobody ticked the box, so no rights record is claimed.
            rightsConfirmedAt: sample ? null : now,
            rightsConfirmedById: sample ? null : userId,
            rightsTextVersion: sample ? null : CLIP_RIGHTS_TEXT_VERSION,
            createdById: userId,
          },
        });
        const job = await this.jobsRepository.create(jobRow, tx);
        return { kind: 'created' as const, video, job };
      });

      if (outcome.kind === 'existing') return existing(outcome.video);
      written = true;

      await this.jobs.start(outcome.job);
      const job = (await this.jobsRepository.find(orgId, outcome.job.id)) ?? outcome.job;
      return { video: await this.videoView(outcome.video), job: toJobView(job), existing: false };
    } finally {
      if (!written) {
        // Not charged (refused) or charged for rows that never landed: give it back.
        await this.usage.reverseAllFor(orgId, jobId);
      }
    }
  }

  // ---- Reads -------------------------------------------------------------------

  /**
   * Newest first (or oldest, or (Module 19) biggest first), 24 a page, with a
   * cursor for the next page. Each card carries the bytes its video keeps.
   */
  async list(
    orgId: string,
    query: ListVideosQuery,
  ): Promise<{ videos: ClipVideoCard[]; nextCursor: string | null; total: number }> {
    if (query.sort === 'size') return this.listBySize(orgId, query.cursor ?? null);
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    const [rows, total] = await Promise.all([
      this.repository.list(orgId, { sort: query.sort, cursor, take: VIDEOS_PAGE_SIZE + 1 }),
      this.repository.countLive(orgId),
    ]);
    const page = rows.slice(0, VIDEOS_PAGE_SIZE);
    const last = page[page.length - 1];
    const sizes = await this.repository.storedBytesOf(
      orgId,
      page.map((row) => row.id),
    );
    return {
      videos: await Promise.all(page.map((row) => this.cardView(row, sizes.get(row.id) ?? 0))),
      nextCursor: rows.length > VIDEOS_PAGE_SIZE && last ? encodeCursor(last) : null,
      total,
    };
  }

  /** Module 19: biggest first, for See What Uses Space. */
  private async listBySize(
    orgId: string,
    rawCursor: string | null,
  ): Promise<{ videos: ClipVideoCard[]; nextCursor: string | null; total: number }> {
    const cursor = rawCursor ? decodeSizeCursor(rawCursor) : null;
    const [ids, total] = await Promise.all([
      this.repository.listIdsBySize(orgId, { cursor, take: VIDEOS_PAGE_SIZE + 1 }),
      this.repository.countLive(orgId),
    ]);
    const page = ids.slice(0, VIDEOS_PAGE_SIZE);
    const rows = await this.repository.cardsByIds(
      orgId,
      page.map((one) => one.id),
    );
    const sizes = new Map(page.map((one) => [one.id, one.bytes]));
    const last = page[page.length - 1];
    return {
      videos: await Promise.all(rows.map((row) => this.cardView(row, sizes.get(row.id) ?? 0))),
      nextCursor: ids.length > VIDEOS_PAGE_SIZE && last ? encodeSizeCursor(last) : null,
      total,
    };
  }

  /**
   * One video with its signed addresses, its newest import and its clips.
   * Opening it counts as using it (Module 19): its date moves forward, at
   * most once a day.
   */
  async get(orgId: string, videoId: string): Promise<ClipVideoDetail> {
    let row = await this.requireCard(orgId, videoId);
    if (await this.retention.touchVideo(orgId, videoId))
      row = await this.requireCard(orgId, videoId);
    const [assets, clips] = await Promise.all([
      this.repository.assetsOf(orgId, videoId),
      this.repository.clipsOf(orgId, videoId),
    ]);
    const ready = row.status === 'READY';

    const clipIds = clips.map((clip) => clip.id);
    const [card, media, scheduled, exporting, highlights, published] = await Promise.all([
      this.cardView(row),
      ready
        ? signVideoMedia(assets, (key) => this.playback.address(key))
        : Promise.resolve(NO_VIDEO_MEDIA),
      scheduledClipIds(orgId, clipIds),
      exportProgressOf(orgId, clipIds),
      highlightsOf(orgId, row),
      publishedPostsOf(orgId, clipIds),
    ]);

    return {
      video: card.video,
      ...media,
      job: card.job,
      clips: clips.map((clip) => ({
        ...toClipSummary(clip, scheduled.has(clip.id), exporting.get(clip.id) ?? null),
        posts: published.get(clip.id) ?? [],
      })),
      highlights,
    };
  }

  // ---- Actions -------------------------------------------------------------------

  /**
   * Tries a FAILED video again: a new job (so a new charge key), the same
   * origin as the last attempt, the rights record kept. The plan is read
   * again, since it may have changed since the first try. 409 for any other
   * state, including a second click that lost the race.
   */
  async retry(
    orgId: string,
    userId: string,
    videoId: string,
  ): Promise<{ video: ClipVideoView; job: ClipJobView }> {
    const video = await this.requireLive(orgId, videoId);
    if (video.status !== 'FAILED') throw this.notFailed();

    const previous = await this.repository.latestImport(orgId, videoId);
    const origin = originOf(previous);
    if (!origin) {
      this.logger.error(JSON.stringify({ event: 'clips.video.retry_no_origin', videoId }));
      throw new ClipErrorException(HttpStatus.UNPROCESSABLE_ENTITY, 'tool_failed');
    }

    const isLink = origin.type === 'link';
    await this.limits.assertEnabled(orgId);
    await this.limits.assertLength(orgId, video.durationMs);
    await this.limits.assertStorage(
      orgId,
      estimateImport({ durationMs: video.durationMs ?? 0, formats: [] }).storedBytes,
    );
    const limits = await this.limits.importLimits(orgId);

    const jobId = this.jobs.newJobId();
    const jobRow = await this.jobs.build({
      id: jobId,
      orgId,
      userId,
      kind: 'IMPORT',
      videoId,
      input: { videoId, origin, limits, expectedBytes: null },
    });

    let written = false;
    try {
      // A link's minutes are charged now; an upload's by the worker once its length is read.
      if (isLink && video.durationMs !== null) {
        await this.limits.chargeImport(orgId, jobId, video.durationMs);
      }

      const job = await serializable(async (tx) => {
        const moved = await tx.clipVideo.updateMany({
          where: { id: videoId, organizationId: orgId, status: 'FAILED', deletedAt: null },
          data: { status: 'IMPORTING', error: Prisma.DbNull },
        });
        if (moved.count === 0) return null;
        return this.jobsRepository.create(jobRow, tx);
      });
      if (!job) throw this.notFailed();
      written = true;

      await this.jobs.start(job);
      const fresh = (await this.jobsRepository.find(orgId, job.id)) ?? job;
      return {
        video: await this.videoView(await this.requireLive(orgId, videoId)),
        job: toJobView(fresh),
      };
    } finally {
      if (!written) await this.usage.reverseAllFor(orgId, jobId);
    }
  }

  /**
   * Stops a video that is still coming in, through its import job. A job
   * that never started is cancelled here (charge given back, row and files
   * removed); a running one is signalled and its workflow does the same.
   */
  async cancel(
    orgId: string,
    videoId: string,
  ): Promise<{ message: string; job: ClipJobView | null }> {
    const video = await this.requireLive(orgId, videoId);
    if (video.status !== 'IMPORTING') {
      throw new ConflictException({
        message: CLIPS_MESSAGES.VIDEO_NOT_IMPORTING,
        code: 'video_not_importing',
      });
    }

    const open = (await this.jobsRepository.openForVideo(orgId, videoId)).find(
      (job) => job.kind === ClipJobKind.IMPORT,
    );
    if (!open) {
      // Nothing is running for it (a lost row): remove it as a cancel would.
      await this.jobsRepository.removeCancelledVideo(orgId, videoId, new Date());
      await this.deleteFiles(orgId, videoId);
      return { message: CLIPS_MESSAGES.VIDEO_CANCELLED, job: null };
    }
    return { message: CLIPS_MESSAGES.VIDEO_CANCELLED, job: await this.jobs.cancel(orgId, open.id) };
  }

  /**
   * Deletes a video through the one removal path (Module 19, `removeVideo`):
   * its open jobs and its clips' are stopped, the row is kept with its rights
   * record, its files and unexported clips go, exported clips are marked
   * removed with their Media untouched. Import minutes already spent are
   * not given back.
   */
  async remove(orgId: string, videoId: string): Promise<{ message: string }> {
    await this.requireLive(orgId, videoId);
    await this.retention.removeVideo(orgId, videoId, 'deleted');
    return { message: CLIPS_MESSAGES.VIDEO_DELETED };
  }

  // ---- Shared ------------------------------------------------------------------

  /** The view of a video row, with its poster address when it has one. */
  async videoView(video: ClipVideo): Promise<ClipVideoView> {
    const card = await this.repository.findCard(video.organizationId, video.id);
    return card ? (await this.cardView(card)).video : toVideoView(video);
  }

  async cardView(row: VideoWithCard, storedBytes?: number): Promise<ClipVideoCard> {
    const { assets, jobs, _count, ...video } = row;
    const poster = assets[0];
    const posterAddress = poster ? await this.playback.address(poster.key) : null;
    const job = jobs[0];
    return {
      video: toVideoView(video, posterAddress?.url ?? null),
      job: job ? toJobView(job) : null,
      clipCount: _count?.clips ?? 0,
      ...(storedBytes === undefined ? {} : { storedBytes }),
    };
  }

  async requireLive(orgId: string, videoId: string): Promise<ClipVideo> {
    const video = isUuid(videoId) ? await this.repository.findLive(orgId, videoId) : null;
    if (!video) throw notFound();
    return video;
  }

  private async requireCard(orgId: string, videoId: string): Promise<VideoWithCard> {
    const card = isUuid(videoId) ? await this.repository.findCard(orgId, videoId) : null;
    if (!card) throw notFound();
    return card;
  }

  private notFailed(): ConflictException {
    return new ConflictException({
      message: CLIPS_MESSAGES.VIDEO_NOT_FAILED,
      code: 'video_not_failed',
    });
  }

  /** Best-effort: a storage hiccup is logged and left to the cleanup sweep. */
  private async deleteFiles(orgId: string, videoId: string): Promise<void> {
    try {
      await this.storage.deletePrefix(clipKeys.videoPrefix(orgId, videoId));
    } catch (error) {
      this.logger.warn(
        JSON.stringify({
          event: 'clips.video.files_left',
          videoId,
          reason: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }
}

function notFound(): NotFoundException {
  return new NotFoundException({
    message: CLIPS_MESSAGES.VIDEO_NOT_FOUND,
    code: 'video_not_found',
  });
}

/** The recognised link, field by field: nothing else from the probe goes into a job. */
function linkRefOf(link: LinkRef): LinkRef {
  return {
    platform: link.platform,
    kind: link.kind,
    externalId: link.externalId,
    canonicalUrl: link.canonicalUrl,
    ...(link.channel ? { channel: link.channel } : {}),
  };
}

/**
 * Module 16: YouTube's heat map from the probe, cleaned to what the import
 * input allows (whole milliseconds, values 0 to 1, at most
 * `MAX_REPLAYED_POINTS`), or nothing when the platform gave none.
 */
export function replayedOf(points: readonly ReplayedPoint[] | undefined): {
  replayed?: ReplayedPoint[];
} {
  if (!points || points.length === 0) return {};
  const replayed = points
    .map((point) => ({
      startMs: Math.max(0, Math.round(point.startMs)),
      endMs: Math.max(0, Math.round(point.endMs)),
      value: Math.min(1, Math.max(0, point.value)),
    }))
    .filter((point) => Number.isFinite(point.value) && point.startMs < point.endMs)
    .slice(0, MAX_REPLAYED_POINTS);
  return replayed.length > 0 ? { replayed } : {};
}

/** Where the last attempt read the video from, re-checked with the engine's schema. */
export function originOf(job: Pick<ClipJob, 'input'> | null): VideoOrigin | null {
  if (!job || typeof job.input !== 'object' || job.input === null) return null;
  const parsed = videoOriginSchema.safeParse((job.input as { origin?: unknown }).origin);
  return parsed.success ? parsed.data : null;
}

/** Text from a platform: control characters out, whitespace collapsed, capped. */
function cleanText(value: string, max: number): string {
  return stripControlChars(value).replace(/\s+/g, ' ').trim().slice(0, max);
}

/**
 * A clip's summary; `scheduled` says whether one of its post groups still has
 * a post waiting, `exportProgress` how far its open export is (Module 15).
 */
export function toClipSummary(
  row: ClipSummaryRow,
  scheduled = false,
  exportProgress: number | null = null,
): ClipSummaryView {
  return {
    id: row.id,
    state: clipStateOf(row, scheduled),
    range: storedDocumentRange(row.document),
    title: row.title,
    status: row.status,
    origin: row.origin,
    ratio: row.ratio,
    durationMs: row.durationMs,
    score: row.score,
    reasons: row.reasons.filter(isHighlightReason),
    revision: row.revision,
    exported: row.lastExportedRevision !== null && row.lastExportedRevision === row.revision,
    exportedMediaId: row.exportedMediaId,
    exportProgress,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** `createdAt|id` as base64url, so the next page starts exactly after the last row. */
export function encodeCursor(row: VideoCursor): string {
  return Buffer.from(`${row.createdAt.toISOString()}|${row.id}`, 'utf8').toString('base64url');
}

/** Module 19: a biggest-first page's cursor, `z:<bytes>|<id>` (never mistaken for a date one). */
export function encodeSizeCursor(row: SizeCursor): string {
  return Buffer.from(`z:${row.bytes}|${row.id}`, 'utf8').toString('base64url');
}

export function decodeSizeCursor(value: string): SizeCursor | null {
  const raw = Buffer.from(value, 'base64url').toString('utf8');
  const match = /^z:(\d{1,18})\|(.+)$/.exec(raw);
  if (!match?.[1] || !isUuid(match[2])) return null;
  return { bytes: Number(match[1]), id: match[2] };
}

export function decodeCursor(value: string): VideoCursor | null {
  const [iso, id] = Buffer.from(value, 'base64url').toString('utf8').split('|');
  const createdAt = iso ? new Date(iso) : null;
  if (!createdAt || Number.isNaN(createdAt.getTime()) || !isUuid(id)) return null;
  return { createdAt, id };
}
