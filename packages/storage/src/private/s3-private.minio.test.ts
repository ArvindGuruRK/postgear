/**
 * The S3 private binding against a real MinIO (docker-compose), run only when
 * `S3_ENDPOINT` is set in the shell, skipped otherwise (CI has no MinIO).
 *
 *   S3_ENDPOINT=http://localhost:9000 npx jest --config packages/storage/jest.config.js minio
 *
 * Everything is written under a random workspace prefix and removed after.
 */
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { text } from 'node:stream/consumers';
import { clipKeys } from '../clip-keys';
import { createS3Client } from '../s3-client';
import { S3PrivateStorage } from './s3-private.storage';

const endpoint = process.env.S3_ENDPOINT;
const describeMinio = endpoint ? describe : describe.skip;

describeMinio('S3PrivateStorage on MinIO', () => {
  const bucket = process.env.CLIPS_PRIVATE_BUCKET || 'postgear-clips';
  const org = randomUUID();
  const video = randomUUID();
  const client = createS3Client({
    endpoint,
    region: process.env.S3_REGION || 'us-east-1',
    accessKeyId: process.env.S3_ACCESS_KEY || 'minioadmin',
    secretAccessKey: process.env.S3_SECRET_KEY || 'minioadmin',
  });
  // A 1 byte threshold sends every putFile through lib-storage's multipart path.
  const storage = new S3PrivateStorage(client, bucket, { multipartThresholdBytes: 1 });
  let scratch: string;

  beforeAll(async () => {
    scratch = await mkdtemp(join(tmpdir(), 'postgear-minio-'));
  });

  afterAll(async () => {
    await storage.deletePrefix(clipKeys.orgPrefix(org));
    await rm(scratch, { recursive: true, force: true });
    client.destroy();
  });

  it('stores privately and serves only through a signed address, with Range', async () => {
    const key = clipKeys.videoFile(org, video, 'proxy', 'mp4');
    await storage.put(key, Buffer.from('0123456789'), 'video/mp4');

    expect(await storage.stat(key)).toEqual({ bytes: 10 });
    expect((await fetch(`${endpoint}/${bucket}/${key}`)).status).toBe(403);

    const url = await storage.signedUrl(key, { expiresInSeconds: 60 });
    const ranged = await fetch(url, { headers: { Range: 'bytes=2-5' } });
    expect(ranged.status).toBe(206);
    expect(ranged.headers.get('content-range')).toBe('bytes 2-5/10');
    expect(await ranged.text()).toBe('2345');

    const tampered = url.replace(/X-Amz-Signature=([0-9a-f])/, (_m, c: string) =>
      `X-Amz-Signature=${c === 'a' ? 'b' : 'a'}`,
    );
    expect((await fetch(tampered)).status).toBe(403);

    const download = await fetch(
      await storage.signedUrl(key, { expiresInSeconds: 60, downloadName: 'My Clip.mp4' }),
    );
    expect(download.headers.get('content-disposition')).toContain('attachment');

    const part = await storage.getStream(key, { start: 7 });
    expect(part).toMatchObject({ bytes: 3, totalBytes: 10, range: { start: 7, end: 9 } });
    expect(part).not.toBeNull();
    if (part) expect(await text(part.body)).toBe('789');
  });

  it('uploads a file in parts and streams it back to disk', async () => {
    const key = clipKeys.videoFile(org, video, 'original', 'mp4');
    const source = join(scratch, 'big.bin');
    const bytes = Buffer.alloc(6 * 1024 * 1024, 7);
    await writeFile(source, bytes);

    expect(await storage.putFile(key, source, 'video/mp4')).toEqual({ bytes: bytes.length });

    const target = join(scratch, 'back.bin');
    await storage.getToFile(key, target);
    expect((await readFile(target)).equals(bytes)).toBe(true);
  });

  it('runs a browser part upload through presigned part addresses', async () => {
    const key = clipKeys.videoFile(org, video, 'upload', 'mp4');
    const { uploadId } = await storage.createUpload(key, 'video/mp4');

    const response = await fetch(await storage.signPart(key, uploadId, 1), {
      method: 'PUT',
      body: Buffer.from('hello parts'),
    });
    expect(response.status).toBe(200);
    const etag = response.headers.get('etag') ?? '';

    expect(await storage.completeUpload(key, uploadId, [{ partNumber: 1, etag }])).toEqual({
      bytes: 11,
    });

    const other = await storage.createUpload(clipKeys.videoFile(org, video, 'upload', 'mp4'), 'video/mp4');
    await expect(
      storage.abortUpload(clipKeys.videoFile(org, video, 'upload', 'mp4'), other.uploadId),
    ).resolves.toBeUndefined();
  });

  it('deletes a whole video prefix and counts it', async () => {
    expect(await storage.deletePrefix(clipKeys.videoPrefix(org, video))).toBe(3);
    expect(await storage.deletePrefix(clipKeys.videoPrefix(org, video))).toBe(0);
  });
});
