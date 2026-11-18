/**
 * One clip (Sprint 12, Module 05; Module 07 completes the clip routes):
 * make it from a range, read it, export it.
 *
 * - **Create** checks the video is READY and the range is a clip we allow
 *   (the engine's 3 seconds to 30 minutes, inside the video), writes the
 *   `Clip` with `createClipDocument` and, in the same transaction, a SEGMENT
 *   job that fetches the range sharp: widened by `HANDLE_MS` each side and
 *   clamped to the video, at the plan's best export height. No job is made
 *   when a stored sharp range already covers it, or when the platform copy
 *   is known to be gone (exports then use the light copy).
 * - **Read** answers the clip, its video, a playing address and `sharp`:
 *   `ready` (a sharp range covers it), `fetching` (its SEGMENT job is open)
 *   or `gone` (exports will use the light copy).
 * - **Export** freezes the document and its revision into a RENDER job. A
 *   second export of the same clip while one is QUEUED or RUNNING is 409
 *   `export_running`, decided inside a serializable transaction so two
 *   clicks never both pass. Every quality is allowed here; plan locks and
 *   the mark's dialog are Module 15 (`watermark` already follows the plan).
 */
import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import {
  type Clip,
  ClipJobKind,
  ClipJobStatus,
  type ClipVideo,
  type Prisma,
  prisma,
} from '@postgear/db';
import {
  type ClipDocument,
  ClipRangeError,
  createClipDocument,
  formatClipLength,
  HANDLE_MS,
  outputDuration,
  safeParseClipDocument,
} from '@postgear/video-engine';
import { stripControlChars } from '../../../common/sanitize';
import { EntitlementResolver } from '../../entitlements/entitlement-resolver';
import { ClipErrorException } from '../clip-error.exception';
import { isUuid } from '../clips.ids';
import { CLIPS_MESSAGES } from '../clips.messages';
import { serializable } from '../clips.tx';
import { type ClipJobView, toJobView } from '../jobs/clip-job-view';
import { ClipJobsRepository, OPEN_JOB_STATUSES } from '../jobs/clip-jobs.repository';
import { ClipJobsService } from '../jobs/clip-jobs.service';
import { ClipLimitsGuard } from '../limits/clip-limits.guard';
import { ClipPlaybackService, type SignedAddress } from '../videos/clip-playback.service';
import { type ClipVideoView, toVideoView } from '../videos/clip-video-view';
import { ClipVideosRepository } from '../videos/clip-videos.repository';
import { originOf } from '../videos/clip-videos.service';
import type { CreateClipInput, ExportClipInput } from './clip-item.schema';
import { documentRange, sharpSourceFor } from './sharp-source';

/** New clips are vertical, the shape short video lives in; the editor changes it. */
const NEW_CLIP_RATIO = '9:16' as const;
const MAX_TITLE_LENGTH = 200;

export type SharpState = 'ready' | 'fetching' | 'gone';

export interface ClipView {
  id: string;
  videoId: string;
  title: string;
  status: Clip['status'];
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
  createdAt: string;
  updatedAt: string;
}

export interface ClipDetail {
  clip: ClipView;
  /** Null when the video was deleted (its exported clips stay). */
  video: ClipVideoView | null;
  playback: SignedAddress | null;
  sharp: SharpState;
}

@Injectable()
export class ClipItemService {
  constructor(
    private readonly jobs: ClipJobsService,
    private readonly jobsRepository: ClipJobsRepository,
    private readonly videos: ClipVideosRepository,
    private readonly limits: ClipLimitsGuard,
    private readonly resolver: EntitlementResolver,
    private readonly playback: ClipPlaybackService,
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
    if (body.fromMs >= body.toMs || body.toMs > video.durationMs) {
      throw new ClipErrorException(HttpStatus.UNPROCESSABLE_ENTITY, 'clip_range_invalid');
    }

    let document: ClipDocument;
    try {
      document = createClipDocument({
        videoId: video.id,
        fromMs: body.fromMs,
        toMs: body.toMs,
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
    const segmentJob = await this.segmentJobFor(orgId, userId, video, clipId, document);

    const { clip, job } = await serializable(async (tx) => {
      const clip = await tx.clip.create({
        data: {
          id: clipId,
          organizationId: orgId,
          videoId: video.id,
          title: clipTitle(video.title, body.fromMs),
          document: document as unknown as Prisma.InputJsonValue,
          revision: 1,
          ratio: document.canvas.ratio,
          durationMs: outputDuration(document),
          createdById: userId,
        },
      });
      const job = segmentJob ? await this.jobsRepository.create(segmentJob, tx) : null;
      await tx.clipVideo.updateMany({
        where: { id: video.id, organizationId: orgId },
        data: { lastUsedAt: new Date() },
      });
      return { clip, job };
    });

    if (job) await this.jobs.start(job);
    return { clip: toClipView(clip), job: job ? toJobView(job) : null };
  }

  async get(orgId: string, clipId: string): Promise<ClipDetail> {
    const clip = await this.requireClip(orgId, clipId);
    const video = await prisma.clipVideo.findFirst({
      where: { id: clip.videoId, organizationId: orgId },
    });
    const live = video && video.deletedAt === null && video.status !== 'REMOVED' ? video : null;
    const view = toClipView(clip);

    if (!live || !view.document) {
      return { clip: view, video: live ? toVideoView(live) : null, playback: null, sharp: 'gone' };
    }

    const assets = await this.videos.assetsOf(orgId, live.id);
    const proxy = sharpSourceFor({ segments: [] }, assets);
    const source = sharpSourceFor(view.document, assets);
    const [playback, open] = await Promise.all([
      proxy ? this.playback.address(proxy.key) : Promise.resolve(null),
      prisma.clipJob.count({
        where: {
          organizationId: orgId,
          clipId: clip.id,
          kind: ClipJobKind.SEGMENT,
          status: { in: [...OPEN_JOB_STATUSES] },
        },
      }),
    ]);

    const sharp: SharpState = source?.kind === 'segment' ? 'ready' : open > 0 ? 'fetching' : 'gone';
    return { clip: view, video: toVideoView(live), playback, sharp };
  }

  /** Starts an export of the clip as it is now. 202 `{ job }`; 409 `export_running`. */
  async export(
    orgId: string,
    userId: string,
    clipId: string,
    body: ExportClipInput,
  ): Promise<{ job: ClipJobView }> {
    if (!isUuid(clipId)) throw clipNotFound();
    await this.limits.assertEnabled(orgId);
    const watermark = await this.resolver.get(orgId, 'clips.export_watermark');

    const job = await serializable(async (tx) => {
      const clip = await tx.clip.findFirst({ where: { id: clipId, organizationId: orgId } });
      if (!clip) throw clipNotFound();
      const video = await this.videos.findLive(orgId, clip.videoId, tx);
      if (!video) throw videoNotFound();
      if (video.status !== 'READY')
        throw new ClipErrorException(HttpStatus.CONFLICT, 'video_not_ready');

      const parsed = safeParseClipDocument(clip.document);
      if (!parsed.ok) {
        throw new ClipErrorException(HttpStatus.UNPROCESSABLE_ENTITY, 'tool_failed', {
          message: CLIPS_MESSAGES.CLIP_UNREADABLE,
        });
      }

      const running = await tx.clipJob.count({
        where: {
          organizationId: orgId,
          clipId: clip.id,
          kind: ClipJobKind.RENDER,
          status: { in: [ClipJobStatus.QUEUED, ClipJobStatus.RUNNING] },
        },
      });
      if (running > 0) throw new ClipErrorException(HttpStatus.CONFLICT, 'export_running');

      const row = await this.jobs.build({
        id: this.jobs.newJobId(),
        orgId,
        userId,
        kind: 'RENDER',
        videoId: video.id,
        clipId: clip.id,
        input: {
          clipId: clip.id,
          videoId: video.id,
          revision: clip.revision,
          document: parsed.doc,
          quality: body.quality,
          proof: false,
          watermark,
          name: exportFileName(clip.title),
        },
      });
      return this.jobsRepository.create(row, tx);
    });

    await this.jobs.start(job);
    const fresh = (await this.jobsRepository.find(orgId, job.id)) ?? job;
    return { job: toJobView(fresh) };
  }

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
    document: ClipDocument,
  ) {
    const range = documentRange(document);
    const durationMs = video.durationMs ?? 0;
    if (!range || durationMs <= 0) return null;

    const assets = await this.videos.assetsOf(orgId, video.id);
    if (sharpSourceFor(document, assets)?.kind === 'segment') return null;

    const origin = originOf(await this.videos.latestImport(orgId, video.id));
    if (!origin) return null;
    if (origin.type === 'link' && !video.hdAvailable) return null;

    const fromMs = Math.max(0, range.fromMs - HANDLE_MS);
    const toMs = Math.min(durationMs, range.toMs + HANDLE_MS);
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
}

export function toClipView(clip: Clip): ClipView {
  const parsed = safeParseClipDocument(clip.document);
  return {
    id: clip.id,
    videoId: clip.videoId,
    title: clip.title,
    status: clip.status,
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

function clipNotFound(): NotFoundException {
  return new NotFoundException({ message: CLIPS_MESSAGES.CLIP_NOT_FOUND, code: 'clip_not_found' });
}

function videoNotFound(): NotFoundException {
  return new NotFoundException({
    message: CLIPS_MESSAGES.VIDEO_NOT_FOUND,
    code: 'video_not_found',
  });
}
