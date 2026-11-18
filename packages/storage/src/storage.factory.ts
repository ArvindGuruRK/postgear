/**
 * Picks the public storage backend from the environment, and finds the local
 * upload directory.
 *
 * The Sprint 4 plan asks for exactly this shape, taken from the reference's
 * `upload.factory.ts`: one environment variable decides between local disk and
 * an S3-compatible store, and nothing above this file knows which it got.
 *
 * Two differences from the reference, both deliberate. It reads its settings
 * from validated config rather than `process.env!` with non-null assertions, so
 * a missing bucket name fails at boot (see the API's `config/env.ts`) instead
 * of at the first upload. And it is a plain function of its input, so it can be
 * tested without a Nest container.
 */
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { LocalStorage } from './local.storage';
import { createS3Client } from './s3-client';
import { S3Storage } from './s3.storage';
import type { StorageBackend } from './storage.interface';

/** Settings for the public space, mapped from the environment by each app. */
export interface StorageConfig {
  provider: 'local' | 's3';
  /** Local only. Absent means `<repo root>/apps/api/uploads`. */
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

/** Builds the public backend the config asks for. */
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

      const client = createS3Client({
        endpoint: s3.endpoint,
        region: s3.region,
        accessKeyId: s3.accessKeyId,
        secretAccessKey: s3.secretAccessKey,
        forcePathStyle: s3.forcePathStyle,
      });

      return new S3Storage(client, s3.bucket, s3.publicUrl);
    }
  }
}

/**
 * The local upload directory, the same answer for the API and the worker.
 *
 * A configured path (`UPLOAD_DIRECTORY`) is taken as given: an absolute path
 * as is, a relative one against the working directory, like any path in an env
 * file. Since the API and the worker start from different directories, a
 * relative value would point them at two places, so set an absolute one or
 * leave it unset.
 *
 * Unset means `apps/api/uploads` under the repository root, found by walking
 * up from `start` (this file by default) to the `package.json` that declares
 * `workspaces`. That holds whichever directory a process starts from: `npm run
 * dev:api` runs from `apps/api`, `npm run dev:api:e2e` from the root, the
 * worker from `apps/worker`, and all three land on one directory.
 */
export function resolveUploadDirectory(configured?: string, start: string = __dirname): string {
  if (configured) {
    return resolve(configured);
  }

  return join(findWorkspaceRoot(start), 'apps', 'api', 'uploads');
}

/**
 * The private Clips folder for local development: beside the upload directory,
 * never inside it.
 *
 * Inside would put it under the public `/uploads` static route, and a file in
 * the private space must not be reachable by its key. `apps/api/uploads` gives
 * `apps/api/uploads-private`.
 */
export function privateDirectoryFor(uploadDirectory: string): string {
  const absolute = resolve(uploadDirectory);
  const parent = dirname(absolute);

  if (parent === absolute) {
    throw new Error('The upload directory cannot be a filesystem root; set UPLOAD_DIRECTORY');
  }

  return join(parent, `${basename(absolute)}-private`);
}

/**
 * The repository root: the nearest folder upwards whose `package.json` has a
 * `workspaces` field.
 */
export function findWorkspaceRoot(start: string): string {
  let current = resolve(start);

  while (true) {
    const manifest = join(current, 'package.json');

    if (existsSync(manifest)) {
      try {
        const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as { workspaces?: unknown };

        if (parsed.workspaces !== undefined) {
          return current;
        }
      } catch {
        // An unreadable manifest is not the one being looked for; keep climbing.
      }
    }

    const parent = dirname(current);

    if (parent === current) {
      throw new Error('Could not find the repository root; set UPLOAD_DIRECTORY');
    }

    current = parent;
  }
}
