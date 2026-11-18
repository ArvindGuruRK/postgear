/**
 * Public object keys: generated here, validated everywhere.
 *
 * A media key looks like `2026/09/3f9c...e1.jpg`: a date prefix so a bucket
 * listing is browsable, and 128 bits of CSPRNG output so a URL cannot be
 * guessed. Media is served publicly (platforms fetch it without credentials),
 * which makes the unguessable name the access control: the same model as an
 * unlisted S3 URL.
 *
 * The reference builds its names from `Math.random()`, digit by digit, with
 * `Math.round(Math.random() * 16)`: which is not a CSPRNG and also yields "10"
 * one time in 32, so the names are neither unpredictable nor uniform.
 *
 * `assertValidKey` is what makes path traversal impossible in the local backend
 * rather than merely unlikely: the only keys it accepts are ones this file could
 * have produced, and none of those contain a separator it did not put there.
 *
 * Moved from `apps/api/src/modules/media/storage/` in Sprint 12 so the worker
 * reads the same patterns instead of keeping a copy of them.
 */
import { randomBytes } from 'node:crypto';

/** Extensions PostGear stores, and the content type each is served with. */
export const CONTENT_TYPES = {
  jpg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
} as const;

/** An extension a media upload may be stored with. */
export type StoredExtension = keyof typeof CONTENT_TYPES;

/**
 * The shape of a media library key. Exported so the worker builds public URLs
 * against the very same rule the API stores with.
 */
export const MEDIA_KEY_PATTERN = /^\d{4}\/\d{2}\/[0-9a-f]{32}(?:\.thumb)?\.(?:jpg|png|gif|webp|mp4|mov)$/;

/** A new media key under this month's prefix, with 128 random bits. */
export function createMediaKey(extension: StoredExtension, now: Date = new Date()): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');

  return `${year}/${month}/${randomBytes(16).toString('hex')}.${extension}`;
}

/** The thumbnail's key sits beside its original, so one prefix covers both. */
export function thumbnailKeyFor(key: string): string {
  return key.replace(/\.[a-z0-9]+$/, '.thumb.webp');
}

/** True for a media library key (an upload or its thumbnail). */
export function isMediaKey(key: string): boolean {
  return MEDIA_KEY_PATTERN.test(key);
}

/**
 * User avatars (UI revamp, 2026-10-17): `avatars/<userId>/<128 random bits>.webp`.
 *
 * Kept under their own prefix, outside the dated media tree, because an avatar
 * belongs to a person rather than to a workspace and has no `Media` row: a
 * bucket listing should not mix the two. The user id is a UUID, so the
 * segment is as tightly shaped as the rest of the key; the random file name is
 * still what makes the URL unguessable.
 */
const AVATAR_KEY_PATTERN =
  /^avatars\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{32}\.webp$/;

/** A new avatar key for one user, validated before it is handed out. */
export function createAvatarKey(userId: string): string {
  const key = `avatars/${userId}/${randomBytes(16).toString('hex')}.webp`;
  assertValidKey(key);
  return key;
}

/** True for a user avatar key. */
export function isAvatarKey(key: string): boolean {
  return AVATAR_KEY_PATTERN.test(key);
}

/**
 * The Clips sound and sticker catalogue (Sprint 12), in the public bucket:
 * `library/sounds/<2 hex>/<sha256>.m4a`, `library/stickers/<2 hex>/<sha256>.apng`
 * or `.png`, and `library/previews/<2 hex>/<sha256>.webp`.
 *
 * The file name is the content's SHA-256, so a key never changes meaning and
 * the files are cached for a year; the two-hex folder is the hash's own first
 * two characters, which spreads a large catalogue over 256 folders.
 */
const LIBRARY_KEY_PATTERN =
  /^library\/(?:sounds\/([0-9a-f]{2})\/([0-9a-f]{64})\.m4a|stickers\/([0-9a-f]{2})\/([0-9a-f]{64})\.(?:apng|png)|previews\/([0-9a-f]{2})\/([0-9a-f]{64})\.webp)$/;

/** Cache header for catalogue files: content-addressed, so immutable. */
export const LIBRARY_CACHE_CONTROL = 'public, max-age=31536000, immutable';

const SHA256_HEX = /^[0-9a-f]{64}$/;

function libraryKey(folder: 'sounds' | 'stickers' | 'previews', sha256: string, ext: string): string {
  if (!SHA256_HEX.test(sha256)) {
    throw new Error('A library key needs a lowercase SHA-256 hex digest');
  }

  const key = `library/${folder}/${sha256.slice(0, 2)}/${sha256}.${ext}`;
  assertValidLibraryKey(key);
  return key;
}

/**
 * Builders for the public catalogue keys. Modules 12 and 14 call these from the
 * operator's ingest command; nothing else writes under `library/`.
 */
export const libraryKeys = {
  /** A sound, always stored as AAC in MP4. */
  sound: (sha256: string): string => libraryKey('sounds', sha256, 'm4a'),
  /** A sticker: animated stickers are APNG, still ones PNG. */
  sticker: (sha256: string, ext: 'apng' | 'png'): string => libraryKey('stickers', sha256, ext),
  /** The small WebP shown in the picker. */
  preview: (sha256: string): string => libraryKey('previews', sha256, 'webp'),
} as const;

/** True for a catalogue key whose folder matches its own hash. */
export function isValidLibraryKey(key: string): boolean {
  const match = LIBRARY_KEY_PATTERN.exec(key);
  if (!match) return false;

  // Exactly one of the three alternatives matched; its folder must be the
  // first two characters of its hash, or one file could live at two keys.
  const folder = match[1] ?? match[3] ?? match[5];
  const hash = match[2] ?? match[4] ?? match[6];
  return folder !== undefined && hash?.startsWith(folder) === true;
}

/** Throws for anything that is not a catalogue key. */
export function assertValidLibraryKey(key: string): void {
  if (!isValidLibraryKey(key)) {
    throw new Error('Refusing to touch a library key PostGear did not generate');
  }
}

/** True for any key the public space may hold: media, avatars and the catalogue. */
export function isValidKey(key: string): boolean {
  return MEDIA_KEY_PATTERN.test(key) || AVATAR_KEY_PATTERN.test(key) || isValidLibraryKey(key);
}

/** Throws for a key the public space must never touch. */
export function assertValidKey(key: string): void {
  if (!isValidKey(key)) {
    throw new Error('Refusing to touch a storage key PostGear did not generate');
  }
}
