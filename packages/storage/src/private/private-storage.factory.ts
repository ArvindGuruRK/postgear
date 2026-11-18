/**
 * Picks the private Clips binding from the environment.
 *
 * It follows `STORAGE_PROVIDER`, like the public space: `s3` means the private
 * bucket `CLIPS_PRIVATE_BUCKET` on the same S3 endpoint and key pair, `local`
 * means a folder beside the upload directory.
 *
 * Production needs S3 (decision D12-05). The API and the worker are separate
 * containers there and signed addresses need object storage, so the local
 * binding is refused when NODE_ENV=production.
 */
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createS3Client } from '../s3-client';
import { privateDirectoryFor, resolveUploadDirectory } from '../storage.factory';
import { MIN_URL_SECRET_LENGTH } from './file-token';
import { LocalPrivateStorage } from './local-private.storage';
import { DEFAULT_CLIPS_PRIVATE_BUCKET, type PrivateStorage } from './private-storage.interface';
import { S3PrivateStorage } from './s3-private.storage';

/** Settings for the private space, mapped from the environment by each app. */
export interface PrivateStorageConfig {
  provider: 'local' | 's3';
  /** `NODE_ENV`; the local binding is refused for `production`. */
  nodeEnv: string;
  /** Local only: `UPLOAD_DIRECTORY`; the private folder sits beside it. */
  uploadDirectory?: string;
  /** Local only: the API's address, which serves `/clips/files/<token>`. */
  apiUrl: string;
  /**
   * Local only: `CLIPS_URL_SECRET`. Unset in development means a random secret
   * kept in the private folder, shared by every process on this machine.
   */
  urlSecret?: string;
  s3?: {
    endpoint?: string;
    region: string;
    /** `CLIPS_PRIVATE_BUCKET`; unset means `postgear-clips`. */
    bucket?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    forcePathStyle?: 'true' | 'false';
  };
}

/** The message production sees when it is configured for local disk. */
export const LOCAL_PRIVATE_REFUSED =
  'Clips needs an S3 bucket in production: set the S3 variables.';

/** Builds the private binding the config asks for. */
export function createPrivateStorage(config: PrivateStorageConfig): PrivateStorage {
  switch (config.provider) {
    case 'local': {
      if (config.nodeEnv === 'production') {
        throw new Error(LOCAL_PRIVATE_REFUSED);
      }

      const folder = privateDirectoryFor(resolveUploadDirectory(config.uploadDirectory));
      const secret = config.urlSecret ?? localUrlSecret(folder);
      return new LocalPrivateStorage(folder, config.apiUrl, secret);
    }

    case 's3': {
      const s3 = config.s3;
      if (!s3?.accessKeyId || !s3.secretAccessKey) {
        throw new Error('Clips storage on S3 needs S3_ACCESS_KEY and S3_SECRET_KEY');
      }

      const client = createS3Client({
        endpoint: s3.endpoint,
        region: s3.region,
        accessKeyId: s3.accessKeyId,
        secretAccessKey: s3.secretAccessKey,
        forcePathStyle: s3.forcePathStyle,
      });

      return new S3PrivateStorage(client, s3.bucket || DEFAULT_CLIPS_PRIVATE_BUCKET);
    }
  }
}

/**
 * The development signing secret when `CLIPS_URL_SECRET` is unset: 32 random
 * bytes kept in `<private folder>/.url-secret`, made on first use.
 *
 * A file rather than a per-process random value, so the API and the worker
 * (and the API after a restart) agree, and links handed to a player keep
 * working while the API reloads. Never used in production, where the env
 * schema requires the variable and the local binding is refused anyway.
 */
export function localUrlSecret(folder: string): string {
  const file = join(folder, '.url-secret');
  mkdirSync(folder, { recursive: true });

  const existing = readSecret(file);
  if (existing) return existing;

  try {
    writeFileSync(file, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 });
  } catch (error) {
    // Another process won the race: read what it wrote.
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }

  const created = readSecret(file);
  if (!created) {
    throw new Error('Could not set up the local Clips signing secret; set CLIPS_URL_SECRET');
  }
  return created;
}

function readSecret(file: string): string | null {
  try {
    const value = readFileSync(file, 'utf8').trim();
    return value.length >= MIN_URL_SECRET_LENGTH ? value : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}
