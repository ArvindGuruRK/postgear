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
 *   Module 08 adds what Follow The Speaker needs beside the boxes, both in
 *   video ms inside the face file's stretch, only when asked (`follow`;
 *   Detect Camera does not need them, so it gets `[]` and `null` without
 *   reading the SIGNALS file or the transcript): `sceneCutsMs` (the video's
 *   SIGNALS scene track, at Sprint 12's cut level; [] without one) and
 *   `speech` (where someone talks, from the spoken transcript's word times,
 *   gaps under `SPEECH_JOIN_GAP_MS` joined; null where nothing was listened to). Ranges
 *   only: the words never leave this service. Either one that cannot be read
 *   is answered empty (no cuts, or null speech), never as a failed read.
 *
 * Face files belong to the video (assets under its key prefix), so a second
 * clip of the same stretch reads the same file and Sprint 12's `removeVideo`
 * deletes them with the video. The file holds boxes and times only; the
 * browser turns them into people. Logs carry ids and counts, never a box.
 */
import { promisify } from 'node:util';
import { gunzip } from 'node:zlib';
import { HttpStatus, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { type ClipAsset, type ClipJob, ClipAssetKind, ClipJobKind, prisma } from '@postgear/db';
import type { PrivateStorage } from '@postgear/storage';
import {
  clipSourceRanges,
  decodeSignalsFile,
  type FaceTracksAssetMeta,
  faceFileCovers,
  facesInputSchema,
  HANDLE_MS,
  LANGUAGE_AUTO,
  readFaceTracksAssetMeta,
  reusableTrack,
  type SpeechSpan,
  safeParseClipDocument,
  sceneCutsMs,
  speechSpansIn,
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
import { ClipTranscriptStore } from '../transcripts/clip-transcript-store';
import { ClipTranscriptsService } from '../transcripts/clip-transcripts.service';
import { ClipVideosRepository } from '../videos/clip-videos.repository';

const gunzipAsync = promisify(gunzip);
/** A stored SIGNALS file larger than this is not read (a day of video is far under; Sprint 12's cap). */
const SIGNALS_MAX_GZ_BYTES = 8 * 1024 * 1024;
const SIGNALS_MAX_JSON_BYTES = 64 * 1024 * 1024;

/** How long the face file's read address works: the editor reads it once, at once. */
export const FACES_URL_SECONDS = 10 * 60;

export interface FacesStretch {
  fromMs: number;
  toMs: number;
}

export interface FacesReady {
  status: 'ready';
  /** Module 08: the FACE_TRACKS asset's id, which a followed layout records as `faceAssetId`. */
  assetId: string;
  url: string;
  meta: FaceTracksAssetMeta;
  /** Module 08: scene cuts inside `meta.fromMs..meta.toMs`, video ms, sorted; [] with no scene track. */
  sceneCutsMs: number[];
  /**
   * Module 08: where someone talks, video ms, sorted, merged (gaps under `SPEECH_JOIN_GAP_MS`
   * joined), inside `meta.fromMs..meta.toMs`; null when that stretch was never
   * listened to. Ranges only, never words.
   */
  speech: SpeechSpan[] | null;
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
    // Module 08: the speech stretches beside the boxes.
    private readonly transcripts: ClipTranscriptsService,
    private readonly transcriptStore: ClipTranscriptStore,
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
  async read(
    orgId: string,
    clipId: string,
    options: { follow?: boolean } = {},
  ): Promise<FacesReadOutcome> {
    const { videoId, durationMs, stretch } = await this.context(orgId, clipId);
    const asset = await this.coveringAsset(orgId, videoId, stretch);
    if (asset) {
      const meta = readFaceTracksAssetMeta(asset.meta) as FaceTracksAssetMeta;
      const url = await this.storage.signedUrl(asset.key, { expiresInSeconds: FACES_URL_SECONDS });
      const [cuts, speech] = options.follow
        ? await Promise.all([
            this.sceneCuts(orgId, videoId, durationMs, meta),
            this.speech(orgId, videoId, meta),
          ])
        : ([[], null] as [number[], SpeechSpan[] | null]);
      return { status: 'ready', assetId: asset.id, url, meta, sceneCutsMs: cuts, speech };
    }
    const running = await this.coveringJob(orgId, videoId, stretch);
    return running ? { status: 'running', job: toJobView(running) } : { status: 'none' };
  }

  /** The clip, its live video and the stretch it plays; a plain 404 for another workspace's. */
  private async context(
    orgId: string,
    clipId: string,
  ): Promise<{ clip: { id: string }; videoId: string; durationMs: number; stretch: FacesStretch }> {
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
    return { clip, videoId: video.id, durationMs: duration, stretch: { fromMs, toMs } };
  }

  /**
   * The scene cuts inside the face file's stretch, from the video's newest
   * SIGNALS file (its scene track at the current version, measured on this
   * length). [] when there is none or it does not read.
   */
  private async sceneCuts(
    orgId: string,
    videoId: string,
    durationMs: number,
    meta: FaceTracksAssetMeta,
  ): Promise<number[]> {
    try {
      const asset = await prisma.clipAsset.findFirst({
        where: { organizationId: orgId, videoId, kind: ClipAssetKind.SIGNALS },
        orderBy: { createdAt: 'desc' },
        select: { key: true },
      });
      if (!asset) return [];
      const opened = await this.storage.getStream(asset.key);
      if (!opened) return [];
      if (opened.totalBytes > SIGNALS_MAX_GZ_BYTES) {
        opened.body.destroy();
        return [];
      }
      const chunks: Buffer[] = [];
      for await (const chunk of opened.body) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
      }
      const json = await gunzipAsync(Buffer.concat(chunks), {
        maxOutputLength: SIGNALS_MAX_JSON_BYTES,
      });
      const scene = reusableTrack(decodeSignalsFile(json.toString('utf8')), 'scene', durationMs);
      return sceneCutsMs(scene, meta.fromMs, meta.toMs);
    } catch (error) {
      this.logger.warn(
        JSON.stringify({
          event: 'clips.faces.scene_unreadable',
          orgId,
          videoId,
          reason: error instanceof Error ? error.name : 'unknown',
        }),
      );
      return [];
    }
  }

  /**
   * Where someone talks inside the face file's stretch, from the video's
   * first spoken transcript (never a translation). A file the person supplied
   * covers the whole stretch, as it does for the words. Null when there is
   * none, it does not read, or nothing in the stretch was listened to.
   */
  private async speech(
    orgId: string,
    videoId: string,
    meta: FaceTracksAssetMeta,
  ): Promise<SpeechSpan[] | null> {
    try {
      const row = await this.transcripts.transcriptRow(orgId, videoId, LANGUAGE_AUTO);
      if (!row) return null;
      const transcript = await this.transcriptStore.read(row.key);
      if (!transcript) return null;
      const covered =
        row.meta.source === 'listened'
          ? transcript.covered
          : [{ fromMs: meta.fromMs, toMs: meta.toMs }];
      return speechSpansIn({ words: transcript.words, covered }, meta.fromMs, meta.toMs);
    } catch (error) {
      this.logger.warn(
        JSON.stringify({
          event: 'clips.faces.speech_unreadable',
          orgId,
          videoId,
          reason: error instanceof Error ? error.name : 'unknown',
        }),
      );
      return null;
    }
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
