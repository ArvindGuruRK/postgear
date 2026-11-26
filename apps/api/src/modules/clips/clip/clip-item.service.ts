/**
 * One clip (Sprint 12, Module 05; completed in Modules 07 to 09): make it
 * from a range or the whole video, read it, fetch more sharp video for it.
 * Saving, opening, copying and deleting are `ClipEditsService`.
 *
 * - **Create** checks the video is READY and the range is a clip we allow
 *   (the engine's 3 seconds to 30 minutes, inside the video), writes the
 *   `Clip` with `createClipDocument` and, in the same transaction, a SEGMENT
 *   job that fetches the range sharp: widened by `HANDLE_MS` each side and
 *   clamped to the video, at the plan's best export height. No job is made
 *   when a stored sharp range already covers it, or when the platform copy
 *   is known to be gone (exports then use the light copy). `whole: true`
 *   (Edit Whole Video, Module 07) is the range 0 to the video's length,
 *   named after the video; a video over `CLIP_MAX_MS` is 422 `clip_too_long`.
 * - **Read** answers the clip (with its library `state`), its video, a
 *   playing address, `sharp`: `ready` (a sharp range covers it), `fetching`
 *   (a SEGMENT job is open) or `gone` (exports will use the light copy),
 *   `held` (Module 09: the sharp stretch around the clip, so the timeline
 *   hatches what lies past it), and (Module 08) the same signed light copy,
 *   filmstrip and waveform the video page reads, so the editor's dock draws
 *   pictures and sound. An AI clip (Module 16) is made with no sharp range;
 *   its first read starts the SEGMENT job (`firstOpenSegment`).
 * - **More video** (Module 09 section 3): a trim past the sharp range asks
 *   for a wider one. Nothing is fetched when a sharp range or an open job
 *   already covers it, or when the platform copy is gone; otherwise a
 *   SEGMENT job for the range widened by the handles, at most one start per
 *   clip every 10 seconds, so a burst of drags starts one job. An upload is
 *   cut from its kept original the same way: an export reads only a SEGMENT
 *   or the light copy, so answering `ready` without one would export soft.
 * - **Export** and Preview Export live in `ClipExportsService` (Module 15),
 *   which reuses `exportFileName` and the 404 helpers from here.
 */
import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  type Clip,
  ClipJobKind,
  type ClipJob,
  type ClipVideo,
  type Prisma,
  prisma,
} from '@postgear/db';
import {
  CLIP_MAX_MS,
  type ClipDocument,
  ClipRangeError,
  createClipDocument,
  formatClipLength,
  HANDLE_MS,
  heldRange,
  outputDuration,
  pickSharpSource,
  type SourceRange,
  safeParseClipDocument,
} from '@postgear/video-engine';
import { stripControlChars } from '../../../common/sanitize';
import { RedisService } from '../../redis/redis.service';
import { ClipErrorException } from '../clip-error.exception';
import { isUuid } from '../clips.ids';
import { CLIPS_MESSAGES } from '../clips.messages';
import { serializable } from '../clips.tx';
import { type ClipJobView, toJobView } from '../jobs/clip-job-view';
import { ClipJobsRepository, OPEN_JOB_STATUSES } from '../jobs/clip-jobs.repository';
import { ClipJobsService } from '../jobs/clip-jobs.service';
import { ClipLimitsGuard } from '../limits/clip-limits.guard';
import { ClipPlaybackService } from '../videos/clip-playback.service';
import { NO_VIDEO_MEDIA, signVideoMedia, type VideoMedia } from '../videos/clip-video-media';
import { type ClipVideoView, toVideoView } from '../videos/clip-video-view';
import { ClipVideosRepository } from '../videos/clip-videos.repository';
import { ClipRetentionService } from '../retention/clip-retention.service';
import { originOf } from '../videos/clip-videos.service';
import {
  type CreateClipInput,
  MAX_CLIP_TITLE_LENGTH,
  type MoreVideoInput,
} from './clip-item.schema';
import { type ClipMetaView, clipMetaView } from './clip-meta';
import { type ClipState, clipStateOf, scheduledClipIds } from './clip-state';
import { documentRange, sharpSourceFor } from './sharp-source';

/** New clips are vertical, the shape short video lives in; the editor changes it. */
const NEW_CLIP_RATIO = '9:16' as const;
const MAX_TITLE_LENGTH = MAX_CLIP_TITLE_LENGTH;

/** One More Video start per clip in this many seconds. */
export const MORE_VIDEO_EVERY_SECONDS = 10;
/** Module 16: an AI clip's first-open fetch, at most once a minute per clip. */
export const FIRST_OPEN_EVERY_SECONDS = 60;
/** The widest range one More Video asks for (before the handles): an hour. */
export const MORE_VIDEO_MAX_MS = 2 * CLIP_MAX_MS;

export type SharpState = 'ready' | 'fetching' | 'gone';

export interface ClipView {
  id: string;
  videoId: string;
  title: string;
  status: Clip['status'];
  /** Module 07: new, draft, exported, scheduled or hidden (see `clip-state.ts`). */
  state: ClipState;
  origin: Clip['origin'];
  ratio: string;
  durationMs: number;
  score: number | null;
  reasons: string[];
  revision: number;
  /** The last export drew this very revision. */
  exported: boolean;
  lastExportedRevision: number | null;
  exportedMediaId: string | null;
  /** The clip document (video ids only, never a storage key); null if it cannot be read. */
  document: ClipDocument | null;
  /**
   * Sprint 13: `Clip.meta`'s known keys (`seen`, Module 06; `followOnOpen:
   * 'speaker'`, Module 08), or null when there are none.
   */
  meta: ClipMetaView | null;
  createdAt: string;
  updatedAt: string;
}

/** The clip, its video and (Module 08) the video's signed light copy, filmstrip and waveform. */
export interface ClipDetail extends VideoMedia {
  clip: ClipView;
  /** Null when the video was deleted (its exported clips stay). */
  video: ClipVideoView | null;
  sharp: SharpState;
  /**
   * The stretch of the video held sharp around the clip, in the video's
   * time (Module 09); null when nothing sharp touches it. A trim past it is
   * what More Video fetches.
   */
  held: SourceRange | null;
}

@Injectable()
export class ClipItemService {
  private readonly logger = new Logger(ClipItemService.name);

  constructor(
    private readonly jobs: ClipJobsService,
    private readonly jobsRepository: ClipJobsRepository,
    private readonly videos: ClipVideosRepository,
    private readonly limits: ClipLimitsGuard,
    private readonly playback: ClipPlaybackService,
    private readonly redis: RedisService,
    private readonly retention: ClipRetentionService,
  ) {}

  async create(
    orgId: string,
    userId: string,
    body: CreateClipInput,
  ): Promise<{ clip: ClipView; job: ClipJobView | null }> {
    await this.limits.assertEnabled(orgId);

    const video = await this.videos.findLive(orgId, body.videoId);
    if (!video) throw videoNotFound();
    if (video.status !== 'READY' || video.durationMs === null) {
      throw new ClipErrorException(HttpStatus.CONFLICT, 'video_not_ready');
    }

    const whole = 'whole' in body;
    if (whole && video.durationMs > CLIP_MAX_MS) {
      throw new ClipErrorException(HttpStatus.UNPROCESSABLE_ENTITY, 'clip_too_long', {
        message: CLIPS_MESSAGES.CLIP_TOO_LONG,
      });
    }
    const fromMs = whole ? 0 : body.fromMs;
    const toMs = whole ? video.durationMs : body.toMs;
    if (fromMs >= toMs || toMs > video.durationMs) {
      throw new ClipErrorException(HttpStatus.UNPROCESSABLE_ENTITY, 'clip_range_invalid');
    }

    let document: ClipDocument;
    try {
      document = createClipDocument({
        videoId: video.id,
        fromMs,
        toMs,
        ratio: NEW_CLIP_RATIO,
        fps: 30,
        ...(video.width && video.height ? { sourceAspect: video.width / video.height } : {}),
      });
    } catch (error) {
      if (error instanceof ClipRangeError) {
        throw new ClipErrorException(HttpStatus.UNPROCESSABLE_ENTITY, 'clip_range_invalid');
      }
      throw error;
    }

    const clipId = randomUUID();
    const range = documentRange(document);
    const segmentJob = range ? await this.segmentJobFor(orgId, userId, video, clipId, range) : null;

    const { clip, job } = await serializable(async (tx) => {
      const clip = await tx.clip.create({
        data: {
          id: clipId,
          organizationId: orgId,
          videoId: video.id,
          title: whole ? wholeTitle(video.title) : clipTitle(video.title, fromMs),
          document: document as unknown as Prisma.InputJsonValue,
          revision: 1,
          ratio: document.canvas.ratio,
          durationMs: outputDuration(document),
          createdById: userId,
        },
      });
      const job = segmentJob ? await this.jobsRepository.create(segmentJob, tx) : null;
      return { clip, job };
    });

    // Module 19: making a clip counts as using its video (at most one write a day).
    await this.retention.touchVideo(orgId, video.id);
    if (job) await this.jobs.start(job);
    return { clip: toClipView(clip), job: job ? toJobView(job) : null };
  }

  async get(orgId: string, clipId: string): Promise<ClipDetail> {
    const clip = await this.requireClip(orgId, clipId);
    const [video, scheduled] = await Promise.all([
      prisma.clipVideo.findFirst({ where: { id: clip.videoId, organizationId: orgId } }),
      scheduledClipIds(orgId, [clip.id]),
    ]);
    const live = video && video.deletedAt === null && video.status !== 'REMOVED' ? video : null;
    const view = toClipView(clip, scheduled.has(clip.id));
    // Module 19: opening a clip in the editor counts as using its video.
    if (live) await this.retention.touchVideo(orgId, live.id);

    if (!live || !view.document) {
      return {
        clip: view,
        video: live ? toVideoView(live) : null,
        ...NO_VIDEO_MEDIA,
        sharp: 'gone',
        held: null,
      };
    }

    const assets = await this.videos.assetsOf(orgId, live.id);
    const source = sharpSourceFor(view.document, assets);
    const [media, open] = await Promise.all([
      live.status === 'READY'
        ? signVideoMedia(assets, (key) => this.playback.address(key))
        : Promise.resolve(NO_VIDEO_MEDIA),
      prisma.clipJob.count({
        where: {
          organizationId: orgId,
          clipId: clip.id,
          kind: ClipJobKind.SEGMENT,
          status: { in: [...OPEN_JOB_STATUSES] },
        },
      }),
    ]);

    let sharp: SharpState = source?.kind === 'segment' ? 'ready' : open > 0 ? 'fetching' : 'gone';
    if (
      sharp === 'gone' &&
      (clip.origin === 'AI_SIGNALS' || clip.origin === 'AI_TRANSCRIPT') &&
      live.status === 'READY'
    ) {
      // Module 16: an AI clip is made without its sharp range; the first open fetches it.
      if (await this.firstOpenSegment(orgId, clip, live, view.document, assets)) sharp = 'fetching';
    }
    const held = heldRange(documentRange(view.document), assets);
    return { clip: view, video: toVideoView(live), ...media, sharp, held };
  }

  /**
   * Starts the SEGMENT job of an AI clip that never had one (Module 16
   * section 4): only when no sharp range of the clip was ever stored, the
   * platform copy is still there, and not more than once a minute per clip
   * (the editor reads the clip often). Never fails the read: a refusal or a
   * hiccup is logged and the clip simply plays from the light copy.
   */
  private async firstOpenSegment(
    orgId: string,
    clip: Clip,
    video: ClipVideo,
    document: ClipDocument,
    assets: Awaited<ReturnType<ClipVideosRepository['assetsOf']>>,
  ): Promise<boolean> {
    if (assets.some((asset) => asset.kind === 'SEGMENT' && asset.clipId === clip.id)) return false;
    const range = documentRange(document);
    if (!range || !video.hdAvailable) return false;
    try {
      await this.limits.assertEnabled(orgId);
      const first = await this.redis.setIfAbsent(
        `clips:ai-first-open:${orgId}:${clip.id}`,
        '1',
        FIRST_OPEN_EVERY_SECONDS,
      );
      if (!first) return false;
      const row = await this.segmentRow(orgId, null, video, clip.id, range);
      if (!row) return false;
      const job = await this.jobsRepository.create(row);
      await this.jobs.start(job);
      this.logger.log(
        JSON.stringify({
          event: 'clips.clip.ai_first_open',
          orgId,
          clipId: clip.id,
          jobId: job.id,
        }),
      );
      return true;
    } catch (error) {
      this.logger.warn(
        JSON.stringify({
          event: 'clips.clip.ai_first_open_failed',
          clipId: clip.id,
          reason: error instanceof Error ? error.message : String(error),
        }),
      );
      return false;
    }
  }

  /**
   * More of the video in sharp quality for a clip whose trim went past what
   * we hold (Module 09). 202 `{ job, sharp }`; `job` is null when nothing
   * needs fetching. 409 `video_not_ready`, 422 `clip_range_invalid`, 429
   * `more_video_throttled`.
   */
  async moreVideo(
    orgId: string,
    userId: string,
    clipId: string,
    body: MoreVideoInput,
  ): Promise<{ job: ClipJobView | null; sharp: SharpState }> {
    const clip = await this.requireClip(orgId, clipId);
    await this.limits.assertEnabled(orgId);

    const video = await this.videos.findLive(orgId, clip.videoId);
    if (!video) throw videoNotFound();
    if (video.status !== 'READY' || video.durationMs === null) {
      throw new ClipErrorException(HttpStatus.CONFLICT, 'video_not_ready');
    }
    if (body.toMs > video.durationMs) {
      throw new ClipErrorException(HttpStatus.UNPROCESSABLE_ENTITY, 'clip_range_invalid');
    }
    if (body.toMs - body.fromMs > MORE_VIDEO_MAX_MS) {
      throw new ClipErrorException(HttpStatus.UNPROCESSABLE_ENTITY, 'clip_range_invalid', {
        message: CLIPS_MESSAGES.MORE_VIDEO_TOO_LONG,
      });
    }

    const range: SourceRange = { fromMs: body.fromMs, toMs: body.toMs };
    const assets = await this.videos.assetsOf(orgId, video.id);
    if (pickSharpSource(range, assets)?.sharp) return { job: null, sharp: 'ready' };

    const covering = await this.openSegmentCovering(orgId, video.id, range);
    if (covering) return { job: toJobView(covering), sharp: 'fetching' };

    const origin = originOf(await this.videos.latestImport(orgId, video.id));
    if (!origin || (origin.type === 'link' && !video.hdAvailable)) {
      return { job: null, sharp: 'gone' };
    }
    // Module 19: a wider sharp range adds to the video space, so it is checked like an import.
    await this.limits.assertStorage(orgId, estimateSegmentBytes(range));

    const first = await this.redis.setIfAbsent(
      `clips:more-video:${orgId}:${clip.id}`,
      '1',
      MORE_VIDEO_EVERY_SECONDS,
    );
    if (!first) {
      throw new ClipErrorException(HttpStatus.TOO_MANY_REQUESTS, 'more_video_throttled', {
        message: CLIPS_MESSAGES.MORE_VIDEO_THROTTLED,
      });
    }

    const row = await this.segmentRow(orgId, userId, video, clip.id, range);
    if (!row) return { job: null, sharp: 'gone' };
    const job = await this.jobsRepository.create(row);
    await this.jobs.start(job);
    const fresh = (await this.jobsRepository.find(orgId, job.id)) ?? job;
    this.logger.log(
      JSON.stringify({
        event: 'clips.clip.more_video',
        orgId,
        clipId: clip.id,
        jobId: job.id,
        fromMs: range.fromMs,
        toMs: range.toMs,
      }),
    );
    return { job: toJobView(fresh), sharp: 'fetching' };
  }

  /** Starts an export of the clip as it is now. 202 `{ job }`; 409 `export_running`. */
  /** 404 for another workspace's clip, an unknown one, or an id that is not a UUID. */
  async requireClip(orgId: string, clipId: string): Promise<Clip> {
    const clip = isUuid(clipId)
      ? await prisma.clip.findFirst({ where: { id: clipId, organizationId: orgId } })
      : null;
    if (!clip) throw clipNotFound();
    return clip;
  }

  /**
   * The SEGMENT job's row for a new clip, or null when none is needed: a
   * stored sharp range already covers it, or the platform copy is gone.
   */
  private async segmentJobFor(
    orgId: string,
    userId: string,
    video: ClipVideo,
    clipId: string,
    range: SourceRange,
  ) {
    const assets = await this.videos.assetsOf(orgId, video.id);
    if (pickSharpSource(range, assets)?.sharp) return null;
    return this.segmentRow(orgId, userId, video, clipId, range);
  }

  /**
   * A SEGMENT job row for `range` widened by the handles and clamped to the
   * video, or null when the video's origin cannot be fetched again (unknown,
   * or a link whose sharp copy is gone).
   */
  private async segmentRow(
    orgId: string,
    userId: string | null,
    video: ClipVideo,
    clipId: string,
    range: SourceRange,
  ) {
    const durationMs = video.durationMs ?? 0;
    if (durationMs <= 0) return null;

    const origin = originOf(await this.videos.latestImport(orgId, video.id));
    if (!origin) return null;
    if (origin.type === 'link' && !video.hdAvailable) return null;

    const fromMs = Math.max(0, range.fromMs - HANDLE_MS);
    const toMs = Math.min(durationMs, range.toMs + HANDLE_MS);
    if (fromMs >= toMs) return null;
    return this.jobs.build({
      id: this.jobs.newJobId(),
      orgId,
      userId,
      kind: 'SEGMENT',
      videoId: video.id,
      clipId,
      input: {
        videoId: video.id,
        clipId,
        origin,
        fromMs,
        toMs,
        maxHeight: await this.limits.bestExportHeight(orgId),
      },
    });
  }

  /** An open SEGMENT job of the video (for any clip) whose range covers `range`, if any. */
  private async openSegmentCovering(
    orgId: string,
    videoId: string,
    range: SourceRange,
  ): Promise<ClipJob | null> {
    const open = await prisma.clipJob.findMany({
      where: {
        organizationId: orgId,
        videoId,
        kind: ClipJobKind.SEGMENT,
        status: { in: [...OPEN_JOB_STATUSES] },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return (
      open.find((job) => {
        const input = segmentRangeOf(job.input);
        return input !== null && input.fromMs <= range.fromMs && input.toMs >= range.toMs;
      }) ?? null
    );
  }
}

/** The range a SEGMENT job's input fetches, or null when it does not read as one. */
function segmentRangeOf(input: unknown): SourceRange | null {
  if (typeof input !== 'object' || input === null) return null;
  const { fromMs, toMs } = input as { fromMs?: unknown; toMs?: unknown };
  return typeof fromMs === 'number' && typeof toMs === 'number' && fromMs < toMs
    ? { fromMs, toMs }
    : null;
}

/** A clip as the browser sees it; `scheduled` says whether one of its post groups still has a post waiting. */
export function toClipView(clip: Clip, scheduled = false): ClipView {
  const parsed = safeParseClipDocument(clip.document);
  return {
    id: clip.id,
    videoId: clip.videoId,
    title: clip.title,
    status: clip.status,
    state: clipStateOf(clip, scheduled),
    origin: clip.origin,
    ratio: clip.ratio,
    durationMs: clip.durationMs,
    score: clip.score,
    reasons: clip.reasons,
    revision: clip.revision,
    exported: clip.lastExportedRevision !== null && clip.lastExportedRevision === clip.revision,
    lastExportedRevision: clip.lastExportedRevision,
    exportedMediaId: clip.exportedMediaId,
    document: parsed.ok ? parsed.doc : null,
    meta: clipMetaView(clip.meta),
    createdAt: clip.createdAt.toISOString(),
    updatedAt: clip.updatedAt.toISOString(),
  };
}

/** "Team Talk (1:23)": the video's name and where the clip starts. */
export function clipTitle(videoTitle: string, fromMs: number): string {
  const base =
    videoTitle
      .trim()
      .slice(0, MAX_TITLE_LENGTH - 12)
      .trim() || 'Clip';
  return `${base} (${formatClipLength(fromMs)})`;
}

/** Edit Whole Video: the clip is named after its video. */
export function wholeTitle(videoTitle: string): string {
  return (
    stripControlChars(videoTitle).replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE_LENGTH).trim() ||
    'Clip'
  );
}

/**
 * The name an export gets in Media: the clip's title without characters a
 * file system refuses, never starting with a dot, ending in `.mp4`.
 */
export function exportFileName(title: string): string {
  const base = stripControlChars(title)
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 120)
    .trim();
  return `${base || 'Clip'}.mp4`;
}

export function clipNotFound(): NotFoundException {
  return new NotFoundException({ message: CLIPS_MESSAGES.CLIP_NOT_FOUND, code: 'clip_not_found' });
}

export function videoNotFound(): NotFoundException {
  return new NotFoundException({
    message: CLIPS_MESSAGES.VIDEO_NOT_FOUND,
    code: 'video_not_found',
  });
}

/** Stored bits a second of a sharp range (fetched at the best export height, up to 1080p). */
const SEGMENT_BITS_PER_SECOND = 5_000_000;

/** Module 19: what a sharp range of `range` (with its handles) adds to the video space, at most. */
export function estimateSegmentBytes(range: SourceRange): number {
  const seconds = Math.max(0, range.toMs - range.fromMs + 2 * HANDLE_MS) / 1000;
  return Math.ceil((seconds * SEGMENT_BITS_PER_SECOND) / 8);
}
