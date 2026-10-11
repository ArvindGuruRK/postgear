/**
 * The public URL of a stored media object.
 *
 * `Media.path` is a storage key (`2026/10/<hex>.jpg`), never a URL, so that
 * moving the store does not orphan every row. The API builds URLs through its
 * storage backend (`apps/api/src/modules/media/storage/`); this is the same
 * rule written for the worker, which has no Nest module to ask. The two must
 * agree, and the test beside this file pins the shape they agree on:
 *
 * - `local`: `<API_URL>/uploads/<key>`, served by the API's static route.
 * - `s3`:    `<S3_PUBLIC_URL>/<key>`.
 *
 * Platforms that fetch media themselves (Instagram, Facebook, Pinterest,
 * TikTok) receive these URLs, so for them the local backend only works behind
 * a tunnel — see docs/social-platform-setup.md.
 */
import type { WorkerEnv } from '../config/env';

const KEY_PATTERN = /^\d{4}\/\d{2}\/[0-9a-f]{32}(?:\.thumb)?\.(?:jpg|png|gif|webp|mp4|mov)$/;

export type MediaUrlConfig = Pick<WorkerEnv, 'STORAGE_PROVIDER' | 'API_URL' | 'S3_PUBLIC_URL'>;

export function mediaUrlBuilder(config: MediaUrlConfig): (key: string) => string {
  const base =
    config.STORAGE_PROVIDER === 's3'
      ? `${(config.S3_PUBLIC_URL ?? '').replace(/\/+$/, '')}/`
      : `${config.API_URL.replace(/\/+$/, '')}/uploads/`;

  return (key: string) => {
    if (!KEY_PATTERN.test(key)) {
      throw new Error('Refusing to build a URL for a storage key PostGear did not generate');
    }

    return `${base}${key}`;
  };
}
