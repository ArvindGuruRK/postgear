/**
 * A workspace's own stickers (Module 12 section 5).
 *
 * **Upload A Sticker**: one PNG, GIF or WebP of at most 8 MB, its type read
 * from its bytes. Clips must be in the plan and the file must fit in the
 * workspace's space (`clips.storage_gb`, through the resolver) before it is
 * kept. The file lands in the private space as a STICKER asset `checking`,
 * and `clipStickerCheckWorkflow` makes it a PNG or APNG on the quick media
 * queue; the API waits for that answer, so a ready sticker usually comes back
 * at once. A file the check refuses is deleted and refused in one sentence.
 * When the worker is slow the asset stays `checking`, and the Uploaded tab's
 * next list asks the worker again for a check that has waited a minute.
 *
 * Uploads stay in the workspace and never enter the shared catalogue.
 */
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { ClipAsset, Prisma } from '@postgear/db';
import {
  CLIP_STICKER_CHECK_TIMEOUT_MS,
  CLIP_STICKER_CHECK_WORKFLOW,
  CLIP_WAIT_FOR_ANSWER_MS,
  clipStickerCheckWorkflowId,
  MEDIA_QUICK_TASK_QUEUE,
} from '@postgear/scheduling';
import { clipKeys, type PrivateStorage } from '@postgear/storage';
import {
  clipErrorMessage,
  readStickerAssetMeta,
  STICKER_UPLOAD_MAX_BYTES,
  type StickerAssetMeta,
  type StickerFileView,
  type StickerUploadView,
  stickerNameFromFile,
} from '@postgear/video-engine';
import { SNIFF_BYTES, sniffMedia } from '../../media/file-type';
import { PRIVATE_STORAGE } from '../../media/storage/storage.interface';
import { SchedulingService } from '../../scheduling/scheduling.service';
import { ClipErrorException } from '../clip-error.exception';
import { isUuid } from '../clips.ids';
import { ClipLimitsGuard } from '../limits/clip-limits.guard';
import { ClipPlaybackService } from '../videos/clip-playback.service';
import { CLIP_LIBRARY_MESSAGES } from './clip-library.messages';
import type { StickerFilesQuery } from './clip-library.schemas';
import { ClipLibraryService } from './clip-library.service';
import { ClipStickerUploadsRepository } from './clip-sticker-uploads.repository';
import { STICKER_PROVIDER, type StickerProvider } from './sticker-provider';

/** The file a sticker upload is (Multer's memory storage). */
export interface StickerUploadFile {
  buffer: Buffer;
  originalname: string;
  size: number;
}

/** The picture types a sticker may be uploaded as, by their real bytes. */
const STICKER_TYPES = {
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
} as const;

/** A check that has waited this long is started again on the next list. */
export const STICKER_CHECK_RESTART_MS = 60_000;
/** A check still not done after this long is shown as failed, so the person can try again. */
export const STICKER_CHECK_GIVE_UP_MS = 15 * 60_000;
/** At most this many stuck checks are started again by one list. */
const RESTARTS_PER_LIST = 5;

@Injectable()
export class ClipStickerUploadsService {
  private readonly logger = new Logger(ClipStickerUploadsService.name);

  constructor(
    private readonly repository: ClipStickerUploadsRepository,
    private readonly library: ClipLibraryService,
    private readonly limits: ClipLimitsGuard,
    private readonly playback: ClipPlaybackService,
    private readonly scheduling: SchedulingService,
    @Inject(PRIVATE_STORAGE) private readonly storage: PrivateStorage,
    @Inject(STICKER_PROVIDER) private readonly provider: StickerProvider,
  ) {}

  /** 201 `{ sticker }` ready or still checking; 413, 415 or 422 with one sentence. */
  async upload(
    orgId: string,
    file: StickerUploadFile | undefined,
  ): Promise<{ sticker: StickerUploadView }> {
    await this.library.admit(orgId);
    if (!file || file.size === 0 || file.buffer.length === 0) {
      throw new ClipErrorException(HttpStatus.UNSUPPORTED_MEDIA_TYPE, 'sticker_unusable');
    }
    if (file.buffer.length > STICKER_UPLOAD_MAX_BYTES) {
      throw new ClipErrorException(HttpStatus.PAYLOAD_TOO_LARGE, 'sticker_upload_too_big');
    }
    const sniffed = sniffMedia(file.buffer.subarray(0, SNIFF_BYTES));
    const mimeType = sniffed?.kind === 'image' ? sniffed.mimeType : null;
    const ext =
      mimeType && mimeType in STICKER_TYPES
        ? STICKER_TYPES[mimeType as keyof typeof STICKER_TYPES]
        : null;
    if (!mimeType || !ext) {
      throw new ClipErrorException(HttpStatus.UNSUPPORTED_MEDIA_TYPE, 'sticker_unusable');
    }
    await this.limits.assertStorage(orgId, file.buffer.length);

    const key = clipKeys.libraryUpload(orgId, ext);
    await this.storage.put(key, file.buffer, mimeType);
    const meta: StickerAssetMeta = {
      status: 'checking',
      name: stickerNameFromFile(file.originalname),
    };
    let asset: ClipAsset;
    try {
      asset = await this.repository.create(orgId, {
        key,
        bytes: file.buffer.length,
        mimeType,
        meta: meta as Prisma.InputJsonValue,
      });
    } catch (error) {
      await this.storage.delete(key).catch(() => undefined);
      throw error;
    }

    await this.check(orgId, asset.id, CLIP_WAIT_FOR_ANSWER_MS);
    const after = await this.repository.find(orgId, asset.id);
    const afterMeta = readStickerAssetMeta(after?.meta);
    if (afterMeta?.status === 'failed') {
      // Refused at once: nothing is kept, and the person reads why.
      await this.repository.remove(orgId, asset.id);
      throw new ClipErrorException(HttpStatus.UNPROCESSABLE_ENTITY, afterMeta.error);
    }
    if (!after) throw new ClipErrorException(HttpStatus.NOT_FOUND, 'sticker_not_found');
    return { sticker: await this.view(after) };
  }

  /** The workspace's stickers, newest first, with six hour addresses for the ready ones. */
  async list(orgId: string, now: Date = new Date()): Promise<{ stickers: StickerUploadView[] }> {
    await this.library.admit(orgId);
    const rows = await this.repository.list(orgId);
    const stuck = rows
      .filter((row) => {
        const age = now.getTime() - row.createdAt.getTime();
        return (
          readStickerAssetMeta(row.meta)?.status === 'checking' &&
          age >= STICKER_CHECK_RESTART_MS &&
          age < STICKER_CHECK_GIVE_UP_MS
        );
      })
      .slice(0, RESTARTS_PER_LIST);
    // Starting a check that is already running joins it (same workflow id), so this is safe to repeat.
    for (const row of stuck) await this.check(orgId, row.id, 1);
    return { stickers: await Promise.all(rows.map((row) => this.view(row, now))) };
  }

  /** `{ message }`; 409 `sticker_in_use` with the count when a clip draws it. */
  async remove(orgId: string, assetId: string): Promise<{ message: string }> {
    await this.library.admit(orgId);
    const row = isUuid(assetId) ? await this.repository.find(orgId, assetId) : null;
    if (!row) throw new ClipErrorException(HttpStatus.NOT_FOUND, 'sticker_not_found');
    const clips = await this.repository.clipsUsing(orgId, assetId);
    if (clips > 0) {
      throw new ClipErrorException(HttpStatus.CONFLICT, 'sticker_in_use', {
        message: CLIP_LIBRARY_MESSAGES.inUse(clips),
        details: { clips },
      });
    }
    await this.repository.remove(orgId, assetId);
    const meta = readStickerAssetMeta(row.meta);
    await this.storage.delete(row.key).catch(() => undefined);
    if (meta?.status === 'ready') await this.storage.delete(meta.previewKey).catch(() => undefined);
    return { message: CLIP_LIBRARY_MESSAGES.DELETED };
  }

  /**
   * The files of the stickers a clip already has: library ones through the
   * provider (a HIDDEN one still draws), uploads by signed address. One that
   * is gone answers `missing`, and the editor says so on the item.
   */
  async files(orgId: string, query: StickerFilesQuery): Promise<{ files: StickerFileView[] }> {
    await this.library.admit(orgId);
    const libraryIds = query.library ?? [];
    const assetIds = query.asset ?? [];
    const [library, uploads] = await Promise.all([
      this.provider.resolve(orgId, libraryIds),
      this.repository.findMany(orgId, assetIds),
    ]);
    const files: StickerFileView[] = [];
    const byId = new Map(library.map((sticker) => [sticker.id, sticker]));
    for (const id of libraryIds) {
      const sticker = byId.get(id);
      files.push(
        sticker
          ? {
              key: `library:${id}`,
              missing: false,
              name: sticker.name,
              kind: sticker.kind,
              width: sticker.width,
              height: sticker.height,
              durationMs: sticker.durationMs,
              fps: sticker.fps,
              frames: sticker.frames,
              fileUrl: sticker.fileUrl,
              previewUrl: sticker.previewUrl,
              credit: sticker.credit,
            }
          : { key: `library:${id}`, missing: true },
      );
    }
    const uploadsById = new Map(uploads.map((row) => [row.id, row]));
    for (const id of assetIds) {
      const row = uploadsById.get(id);
      const view = row ? await this.view(row) : null;
      files.push(
        view?.status === 'ready' && view.fileUrl && view.kind && view.width && view.height
          ? {
              key: `asset:${id}`,
              missing: false,
              name: view.name,
              kind: view.kind,
              width: view.width,
              height: view.height,
              durationMs: view.durationMs,
              fps: view.fps,
              frames: view.frames,
              fileUrl: view.fileUrl,
              previewUrl: view.previewUrl,
              credit: null,
            }
          : { key: `asset:${id}`, missing: true },
      );
    }
    return { files };
  }

  /** Starts (or joins) the check and waits up to `waitMs` for it. Never throws: the row carries the state. */
  private async check(orgId: string, assetId: string, waitMs: number): Promise<void> {
    const outcome = await this.scheduling.runClipQuery<unknown>({
      workflowType: CLIP_STICKER_CHECK_WORKFLOW,
      workflowId: clipStickerCheckWorkflowId(assetId),
      taskQueue: MEDIA_QUICK_TASK_QUEUE,
      args: [{ organizationId: orgId, assetId }],
      waitMs,
      executionTimeoutMs: CLIP_STICKER_CHECK_TIMEOUT_MS * 2,
    });
    if (outcome.outcome === 'failed') {
      this.logger.warn(JSON.stringify({ event: 'clips.sticker_check.failed', orgId, assetId }));
    }
  }

  private async view(row: ClipAsset, now: Date = new Date()): Promise<StickerUploadView> {
    const meta = readStickerAssetMeta(row.meta);
    const base = {
      id: row.id,
      name: meta?.name ?? 'Sticker',
      createdAt: row.createdAt.toISOString(),
    };
    if (meta?.status === 'ready') {
      const [file, preview] = await Promise.all([
        this.playback.address(row.key, now),
        this.playback.address(meta.previewKey, now),
      ]);
      return {
        ...base,
        status: 'ready',
        error: null,
        kind: meta.animated ? 'animated' : 'static',
        width: meta.width,
        height: meta.height,
        durationMs: meta.durationMs,
        fps: meta.fps,
        frames: meta.frames,
        previewUrl: preview?.url ?? null,
        fileUrl: file?.url ?? null,
      };
    }
    const empty = {
      kind: null,
      width: null,
      height: null,
      durationMs: null,
      fps: null,
      frames: null,
      previewUrl: null,
      fileUrl: null,
    };
    if (meta?.status === 'failed') {
      return { ...base, ...empty, status: 'failed', error: clipErrorMessage(meta.error) };
    }
    // Still checking, unless it has waited far too long: then it reads as failed, so it can be deleted and tried again.
    const gaveUp = now.getTime() - row.createdAt.getTime() >= STICKER_CHECK_GIVE_UP_MS;
    return gaveUp
      ? { ...base, ...empty, status: 'failed', error: clipErrorMessage('tool_failed') }
      : { ...base, ...empty, status: 'checking', error: null };
  }
}
