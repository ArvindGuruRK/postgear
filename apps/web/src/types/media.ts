/**
 * Media library shapes, mirroring what `GET /media` and `POST /media` return.
 *
 * Note the absence of storage keys: the API sends URLs only, built by whichever
 * storage backend the deployment uses.
 */

export type MediaKind = 'image' | 'video';

export interface MediaItem {
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
   * An image's thumbnail, or a video's poster (Sprint 12, Module 19): null
   * until the media worker has made it, or when the file could not be read.
   */
  thumbnailUrl: string | null;
  createdAt: string;
  /**
   * Sprint 12: a video's length, so the composer holds it to each platform's
   * length rules and the library shows it ("0:42"); null when unknown. Older
   * uploads gain it over the maintenance passes (Module 19).
   */
  durationMs?: number | null;
}

export interface MediaPage {
  media: MediaItem[];
  page: number;
  pageCount: number;
  total: number;
}

export interface UploadResult {
  media: MediaItem;
  /** The size of the file before compression, for the "saved 93%" message. */
  originalBytes: number;
}
