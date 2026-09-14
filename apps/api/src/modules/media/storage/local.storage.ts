/**
 * Local-disk storage, for development.
 *
 * Files are written under the upload directory and served back by a static
 * route in `main.ts` at `/uploads/<key>`. That route is public for the same
 * reason S3 objects are: platforms fetch media without a PostGear session.
 *
 * Not for production publishing. Its URLs point at the API's own address, which
 * Instagram, Facebook, Pinterest and TikTok cannot reach when that is
 * `localhost` — and those four fetch the media themselves.
 */
import { constants } from 'node:fs';
import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import type { StorageBackend, StorageBody } from './storage.interface';
import { assertValidKey } from './storage-keys';

/** The path the static route is mounted on. `main.ts` reads it from here. */
export const UPLOADS_ROUTE = '/uploads';

export class LocalStorage implements StorageBackend {
  readonly kind = 'local' as const;
  private readonly root: string;

  constructor(
    root: string,
    private readonly publicBaseUrl: string,
  ) {
    this.root = resolve(root);
  }

  async put(key: string, body: StorageBody, _contentType: string): Promise<void> {
    const target = this.pathFor(key);
    await mkdir(dirname(target), { recursive: true });

    // Exclusive create: keys are random and never reused, so an existing file
    // here means something has gone wrong, and overwriting it would silently
    // swap the media behind a published post.
    if (Buffer.isBuffer(body)) {
      await writeFile(target, body, { flag: 'wx' });
    } else {
      await copyFile(body.filePath, target, constants.COPYFILE_EXCL);
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }

  publicUrl(key: string): string {
    assertValidKey(key);
    return `${this.publicBaseUrl.replace(/\/+$/, '')}${UPLOADS_ROUTE}/${key}`;
  }

  /** The directory the static route serves. */
  get directory(): string {
    return this.root;
  }

  private pathFor(key: string): string {
    assertValidKey(key);

    const target = resolve(this.root, key);

    // Unreachable for a key that passed validation. Kept anyway: this is the
    // one line standing between a bad key and a write outside the directory.
    if (!target.startsWith(this.root + sep)) {
      throw new Error('Refusing to write outside the upload directory');
    }

    return target;
  }
}
