/**
 * The private Clips space (Sprint 12): imported videos, proxies, working files,
 * Preview Exports, prepared downloads and a workspace's own stickers and sounds.
 *
 * Nothing here is public. The API and the worker read and write it with their
 * own credentials; a browser reaches one file only through `signedUrl`, an
 * address that expires. Keys come from `clipKeys` and are checked on every
 * call, so a bad key fails before any disk or bucket is touched.
 *
 * Two bindings: S3 (a private bucket, `CLIPS_PRIVATE_BUCKET`, presigned URLs)
 * and local disk for development (a folder beside the uploads, served by the
 * API's `/clips/files/<token>` route). The local one is refused in production.
 */
import type { Readable } from 'node:stream';
import type { ByteRange } from './http';

/** Size of a stored object. */
export interface PrivateObjectInfo {
  bytes: number;
}

/** A readable object, or the requested part of it. */
export interface PrivateObjectStream {
  body: Readable;
  /** Bytes in `body`: the range's length, or the whole object's. */
  bytes: number;
  /** The whole object's size, for `Content-Range`. */
  totalBytes: number;
  /** The range served, both ends inclusive; null when the whole object is. */
  range: { start: number; end: number } | null;
}

/** Options for a signed read address. */
export interface SignedUrlOptions {
  /** How long the address works, 1 second to 7 days. */
  expiresInSeconds: number;
  /** When set, the browser saves the file under this name instead of playing it. */
  downloadName?: string;
}

/** One finished part of a multipart upload, as the browser reports it. */
export interface UploadedPart {
  partNumber: number;
  etag: string;
}

/** The private space. Both bindings behave the same from the outside. */
export interface PrivateStorage {
  readonly kind: 'local' | 's3';

  /** Stores bytes or a stream (overwrites, as S3 does). */
  put(key: string, body: Buffer | Readable, contentType: string): Promise<PrivateObjectInfo>;

  /** Stores a file from disk; multipart above 64 MB, never read into memory. */
  putFile(key: string, filePath: string, contentType: string): Promise<PrivateObjectInfo>;

  /**
   * Streams an object to a file on disk, never buffering it. Writes beside the
   * target first, so an aborted or failed copy never leaves a half file at
   * `filePath`. Throws `StorageNotFoundError` when the object is missing.
   */
  getToFile(key: string, filePath: string, signal?: AbortSignal): Promise<void>;

  /**
   * Opens an object, or a byte range of it, for streaming. Null when it is
   * missing; throws `StorageRangeError` for a range outside it.
   */
  getStream(key: string, range?: ByteRange): Promise<PrivateObjectStream | null>;

  /** The object's size, or null when it is missing. */
  stat(key: string): Promise<PrivateObjectInfo | null>;

  /** True when the object is there. */
  exists(key: string): Promise<boolean>;

  /** Removes an object. Succeeds when it is already gone. */
  delete(key: string): Promise<void>;

  /**
   * Removes everything under a prefix from `clipKeys` (a workspace, a video, a
   * job or a folder) and answers how many objects went. Pages through any
   * number of objects.
   */
  deletePrefix(prefix: string): Promise<number>;

  /** A read address that expires; the only way a browser reaches a file. */
  signedUrl(key: string, opts: SignedUrlOptions): Promise<string>;

  /** Starts a browser upload in parts (Module 04). */
  createUpload(key: string, contentType: string): Promise<{ uploadId: string }>;

  /** An address the browser PUTs one part to; it expires after an hour. */
  signPart(key: string, uploadId: string, partNumber: number): Promise<string>;

  /** Joins the parts, in part order, into the object. */
  completeUpload(key: string, uploadId: string, parts: UploadedPart[]): Promise<PrivateObjectInfo>;

  /** Drops an unfinished upload. Succeeds when it is already gone. */
  abortUpload(key: string, uploadId: string): Promise<void>;
}

/** Above this size `putFile` uploads in parts. */
export const MULTIPART_THRESHOLD_BYTES = 64 * 1024 * 1024;

/** Part size for server-side multipart uploads. */
export const MULTIPART_PART_BYTES = 16 * 1024 * 1024;

/** How long a part upload address works. */
export const PART_URL_SECONDS = 60 * 60;

/** Cache header every private object carries. */
export const PRIVATE_CACHE_CONTROL = 'private, max-age=3600';

/** The private bucket's name when `CLIPS_PRIVATE_BUCKET` is unset. */
export const DEFAULT_CLIPS_PRIVATE_BUCKET = 'postgear-clips';

/** The API route that serves local private files: `${API_URL}/clips/files/<token>`. */
export const CLIP_FILES_ROUTE = '/clips/files';
