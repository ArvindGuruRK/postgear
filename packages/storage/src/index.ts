/**
 * `@postgear/storage`: file storage shared by the API and the worker (Node only).
 *
 * Two spaces. The public one (`StorageBackend`) holds media, avatars and the
 * Clips sound and sticker catalogue, served by URL to browsers and platforms.
 * The private one (`PrivateStorage`) holds Clips' imported videos and working
 * files, reached only through signed addresses that expire.
 */

// Public space.
export type { StorageBackend, StorageBody } from './storage.interface';
export {
  assertValidKey,
  assertValidLibraryKey,
  CONTENT_TYPES,
  createAvatarKey,
  createMediaKey,
  isAvatarKey,
  isMediaKey,
  isValidKey,
  isValidLibraryKey,
  LIBRARY_CACHE_CONTROL,
  libraryKeys,
  MEDIA_KEY_PATTERN,
  type StoredExtension,
  thumbnailKeyFor,
} from './storage-keys';
export { LocalStorage, UPLOADS_ROUTE } from './local.storage';
export { S3Storage } from './s3.storage';
export {
  createStorage,
  findWorkspaceRoot,
  privateDirectoryFor,
  resolveUploadDirectory,
  type StorageConfig,
} from './storage.factory';
export {
  createS3Client,
  isS3NotFound,
  type S3ConnectionConfig,
} from './s3-client';

// Private Clips space.
export {
  assertValidClipKey,
  assertValidClipListPrefix,
  assertValidClipPrefix,
  CLIP_EXTENSIONS,
  CLIP_JOB_FOLDERS,
  type ClipExtension,
  type ClipJobFolder,
  clipKeys,
  clipKindSegment,
  contentTypeForClipKey,
  isValidClipKey,
  isValidClipListPrefix,
  isValidClipPrefix,
} from './clip-keys';
export {
  CLIP_FILES_ROUTE,
  DEFAULT_CLIPS_PRIVATE_BUCKET,
  MULTIPART_PART_BYTES,
  MULTIPART_THRESHOLD_BYTES,
  PART_URL_SECONDS,
  PRIVATE_CACHE_CONTROL,
  type PrivateListedObject,
  type PrivateListPage,
  type PrivateObjectInfo,
  type PrivateObjectStream,
  type PrivateStorage,
  type SignedUrlOptions,
  type UploadedPart,
} from './private/private-storage.interface';
export {
  StorageNotFoundError,
  StorageRangeError,
  StorageUploadError,
} from './private/errors';
export {
  type ByteRange,
  contentDispositionFor,
  parseRangeHeader,
  type ResolvedRange,
  resolveRange,
  safeDownloadName,
} from './private/http';
export {
  assertSignedUrlSeconds,
  expiryFrom,
  type FileTokenClaims,
  type FileTokenFailure,
  type FileTokenResult,
  isPartNumber,
  MAX_SIGNED_URL_SECONDS,
  MIN_URL_SECRET_LENGTH,
  signFileToken,
  verifyFileToken,
} from './private/file-token';
export {
  LocalPrivateStorage,
  type LocalPrivateStorageOptions,
  MAX_LOCAL_PART_BYTES,
} from './private/local-private.storage';
export {
  parseContentRange,
  type Presigner,
  S3PrivateStorage,
  type S3PrivateStorageOptions,
  type Uploader,
  type UploaderOptions,
} from './private/s3-private.storage';
export {
  createPrivateStorage,
  LOCAL_PRIVATE_REFUSED,
  type PrivateStorageConfig,
} from './private/private-storage.factory';
