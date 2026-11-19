/**
 * The local private binding against a real temporary folder: what reaches the
 * disk, where, and what a signed address lets through.
 */
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { text } from 'node:stream/consumers';
import { clipKeys } from '../clip-keys';
import { StorageNotFoundError, StorageRangeError, StorageUploadError } from './errors';
import { LocalPrivateStorage } from './local-private.storage';

const org = '3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e';
const video = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const otherVideo = '1a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const job = 'b1c2d3e4-f5a6-4b7c-8d9e-0f1a2b3c4d5e';
const secret = 'x'.repeat(48);
const now = Date.UTC(2026, 10, 18, 12, 0, 0);

describe('LocalPrivateStorage', () => {
  let root: string;
  let scratch: string;
  let storage: LocalPrivateStorage;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'postgear-private-'));
    scratch = await mkdtemp(join(tmpdir(), 'postgear-scratch-'));
    storage = new LocalPrivateStorage(root, 'http://localhost:3001/', secret, { now: () => now });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(scratch, { recursive: true, force: true });
  });

  it('puts bytes and streams, stats them, and overwrites like S3', async () => {
    const key = clipKeys.videoFile(org, video, 'poster', 'webp');

    expect(await storage.put(key, Buffer.from('first'), 'image/webp')).toEqual({ bytes: 5 });
    expect(await storage.stat(key)).toEqual({ bytes: 5 });
    expect(await storage.exists(key)).toBe(true);

    expect(await storage.put(key, Readable.from([Buffer.from('second!')]), 'image/webp')).toEqual({
      bytes: 7,
    });
    expect(await readFile(join(root, ...key.split('/')), 'utf8')).toBe('second!');
    // Nothing is left behind in the temporary folder.
    expect(await readdir(join(root, '.tmp'))).toEqual([]);
  });

  it('copies a file in and streams it back out to disk', async () => {
    const source = join(scratch, 'in.mp4');
    await writeFile(source, 'video bytes');
    const key = clipKeys.videoFile(org, video, 'proxy', 'mp4');

    expect(await storage.putFile(key, source, 'video/mp4')).toEqual({ bytes: 11 });

    const target = join(scratch, 'out', 'copy.mp4');
    await storage.getToFile(key, target);
    expect(await readFile(target, 'utf8')).toBe('video bytes');
    expect((await readdir(join(scratch, 'out'))).filter((name) => name.endsWith('.part'))).toEqual(
      [],
    );
  });

  it('serves a byte range, and refuses one outside the file', async () => {
    const key = clipKeys.videoFile(org, video, 'proxy', 'mp4');
    await storage.put(key, Buffer.from('0123456789'), 'video/mp4');

    const part = await storage.getStream(key, { start: 2, end: 5 });
    expect(part).toMatchObject({ bytes: 4, totalBytes: 10, range: { start: 2, end: 5 } });
    expect(await text(part?.body ?? Readable.from([]))).toBe('2345');

    const tail = await storage.getStream(key, { start: 7 });
    expect(await text(tail?.body ?? Readable.from([]))).toBe('789');

    const whole = await storage.getStream(key);
    expect(whole).toMatchObject({ bytes: 10, totalBytes: 10, range: null });
    whole?.body.destroy();

    await expect(storage.getStream(key, { start: 10 })).rejects.toBeInstanceOf(StorageRangeError);
  });

  it('answers null or not-found for a missing file', async () => {
    const key = clipKeys.videoFile(org, video, 'proxy', 'mp4');
    expect(await storage.stat(key)).toBeNull();
    expect(await storage.exists(key)).toBe(false);
    expect(await storage.getStream(key)).toBeNull();
    await expect(storage.getToFile(key, join(scratch, 'x.mp4'))).rejects.toBeInstanceOf(
      StorageNotFoundError,
    );
    await expect(storage.delete(key)).resolves.toBeUndefined();
  });

  it('stops a copy to disk when aborted and leaves no file behind', async () => {
    const key = clipKeys.videoFile(org, video, 'proxy', 'mp4');
    await storage.put(key, Buffer.alloc(1024), 'video/mp4');
    const controller = new AbortController();
    controller.abort();

    const target = join(scratch, 'aborted.mp4');
    await expect(storage.getToFile(key, target, controller.signal)).rejects.toThrow();
    expect(await readdir(scratch)).toEqual([]);
  });

  it('deletes a prefix and only that prefix, counting the files', async () => {
    await storage.put(clipKeys.videoFile(org, video, 'proxy', 'mp4'), Buffer.from('a'), 'video/mp4');
    await storage.put(clipKeys.videoFile(org, video, 'poster', 'webp'), Buffer.from('b'), 'image/webp');
    const kept = clipKeys.videoFile(org, otherVideo, 'proxy', 'mp4');
    await storage.put(kept, Buffer.from('c'), 'video/mp4');

    expect(await storage.deletePrefix(clipKeys.videoPrefix(org, video))).toBe(2);
    expect(await storage.deletePrefix(clipKeys.videoPrefix(org, video))).toBe(0);
    expect(await storage.exists(kept)).toBe(true);
    await expect(storage.deletePrefix('clips/')).rejects.toThrow(/did not generate/);
    await expect(storage.deletePrefix('../')).rejects.toThrow(/did not generate/);
  });

  it('lists every Clips file in key order, a page at a time, with sizes and dates (Module 19)', async () => {
    const keys = [
      clipKeys.videoFile(org, video, 'proxy', 'mp4'),
      clipKeys.videoFile(org, otherVideo, 'poster', 'webp'),
      clipKeys.downloadFile(org, job, 'talk', 'mp4'),
    ];
    for (const key of keys) await storage.put(key, Buffer.from('abc'), 'video/mp4');
    const sorted = [...keys].sort();

    const first = await storage.list('clips/', { limit: 2 });
    expect(first.objects.map((object) => object.key)).toEqual(sorted.slice(0, 2));
    expect(first.objects[0]?.bytes).toBe(3);
    expect(first.objects[0]?.modifiedAt).toBeInstanceOf(Date);
    expect(first.next).toBe(sorted[1]);

    const second = await storage.list('clips/', { after: first.next, limit: 2 });
    expect(second.objects.map((object) => object.key)).toEqual(sorted.slice(2));
    expect(second.next).toBeNull();

    const one = await storage.list(clipKeys.videoPrefix(org, video), { limit: 10 });
    expect(one.objects.map((object) => object.key)).toEqual([keys[0]]);
    expect(await storage.list(clipKeys.videoPrefix(org, job), { limit: 10 })).toEqual({
      objects: [],
      next: null,
    });
    await expect(storage.list('../', { limit: 1 })).rejects.toThrow(/did not generate/);
    await expect(storage.list('', { limit: 1 })).rejects.toThrow(/did not generate/);
  });

  it('refuses keys that could leave the folder before touching the disk', async () => {
    await expect(storage.put('../escape.mp4', Buffer.from('x'), 'video/mp4')).rejects.toThrow(
      /did not generate/,
    );
    await expect(storage.getToFile('../../etc/passwd', join(scratch, 'x'))).rejects.toThrow(
      /did not generate/,
    );
  });

  it('signs an address the files route accepts, and only until it expires', async () => {
    const key = clipKeys.downloadFile(org, job, 'file', 'mp4');
    const url = await storage.signedUrl(key, { expiresInSeconds: 300, downloadName: 'Clip.mp4' });

    expect(url).toMatch(/^http:\/\/localhost:3001\/clips\/files\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    const token = url.slice(url.lastIndexOf('/') + 1);

    expect(storage.verify(token)).toEqual({
      ok: true,
      claims: { purpose: 'get', key, expiresAt: Math.floor(now / 1000) + 300, downloadName: 'Clip.mp4' },
    });
    expect(storage.verify(token, now + 301_000)).toEqual({ ok: false, reason: 'expired' });
    // The token is not a path: the key alone opens nothing.
    expect(url).not.toContain(key);
  });

  it('uploads in parts, joins them in part order, and cleans up', async () => {
    const key = clipKeys.videoFile(org, video, 'original', 'mp4');
    const { uploadId } = await storage.createUpload(key, 'video/mp4');

    const partUrl = await storage.signPart(key, uploadId, 1);
    const claims = storage.verify(partUrl.slice(partUrl.lastIndexOf('/') + 1));
    expect(claims.ok && claims.claims).toMatchObject({ purpose: 'part', uploadId, partNumber: 1 });

    const second = await storage.receivePart(key, uploadId, 2, Readable.from([Buffer.from('world')]));
    const first = await storage.receivePart(key, uploadId, 1, Readable.from([Buffer.from('hello ')]));
    expect(first.etag).toMatch(/^"[0-9a-f]{32}"$/);

    await expect(
      storage.completeUpload(key, uploadId, [
        { partNumber: 1, etag: first.etag },
        { partNumber: 2, etag: '"wrong"' },
      ]),
    ).rejects.toBeInstanceOf(StorageUploadError);

    const info = await storage.completeUpload(key, uploadId, [
      { partNumber: 2, etag: second.etag },
      { partNumber: 1, etag: first.etag },
    ]);
    expect(info).toEqual({ bytes: 11 });
    expect(await readFile(join(root, ...key.split('/')), 'utf8')).toBe('hello world');
    expect(await readdir(join(root, '.uploads'))).toEqual([]);
  });

  it('refuses parts for an unknown upload or another key, and aborts cleanly', async () => {
    const key = clipKeys.videoFile(org, video, 'original', 'mp4');
    const other = clipKeys.videoFile(org, video, 'original', 'mp4');
    const { uploadId } = await storage.createUpload(key, 'video/mp4');

    await expect(storage.signPart(other, uploadId, 1)).rejects.toBeInstanceOf(StorageUploadError);
    await expect(storage.signPart(key, 'f'.repeat(32), 1)).rejects.toBeInstanceOf(
      StorageUploadError,
    );
    await expect(storage.signPart(key, '../x', 1)).rejects.toBeInstanceOf(StorageUploadError);
    await expect(storage.signPart(key, uploadId, 0)).rejects.toBeInstanceOf(StorageUploadError);
    await expect(
      storage.receivePart(key, uploadId, 1, Readable.from([Buffer.alloc(20)]), 10),
    ).rejects.toThrow(/too big/);

    await storage.abortUpload(key, uploadId);
    await storage.abortUpload(key, uploadId);
    await expect(storage.completeUpload(key, uploadId, [{ partNumber: 1, etag: '"x"' }])).rejects.toBeInstanceOf(
      StorageUploadError,
    );
  });
});
