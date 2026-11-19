import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';
import { SchedulingModule } from '../scheduling/scheduling.module';
import { MediaController } from './media.controller';
import { MediaRepository } from './media.repository';
import { MediaService } from './media.service';
import { PRIVATE_STORAGE, STORAGE_BACKEND } from './storage/storage.interface';
import {
  createPrivateStorage,
  createStorage,
  type PrivateStorageConfig,
  type StorageConfig,
} from '@postgear/storage';

/** Sprint 12: the Clips private space, from the same variables plus its own bucket and key. */
export function privateStorageConfigFrom(config: ConfigService<Env, true>): PrivateStorageConfig {
  return {
    provider: config.get('STORAGE_PROVIDER', { infer: true }),
    nodeEnv: config.get('NODE_ENV', { infer: true }),
    uploadDirectory: config.get('UPLOAD_DIRECTORY', { infer: true }),
    apiUrl: config.get('API_URL', { infer: true }),
    urlSecret: config.get('CLIPS_URL_SECRET', { infer: true }),
    s3: {
      endpoint: config.get('S3_ENDPOINT', { infer: true }),
      region: config.get('S3_REGION', { infer: true }),
      bucket: config.get('CLIPS_PRIVATE_BUCKET', { infer: true }),
      accessKeyId: config.get('S3_ACCESS_KEY', { infer: true }),
      secretAccessKey: config.get('S3_SECRET_KEY', { infer: true }),
      forcePathStyle: config.get('S3_FORCE_PATH_STYLE', { infer: true }),
    },
  };
}

/**
 * Builds storage config from validated environment values.
 *
 * Exported because `main.ts` needs the same answer to mount the static route
 * for local uploads: two copies of this mapping would be two chances to
 * serve from a different directory than the one being written to.
 */
export function storageConfigFrom(config: ConfigService<Env, true>): StorageConfig {
  return {
    provider: config.get('STORAGE_PROVIDER', { infer: true }),
    uploadDirectory: config.get('UPLOAD_DIRECTORY', { infer: true }),
    apiUrl: config.get('API_URL', { infer: true }),
    s3: {
      endpoint: config.get('S3_ENDPOINT', { infer: true }),
      region: config.get('S3_REGION', { infer: true }),
      bucket: config.get('S3_BUCKET_NAME', { infer: true }),
      accessKeyId: config.get('S3_ACCESS_KEY', { infer: true }),
      secretAccessKey: config.get('S3_SECRET_KEY', { infer: true }),
      publicUrl: config.get('S3_PUBLIC_URL', { infer: true }),
      forcePathStyle: config.get('S3_FORCE_PATH_STYLE', { infer: true }),
    },
  };
}

/**
 * The media library.
 *
 * The storage backend is a provider behind a token rather than a class import,
 * so the service never knows which one it has and a test can hand it a fake.
 * `MediaService` is exported for the posts module, which resolves attachments
 * through it rather than reading `Media` rows itself.
 *
 * `STORAGE_BACKEND` is exported too (UI revamp, 2026-10-17) so user avatars are
 * written to the same local directory or bucket as media, from the same
 * validated config, without a second factory call that could drift from this
 * one. Avatars use the backend directly and never create a `Media` row.
 */
@Module({
  // Module 19: an uploaded video's poster and length start on the media worker.
  imports: [SchedulingModule],
  controllers: [MediaController],
  providers: [
    MediaService,
    MediaRepository,
    {
      provide: STORAGE_BACKEND,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => createStorage(storageConfigFrom(config)),
    },
    // Sprint 12: the Clips private space (imported videos, previews, exports
    // before they become Media). Refused on local disk in production.
    {
      provide: PRIVATE_STORAGE,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        createPrivateStorage(privateStorageConfigFrom(config)),
    },
  ],
  exports: [MediaService, STORAGE_BACKEND, PRIVATE_STORAGE],
})
export class MediaModule {}
