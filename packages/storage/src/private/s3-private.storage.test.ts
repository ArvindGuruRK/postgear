/**
 * The S3 private binding at its seam: the commands it sends to a mocked
 * client. A real bucket is an integration concern checked against MinIO.
 */
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { text } from 'node:stream/consumers';
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { clipKeys } from '../clip-keys';
import { StorageNotFoundError, StorageRangeError, StorageUploadError } from './errors';
import { PRIVATE_CACHE_CONTROL } from './private-storage.interface';
import { S3PrivateStorage, type Uploader } from './s3-private.storage';

const org = '3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e';
const video = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

function notFound(): Error {
  return Object.assign(new Error('gone'), { name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } });
}

describe('S3PrivateStorage', () => {
  const send = jest.fn();
  const client = { send } as unknown as S3Client;
  const presign = jest.fn(async () => 'https://signed.example/x');
  const uploads: Array<Parameters<Uploader>[0]> = [];
  const uploader: Uploader = (options) => {
    uploads.push(options);
    return { done: async () => text(options.params.Body as Readable) };
  };
  let storage: S3PrivateStorage;
  let scratch: string;

  beforeEach(async () => {
    uploads.length = 0;
    storage = new S3PrivateStorage(client, 'postgear-clips', {
      presign,
      uploader,
      multipartThresholdBytes: 8,
    });
    scratch = await mkdtemp(join(tmpdir(), 'postgear-s3-'));
  });

  afterEach(async () => {
    await rm(scratch, { recursive: true, force: true });
  });

  it('puts a buffer with a private cache header', async () => {
    const key = clipKeys.videoFile(org, video, 'poster', 'webp');
    expect(await storage.put(key, Buffer.from('abc'), 'image/webp')).toEqual({ bytes: 3 });

    const command = send.mock.calls[0][0] as PutObjectCommand;
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input).toMatchObject({
      Bucket: 'postgear-clips',
      Key: key,
      ContentType: 'image/webp',
      ContentLength: 3,
      CacheControl: PRIVATE_CACHE_CONTROL,
    });
  });

  it('sends a stream in parts and counts its bytes', async () => {
    const key = clipKeys.videoFile(org, video, 'proxy', 'mp4');
    const info = await storage.put(key, Readable.from([Buffer.from('hello '), Buffer.from('there')]), 'video/mp4');

    expect(info).toEqual({ bytes: 11 });
    expect(uploads[0]?.params).toMatchObject({ Bucket: 'postgear-clips', Key: key, CacheControl: PRIVATE_CACHE_CONTROL });
  });

  it('puts a small file in one request and a big one in parts', async () => {
    const small = join(scratch, 'small.mp4');
    const big = join(scratch, 'big.mp4');
    await writeFile(small, '1234');
    await writeFile(big, '0123456789abc');
    const key = clipKeys.videoFile(org, video, 'proxy', 'mp4');

    expect(await storage.putFile(key, small, 'video/mp4')).toEqual({ bytes: 4 });
    expect(send.mock.calls[0][0]).toBeInstanceOf(PutObjectCommand);
    expect(uploads).toHaveLength(0);

    expect(await storage.putFile(key, big, 'video/mp4')).toEqual({ bytes: 13 });
    expect(uploads).toHaveLength(1);
    expect(uploads[0]?.params.ContentType).toBe('video/mp4');
  });

  it('streams an object to disk, and reports a missing one as not found', async () => {
    const key = clipKeys.videoFile(org, video, 'proxy', 'mp4');
    send.mockResolvedValueOnce({ Body: Readable.from([Buffer.from('video bytes')]) });

    const target = join(scratch, 'out.mp4');
    await storage.getToFile(key, target);
    expect(await readFile(target, 'utf8')).toBe('video bytes');
    expect(send.mock.calls[0][0]).toBeInstanceOf(GetObjectCommand);

    send.mockRejectedValueOnce(notFound());
    await expect(storage.getToFile(key, join(scratch, 'missing.mp4'))).rejects.toBeInstanceOf(
      StorageNotFoundError,
    );
    expect((await readdir(scratch)).sort()).toEqual(['out.mp4']);
  });

  it('asks for a byte range and reads the total from Content-Range', async () => {
    const key = clipKeys.videoFile(org, video, 'proxy', 'mp4');
    send.mockResolvedValueOnce({
      Body: Readable.from([Buffer.from('2345')]),
      ContentLength: 4,
      ContentRange: 'bytes 2-5/10',
    });

    const part = await storage.getStream(key, { start: 2, end: 5 });
    expect((send.mock.calls[0][0] as GetObjectCommand).input.Range).toBe('bytes=2-5');
    expect(part).toMatchObject({ bytes: 4, totalBytes: 10, range: { start: 2, end: 5 } });

    send.mockRejectedValueOnce(
      Object.assign(new Error('range'), { name: 'InvalidRange', $metadata: { httpStatusCode: 416 } }),
    );
    await expect(storage.getStream(key, { start: 99 })).rejects.toBeInstanceOf(StorageRangeError);
    await expect(storage.getStream(key, { start: 5, end: 2 })).rejects.toBeInstanceOf(
      StorageRangeError,
    );

    send.mockRejectedValueOnce(notFound());
    expect(await storage.getStream(key)).toBeNull();
  });

  it('stats with HEAD, and tells a missing object from a broken bucket', async () => {
    const key = clipKeys.videoFile(org, video, 'proxy', 'mp4');
    send.mockResolvedValueOnce({ ContentLength: 42 });
    expect(await storage.stat(key)).toEqual({ bytes: 42 });
    expect(send.mock.calls[0][0]).toBeInstanceOf(HeadObjectCommand);

    send.mockRejectedValueOnce(Object.assign(new Error('nf'), { name: 'NotFound' }));
    expect(await storage.exists(key)).toBe(false);

    send.mockRejectedValueOnce(
      Object.assign(new Error('socket hang up'), { $metadata: { httpStatusCode: 503 } }),
    );
    await expect(storage.stat(key)).rejects.toThrow('socket hang up');
  });

  it('deletes a prefix page by page', async () => {
    const prefix = clipKeys.videoPrefix(org, video);
    const page = (count: number, start: number) =>
      Array.from({ length: count }, (_, index) => ({ Key: `${prefix}file-${start + index}.mp4` }));

    send
      .mockResolvedValueOnce({ Contents: page(1000, 0), IsTruncated: true, NextContinuationToken: 't1' })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ Contents: page(5, 1000), IsTruncated: false })
      .mockResolvedValueOnce({});

    expect(await storage.deletePrefix(prefix)).toBe(1005);

    const commands = send.mock.calls.map((call) => call[0]);
    expect(commands[0]).toBeInstanceOf(ListObjectsV2Command);
    expect((commands[0] as ListObjectsV2Command).input).toMatchObject({ Prefix: prefix });
    expect(commands[1]).toBeInstanceOf(DeleteObjectsCommand);
    expect((commands[1] as DeleteObjectsCommand).input.Delete?.Objects).toHaveLength(1000);
    expect((commands[2] as ListObjectsV2Command).input.ContinuationToken).toBe('t1');
    expect((commands[3] as DeleteObjectsCommand).input.Delete?.Objects).toHaveLength(5);

    await expect(storage.deletePrefix('clips/')).rejects.toThrow(/did not generate/);
  });

  it('fails loudly when some objects under a prefix could not be deleted', async () => {
    const prefix = clipKeys.videoPrefix(org, video);
    send
      .mockResolvedValueOnce({ Contents: [{ Key: `${prefix}a.mp4` }], IsTruncated: false })
      .mockResolvedValueOnce({ Errors: [{ Key: `${prefix}a.mp4`, Code: 'AccessDenied' }] });

    await expect(storage.deletePrefix(prefix)).rejects.toThrow(/Could not delete 1 of 1/);
  });

  it('presigns a GET, with an attachment header for a download', async () => {
    const key = clipKeys.videoFile(org, video, 'proxy', 'mp4');
    await storage.signedUrl(key, { expiresInSeconds: 600, downloadName: 'My Clip.mp4' });

    const [, command, options] = presign.mock.calls[0] as unknown as [
      S3Client,
      GetObjectCommand,
      { expiresIn: number },
    ];
    expect(command).toBeInstanceOf(GetObjectCommand);
    expect(command.input.ResponseContentDisposition).toBe(
      `attachment; filename="My Clip.mp4"; filename*=UTF-8''My%20Clip.mp4`,
    );
    expect(options).toEqual({ expiresIn: 600 });
    await expect(storage.signedUrl(key, { expiresInSeconds: 0 })).rejects.toThrow();
    await expect(storage.signedUrl('../x', { expiresInSeconds: 60 })).rejects.toThrow();
  });

  it('runs a browser upload in parts: create, sign, complete, abort', async () => {
    const key = clipKeys.videoFile(org, video, 'original', 'mp4');

    send.mockResolvedValueOnce({ UploadId: 'up-1' });
    expect(await storage.createUpload(key, 'video/mp4')).toEqual({ uploadId: 'up-1' });
    expect(send.mock.calls[0][0]).toBeInstanceOf(CreateMultipartUploadCommand);

    await storage.signPart(key, 'up-1', 2);
    const [, partCommand, partOptions] = presign.mock.calls[0] as unknown as [
      S3Client,
      UploadPartCommand,
      { expiresIn: number },
    ];
    expect(partCommand).toBeInstanceOf(UploadPartCommand);
    expect(partCommand.input).toMatchObject({ UploadId: 'up-1', PartNumber: 2 });
    expect(partOptions).toEqual({ expiresIn: 3600 });
    await expect(storage.signPart(key, 'up-1', 10_001)).rejects.toBeInstanceOf(StorageUploadError);

    send.mockResolvedValueOnce({}).mockResolvedValueOnce({ ContentLength: 99 });
    const info = await storage.completeUpload(key, 'up-1', [
      { partNumber: 2, etag: '"b"' },
      { partNumber: 1, etag: '"a"' },
    ]);
    expect(info).toEqual({ bytes: 99 });
    const complete = send.mock.calls[1][0] as CompleteMultipartUploadCommand;
    expect(complete).toBeInstanceOf(CompleteMultipartUploadCommand);
    expect(complete.input.MultipartUpload?.Parts).toEqual([
      { PartNumber: 1, ETag: '"a"' },
      { PartNumber: 2, ETag: '"b"' },
    ]);

    await expect(
      storage.completeUpload(key, 'up-1', [
        { partNumber: 1, etag: '"a"' },
        { partNumber: 1, etag: '"a"' },
      ]),
    ).rejects.toThrow(/listed twice/);

    send.mockRejectedValueOnce(Object.assign(new Error('gone'), { name: 'NoSuchUpload' }));
    await expect(storage.abortUpload(key, 'up-1')).resolves.toBeUndefined();
    expect(send.mock.calls.at(-1)?.[0]).toBeInstanceOf(AbortMultipartUploadCommand);
  });
});

describe('S3PrivateStorage with the real presigner', () => {
  it('signs locally, with no network, and carries the download header', async () => {
    const client = new S3Client({
      region: 'us-east-1',
      endpoint: 'http://localhost:9000',
      forcePathStyle: true,
      credentials: { accessKeyId: 'test-access', secretAccessKey: 'test-secret' },
    });
    const storage = new S3PrivateStorage(client, 'postgear-clips');
    const key = clipKeys.videoFile(org, video, 'proxy', 'mp4');

    const url = new URL(await storage.signedUrl(key, { expiresInSeconds: 300, downloadName: 'a.mp4' }));

    expect(url.origin).toBe('http://localhost:9000');
    expect(url.pathname).toBe(`/postgear-clips/${key}`);
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(url.searchParams.get('response-content-disposition')).toContain('attachment');
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
  });
});
