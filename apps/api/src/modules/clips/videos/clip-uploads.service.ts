/**
 * Uploads in parts (Sprint 12, Module 04): a file from the person's computer
 * becomes a video, straight into the private space, never through the API.
 *
 * Three calls, the S3 multipart shape (the browser uses Uppy's S3 plugin):
 *
 * 1. **Start** `{ name, bytes, mimeType }`: the plan's switch, the declared
 *    size against `clips.upload_max_gb`, the space against `clips.storage_gb`,
 *    then the video row (UPLOAD, IMPORTING), the storage upload and an
 *    ORIGINAL asset row that binds the upload id to this video and this
 *    workspace. Answers `{ videoId, uploadId, partSize, partCount }`.
 * 2. **Parts** `{ partNumbers }`: one signed address per part, an hour each.
 * 3. **Complete** `{ parts }`: the parts are joined, the real size is read
 *    back (`stat`) and checked again (size and space, a person can lie about
 *    `bytes`), the asset gets its size, and the IMPORT job starts with origin
 *    upload. Its import minutes are charged later, by the worker through the
 *    internal route, once the file's length is known.
 *
 * The browser only ever names the upload id; the key, the video and the
 * workspace come from the asset row, so one workspace can never complete or
 * sign parts of another's upload. Complete is idempotent: a second call
 * after success answers the same video and job. An upload never completed
 * is aborted by the cleanup after 24 hours (Module 19).
 */
import { randomUUID } from 'node:crypto';
import { HttpStatus, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { type ClipAsset, ClipAssetKind, type Prisma } from '@postgear/db';
import {
  type ClipExtension,
  clipKeys,
  contentTypeForClipKey,
  MULTIPART_PART_BYTES,
  type PrivateStorage,
  StorageNotFoundError,
  StorageUploadError,
} from '@postgear/storage';
import { displayName } from '../../media/media.service';
import { PRIVATE_STORAGE } from '../../media/storage/storage.interface';
import { ClipErrorException } from '../clip-error.exception';
import { CLIPS_MESSAGES } from '../clips.messages';
import { serializable } from '../clips.tx';
import type { ClipJobView } from '../jobs/clip-job-view';
import { ClipJobsRepository } from '../jobs/clip-jobs.repository';
import { ClipJobsService } from '../jobs/clip-jobs.service';
import { ClipLimitsGuard } from '../limits/clip-limits.guard';
import { CLIP_RIGHTS_TEXT_VERSION } from './clip-rights';
import type { ClipVideoView } from './clip-video-view';
import { ClipVideosRepository, type UploadBinding } from './clip-videos.repository';
import {
  type CompleteUploadInput,
  type SignPartsInput,
  type StartUploadInput,
  UPLOAD_ID_PATTERN,
} from './clip-videos.schema';
import { ClipVideosService } from './clip-videos.service';

/** The containers an upload may be, by the type the browser declares. The worker probes the real one. */
const UPLOAD_TYPES: Readonly<Record<string, ClipExtension>> = {
  'video/mp4': 'mp4',
  'video/x-m4v': 'mp4',
  'video/quicktime': 'mov',
  'video/x-matroska': 'mkv',
  'video/webm': 'webm',
};

const MIB = 1024 * 1024;
/** S3 numbers parts 1 to 10,000. */
const MAX_PARTS = 10_000;

/** What the ORIGINAL asset row's `meta` holds while the upload runs, and after. */
interface UploadMeta {
  uploadId: string;
  declaredBytes: number;
  partSize: number;
  partCount: number;
  state: 'uploading' | 'complete';
}

export interface UploadStarted {
  videoId: string;
  uploadId: string;
  /** Bytes per part; the last part may be smaller. */
  partSize: number;
  partCount: number;
}

/** Parts of at least 16 MiB, bigger when needed so a file never needs more than 10,000. */
export function partPlan(bytes: number): { partSize: number; partCount: number } {
  const partSize = Math.max(MULTIPART_PART_BYTES, Math.ceil(bytes / MAX_PARTS / MIB) * MIB);
  return { partSize, partCount: Math.max(1, Math.ceil(bytes / partSize)) };
}

@Injectable()
export class ClipUploadsService {
  private readonly logger = new Logger(ClipUploadsService.name);

  constructor(
    private readonly repository: ClipVideosRepository,
    private readonly videos: ClipVideosService,
    private readonly jobs: ClipJobsService,
    private readonly jobsRepository: ClipJobsRepository,
    private readonly limits: ClipLimitsGuard,
    @Inject(PRIVATE_STORAGE) private readonly storage: PrivateStorage,
  ) {}

  async start(orgId: string, userId: string, body: StartUploadInput): Promise<UploadStarted> {
    const extension = UPLOAD_TYPES[body.mimeType.toLowerCase()];
    if (!extension)
      throw new ClipErrorException(HttpStatus.UNPROCESSABLE_ENTITY, 'upload_not_video');

    await this.limits.checkUploadStart(orgId, body.bytes);

    const videoId = randomUUID();
    const key = clipKeys.videoFile(orgId, videoId, ClipAssetKind.ORIGINAL, extension);
    const { partSize, partCount } = partPlan(body.bytes);
    const { uploadId } = await this.storage.createUpload(key, contentTypeForClipKey(key));

    const meta: UploadMeta = {
      uploadId,
      declaredBytes: body.bytes,
      partSize,
      partCount,
      state: 'uploading',
    };

    try {
      const now = new Date();
      await serializable(async (tx) => {
        await tx.clipVideo.create({
          data: {
            id: videoId,
            organizationId: orgId,
            platform: 'UPLOAD',
            kind: 'UPLOAD',
            title: titleFromFileName(body.name),
            // The upload is the person's own act; the page shows the rights
            // sentence beside the file box, so the record is kept the same way.
            rightsConfirmedAt: now,
            rightsConfirmedById: userId,
            rightsTextVersion: CLIP_RIGHTS_TEXT_VERSION,
            createdById: userId,
          },
        });
        await tx.clipAsset.create({
          data: {
            organizationId: orgId,
            videoId,
            kind: ClipAssetKind.ORIGINAL,
            key,
            bytes: 0n,
            mimeType: contentTypeForClipKey(key),
            meta: meta as unknown as Prisma.InputJsonValue,
          },
        });
      });
    } catch (error) {
      // No row means nobody could ever finish or clean it: drop the upload now.
      await this.storage.abortUpload(key, uploadId).catch(() => undefined);
      throw error;
    }

    return { videoId, uploadId, partSize, partCount };
  }

  /** Signed addresses for the parts asked for, an hour each. */
  async signParts(
    orgId: string,
    uploadId: string,
    body: SignPartsInput,
  ): Promise<{ parts: Array<{ partNumber: number; url: string }> }> {
    const binding = await this.requireUpload(orgId, uploadId);
    const meta = uploadMetaOf(binding.asset.meta);
    if (meta?.state !== 'uploading' || binding.video.status !== 'IMPORTING') {
      throw uploadNotFound();
    }
    if (body.partNumbers.some((partNumber) => partNumber > meta.partCount)) {
      throw new ClipErrorException(HttpStatus.UNPROCESSABLE_ENTITY, 'upload_incomplete');
    }

    try {
      const parts = await Promise.all(
        body.partNumbers.map(async (partNumber) => ({
          partNumber,
          url: await this.storage.signPart(binding.asset.key, uploadId, partNumber),
        })),
      );
      return { parts };
    } catch (error) {
      if (error instanceof StorageUploadError || error instanceof StorageNotFoundError)
        throw uploadNotFound();
      throw error;
    }
  }

  /**
   * Joins the parts and starts the import. The real size is checked against
   * the plan again; a file over the cap or past the space is removed, its
   * video with it, and the refusal is the usual 402.
   */
  async complete(
    orgId: string,
    userId: string,
    uploadId: string,
    body: CompleteUploadInput,
  ): Promise<{ video: ClipVideoView; job: ClipJobView | null }> {
    const binding = await this.requireUpload(orgId, uploadId);
    const meta = uploadMetaOf(binding.asset.meta);
    if (!meta) throw uploadNotFound();
    if (meta.state === 'complete') return this.answer(orgId, binding);
    if (binding.video.status !== 'IMPORTING') throw uploadNotFound();
    if (body.parts.some((part) => part.partNumber > meta.partCount)) {
      throw new ClipErrorException(HttpStatus.UNPROCESSABLE_ENTITY, 'upload_incomplete');
    }

    const key = binding.asset.key;
    try {
      await this.storage.completeUpload(key, uploadId, body.parts);
    } catch (error) {
      // A retried complete after one that joined the parts finds the upload
      // gone but the file there: carry on from the file.
      if (!(error instanceof StorageUploadError || error instanceof StorageNotFoundError))
        throw error;
      if (!(await this.storage.exists(key).catch(() => false))) {
        throw new ClipErrorException(HttpStatus.UNPROCESSABLE_ENTITY, 'upload_incomplete');
      }
    }

    const stored = await this.storage.stat(key);
    if (!stored || stored.bytes <= 0) {
      throw new ClipErrorException(HttpStatus.UNPROCESSABLE_ENTITY, 'upload_incomplete');
    }

    try {
      await this.limits.assertEnabled(orgId);
      await this.limits.assertUploadSize(orgId, stored.bytes);
      await this.limits.assertStorage(orgId, stored.bytes);
    } catch (refusal) {
      await this.discard(orgId, binding);
      throw refusal;
    }

    const videoId = binding.video.id;
    const limits = await this.limits.importLimits(orgId);
    const jobRow = await this.jobs.build({
      id: this.jobs.newJobId(),
      orgId,
      userId,
      kind: 'IMPORT',
      videoId,
      input: {
        videoId,
        origin: { type: 'upload', originalKey: key },
        limits,
        expectedBytes: stored.bytes,
      },
    });
    const finished: UploadMeta = { ...meta, state: 'complete' };

    const job = await serializable(async (tx) => {
      const moved = await tx.clipAsset.updateMany({
        where: {
          id: binding.asset.id,
          organizationId: orgId,
          meta: { path: ['state'], equals: 'uploading' },
        },
        data: { bytes: BigInt(stored.bytes), meta: finished as unknown as Prisma.InputJsonValue },
      });
      if (moved.count === 0) return null;
      return this.jobsRepository.create(jobRow, tx);
    });

    // Another complete won the race: answer what it made.
    if (!job) return this.answer(orgId, binding);

    await this.jobs.start(job);
    return this.answer(orgId, binding);
  }

  /** The video and its newest import, as a finished complete answers. */
  private async answer(
    orgId: string,
    binding: UploadBinding,
  ): Promise<{ video: ClipVideoView; job: ClipJobView | null }> {
    const card = await this.repository.findCard(orgId, binding.video.id);
    if (!card) throw uploadNotFound();
    return this.videos.cardView(card);
  }

  private async requireUpload(orgId: string, uploadId: string): Promise<UploadBinding> {
    const binding = UPLOAD_ID_PATTERN.test(uploadId)
      ? await this.repository.findUpload(orgId, uploadId)
      : null;
    if (!binding) throw uploadNotFound();
    return binding;
  }

  /** A refused file: the upload, the file and the video go. Best-effort on storage. */
  private async discard(orgId: string, binding: UploadBinding): Promise<void> {
    const meta = uploadMetaOf(binding.asset.meta);
    if (meta)
      await this.storage.abortUpload(binding.asset.key, meta.uploadId).catch(() => undefined);
    await this.jobsRepository.removeCancelledVideo(orgId, binding.video.id, new Date());
    try {
      await this.storage.deletePrefix(clipKeys.videoPrefix(orgId, binding.video.id));
    } catch (error) {
      this.logger.warn(
        JSON.stringify({
          event: 'clips.upload.files_left',
          videoId: binding.video.id,
          reason: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }
}

function uploadNotFound(): NotFoundException {
  return new NotFoundException({
    message: CLIPS_MESSAGES.UPLOAD_NOT_FOUND,
    code: 'upload_not_found',
  });
}

function uploadMetaOf(raw: ClipAsset['meta']): UploadMeta | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const meta = raw as Record<string, unknown>;
  const whole = (value: unknown) =>
    typeof value === 'number' && Number.isInteger(value) && value > 0;
  if (
    typeof meta.uploadId !== 'string' ||
    !whole(meta.declaredBytes) ||
    !whole(meta.partSize) ||
    !whole(meta.partCount) ||
    (meta.state !== 'uploading' && meta.state !== 'complete')
  ) {
    return null;
  }
  return meta as unknown as UploadMeta;
}

/** "Team Talk.final.mp4" becomes "Team Talk.final": the last extension goes. */
export function titleFromFileName(name: string): string {
  const shown = displayName(name);
  const stem = shown.replace(/\.[A-Za-z0-9]{1,5}$/, '').trim();
  return (stem || shown).slice(0, 300);
}
