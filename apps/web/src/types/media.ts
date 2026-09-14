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
  /** Null for video, which has no generated poster yet. */
  thumbnailUrl: string | null;
  createdAt: string;
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
