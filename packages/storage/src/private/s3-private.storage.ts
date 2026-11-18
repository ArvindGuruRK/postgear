/**
 * The private Clips space on S3 (AWS S3, Cloudflare R2, MinIO): one private
 * bucket, `CLIPS_PRIVATE_BUCKET` (default `postgear-clips`), never public.
 *
 * Big files go up in parts through `@aws-sdk/lib-storage`; downloads stream to
 * disk; browsers get presigned GET addresses (with a `Content-Disposition`
 * when the file is a download) and presigned part addresses for uploads.
 * Every object carries `Cache-Control: private, max-age=3600`.
 */
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { Readable, Transform, type TransformCallback } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { randomBytes } from 'node:crypto';
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  type PutObjectCommandInput,
  type S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { assertValidClipKey, assertValidClipPrefix } from '../clip-keys';
import { isS3InvalidRange, isS3NoSuchUpload, isS3NotFound } from '../s3-client';
import { StorageNotFoundError, StorageRangeError, StorageUploadError } from './errors';
import { assertSignedUrlSeconds, isPartNumber } from './file-token';
import { type ByteRange, contentDispositionFor } from './http';
import { orderedParts } from './parts';
import {
  MULTIPART_PART_BYTES,
  MULTIPART_THRESHOLD_BYTES,
  PART_URL_SECONDS,
  PRIVATE_CACHE_CONTROL,
  type PrivateObjectInfo,
  type PrivateObjectStream,
  type PrivateStorage,
  type SignedUrlOptions,
  type UploadedPart,
} from './private-storage.interface';

/** Signs a command into an address; `getSignedUrl` unless a test swaps it. */
export type Presigner = (
  client: S3Client,
  command: GetObjectCommand | UploadPartCommand,
  options: { expiresIn: number },
) => Promise<string>;

/** What a multipart upload needs; the default runs `@aws-sdk/lib-storage`. */
export interface UploaderOptions {
  client: S3Client;
  params: PutObjectCommandInput;
  partSize: number;
  queueSize: number;
}

/** Starts a multipart upload and resolves when it is complete. */
export type Uploader = (options: UploaderOptions) => { done(): Promise<unknown> };

/** Options for the S3 binding. Tests swap the presigner and the uploader. */
export interface S3PrivateStorageOptions {
  multipartThresholdBytes?: number;
  partBytes?: number;
  presign?: Presigner;
  uploader?: Uploader;
}

const defaultPresign: Presigner = (client, command, options) =>
  command instanceof GetObjectCommand
    ? getSignedUrl(client, command, options)
    : getSignedUrl(client, command, options);

const defaultUploader: Uploader = ({ client, params, partSize, queueSize }) =>
  new Upload({ client, params, partSize, queueSize, leavePartsOnError: false });

/** The S3 binding of `PrivateStorage`. */
export class S3PrivateStorage implements PrivateStorage {
  readonly kind = 's3' as const;
  private readonly threshold: number;
  private readonly partBytes: number;
  private readonly presign: Presigner;
  private readonly uploader: Uploader;

  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
    options: S3PrivateStorageOptions = {},
  ) {
    this.threshold = options.multipartThresholdBytes ?? MULTIPART_THRESHOLD_BYTES;
    this.partBytes = options.partBytes ?? MULTIPART_PART_BYTES;
    this.presign = options.presign ?? defaultPresign;
    this.uploader = options.uploader ?? defaultUploader;
  }

  async put(key: string, body: Buffer | Readable, contentType: string): Promise<PrivateObjectInfo> {
    assertValidClipKey(key);

    if (Buffer.isBuffer(body)) {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: body,
          ContentLength: body.length,
          ContentType: contentType,
          CacheControl: PRIVATE_CACHE_CONTROL,
        }),
      );
      return { bytes: body.length };
    }

    // A stream of unknown length can only go up in parts; count it on the way.
    let bytes = 0;
    const counter = new Transform({
      transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
        bytes += chunk.length;
        callback(null, chunk);
      },
    });
    body.once('error', (error) => counter.destroy(error));

    await this.multipart(key, body.pipe(counter), contentType);
    return { bytes };
  }

  async putFile(key: string, filePath: string, contentType: string): Promise<PrivateObjectInfo> {
    assertValidClipKey(key);
    const { size } = await stat(filePath);

    if (size > this.threshold) {
      await this.multipart(key, createReadStream(filePath), contentType);
    } else {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: createReadStream(filePath),
          ContentLength: size,
          ContentType: contentType,
          CacheControl: PRIVATE_CACHE_CONTROL,
        }),
      );
    }

    return { bytes: size };
  }

  async getToFile(key: string, filePath: string, signal?: AbortSignal): Promise<void> {
    assertValidClipKey(key);
    signal?.throwIfAborted();

    let body: Readable;
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
        { abortSignal: signal },
      );
      body = toReadable(result.Body);
    } catch (error) {
      if (isS3NotFound(error)) throw new StorageNotFoundError();
      throw error;
    }

    const target = resolve(filePath);
    const temp = `${target}.${randomBytes(6).toString('hex')}.part`;
    await mkdir(dirname(target), { recursive: true });

    try {
      await pipeline(body, createWriteStream(temp, { flags: 'wx' }), { signal });
      await rename(temp, target);
    } catch (error) {
      body.destroy();
      await rm(temp, { force: true });
      throw error;
    }
  }

  async getStream(key: string, range?: ByteRange): Promise<PrivateObjectStream | null> {
    assertValidClipKey(key);

    if (range !== undefined) {
      const badEnd =
        range.end !== undefined && (!Number.isSafeInteger(range.end) || range.end < range.start);
      if (!Number.isSafeInteger(range.start) || range.start < 0 || badEnd) {
        throw new StorageRangeError();
      }
    }

    try {
      const result = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
          ...(range ? { Range: `bytes=${range.start}-${range.end ?? ''}` } : {}),
        }),
      );
      const body = toReadable(result.Body);
      const bytes = result.ContentLength ?? 0;

      if (!range) return { body, bytes, totalBytes: bytes, range: null };

      const served = parseContentRange(result.ContentRange);
      if (!served) {
        // A store that ignored the Range header sent the whole object.
        return { body, bytes, totalBytes: bytes, range: null };
      }
      return { body, bytes, totalBytes: served.total, range: { start: served.start, end: served.end } };
    } catch (error) {
      if (isS3NotFound(error)) return null;
      if (isS3InvalidRange(error)) throw new StorageRangeError();
      throw error;
    }
  }

  async stat(key: string): Promise<PrivateObjectInfo | null> {
    assertValidClipKey(key);

    try {
      const result = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return { bytes: result.ContentLength ?? 0 };
    } catch (error) {
      if (isS3NotFound(error)) return null;
      throw error;
    }
  }

  async exists(key: string): Promise<boolean> {
    return (await this.stat(key)) !== null;
  }

  async delete(key: string): Promise<void> {
    assertValidClipKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async deletePrefix(prefix: string): Promise<number> {
    assertValidClipPrefix(prefix);
    let deleted = 0;
    let continuationToken: string | undefined;

    do {
      const page = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          MaxKeys: 1000,
          ContinuationToken: continuationToken,
        }),
      );

      const keys = (page.Contents ?? [])
        .map((object) => object.Key)
        .filter((key): key is string => typeof key === 'string' && key.startsWith(prefix));

      if (keys.length > 0) {
        const result = await this.client.send(
          new DeleteObjectsCommand({
            Bucket: this.bucket,
            Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
          }),
        );
        const failed = result.Errors?.length ?? 0;
        if (failed > 0) {
          throw new Error(`Could not delete ${failed} of ${keys.length} private files`);
        }
        deleted += keys.length;
      }

      continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (continuationToken);

    return deleted;
  }

  async signedUrl(key: string, opts: SignedUrlOptions): Promise<string> {
    assertValidClipKey(key);
    assertSignedUrlSeconds(opts.expiresInSeconds);

    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ...(opts.downloadName
        ? { ResponseContentDisposition: contentDispositionFor(opts.downloadName) }
        : {}),
    });

    return this.presign(this.client, command, { expiresIn: opts.expiresInSeconds });
  }

  async createUpload(key: string, contentType: string): Promise<{ uploadId: string }> {
    assertValidClipKey(key);
    const result = await this.client.send(
      new CreateMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType,
        CacheControl: PRIVATE_CACHE_CONTROL,
      }),
    );

    if (!result.UploadId) throw new StorageUploadError('The store did not start the upload');
    return { uploadId: result.UploadId };
  }

  async signPart(key: string, uploadId: string, partNumber: number): Promise<string> {
    assertValidClipKey(key);
    assertUploadId(uploadId);
    if (!isPartNumber(partNumber)) {
      throw new StorageUploadError('A part number runs from 1 to 10000');
    }

    const command = new UploadPartCommand({
      Bucket: this.bucket,
      Key: key,
      UploadId: uploadId,
      PartNumber: partNumber,
    });
    return this.presign(this.client, command, { expiresIn: PART_URL_SECONDS });
  }

  async completeUpload(
    key: string,
    uploadId: string,
    parts: UploadedPart[],
  ): Promise<PrivateObjectInfo> {
    assertValidClipKey(key);
    assertUploadId(uploadId);
    const ordered = orderedParts(parts);

    try {
      await this.client.send(
        new CompleteMultipartUploadCommand({
          Bucket: this.bucket,
          Key: key,
          UploadId: uploadId,
          MultipartUpload: {
            Parts: ordered.map((part) => ({ PartNumber: part.partNumber, ETag: part.etag })),
          },
        }),
      );
    } catch (error) {
      if (isS3NoSuchUpload(error)) throw new StorageUploadError('That upload is not known');
      throw error;
    }

    const info = await this.stat(key);
    if (!info) throw new StorageUploadError('The store did not keep the finished upload');
    return info;
  }

  async abortUpload(key: string, uploadId: string): Promise<void> {
    assertValidClipKey(key);
    assertUploadId(uploadId);

    try {
      await this.client.send(
        new AbortMultipartUploadCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId }),
      );
    } catch (error) {
      if (isS3NoSuchUpload(error) || isS3NotFound(error)) return;
      throw error;
    }
  }

  private async multipart(key: string, body: Readable, contentType: string): Promise<void> {
    await this.uploader({
      client: this.client,
      params: {
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        CacheControl: PRIVATE_CACHE_CONTROL,
      },
      partSize: this.partBytes,
      queueSize: 4,
    }).done();
  }
}

function assertUploadId(uploadId: string): void {
  if (typeof uploadId !== 'string' || uploadId.length === 0 || uploadId.length > 1024) {
    throw new StorageUploadError('That upload is not known');
  }
}

/** The SDK's body is a Node stream under Node; anything else is a fault. */
function toReadable(body: unknown): Readable {
  if (body instanceof Readable) return body;
  throw new Error('The store answered without a readable body');
}

/** Reads `bytes start-end/total` from a `Content-Range` header. */
export function parseContentRange(
  header: string | undefined,
): { start: number; end: number; total: number } | null {
  const match = header ? /^bytes (\d+)-(\d+)\/(\d+)$/.exec(header.trim()) : null;
  if (!match) return null;

  const [start, end, total] = [Number(match[1]), Number(match[2]), Number(match[3])];
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && Number.isSafeInteger(total)
    ? { start, end, total }
    : null;
}
