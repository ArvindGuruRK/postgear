/**
 * The worker's Clips settings, mapped from its validated environment.
 *
 * The two storage mappings mirror the API's (`media.module.ts`:
 * `storageConfigFrom` and `privateStorageConfigFrom`) field for field, so the
 * worker writes to the same folders and buckets the API reads from. The
 * local private binding signs `/clips/files/<token>` links with the same
 * secret file the API uses, so either process can make a link the other
 * serves.
 */
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import type { PrivateStorageConfig, StorageConfig } from '@postgear/storage';
import type { WorkerEnv } from '../config/env';

export function publicStorageConfigFrom(env: WorkerEnv): StorageConfig {
  return {
    provider: env.STORAGE_PROVIDER,
    uploadDirectory: env.UPLOAD_DIRECTORY,
    apiUrl: env.API_URL,
    s3: {
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      bucket: env.S3_BUCKET_NAME,
      accessKeyId: env.S3_ACCESS_KEY,
      secretAccessKey: env.S3_SECRET_KEY,
      publicUrl: env.S3_PUBLIC_URL,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
    },
  };
}

export function privateStorageConfigFrom(env: WorkerEnv): PrivateStorageConfig {
  return {
    provider: env.STORAGE_PROVIDER,
    nodeEnv: env.NODE_ENV,
    uploadDirectory: env.UPLOAD_DIRECTORY,
    apiUrl: env.API_URL,
    urlSecret: env.CLIPS_URL_SECRET,
    s3: {
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      bucket: env.CLIPS_PRIVATE_BUCKET,
      accessKeyId: env.S3_ACCESS_KEY,
      secretAccessKey: env.S3_SECRET_KEY,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
    },
  };
}

/** Where jobs work: `CLIPS_SCRATCH_DIR`, or `<os temp>/postgear-clips`. Always absolute. */
export function scratchRootFrom(env: Pick<WorkerEnv, 'CLIPS_SCRATCH_DIR'>): string {
  const configured = env.CLIPS_SCRATCH_DIR;
  if (!configured) return join(tmpdir(), 'postgear-clips');
  return isAbsolute(configured) ? configured : resolve(configured);
}

/** True when fetches come from fixtures and the sample videos. */
export function clipsSimulated(env: Pick<WorkerEnv, 'CLIPS_SIMULATION'>): boolean {
  return env.CLIPS_SIMULATION === 'true';
}
