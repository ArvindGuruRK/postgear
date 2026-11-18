/**
 * Typed storage failures, so callers branch on a class rather than on a
 * message. Messages are plain and never hold a path, a bucket address or a
 * signed token.
 */

/** The object is not in the private space. */
export class StorageNotFoundError extends Error {
  readonly code = 'storage_not_found' as const;

  constructor() {
    super('That file is not in storage');
    this.name = 'StorageNotFoundError';
  }
}

/** A byte range lies outside the object (HTTP 416). */
export class StorageRangeError extends Error {
  readonly code = 'storage_range' as const;

  constructor() {
    super('That byte range is outside the file');
    this.name = 'StorageRangeError';
  }
}

/** A part upload does not match what was started or what was sent. */
export class StorageUploadError extends Error {
  readonly code = 'storage_upload' as const;

  constructor(message: string) {
    super(message);
    this.name = 'StorageUploadError';
  }
}
