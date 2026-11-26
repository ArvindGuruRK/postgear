/**
 * Where faces are in a clip's stretch (Sprint 13, Module 07). Free: no AI
 * minutes, no charge.
 *
 * - `ensure` (`POST /clips/:clipId/faces`): the stretch the clip plays, from
 *   its first source moment to its last, widened by Sprint 12's handles.
 *   A face file of the video that already covers it is reused (`ready`, no
 *   job); an open FACES job of the video that covers it is joined; otherwise
 *   a FACES job is written and started (`running`).
 * - `read` (`GET /clips/:clipId/faces`): a short signed address for the
 *   covering face file and its `meta`, or `{ status: 'running' | 'none' }`.
 *
 * Face files belong to the video (assets under its key prefix), so a second
 * clip of the same stretch reads the same file and Sprint 12's `removeVideo`
 * deletes them with the video. The file holds boxes and times only; the
 * browser turns them into people. Logs carry ids and counts, never a box.
 */
import { HttpStatus, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { type ClipAsset, type ClipJob, ClipAssetKind, ClipJobKind, prisma } from '@postgear/db';
import type { PrivateStorage } from '@postgear/storage';
import {
  clipSourceRanges,
  type FaceTracksAssetMeta,
  faceFileCovers,
  facesInputSchema,
  HANDLE_MS,
  readFaceTracksAssetMeta,
  safeParseClipDocument,
} from '@postgear/video-engine';
import { PRIVATE_STORAGE } from '../../media/storage/storage.interface';
import { ClipItemService } from '../clip/clip-item.service';
import { ClipErrorException } from '../clip-error.exception';
import { CLIPS_MESSAGES } from '../clips.messages';
import { type ClipsTx, serializable } from '../clips.tx';
import { type ClipJobView, toJobView } from '../jobs/clip-job-view';
import { ClipJobsRepository, OPEN_JOB_STATUSES } from '../jobs/clip-jobs.repository';
import { ClipJobsService } from '../jobs/clip-jobs.service';
import { ClipLimitsGuard } from '../limits/clip-limits.guard';
import { MediaServiceProbe } from '../status/media-service.probe';
import { ClipVideosRepository } from '../videos/clip-videos.repository';

/** How long the face file's read address works: the editor reads it once, at once. */
export const FACES_URL_SECONDS = 10 * 60;

export interface FacesStretch {
  fromMs: number;
  toMs: number;
}

export interface FacesReady {
  status: 'ready';
  url: string;
  meta: FaceTracksAssetMeta;
}

export type FacesEnsureOutcome =
  | { status: 'ready'; reused: true }
  | { status: 'running'; job: ClipJobView; joined: boolean };

export type FacesReadOutcome =
  | FacesReady
  | { status: 'running'; job: ClipJobView }
  | { status: 'none' };

@Injectable()
export class ClipFacesService {
  private readonly logger = new Logger(ClipFacesService.name);

  constructor(
    private readonly items: ClipItemService,
    private readonly videos: ClipVideosRepository,
    private readonly jobs: ClipJobsService,
    private readonly jobsRepository: ClipJobsRepository,
    private readonly limits: ClipLimitsGuard,
    private readonly mediaService: MediaServiceProbe,
    @Inject(PRIVATE_STORAGE) private readonly storage: PrivateStorage,
  ) {}

  /** `POST /clips/:clipId/faces`: see the file comment. */
  async ensure(orgId: string, userId: string | null, clipId: string): Promise<FacesEnsureOutcome> {
    await this.limits.assertEnabled(orgId);
    const { clip, videoId, stretch } = await this.context(orgId, clipId);

    if (await this.coveringAsset(orgId, videoId, stretch)) {
      return { status: 'ready', reused: true };
    }
    const running = await this.coveringJob(orgId, videoId, stretch);
    if (running) return { status: 'running', job: toJobView(running), joined: true };

    if ((await this.mediaService.state()) !== 'ok') {
      throw new ClipErrorException(HttpStatus.SERVICE_UNAVAILABLE, 'faces_off');
    }

    const jobRow = await this.jobs.build({
      id: this.jobs.newJobId(),
      orgId,
      userId,
      kind: 'FACES',
      videoId,
      clipId: clip.id,
      input: facesInputSchema.parse({ videoId, clipId: clip.id, ...stretch }),
    });
    const outcome = await serializable(async (tx) => {
      const live = await this.videos.findLive(orgId, videoId, tx);
      if (live?.status !== 'READY') return { kind: 'gone' as const };
      if (await this.coveringAsset(orgId, videoId, stretch, tx)) return { kind: 'ready' as const };
      const other = await this.coveringJob(orgId, videoId, stretch, tx);
      if (other) return { kind: 'running' as const, job: other };
      return { kind: 'created' as const, job: await this.jobsRepository.create(jobRow, tx) };
    });
    if (outcome.kind === 'gone') throw clipNotFound();
    if (outcome.kind === 'ready') return { status: 'ready', reused: true };
    if (outcome.kind === 'running') {
      return { status: 'running', job: toJobView(outcome.job), joined: true };
    }

    await this.jobs.start(outcome.job);
    const job = (await this.jobsRepository.find(orgId, outcome.job.id)) ?? outcome.job;
    this.logger.log(
      JSON.stringify({
        event: 'clips.faces.started',
        orgId,
        videoId,
        clipId: clip.id,
        jobId: job.id,
        ms: stretch.toMs - stretch.fromMs,
      }),
    );
    return { status: 'running', job: toJobView(job), joined: false };
  }

  /** `GET /clips/:clipId/faces`: see the file comment. */
  async read(orgId: string, clipId: string): Promise<FacesReadOutcome> {
    const { videoId, stretch } = await this.context(orgId, clipId);
    const asset = await this.coveringAsset(orgId, videoId, stretch);
    if (asset) {
      const meta = readFaceTracksAssetMeta(asset.meta) as FaceTracksAssetMeta;
      const url = await this.storage.signedUrl(asset.key, { expiresInSeconds: FACES_URL_SECONDS });
      return { status: 'ready', url, meta };
    }
    const running = await this.coveringJob(orgId, videoId, stretch);
    return running ? { status: 'running', job: toJobView(running) } : { status: 'none' };
  }

  /** The clip, its live video and the stretch it plays; a plain 404 for another workspace's. */
  private async context(
    orgId: string,
    clipId: string,
  ): Promise<{ clip: { id: string }; videoId: string; stretch: FacesStretch }> {
    const clip = await this.items.requireClip(orgId, clipId);
    const video = await this.videos.findLive(orgId, clip.videoId);
    if (!video) throw clipNotFound();
    const parsed = safeParseClipDocument(clip.document);
    const duration = video.durationMs ?? 0;
    const ranges = parsed.ok
      ? clipSourceRanges(parsed.doc).filter((range) => range.fromMs < duration)
      : [];
    if (video.status !== 'READY' || duration <= 0 || ranges.length === 0) {
      throw new ClipErrorException(HttpStatus.UNPROCESSABLE_ENTITY, 'clip_document_invalid', {
        message: CLIPS_MESSAGES.CLIP_DOCUMENT_INVALID,
      });
    }
    const fromMs = Math.max(0, Math.min(...ranges.map((r) => r.fromMs)) - HANDLE_MS);
    const toMs = Math.min(duration, Math.max(...ranges.map((r) => r.toMs)) + HANDLE_MS);
    return { clip, videoId: video.id, stretch: { fromMs, toMs } };
  }

  /** The newest face file of the video that covers the stretch. */
  private async coveringAsset(
    orgId: string,
    videoId: string,
    stretch: FacesStretch,
    tx: ClipsTx = prisma,
  ): Promise<ClipAsset | null> {
    const rows = await tx.clipAsset.findMany({
      where: { organizationId: orgId, videoId, kind: ClipAssetKind.FACE_TRACKS },
      orderBy: { createdAt: 'desc' },
    });
    return (
      rows.find((row) => {
        const meta = readFaceTracksAssetMeta(row.meta);
        return meta !== null && faceFileCovers(meta, stretch.fromMs, stretch.toMs);
      }) ?? null
    );
  }

  /** An open FACES job of the video whose stretch covers this one. */
  private async coveringJob(
    orgId: string,
    videoId: string,
    stretch: FacesStretch,
    tx: ClipsTx = prisma,
  ): Promise<ClipJob | null> {
    const open = await tx.clipJob.findMany({
      where: {
        organizationId: orgId,
        videoId,
        kind: ClipJobKind.FACES,
        status: { in: [...OPEN_JOB_STATUSES] },
      },
      orderBy: { createdAt: 'asc' },
    });
    for (const job of open) {
      const input = facesInputSchema.safeParse(job.input);
      if (input.success && faceFileCovers(input.data, stretch.fromMs, stretch.toMs)) return job;
    }
    return null;
  }
}

function clipNotFound(): NotFoundException {
  return new NotFoundException({ message: CLIPS_MESSAGES.CLIP_NOT_FOUND, code: 'clip_not_found' });
}
