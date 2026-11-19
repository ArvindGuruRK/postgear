/**
 * The media library: upload, list, delete.
 *
 * An upload runs a fixed sequence, and the order is the safety argument:
 *
 * 1. **Sniff** the real type from the bytes (`file-type.ts`). The name and the
 *    browser's claimed type are ignored.
 * 2. **Size-check** against the limit for *that* type: a 200 MB "image" is
 *    refused even though the multipart limit let a video that size through.
 * 3. **Process** images (`image-processor.ts`); store video as uploaded.
 * 4. **Store** the file and its thumbnail under fresh random keys.
 * 5. **Record** the row. If that fails, the stored files are removed, so a
 *    database error never leaves orphaned objects nobody can see or delete.
 * 6. **Video only** (Sprint 12, Module 19): start `mediaVideoFactsWorkflow`,
 *    which gives the row its poster and length on the media worker. Not
 *    awaited, and a failed start is logged, never the upload's failure: the
 *    maintenance pass picks up any video still without them.
 *
 * The multipart temp file is removed whatever happens.
 */
import { open, rm } from 'node:fs/promises';
import { basename } from 'node:path';
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
  UnprocessableEntityException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import type { PrismaTransactionClient } from '@postgear/db';
import { CONTENT_TYPES, createMediaKey, isMediaKey, thumbnailKeyFor } from '@postgear/storage';
import { fileNameParts } from '../../common/attachment';
import { securityLogger } from '../../common/logging/security-logger';
import { stripControlChars } from '../../common/sanitize';
import { matchesAllTerms, selectiveTerm } from '../../common/search-terms';
import { SchedulingService } from '../scheduling/scheduling.service';
import { type ListMediaQuery, MEDIA_PAGE_SIZE } from './dto/media.schema';
import { SNIFF_BYTES, sniffMedia } from './file-type';
import { processImage, UnreadableImageError } from './image-processor';
import {
  MAX_GIF_UPLOAD_BYTES,
  MAX_IMAGE_UPLOAD_BYTES,
  MAX_VIDEO_UPLOAD_BYTES,
  MEDIA_MESSAGES,
} from './media.messages';
import { type MediaKind, type MediaRecord, MediaRepository } from './media.repository';
import { STORAGE_BACKEND, type StorageBackend } from './storage/storage.interface';

/** How many of the newest items a search looks through. */
const SEARCH_CANDIDATES = 60;

/** A library item as a search result shows it (2026-10-21). */
export type MediaSearchHit = Pick<MediaView, 'id' | 'name' | 'type' | 'url' | 'thumbnailUrl'>;

/** What a client sees for one item: URLs, never storage keys. */
export interface MediaView {
  id: string;
  name: string;
  type: MediaKind;
  mimeType: string | null;
  /** Bytes as stored, after compression. */
  fileSize: number;
  width: number | null;
  height: number | null;
  url: string;
  /**
   * A small preview for grids. A video's is its poster (Module 19), null
   * until the media worker has made it or when the file could not be read.
   */
  thumbnailUrl: string | null;
  createdAt: Date;
  /**
   * Sprint 12 (Module 17): a video's length, so the composer and the queue
   * can hold it to a platform's length rules; null when unknown.
   */
  durationMs?: number | null;
}

/** The subset of Multer's file object this service reads. */
export interface UploadedFileInput {
  path: string;
  size: number;
  originalname: string;
}

/** Bytes produced inside the API, an AI image (Sprint 6), rather than uploaded. */
export interface GeneratedFileInput {
  data: Buffer;
  /** What the producer believes it made. The bytes are sniffed anyway. */
  mimeType: string;
  name: string;
  /** Alt text: the (possibly rewritten) prompt the image was made from. */
  alt?: string | null;
  /**
   * The format and quality to store, when the producer has a reason to care
   * (Sprint 9: a Studio export's JPEG or PNG choice, at the quality the
   * sprint fixed). Omitted everywhere else, which keeps the library's own
   * rule: JPEG unless the image genuinely uses transparency. `maxEdge` lets
   * a 2x Studio export keep its size past the library's 2048 px cap
   * (Sprint 9b; see `ProcessImageOptions`).
   */
  encode?: { prefer?: 'jpeg' | 'png'; quality?: number; maxEdge?: number };
}

/** An exported clip the worker already stored in the public space (Sprint 12). */
export interface RenderedVideoInput {
  orgId: string;
  /** The MP4's media key. */
  key: string;
  /** Its poster's media key, or null. */
  posterKey: string | null;
  bytes: number;
  durationMs: number;
  width: number;
  height: number;
  fps: number;
  /** The name it gets in the library. */
  name: string;
  /**
   * `clip` for an exported clip (the default); `upload` for a download a
   * person saved to Media (Module 18): a whole video, not a clip.
   */
  origin?: 'clip' | 'upload';
}

/** `Media.fileSize` is a 32-bit column; a bigger file is recorded at the column's ceiling. */
const MAX_INT = 2_147_483_647;

function wholeOrNull(value: number): number | null {
  return Number.isFinite(value) && value > 0 ? Math.min(MAX_INT, Math.round(value)) : null;
}

/** One image to save, and the name to save it under. */
export interface MediaDownload {
  bytes: Buffer;
  mimeType: string;
  fileName: string;
}

const MAX_NAME_LENGTH = 200;

/** Alt text is shown to screen readers, not read as an essay. */
const MAX_ALT_LENGTH = 1_000;

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  constructor(
    private readonly repository: MediaRepository,
    @Inject(STORAGE_BACKEND) private readonly storage: StorageBackend,
    private readonly scheduling: SchedulingService,
  ) {}

  async upload(
    orgId: string,
    file: UploadedFileInput | undefined,
  ): Promise<{ media: MediaView; originalBytes: number }> {
    if (!file) {
      throw new BadRequestException(MEDIA_MESSAGES.NO_FILE);
    }

    const storedKeys: string[] = [];

    try {
      const sniffed = sniffMedia(await readHead(file.path));

      if (!sniffed) {
        securityLogger.log('media.upload_rejected', { orgId, reason: 'unrecognised' });
        throw new UnsupportedMediaTypeException(MEDIA_MESSAGES.UNSUPPORTED);
      }

      if (sniffed.kind === 'refused') {
        throw new UnsupportedMediaTypeException(
          sniffed.reason === 'heic' ? MEDIA_MESSAGES.HEIC : MEDIA_MESSAGES.WEBM,
        );
      }

      const name = displayName(file.originalname);

      if (sniffed.kind === 'video') {
        if (file.size > MAX_VIDEO_UPLOAD_BYTES) {
          throw new PayloadTooLargeException(MEDIA_MESSAGES.VIDEO_TOO_LARGE);
        }

        const extension = sniffed.mimeType === 'video/quicktime' ? 'mov' : 'mp4';
        const key = createMediaKey(extension);

        await this.storage.put(
          key,
          { filePath: file.path, size: file.size },
          CONTENT_TYPES[extension],
        );
        storedKeys.push(key);

        const record = await this.repository.create({
          orgId,
          name,
          originalName: name,
          path: key,
          thumbnail: null,
          type: 'video',
          mimeType: sniffed.mimeType,
          fileSize: file.size,
          width: null,
          height: null,
        });

        this.startVideoFacts(orgId, record.id);
        return { media: this.toView(record), originalBytes: file.size };
      }

      const limit =
        sniffed.mimeType === 'image/gif' ? MAX_GIF_UPLOAD_BYTES : MAX_IMAGE_UPLOAD_BYTES;

      if (file.size > limit) {
        throw new PayloadTooLargeException(
          sniffed.mimeType === 'image/gif'
            ? MEDIA_MESSAGES.GIF_TOO_LARGE
            : MEDIA_MESSAGES.IMAGE_TOO_LARGE,
        );
      }

      const processed = await processImage(file.path, sniffed);
      const key = createMediaKey(processed.extension);
      const thumbnailKey = thumbnailKeyFor(key);

      await this.storage.put(key, processed.data, processed.mimeType);
      storedKeys.push(key);
      await this.storage.put(thumbnailKey, processed.thumbnail, CONTENT_TYPES.webp);
      storedKeys.push(thumbnailKey);

      const record = await this.repository.create({
        orgId,
        name,
        originalName: name,
        path: key,
        thumbnail: thumbnailKey,
        type: 'image',
        mimeType: processed.mimeType,
        fileSize: processed.data.length,
        width: processed.width,
        height: processed.height,
      });

      return { media: this.toView(record), originalBytes: file.size };
    } catch (error) {
      await this.removeQuietly(storedKeys);

      if (error instanceof UnreadableImageError) {
        securityLogger.log('media.upload_rejected', { orgId, reason: error.message });
        throw new UnprocessableEntityException(MEDIA_MESSAGES.UNREADABLE);
      }

      throw error;
    } finally {
      await rm(file.path, { force: true }).catch(() => undefined);
    }
  }

  /**
   * Stores an image the API itself produced (the AI engine's hero image or
   * the copilot's `generate_image`, both Sprint 6) as an ordinary library item.
   *
   * Runs the same sequence as `upload` from step 1: the bytes are sniffed
   * rather than trusted (a provider that says "PNG" and sends something else
   * is treated exactly like a browser that does), compressed and stripped by
   * `processImage`, stored under random keys, and recorded, with the stored
   * objects removed again if the row write fails. The differences are what an
   * upload has and a generation does not: there is no temp file, no size limit
   * (the generator's output is bounded by its own parameters, and the decoder's
   * pixel limit still applies), and there *is* alt text, because the prompt is
   * the one honest description of the picture.
   */
  async saveGenerated(orgId: string, file: GeneratedFileInput): Promise<MediaView> {
    const sniffed = sniffMedia(file.data.subarray(0, SNIFF_BYTES));

    if (sniffed?.kind !== 'image') {
      securityLogger.log('media.upload_rejected', { orgId, reason: 'generated_not_image' });
      throw new UnsupportedMediaTypeException(MEDIA_MESSAGES.UNSUPPORTED);
    }

    const storedKeys: string[] = [];

    try {
      const processed = await processImage(file.data, sniffed, file.encode ?? {});
      const key = createMediaKey(processed.extension);
      const thumbnailKey = thumbnailKeyFor(key);

      await this.storage.put(key, processed.data, processed.mimeType);
      storedKeys.push(key);
      await this.storage.put(thumbnailKey, processed.thumbnail, CONTENT_TYPES.webp);
      storedKeys.push(thumbnailKey);

      const name = displayName(file.name);
      const record = await this.repository.create({
        orgId,
        name,
        originalName: name,
        path: key,
        thumbnail: thumbnailKey,
        type: 'image',
        mimeType: processed.mimeType,
        fileSize: processed.data.length,
        width: processed.width,
        height: processed.height,
        alt: file.alt ? stripControlChars(file.alt).trim().slice(0, MAX_ALT_LENGTH) || null : null,
      });

      return this.toView(record);
    } catch (error) {
      await this.removeQuietly(storedKeys);

      if (error instanceof UnreadableImageError) {
        securityLogger.log('media.upload_rejected', { orgId, reason: error.message });
        throw new UnprocessableEntityException(MEDIA_MESSAGES.UNREADABLE);
      }

      throw error;
    }
  }

  /**
   * Records an exported clip (Sprint 12, Module 05) as an ordinary library
   * video. The worker rendered it and stored it, with its poster, in the
   * public media space under keys it made with `createMediaKey`; this only
   * writes the row (`type: 'video'`, `origin: 'clip'` or, for a saved
   * download (Module 18), `'upload'`, its length, size and
   * frame rate, the poster as its thumbnail), inside the caller's
   * transaction when it gives one, so the row lands with the clip's export
   * mark or not at all.
   *
   * The keys are checked against the media key shape (a worker bug can never
   * point a library row at an avatar or a private key) and the numbers are
   * kept in range. Nothing is uploaded here and nothing is removed on
   * failure: the files are the worker's until the row exists, and an
   * orphaned pair is left for the storage sweep.
   */
  async saveRendered(input: RenderedVideoInput, tx?: PrismaTransactionClient): Promise<MediaView> {
    if (!isMediaKey(input.key) || !input.key.endsWith('.mp4')) {
      throw new BadRequestException(MEDIA_MESSAGES.UNSUPPORTED);
    }
    if (
      input.posterKey !== null &&
      (!isMediaKey(input.posterKey) || input.posterKey.endsWith('.mp4'))
    ) {
      throw new BadRequestException(MEDIA_MESSAGES.UNSUPPORTED);
    }

    const name = displayName(input.name);
    const record = await this.repository.create(
      {
        orgId: input.orgId,
        name,
        originalName: name,
        path: input.key,
        thumbnail: input.posterKey,
        type: 'video',
        mimeType: CONTENT_TYPES.mp4,
        fileSize: Math.min(MAX_INT, Math.max(0, Math.round(input.bytes))),
        width: wholeOrNull(input.width),
        height: wholeOrNull(input.height),
        origin: input.origin ?? 'clip',
        durationMs: wholeOrNull(input.durationMs),
        fps: Number.isFinite(input.fps) && input.fps > 0 ? input.fps : null,
      },
      tx,
    );

    return this.toView(record);
  }

  async list(
    orgId: string,
    query: ListMediaQuery,
  ): Promise<{ media: MediaView[]; page: number; pageCount: number; total: number }> {
    const { items, total } = await this.repository.list({
      orgId,
      search: query.search || undefined,
      type: query.type,
      page: query.page,
      pageSize: MEDIA_PAGE_SIZE,
    });

    return {
      media: items.map((item) => this.toView(item)),
      page: query.page,
      pageCount: Math.max(1, Math.ceil(total / MEDIA_PAGE_SIZE)),
      total,
    };
  }

  /**
   * Library items whose name contains every search term (2026-10-21), newest
   * first.
   *
   * The database narrows by the most selective word over the newest
   * `SEARCH_CANDIDATES` items and the rest is checked here, which also keeps
   * a `%` or `_` in the search from acting as a wildcard. One more match than
   * `limit` sets `more`.
   */
  async search(
    orgId: string,
    terms: string[],
    limit: number,
  ): Promise<{ media: MediaSearchHit[]; more: boolean }> {
    const { items } = await this.repository.list({
      orgId,
      search: selectiveTerm(terms),
      page: 1,
      pageSize: SEARCH_CANDIDATES,
    });

    const matches = items.filter((item) => matchesAllTerms(item.name, terms));

    return {
      media: matches.slice(0, limit).map((item) => {
        const view = this.toView(item);
        return {
          id: view.id,
          name: view.name,
          type: view.type,
          url: view.url,
          thumbnailUrl: view.thumbnailUrl,
        };
      }),
      more: matches.length > limit,
    };
  }

  /** One item: how "Use in a post" hands a library image to a new composer. */
  async get(orgId: string, id: string): Promise<MediaView> {
    const media = await this.repository.findById(orgId, id);

    if (!media) {
      throw new NotFoundException(MEDIA_MESSAGES.NOT_FOUND);
    }

    return this.toView(media);
  }

  /** How many unpublished posts would lose this attachment. */
  async usage(orgId: string, id: string): Promise<{ posts: number }> {
    const media = await this.repository.findById(orgId, id);

    if (!media) {
      throw new NotFoundException(MEDIA_MESSAGES.NOT_FOUND);
    }

    return { posts: await this.repository.countUnpublishedUsage(orgId, id) };
  }

  /**
   * Deletes an item: the row first, then its files.
   *
   * In that order so a user is never shown a tile whose image is already gone.
   * Removing the files is best-effort (a storage outage must not make an item
   * undeletable) and a failure is logged for cleanup rather than surfaced.
   */
  async remove(orgId: string, id: string): Promise<void> {
    const removed = await this.repository.softDelete(orgId, id);

    if (!removed) {
      throw new NotFoundException(MEDIA_MESSAGES.NOT_FOUND);
    }

    await this.removeQuietly(
      [removed.path, removed.thumbnail].filter((key): key is string => !!key),
    );
  }

  /**
   * Resolves media ids to views, for the posts module.
   *
   * Returns only what exists in this workspace. A missing id is simply absent
   * from the map; the caller decides whether that is an error.
   */
  async findViews(orgId: string, ids: string[]): Promise<Map<string, MediaView>> {
    const records = await this.repository.findByIds(orgId, [...new Set(ids)]);
    return new Map(records.map((record) => [record.id, this.toView(record)]));
  }

  /**
   * Reads one image's bytes back, for the Design Studio exporter (Sprint 9).
   *
   * Scoped by workspace like every other read here, so an id from another
   * workspace is simply absent rather than readable, and limited to images: a
   * slide draws pictures, so a video id in a design is a missing picture, not
   * a file to inline. Null for an item that is gone from the library or from
   * storage, which the exporter draws as an empty slot and warns about. A
   * storage that cannot be read at all throws instead, so an outage fails the
   * export rather than quietly producing slides with holes in them.
   */
  async readImageBytes(
    orgId: string,
    id: string,
  ): Promise<{ bytes: Buffer; mimeType: string } | null> {
    const records = await this.repository.findByIds(orgId, [id]);
    const record = records[0];
    if (record?.type !== 'image') return null;

    const bytes = await this.storage.read(record.path);
    if (!bytes) return null;

    return { bytes, mimeType: record.mimeType ?? 'application/octet-stream' };
  }

  /**
   * One image as a file to save (DS-8.3: each exported slide can be downloaded
   * from Media). The browser could not do this alone: media lives on another
   * origin, where it ignores a link's `download` and opens the picture instead.
   *
   * Images only. They are stored small (2048 px at most, a GIF 15 MB at most),
   * so one read into memory is cheap; a video can be 250 MB, and its player
   * already offers its own save. A row whose stored object is gone is a 404
   * like a missing row, and is logged, because the two disagreeing is a fault.
   */
  async download(orgId: string, id: string): Promise<MediaDownload> {
    const media = await this.repository.findById(orgId, id);

    if (!media) {
      throw new NotFoundException(MEDIA_MESSAGES.NOT_FOUND);
    }

    if (media.type !== 'image') {
      throw new BadRequestException(MEDIA_MESSAGES.DOWNLOAD_IMAGES_ONLY);
    }

    const bytes = await this.storage.read(media.path);

    if (!bytes) {
      this.logger.warn(`Media ${media.id} has a row but no stored object at ${media.path}`);
      throw new NotFoundException(MEDIA_MESSAGES.NOT_FOUND);
    }

    const { stem, extension } = fileNameParts(media.name, media.mimeType, 'Image');

    return {
      bytes,
      mimeType: media.mimeType ?? 'application/octet-stream',
      fileName: extension ? `${stem}.${extension}` : stem,
    };
  }

  toView(record: MediaRecord): MediaView {
    return {
      id: record.id,
      name: record.name,
      type: record.type,
      mimeType: record.mimeType,
      fileSize: record.fileSize,
      width: record.width,
      height: record.height,
      url: this.storage.publicUrl(record.path),
      thumbnailUrl: record.thumbnail ? this.storage.publicUrl(record.thumbnail) : null,
      createdAt: record.createdAt,
      durationMs: record.durationMs ?? null,
    };
  }

  /**
   * Starts the poster and length of a just-uploaded video, without waiting:
   * the person's upload is done whatever Temporal says. A start that does
   * not reach Temporal is logged; the maintenance pass covers the row.
   */
  private startVideoFacts(orgId: string, mediaId: string): void {
    const logMissed = (reason: string) =>
      this.logger.warn(
        JSON.stringify({ event: 'media.video_facts_not_started', orgId, mediaId, reason }),
      );
    try {
      void this.scheduling.startMediaVideoFacts(mediaId, orgId).then(
        (started) => {
          if (!started) logMissed('scheduler_unreachable');
        },
        (error: unknown) => logMissed(error instanceof Error ? error.message : String(error)),
      );
    } catch (error) {
      logMissed(error instanceof Error ? error.message : String(error));
    }
  }

  private async removeQuietly(keys: string[]): Promise<void> {
    await Promise.all(
      keys.map((key) =>
        this.storage.delete(key).catch((error: unknown) => {
          this.logger.warn(
            `Could not remove stored object ${key}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }),
      ),
    );
  }
}

async function readHead(path: string): Promise<Buffer> {
  const handle = await open(path, 'r');

  try {
    const buffer = Buffer.alloc(SNIFF_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, SNIFF_BYTES, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/**
 * The name shown in the library.
 *
 * Only the last path segment survives (some browsers send a full path),
 * control and direction-override characters are removed so a name cannot
 * render as something else, and the length is capped. Never used to build a
 * storage key: that is always random.
 */
export function displayName(originalName: string): string {
  const cleaned = stripControlChars(basename(originalName.replace(/\\/g, '/')))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME_LENGTH);

  return cleaned || 'Untitled upload';
}
