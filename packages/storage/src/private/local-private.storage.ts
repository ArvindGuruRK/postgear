/**
 * The private Clips space on local disk, for development only.
 *
 * Files live in a folder beside the upload directory (never inside it, so the
 * public `/uploads` route cannot serve them). A browser reaches a file only
 * through `${API_URL}/clips/files/<token>`, which the API serves with Range
 * support after `verify(token)`. Browser uploads in parts are kept as part
 * files under `.uploads/<uploadId>/` and joined on complete; the API's PUT
 * handler for a part token calls `receivePart`.
 *
 * Every write lands in `.tmp/` first and is renamed into place, so a crash or
 * an abort never leaves half a file at a key. The factory refuses this binding
 * when NODE_ENV=production: the API and the worker run in separate containers
 * there and cannot share a disk.
 */
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { type Readable, Transform, type TransformCallback } from 'node:stream';
import { finished, pipeline } from 'node:stream/promises';
import { assertValidClipKey, assertValidClipListPrefix, assertValidClipPrefix } from '../clip-keys';
import { StorageNotFoundError, StorageRangeError, StorageUploadError } from './errors';
import {
  expiryFrom,
  type FileTokenResult,
  isPartNumber,
  signFileToken,
  verifyFileToken,
} from './file-token';
import { type ByteRange, resolveRange, safeDownloadName } from './http';
import { orderedParts, unquoteEtag } from './parts';
import {
  CLIP_FILES_ROUTE,
  PART_URL_SECONDS,
  type PrivateListPage,
  type PrivateObjectInfo,
  type PrivateObjectStream,
  type PrivateStorage,
  type SignedUrlOptions,
  type UploadedPart,
} from './private-storage.interface';

const UPLOAD_ID = /^[0-9a-f]{32}$/;

/** The largest single part the local binding accepts, S3's own limit. */
export const MAX_LOCAL_PART_BYTES = 5 * 1024 * 1024 * 1024;

interface UploadMeta {
  key: string;
  contentType: string;
}

/** Options for the local binding. */
export interface LocalPrivateStorageOptions {
  /** The clock, in milliseconds; tests pass a fixed one. */
  now?: () => number;
}

/** The local-disk binding of `PrivateStorage`. */
export class LocalPrivateStorage implements PrivateStorage {
  readonly kind = 'local' as const;
  private readonly root: string;
  private readonly baseUrl: string;
  private readonly now: () => number;

  constructor(
    root: string,
    apiUrl: string,
    private readonly secret: string,
    options: LocalPrivateStorageOptions = {},
  ) {
    this.root = resolve(root);
    this.baseUrl = apiUrl.replace(/\/+$/, '');
    this.now = options.now ?? Date.now;
  }

  /** The folder this binding writes to. */
  get directory(): string {
    return this.root;
  }

  async put(key: string, body: Buffer | Readable, _contentType: string): Promise<PrivateObjectInfo> {
    const target = this.pathFor(key);

    return this.writeAtomically(target, async (temp) => {
      if (Buffer.isBuffer(body)) {
        await writeFile(temp, body, { flag: 'wx' });
      } else {
        await pipeline(body, createWriteStream(temp, { flags: 'wx' }));
      }
    });
  }

  async putFile(key: string, filePath: string, _contentType: string): Promise<PrivateObjectInfo> {
    const target = this.pathFor(key);
    return this.writeAtomically(target, (temp) => copyFile(filePath, temp));
  }

  async getToFile(key: string, filePath: string, signal?: AbortSignal): Promise<void> {
    const source = this.pathFor(key);
    if ((await this.fileSize(source)) === null) throw new StorageNotFoundError();

    signal?.throwIfAborted();

    const target = resolve(filePath);
    const temp = `${target}.${randomBytes(6).toString('hex')}.part`;
    await mkdir(dirname(target), { recursive: true });

    try {
      await pipeline(createReadStream(source), createWriteStream(temp, { flags: 'wx' }), {
        signal,
      });
      await rename(temp, target);
    } catch (error) {
      await rm(temp, { force: true });
      if (isMissing(error)) throw new StorageNotFoundError();
      throw error;
    }
  }

  async getStream(key: string, range?: ByteRange): Promise<PrivateObjectStream | null> {
    const path = this.pathFor(key);
    const totalBytes = await this.fileSize(path);
    if (totalBytes === null) return null;

    if (range === undefined) {
      return { body: createReadStream(path), bytes: totalBytes, totalBytes, range: null };
    }

    const resolved = resolveRange(range, totalBytes);
    if (!resolved) throw new StorageRangeError();

    return {
      body: createReadStream(path, { start: resolved.start, end: resolved.end }),
      bytes: resolved.end - resolved.start + 1,
      totalBytes,
      range: resolved,
    };
  }

  async stat(key: string): Promise<PrivateObjectInfo | null> {
    const bytes = await this.fileSize(this.pathFor(key));
    return bytes === null ? null : { bytes };
  }

  async exists(key: string): Promise<boolean> {
    return (await this.stat(key)) !== null;
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }

  async deletePrefix(prefix: string): Promise<number> {
    assertValidClipPrefix(prefix);
    const folder = this.inside(resolve(this.root, ...prefix.split('/').filter(Boolean)));

    let count = 0;
    try {
      const entries = await readdir(folder, { recursive: true, withFileTypes: true });
      count = entries.filter((entry) => entry.isFile()).length;
    } catch (error) {
      if (isMissing(error)) return 0;
      throw error;
    }

    await rm(folder, { recursive: true, force: true });
    return count;
  }

  async list(
    prefix: string,
    options: { after?: string | null; limit: number },
  ): Promise<PrivateListPage> {
    assertValidClipListPrefix(prefix);
    const folder = this.inside(resolve(this.root, ...prefix.split('/').filter(Boolean)));
    let entries: string[];
    try {
      entries = (await readdir(folder, { recursive: true, withFileTypes: true }))
        .filter((entry) => entry.isFile())
        .map((entry) => join(entry.parentPath ?? entry.path, entry.name));
    } catch (error) {
      if (isMissing(error)) return { objects: [], next: null };
      throw error;
    }

    const keys = entries
      .map((path) => path.slice(this.root.length + 1).split(sep).join('/'))
      .filter((key) => key.startsWith(prefix) && (!options.after || key > options.after))
      .sort();
    const limit = Math.max(1, Math.floor(options.limit));
    const page = keys.slice(0, limit);
    const objects = await Promise.all(
      page.map(async (key) => {
        const info = await stat(join(this.root, ...key.split('/')));
        return { key, bytes: info.size, modifiedAt: new Date(info.mtimeMs) };
      }),
    );
    return { objects, next: keys.length > limit ? (page[page.length - 1] ?? null) : null };
  }

  async signedUrl(key: string, opts: SignedUrlOptions): Promise<string> {
    assertValidClipKey(key);
    const token = signFileToken(
      {
        purpose: 'get',
        key,
        expiresAt: expiryFrom(opts.expiresInSeconds, this.now()),
        ...(opts.downloadName ? { downloadName: safeDownloadName(opts.downloadName) } : {}),
      },
      this.secret,
    );

    return `${this.baseUrl}${CLIP_FILES_ROUTE}/${token}`;
  }

  /**
   * Checks a token from the files route against this binding's secret. The
   * route then serves `claims.key` (purpose `get`) or hands the request body
   * to `receivePart` (purpose `part`).
   */
  verify(token: string, now: number = this.now()): FileTokenResult {
    return verifyFileToken(token, this.secret, now);
  }

  async createUpload(key: string, contentType: string): Promise<{ uploadId: string }> {
    assertValidClipKey(key);
    const uploadId = randomBytes(16).toString('hex');
    const folder = this.uploadFolder(uploadId);

    await mkdir(folder, { recursive: true });
    const meta: UploadMeta = { key, contentType };
    await writeFile(join(folder, 'meta.json'), JSON.stringify(meta), { flag: 'wx' });

    return { uploadId };
  }

  async signPart(key: string, uploadId: string, partNumber: number): Promise<string> {
    await this.readMeta(key, uploadId);
    if (!isPartNumber(partNumber)) {
      throw new StorageUploadError('A part number runs from 1 to 10000');
    }

    const token = signFileToken(
      {
        purpose: 'part',
        key,
        uploadId,
        partNumber,
        expiresAt: expiryFrom(PART_URL_SECONDS, this.now()),
      },
      this.secret,
    );

    return `${this.baseUrl}${CLIP_FILES_ROUTE}/${token}`;
  }

  /**
   * Stores one part sent to a part address, and answers its ETag (the MD5 in
   * quotes, as S3 does), which the browser reports back on complete. Local only.
   */
  async receivePart(
    key: string,
    uploadId: string,
    partNumber: number,
    body: Readable,
    maxBytes: number = MAX_LOCAL_PART_BYTES,
  ): Promise<{ etag: string; bytes: number }> {
    await this.readMeta(key, uploadId);
    if (!isPartNumber(partNumber)) {
      throw new StorageUploadError('A part number runs from 1 to 10000');
    }

    const folder = this.uploadFolder(uploadId);
    const hash = createHash('md5');
    let bytes = 0;

    const meter = new Transform({
      transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
        bytes += chunk.length;
        if (bytes > maxBytes) {
          callback(new StorageUploadError('That part is too big'));
          return;
        }
        hash.update(chunk);
        callback(null, chunk);
      },
    });

    const target = join(folder, `part-${partNumber}`);
    const temp = join(folder, `part-${partNumber}.${randomBytes(6).toString('hex')}.tmp`);

    try {
      await pipeline(body, meter, createWriteStream(temp, { flags: 'wx' }));
      const etag = `"${hash.digest('hex')}"`;
      await writeFile(`${target}.etag`, etag);
      await rename(temp, target);
      return { etag, bytes };
    } catch (error) {
      await rm(temp, { force: true });
      throw error;
    }
  }

  async completeUpload(
    key: string,
    uploadId: string,
    parts: UploadedPart[],
  ): Promise<PrivateObjectInfo> {
    await this.readMeta(key, uploadId);
    const folder = this.uploadFolder(uploadId);
    const ordered = orderedParts(parts);

    for (const part of ordered) {
      let stored: string;
      try {
        stored = await readFile(join(folder, `part-${part.partNumber}.etag`), 'utf8');
      } catch (error) {
        if (isMissing(error)) throw new StorageUploadError('A part of that upload is missing');
        throw error;
      }
      if (unquoteEtag(stored) !== unquoteEtag(part.etag)) {
        throw new StorageUploadError('A part does not match what was uploaded');
      }
    }

    const info = await this.writeAtomically(this.pathFor(key), async (temp) => {
      const out = createWriteStream(temp, { flags: 'wx' });
      try {
        for (const part of ordered) {
          await pipeline(createReadStream(join(folder, `part-${part.partNumber}`)), out, {
            end: false,
          });
        }
        out.end();
        await finished(out);
      } catch (error) {
        out.destroy();
        throw error;
      }
    });

    await rm(folder, { recursive: true, force: true });
    return info;
  }

  async abortUpload(key: string, uploadId: string): Promise<void> {
    assertValidClipKey(key);
    const folder = this.uploadFolder(uploadId);

    try {
      await this.readMeta(key, uploadId);
    } catch (error) {
      // Already gone is success; someone else's upload is not ours to drop.
      if (error instanceof StorageUploadError && (await this.fileSize(join(folder, 'meta.json'))) === null) {
        return;
      }
      throw error;
    }

    await rm(folder, { recursive: true, force: true });
  }

  private async readMeta(key: string, uploadId: string): Promise<UploadMeta> {
    assertValidClipKey(key);
    const folder = this.uploadFolder(uploadId);

    let meta: UploadMeta;
    try {
      meta = JSON.parse(await readFile(join(folder, 'meta.json'), 'utf8')) as UploadMeta;
    } catch (error) {
      if (isMissing(error) || error instanceof SyntaxError) {
        throw new StorageUploadError('That upload is not known');
      }
      throw error;
    }

    if (meta.key !== key) throw new StorageUploadError('That upload is not known');
    return meta;
  }

  private uploadFolder(uploadId: string): string {
    if (!UPLOAD_ID.test(uploadId)) throw new StorageUploadError('That upload is not known');
    return join(this.root, '.uploads', uploadId);
  }

  private async writeAtomically(
    target: string,
    write: (temp: string) => Promise<void>,
  ): Promise<PrivateObjectInfo> {
    const tempFolder = join(this.root, '.tmp');
    const temp = join(tempFolder, randomBytes(16).toString('hex'));
    await mkdir(tempFolder, { recursive: true });
    await mkdir(dirname(target), { recursive: true });

    try {
      await write(temp);
      const { size } = await stat(temp);
      await rename(temp, target);
      return { bytes: size };
    } catch (error) {
      await rm(temp, { force: true });
      throw error;
    }
  }

  private async fileSize(path: string): Promise<number | null> {
    try {
      const info = await stat(path);
      return info.isFile() ? info.size : null;
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  private pathFor(key: string): string {
    assertValidClipKey(key);
    return this.inside(resolve(this.root, ...key.split('/')));
  }

  private inside(target: string): string {
    // Unreachable for a key that passed validation. Kept anyway: this is the
    // one line standing between a bad key and a write outside the folder.
    if (!target.startsWith(this.root + sep)) {
      throw new Error('Refusing to touch a path outside the private folder');
    }
    return target;
  }
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}
