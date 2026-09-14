/**
 * Picks the storage backend from the environment.
 *
 * The Sprint 4 plan asks for exactly this shape, taken from the reference's
 * `upload.factory.ts`: one environment variable decides between local disk and
 * an S3-compatible store, and nothing above this file knows which it got.
 *
 * Two differences from the reference, both deliberate. It reads its settings
 * from validated config rather than `process.env!` with non-null assertions, so
 * a missing bucket name fails at boot (see `config/env.ts`) instead of at the
 * first upload. And it is a plain function of its input, so it can be tested
 * without a Nest container.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { S3Client } from '@aws-sdk/client-s3';
import { LocalStorage } from './local.storage';
import { S3Storage } from './s3.storage';
import type { StorageBackend } from './storage.interface';

export interface StorageConfig {
  provider: 'local' | 's3';
  /** Local only. Absent means `apps/api/uploads`. */
  uploadDirectory?: string;
  /** Local only: the API's public address, which serves `/uploads`. */
  apiUrl: string;
  s3?: {
    endpoint?: string;
    region: string;
    bucket?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    publicUrl?: string;
    forcePathStyle?: 'true' | 'false';
  };
}

export function createStorage(config: StorageConfig): StorageBackend {
  switch (config.provider) {
    case 'local':
      return new LocalStorage(resolveUploadDirectory(config.uploadDirectory), config.apiUrl);

    case 's3': {
      const s3 = config.s3;

      // `validateEnv` already refuses to boot without these; this guards the
      // function when it is called with hand-built config.
      if (!s3?.bucket || !s3.accessKeyId || !s3.secretAccessKey || !s3.publicUrl) {
        throw new Error(
          'STORAGE_PROVIDER=s3 needs S3_BUCKET_NAME, S3_ACCESS_KEY, S3_SECRET_KEY and S3_PUBLIC_URL',
        );
      }

      const client = new S3Client({
        region: s3.region,
        endpoint: s3.endpoint,
        forcePathStyle:
          s3.forcePathStyle === undefined ? Boolean(s3.endpoint) : s3.forcePathStyle === 'true',
        credentials: { accessKeyId: s3.accessKeyId, secretAccessKey: s3.secretAccessKey },
      });

      return new S3Storage(client, s3.bucket, s3.publicUrl);
    }
  }
}

/**
 * The local upload directory.
 *
 * A configured path is taken as given (relative to the working directory, like
 * any path in an env file). The default is anchored to the API package instead,
 * found by walking up from this file: `npm run dev:api` runs from `apps/api`
 * but `npm run dev:api:e2e` runs from the repository root, and a
 * `process.cwd()`-relative default would split uploads across two directories —
 * with the second one serving 404s for everything the first one stored.
 */
export function resolveUploadDirectory(configured?: string): string {
  if (configured) {
    return resolve(configured);
  }

  return join(findApiPackageRoot(__dirname), 'uploads');
}

function findApiPackageRoot(start: string): string {
  let current = start;

  while (true) {
    const manifest = join(current, 'package.json');

    if (existsSync(manifest)) {
      try {
        const { name } = JSON.parse(readFileSync(manifest, 'utf8')) as { name?: string };

        if (name === '@postgear/api') {
          return current;
        }
      } catch {
        // An unreadable manifest is not the one being looked for; keep climbing.
      }
    }

    const parent = dirname(current);

    if (parent === current) {
      throw new Error('Could not locate the @postgear/api package; set UPLOAD_DIRECTORY');
    }

    current = parent;
  }
}
