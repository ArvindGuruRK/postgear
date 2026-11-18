/**
 * Nest injection tokens for the two storage spaces.
 *
 * The code itself lives in `@postgear/storage` (Sprint 12), shared with the
 * worker; only the tokens stay here because they are a Nest concern. The
 * types are re-exported so existing imports keep reading from one place.
 */
export type { PrivateStorage, StorageBackend, StorageBody } from '@postgear/storage';

/** The public space: media, avatars and the Clips catalogue. */
export const STORAGE_BACKEND = Symbol('STORAGE_BACKEND');

/** The private Clips space, reached by browsers only through signed addresses. */
export const PRIVATE_STORAGE = Symbol('PRIVATE_STORAGE');
