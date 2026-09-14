import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';
import { MediaController } from './media.controller';
import { MediaRepository } from './media.repository';
import { MediaService } from './media.service';
import { STORAGE_BACKEND } from './storage/storage.interface';
import { createStorage, type StorageConfig } from './storage/storage.factory';

/**
 * Builds storage config from validated environment values.
 *
 * Exported because `main.ts` needs the same answer to mount the static route
 * for local uploads — two copies of this mapping would be two chances to
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
 */
@Module({
  controllers: [MediaController],
  providers: [
    MediaService,
    MediaRepository,
    {
      provide: STORAGE_BACKEND,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => createStorage(storageConfigFrom(config)),
    },
  ],
  exports: [MediaService],
})
export class MediaModule {}
