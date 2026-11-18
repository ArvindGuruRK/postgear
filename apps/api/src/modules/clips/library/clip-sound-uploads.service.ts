/**
 * A workspace's own sounds (Module 14 section 4), and the files of the
 * sounds a clip already has.
 *
 * **Upload A Sound**: one MP3, WAV, M4A or AAC of at most 20 MB, its type
 * read from its bytes. Clips must be in the plan and the file must fit in the
 * workspace's space (`clips.storage_gb`, through the resolver) before it is
 * kept. The file lands in the private space as an AUDIO asset `checking`
 * (`purpose: 'sound'`), and `clipSoundCheckWorkflow` makes it the editor's
 * AAC `.m4a` with its peaks on the quick media queue; the API waits for that
 * answer, so a ready sound usually comes back at once. A file the check
 * refuses is deleted and refused in one sentence. When the worker is slow
 * the asset stays `checking`, and the Uploaded tab's next list asks the
 * worker again for a check that has waited a minute.
 *
 * Uploads stay in the workspace and never enter the shared catalogue.
 */
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { ClipAsset, Prisma } from '@postgear/db';
import {
  CLIP_SOUND_CHECK_TIMEOUT_MS,
  CLIP_SOUND_CHECK_WORKFLOW,
  CLIP_WAIT_FOR_ANSWER_MS,
  clipSoundCheckWorkflowId,
  MEDIA_QUICK_TASK_QUEUE,
} from '@postgear/scheduling';
import { clipKeys, type PrivateStorage } from '@postgear/storage';
import {
  clipErrorMessage,
  readSoundAssetMeta,
  SOUND_UPLOAD_MAX_BYTES,
  type SoundAssetMeta,
  type SoundFileView,
  type SoundUploadView,
  soundNameFromFile,
} from '@postgear/video-engine';
import { PRIVATE_STORAGE } from '../../media/storage/storage.interface';
import { SchedulingService } from '../../scheduling/scheduling.service';
import { ClipErrorException } from '../clip-error.exception';
import { isUuid } from '../clips.ids';
import { ClipLimitsGuard } from '../limits/clip-limits.guard';
import { ClipPlaybackService } from '../videos/clip-playback.service';
import { CLIP_LIBRARY_MESSAGES } from './clip-library.messages';
import type { SoundFilesQuery } from './clip-library.schemas';
import { ClipLibraryService } from './clip-library.service';
import { ClipSoundUploadsRepository } from './clip-sound-uploads.repository';
import { SOUND_SNIFF_BYTES, sniffSound } from './sound-file-type';
import { peaksOf, SOUND_PROVIDER, type SoundProvider } from './sound-provider';

/** The file a sound upload is (Multer's memory storage). */
export interface SoundUploadFile {
  buffer: Buffer;
  originalname: string;
  size: number;
}

/** A check that has waited this long is started again on the next list. */
export const SOUND_CHECK_RESTART_MS = 60_000;
/** A check still not done after this long is shown as failed, so the person can try again. */
export const SOUND_CHECK_GIVE_UP_MS = 15 * 60_000;
/** At most this many stuck checks are started again by one list. */
const RESTARTS_PER_LIST = 5;

@Injectable()
export class ClipSoundUploadsService {
  private readonly logger = new Logger(ClipSoundUploadsService.name);

  constructor(
    private readonly repository: ClipSoundUploadsRepository,
    private readonly library: ClipLibraryService,
    private readonly limits: ClipLimitsGuard,
    private readonly playback: ClipPlaybackService,
    private readonly scheduling: SchedulingService,
    @Inject(PRIVATE_STORAGE) private readonly storage: PrivateStorage,
    @Inject(SOUND_PROVIDER) private readonly provider: SoundProvider,
  ) {}

  /** 201 `{ sound }` ready or still checking; 413, 415 or 422 with one sentence. */
  async upload(
    orgId: string,
    file: SoundUploadFile | undefined,
  ): Promise<{ sound: SoundUploadView }> {
    await this.library.admit(orgId);
    if (!file || file.size === 0 || file.buffer.length === 0) {
      throw new ClipErrorException(HttpStatus.UNSUPPORTED_MEDIA_TYPE, 'sound_unusable');
    }
    if (file.buffer.length > SOUND_UPLOAD_MAX_BYTES) {
      throw new ClipErrorException(HttpStatus.PAYLOAD_TOO_LARGE, 'sound_upload_too_big');
    }
    const sniffed = sniffSound(file.buffer.subarray(0, SOUND_SNIFF_BYTES));
    if (!sniffed) {
      throw new ClipErrorException(HttpStatus.UNSUPPORTED_MEDIA_TYPE, 'sound_unusable');
    }
    await this.limits.assertStorage(orgId, file.buffer.length);

    const key = clipKeys.libraryUpload(orgId, sniffed.ext);
    await this.storage.put(key, file.buffer, sniffed.mimeType);
    const meta: SoundAssetMeta = {
      status: 'checking',
      purpose: 'sound',
      name: soundNameFromFile(file.originalname),
    };
    let asset: ClipAsset;
    try {
      asset = await this.repository.create(orgId, {
        key,
        bytes: file.buffer.length,
        mimeType: sniffed.mimeType,
        meta: meta as Prisma.InputJsonValue,
      });
    } catch (error) {
      await this.storage.delete(key).catch(() => undefined);
      throw error;
    }

    await this.check(orgId, asset.id, CLIP_WAIT_FOR_ANSWER_MS);
    const after = await this.repository.find(orgId, asset.id);
    const afterMeta = readSoundAssetMeta(after?.meta);
    if (afterMeta?.status === 'failed') {
      // Refused at once: nothing is kept, and the person reads why.
      await this.repository.remove(orgId, asset.id);
      throw new ClipErrorException(HttpStatus.UNPROCESSABLE_ENTITY, afterMeta.error);
    }
    if (!after) throw new ClipErrorException(HttpStatus.NOT_FOUND, 'sound_not_found');
    return { sound: await this.view(after) };
  }

  /** The workspace's sounds, newest first, with six hour addresses for the ready ones. */
  async list(orgId: string, now: Date = new Date()): Promise<{ sounds: SoundUploadView[] }> {
    await this.library.admit(orgId);
    const rows = await this.repository.list(orgId);
    const stuck = rows
      .filter((row) => {
        const age = now.getTime() - row.createdAt.getTime();
        return (
          readSoundAssetMeta(row.meta)?.status === 'checking' &&
          age >= SOUND_CHECK_RESTART_MS &&
          age < SOUND_CHECK_GIVE_UP_MS
        );
      })
      .slice(0, RESTARTS_PER_LIST);
    // Starting a check that is already running joins it (same workflow id), so this is safe to repeat.
    for (const row of stuck) await this.check(orgId, row.id, 1);
    return { sounds: await Promise.all(rows.map((row) => this.view(row, now))) };
  }

  /** `{ message }`; 409 `sound_in_use` with the count when a clip plays it. */
  async remove(orgId: string, assetId: string): Promise<{ message: string }> {
    await this.library.admit(orgId);
    const row = isUuid(assetId) ? await this.repository.find(orgId, assetId) : null;
    if (!row) throw new ClipErrorException(HttpStatus.NOT_FOUND, 'sound_not_found');
    const clips = await this.repository.clipsUsing(orgId, assetId);
    if (clips > 0) {
      throw new ClipErrorException(HttpStatus.CONFLICT, 'sound_in_use', {
        message: CLIP_LIBRARY_MESSAGES.soundInUse(clips),
        details: { clips },
      });
    }
    await this.repository.remove(orgId, assetId);
    await this.storage.delete(row.key).catch(() => undefined);
    return { message: CLIP_LIBRARY_MESSAGES.SOUND_DELETED };
  }

  /**
   * The files of the sounds a clip already has: library ones through the
   * provider (a HIDDEN one still plays, a REMOVED one says so), uploads by
   * signed address once ready. One that is gone answers `missing`, and the
   * editor says so on the item.
   */
  async files(orgId: string, query: SoundFilesQuery): Promise<{ files: SoundFileView[] }> {
    await this.library.admit(orgId);
    const libraryIds = query.library ?? [];
    const assetIds = query.asset ?? [];
    const [library, uploads] = await Promise.all([
      this.provider.resolve(orgId, libraryIds),
      this.repository.findMany(orgId, assetIds),
    ]);
    const files: SoundFileView[] = [];
    const byId = new Map(library.sounds.map((sound) => [sound.id, sound]));
    const removed = new Set(library.removed);
    for (const id of libraryIds) {
      const sound = byId.get(id);
      files.push(
        sound
          ? {
              key: `library:${id}`,
              missing: false,
              name: sound.name,
              kind: sound.kind,
              durationMs: sound.durationMs,
              fileUrl: sound.previewUrl,
              peaks: sound.peaks,
            }
          : { key: `library:${id}`, missing: true, removed: removed.has(id) },
      );
    }
    const uploadsById = new Map(uploads.map((row) => [row.id, row]));
    for (const id of assetIds) {
      const row = uploadsById.get(id);
      const view = row ? await this.view(row) : null;
      files.push(
        view?.status === 'ready' && view.fileUrl && view.durationMs && view.peaks
          ? {
              key: `asset:${id}`,
              missing: false,
              name: view.name,
              // An upload plays once, like an effect; the item's own type decides how it loops.
              kind: 'sfx',
              durationMs: view.durationMs,
              fileUrl: view.fileUrl,
              peaks: view.peaks,
            }
          : { key: `asset:${id}`, missing: true, removed: false },
      );
    }
    return { files };
  }

  /** Starts (or joins) the check and waits up to `waitMs` for it. Never throws: the row carries the state. */
  private async check(orgId: string, assetId: string, waitMs: number): Promise<void> {
    const outcome = await this.scheduling.runClipQuery<unknown>({
      workflowType: CLIP_SOUND_CHECK_WORKFLOW,
      workflowId: clipSoundCheckWorkflowId(assetId),
      taskQueue: MEDIA_QUICK_TASK_QUEUE,
      args: [{ organizationId: orgId, assetId }],
      waitMs,
      executionTimeoutMs: CLIP_SOUND_CHECK_TIMEOUT_MS * 2,
    });
    if (outcome.outcome === 'failed') {
      this.logger.warn(JSON.stringify({ event: 'clips.sound_check.failed', orgId, assetId }));
    }
  }

  private async view(row: ClipAsset, now: Date = new Date()): Promise<SoundUploadView> {
    const meta = readSoundAssetMeta(row.meta);
    const base = {
      id: row.id,
      name: meta?.name ?? 'Sound',
      createdAt: row.createdAt.toISOString(),
    };
    if (meta?.status === 'ready') {
      const file = await this.playback.address(row.key, now);
      return {
        ...base,
        status: 'ready',
        error: null,
        durationMs: meta.durationMs,
        peaks: peaksOf(meta.peaks),
        fileUrl: file?.url ?? null,
      };
    }
    const empty = { durationMs: null, peaks: null, fileUrl: null };
    if (meta?.status === 'failed') {
      return { ...base, ...empty, status: 'failed', error: clipErrorMessage(meta.error) };
    }
    // Still checking, unless it has waited far too long: then it reads as failed, so it can be deleted and tried again.
    const gaveUp = now.getTime() - row.createdAt.getTime() >= SOUND_CHECK_GIVE_UP_MS;
    return gaveUp
      ? { ...base, ...empty, status: 'failed', error: clipErrorMessage('tool_failed') }
      : { ...base, ...empty, status: 'checking', error: null };
  }
}
