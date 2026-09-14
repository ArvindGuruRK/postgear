/**
 * Object keys — generated here, validated everywhere.
 *
 * A key looks like `2026/09/3f9c…e1.jpg`: a date prefix so a bucket listing is
 * browsable, and 128 bits of CSPRNG output so a URL cannot be guessed. Media is
 * served publicly (platforms fetch it without credentials), which makes the
 * unguessable name the access control — the same model as an unlisted S3 URL.
 *
 * The reference builds its names from `Math.random()`, digit by digit, with
 * `Math.round(Math.random() * 16)` — which is not a CSPRNG and also yields "10"
 * one time in 32, so the names are neither unpredictable nor uniform.
 *
 * `assertValidKey` is what makes path traversal impossible in the local backend
 * rather than merely unlikely: the only keys it accepts are ones this file could
 * have produced, and none of those contain a separator it did not put there.
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

export type StoredExtension = keyof typeof CONTENT_TYPES;

const KEY_PATTERN = /^\d{4}\/\d{2}\/[0-9a-f]{32}(?:\.thumb)?\.(?:jpg|png|gif|webp|mp4|mov)$/;

export function createMediaKey(extension: StoredExtension, now: Date = new Date()): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');

  return `${year}/${month}/${randomBytes(16).toString('hex')}.${extension}`;
}

/** The thumbnail's key sits beside its original, so one prefix covers both. */
export function thumbnailKeyFor(key: string): string {
  return key.replace(/\.[a-z0-9]+$/, '.thumb.webp');
}

export function isValidKey(key: string): boolean {
  return KEY_PATTERN.test(key);
}

export function assertValidKey(key: string): void {
  if (!isValidKey(key)) {
    throw new Error('Refusing to touch a storage key PostGear did not generate');
  }
}
