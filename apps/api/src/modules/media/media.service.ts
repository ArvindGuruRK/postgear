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
import { securityLogger } from '../../common/logging/security-logger';
import { stripControlChars } from '../../common/sanitize';
import { matchesAllTerms, selectiveTerm } from '../../common/search-terms';
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
import { CONTENT_TYPES, createMediaKey, thumbnailKeyFor } from './storage/storage-keys';

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
  /** A small preview for grids. Null for video, which has no generated poster yet. */
  thumbnailUrl: string | null;
  createdAt: Date;
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
      const processed = await processImage(file.data, sniffed);
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
    };
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
