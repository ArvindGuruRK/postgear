/**
 * S3-compatible storage: AWS S3, Cloudflare R2, MinIO.
 *
 * The bucket (or the CDN in front of it) must allow anonymous reads of these
 * objects: Instagram, Facebook, Pinterest and TikTok fetch media by URL with
 * no credentials. Writes and deletes use the configured key pair.
 *
 * Every object is written with a year-long immutable cache header, which is
 * safe precisely because keys are never reused: replacing an image is a new
 * upload with a new key, never an overwrite.
 */
import { createReadStream } from 'node:fs';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import type { StorageBackend, StorageBody } from './storage.interface';
import { assertValidKey } from './storage-keys';

const IMMUTABLE = 'public, max-age=31536000, immutable';

export class S3Storage implements StorageBackend {
  readonly kind = 's3' as const;

  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
    private readonly publicBaseUrl: string,
  ) {}

  async put(key: string, body: StorageBody, contentType: string): Promise<void> {
    assertValidKey(key);

    const inMemory = Buffer.isBuffer(body);

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        // A video is streamed from the upload's temp file rather than read into
        // memory. The SDK needs the length up front to stream a body at all.
        Body: inMemory ? body : createReadStream(body.filePath),
        ContentLength: inMemory ? body.length : body.size,
        ContentType: contentType,
        CacheControl: IMMUTABLE,
      }),
    );
  }

  async delete(key: string): Promise<void> {
    assertValidKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async read(key: string): Promise<Buffer | null> {
    assertValidKey(key);

    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      const body = result.Body as { transformToByteArray?: () => Promise<Uint8Array> } | undefined;
      if (!body?.transformToByteArray) return null;

      return Buffer.from(await body.transformToByteArray());
    } catch (error) {
      // A missing object is an answer: the exporter draws the empty slot and
      // says which picture was deleted. An unreachable bucket is a fault, and
      // passing it off as "deleted" would send the user looking for a problem
      // they do not have.
      const failure = error as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (failure?.name === 'NoSuchKey' || failure?.$metadata?.httpStatusCode === 404) return null;
      throw error;
    }
  }

  publicUrl(key: string): string {
    assertValidKey(key);
    return `${this.publicBaseUrl.replace(/\/+$/, '')}/${key}`;
  }
}
