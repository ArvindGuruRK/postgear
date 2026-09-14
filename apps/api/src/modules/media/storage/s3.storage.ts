/**
 * S3-compatible storage: AWS S3, Cloudflare R2, MinIO.
 *
 * The bucket (or the CDN in front of it) must allow anonymous reads of these
 * objects — Instagram, Facebook, Pinterest and TikTok fetch media by URL with
 * no credentials. Writes and deletes use the configured key pair.
 *
 * Every object is written with a year-long immutable cache header, which is
 * safe precisely because keys are never reused: replacing an image is a new
 * upload with a new key, never an overwrite.
 */
import { createReadStream } from 'node:fs';
import { DeleteObjectCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
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

  publicUrl(key: string): string {
    assertValidKey(key);
    return `${this.publicBaseUrl.replace(/\/+$/, '')}/${key}`;
  }
}
