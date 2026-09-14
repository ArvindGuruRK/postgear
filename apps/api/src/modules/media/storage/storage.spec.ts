/**
 * Storage keys, both backends, and the factory that chooses between them.
 *
 * The local backend runs against a real temporary directory — the point is to
 * prove what reaches the disk, and where. The S3 backend is checked at its
 * seam, the commands it sends, since a real bucket is an integration concern
 * (the Sprint 4 checklist verifies it against MinIO).
 */
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { DeleteObjectCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { validateEnv } from '../../../config/env';
import { LocalStorage } from './local.storage';
import { S3Storage } from './s3.storage';
import { createStorage, resolveUploadDirectory } from './storage.factory';
import { createMediaKey, isValidKey, thumbnailKeyFor } from './storage-keys';

describe('storage keys', () => {
  it('are date-prefixed and carry 128 random bits', () => {
    const key = createMediaKey('jpg', new Date('2026-09-14T10:00:00Z'));

    expect(key).toMatch(/^2026\/09\/[0-9a-f]{32}\.jpg$/);
    expect(createMediaKey('jpg')).not.toBe(createMediaKey('jpg'));
    expect(isValidKey(key)).toBe(true);
  });

  it('put the thumbnail beside its original', () => {
    expect(thumbnailKeyFor('2026/09/abcdefabcdefabcdefabcdefabcdefab.png')).toBe(
      '2026/09/abcdefabcdefabcdefabcdefabcdefab.thumb.webp',
    );
  });

  it('refuse anything this module could not have generated', () => {
    for (const key of [
      '../../etc/passwd',
      '2026/09/../../secret.jpg',
      '2026/09/abcdefabcdefabcdefabcdefabcdefab.html',
      '2026/09/abcdefabcdefabcdefabcdefabcdefab.svg',
      '/2026/09/abcdefabcdefabcdefabcdefabcdefab.jpg',
      '2026\\09\\abcdefabcdefabcdefabcdefabcdefab.jpg',
      '2026/09/ABCDEFABCDEFABCDEFABCDEFABCDEFAB.jpg',
    ]) {
      expect(isValidKey(key)).toBe(false);
    }
  });
});

describe('LocalStorage', () => {
  let root: string;
  let storage: LocalStorage;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'postgear-storage-'));
    storage = new LocalStorage(root, 'http://localhost:3001/');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('writes a buffer under the upload directory and serves it at /uploads', async () => {
    const key = createMediaKey('jpg');
    await storage.put(key, Buffer.from('jpeg bytes'), 'image/jpeg');

    expect(await readFile(join(root, ...key.split('/')), 'utf8')).toBe('jpeg bytes');
    expect(storage.publicUrl(key)).toBe(`http://localhost:3001/uploads/${key}`);
  });

  it('copies a file already on disk, which is how video avoids memory', async () => {
    const source = join(root, 'upload.tmp');
    await writeFile(source, 'video bytes');

    const key = createMediaKey('mp4');
    await storage.put(key, { filePath: source, size: 11 }, 'video/mp4');

    expect((await stat(join(root, ...key.split('/')))).size).toBe(11);
  });

  it('never overwrites an existing object', async () => {
    const key = createMediaKey('png');
    await storage.put(key, Buffer.from('first'), 'image/png');

    await expect(storage.put(key, Buffer.from('second'), 'image/png')).rejects.toThrow();
    expect(await readFile(join(root, ...key.split('/')), 'utf8')).toBe('first');
  });

  it('refuses a key that could escape the directory, before touching the disk', async () => {
    await expect(storage.put('../escape.jpg', Buffer.from('x'), 'image/jpeg')).rejects.toThrow(
      /did not generate/,
    );
    await expect(storage.delete('../../outside.jpg')).rejects.toThrow(/did not generate/);
  });

  it('treats deleting a missing object as success', async () => {
    await expect(storage.delete(createMediaKey('gif'))).resolves.toBeUndefined();
  });
});

describe('S3Storage', () => {
  const client = { send: jest.fn() };
  const storage = new S3Storage(
    client as unknown as S3Client,
    'media',
    'https://cdn.postgear.test/',
  );

  it('writes with the content type and an immutable cache header', async () => {
    const key = createMediaKey('jpg');
    await storage.put(key, Buffer.from('abc'), 'image/jpeg');

    const command = client.send.mock.calls[0][0] as PutObjectCommand;
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input).toMatchObject({
      Bucket: 'media',
      Key: key,
      ContentType: 'image/jpeg',
      ContentLength: 3,
      CacheControl: 'public, max-age=31536000, immutable',
    });
  });

  it('deletes by key and builds public URLs from the public base, not the endpoint', async () => {
    const key = createMediaKey('mp4');
    await storage.delete(key);

    expect(client.send.mock.calls.at(-1)?.[0]).toBeInstanceOf(DeleteObjectCommand);
    expect(storage.publicUrl(key)).toBe(`https://cdn.postgear.test/${key}`);
  });

  it('refuses a foreign key', async () => {
    await expect(storage.put('../x', Buffer.from(''), 'image/jpeg')).rejects.toThrow();
  });
});

describe('createStorage', () => {
  it('selects local disk by default and S3 when asked', () => {
    expect(
      createStorage({ provider: 'local', uploadDirectory: tmpdir(), apiUrl: 'http://api' }).kind,
    ).toBe('local');
    expect(
      createStorage({
        provider: 's3',
        apiUrl: 'http://api',
        s3: {
          endpoint: 'http://localhost:9000',
          region: 'us-east-1',
          bucket: 'media',
          accessKeyId: 'key',
          secretAccessKey: 'secret',
          publicUrl: 'http://localhost:9000/media',
        },
      }).kind,
    ).toBe('s3');
  });

  it('refuses S3 without the settings it needs', () => {
    expect(() =>
      createStorage({ provider: 's3', apiUrl: 'http://api', s3: { region: 'auto' } }),
    ).toThrow(/S3_BUCKET_NAME/);
  });

  it('anchors the default upload directory to the API package, not the working directory', () => {
    expect(resolveUploadDirectory()).toMatch(new RegExp(`apps\\${sep}api\\${sep}uploads$`));
  });
});

describe('storage environment validation', () => {
  const base = {
    DATABASE_URL: 'postgresql://localhost/db',
    JWT_SECRET: 'x'.repeat(32),
    ENCRYPTION_KEY_AES256: 'a'.repeat(64),
  };

  it('boots with local storage and no S3 settings', () => {
    expect(validateEnv(base).STORAGE_PROVIDER).toBe('local');
  });

  it('refuses to boot with half an S3 configuration, naming each missing setting', () => {
    expect(() => validateEnv({ ...base, STORAGE_PROVIDER: 's3', S3_BUCKET_NAME: 'media' })).toThrow(
      /S3_ACCESS_KEY[\s\S]*S3_SECRET_KEY[\s\S]*S3_PUBLIC_URL/,
    );
  });
});
