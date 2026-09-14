/**
 * The upload sequence and its failure paths.
 *
 * Storage and the repository are fakes here; sniffing and image processing
 * are real, run on real files in a temp directory. What is pinned is the
 * order of operations the service's header comment argues for — and above all
 * the cleanup: no temp file survives a request, and no stored object survives
 * a failed one.
 */
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BadRequestException,
  NotFoundException,
  PayloadTooLargeException,
  UnprocessableEntityException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import sharp from 'sharp';
import { MEDIA_MESSAGES } from './media.messages';
import type { MediaRecord, MediaRepository } from './media.repository';
import { displayName, MediaService } from './media.service';
import type { StorageBackend } from './storage/storage.interface';

describe('MediaService', () => {
  let directory: string;
  let storage: jest.Mocked<StorageBackend>;
  let repository: jest.Mocked<
    Pick<
      MediaRepository,
      'create' | 'findById' | 'softDelete' | 'countUnpublishedUsage' | 'findByIds' | 'list'
    >
  >;
  let service: MediaService;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'postgear-media-'));

    storage = {
      kind: 'local',
      put: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
      publicUrl: jest.fn((key: string) => `http://localhost:3001/uploads/${key}`),
    };

    repository = {
      create: jest.fn(async (input) => record({ ...input, id: 'm1' })),
      findById: jest.fn(),
      softDelete: jest.fn(),
      countUnpublishedUsage: jest.fn(),
      findByIds: jest.fn(),
      list: jest.fn(),
    };

    service = new MediaService(repository as unknown as MediaRepository, storage);
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  function record(overrides: Partial<MediaRecord> & Record<string, unknown>): MediaRecord {
    return {
      id: 'm1',
      name: 'photo.jpg',
      type: 'image',
      mimeType: 'image/jpeg',
      fileSize: 100,
      width: 10,
      height: 10,
      path: '2026/09/abcdefabcdefabcdefabcdefabcdefab.jpg',
      thumbnail: null,
      createdAt: new Date('2026-09-14'),
      ...(overrides as Partial<MediaRecord>),
    };
  }

  async function tempFile(contents: Buffer, name = 'upload.bin') {
    const path = join(directory, name);
    await writeFile(path, contents);
    return { path, size: contents.length, originalname: name };
  }

  async function exists(path: string): Promise<boolean> {
    return access(path).then(
      () => true,
      () => false,
    );
  }

  it('compresses an image, stores it with a thumbnail, and records the compressed size', async () => {
    const photo = await sharp({
      create: {
        width: 3000,
        height: 2000,
        channels: 3,
        background: '#808080',
        noise: { type: 'gaussian', mean: 128, sigma: 40 },
      },
    })
      .jpeg({ quality: 100 })
      .toBuffer();
    const file = await tempFile(photo, 'Beach day.jpg');

    const { media, originalBytes } = await service.upload('org_1', file);

    expect(storage.put).toHaveBeenCalledTimes(2);
    const [[imageKey, imageBody, imageType], [thumbKey, , thumbType]] = storage.put.mock.calls;
    expect(imageType).toBe('image/jpeg');
    expect(thumbType).toBe('image/webp');
    expect(thumbKey).toBe(String(imageKey).replace('.jpg', '.thumb.webp'));

    const created = repository.create.mock.calls[0][0];
    expect(created).toMatchObject({
      orgId: 'org_1',
      name: 'Beach day.jpg',
      type: 'image',
      mimeType: 'image/jpeg',
      width: 2048,
      path: imageKey,
      thumbnail: thumbKey,
    });
    // The recorded size is the stored file, not the upload.
    expect(created.fileSize).toBe((imageBody as Buffer).length);
    expect(created.fileSize).toBeLessThan(photo.length);
    expect(originalBytes).toBe(photo.length);

    expect(media.url).toContain('/uploads/');
    expect(await exists(file.path)).toBe(false);
  });

  it('stores a video from its temp file without reading it into memory', async () => {
    const video = Buffer.concat([
      Buffer.from([0, 0, 0, 0x18]),
      Buffer.from('ftypmp42'),
      Buffer.alloc(64),
    ]);
    const file = await tempFile(video, 'clip.mp4');

    await service.upload('org_1', file);

    expect(storage.put).toHaveBeenCalledTimes(1);
    expect(storage.put.mock.calls[0][1]).toEqual({ filePath: file.path, size: video.length });
    expect(repository.create.mock.calls[0][0]).toMatchObject({
      type: 'video',
      mimeType: 'video/mp4',
      thumbnail: null,
    });
  });

  it('refuses a request with no file', async () => {
    await expect(service.upload('org_1', undefined)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a file by its bytes, whatever it is called, and removes the temp file', async () => {
    const file = await tempFile(Buffer.from('<svg onload="alert(1)">'), 'innocent.jpg');

    await expect(service.upload('org_1', file)).rejects.toBeInstanceOf(
      UnsupportedMediaTypeException,
    );
    expect(storage.put).not.toHaveBeenCalled();
    expect(await exists(file.path)).toBe(false);
  });

  it('explains HEIC rather than calling it unsupported', async () => {
    const heic = Buffer.concat([
      Buffer.from([0, 0, 0, 0x18]),
      Buffer.from('ftypheic'),
      Buffer.alloc(16),
    ]);

    await expect(service.upload('org_1', await tempFile(heic))).rejects.toThrow(
      MEDIA_MESSAGES.HEIC,
    );
  });

  it('applies the image limit to images even though the multipart limit is higher', async () => {
    const jpegHeader = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    const file = await tempFile(jpegHeader);

    await expect(
      service.upload('org_1', { ...file, size: 21 * 1024 * 1024 }),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('reports a damaged image as unreadable', async () => {
    const file = await tempFile(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]));

    await expect(service.upload('org_1', file)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('removes stored objects when the database write fails, so nothing is orphaned', async () => {
    const png = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#123' } })
      .png()
      .toBuffer();
    repository.create.mockRejectedValueOnce(new Error('db down'));

    await expect(service.upload('org_1', await tempFile(png))).rejects.toThrow('db down');

    const storedKeys = storage.put.mock.calls.map(([key]) => key);
    expect(storedKeys).toHaveLength(2);
    expect(storage.delete.mock.calls.map(([key]) => key).sort()).toEqual([...storedKeys].sort());
  });

  it('deletes the row before the files, and survives a storage failure', async () => {
    repository.softDelete.mockResolvedValueOnce(
      record({
        path: '2026/09/abcdefabcdefabcdefabcdefabcdefab.jpg',
        thumbnail: '2026/09/abcdefabcdefabcdefabcdefabcdefab.thumb.webp',
      }),
    );
    storage.delete.mockRejectedValueOnce(new Error('bucket unreachable'));

    await expect(service.remove('org_1', 'm1')).resolves.toBeUndefined();
    expect(storage.delete).toHaveBeenCalledTimes(2);
  });

  it('404s reading, deleting or measuring media that is not in this workspace', async () => {
    repository.softDelete.mockResolvedValueOnce(null);
    repository.findById.mockResolvedValue(null);

    await expect(service.get('org_1', 'other-org-media')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.remove('org_1', 'other-org-media')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.usage('org_1', 'other-org-media')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(repository.findById).toHaveBeenCalledWith('org_1', 'other-org-media');
  });

  it('builds URLs from keys and never exposes the keys themselves', () => {
    const view = service.toView(
      record({ thumbnail: '2026/09/abcdefabcdefabcdefabcdefabcdefab.thumb.webp' }),
    );

    expect(view.url).toBe(
      'http://localhost:3001/uploads/2026/09/abcdefabcdefabcdefabcdefabcdefab.jpg',
    );
    expect(view.thumbnailUrl).toContain('.thumb.webp');
    expect(view).not.toHaveProperty('path');
    expect(view).not.toHaveProperty('thumbnail');
  });
});

describe('displayName', () => {
  it('keeps only the file name, without paths or invisible characters', () => {
    expect(displayName('C:\\Users\\me\\Pictures\\launch.png')).toBe('launch.png');
    expect(displayName('/home/me/launch.png')).toBe('launch.png');
    // U+202E would render the name backwards.
    expect(displayName('evil\u202Egnp.exe')).toBe('evilgnp.exe');
    expect(displayName('   ')).toBe('Untitled upload');
    expect(displayName('café.jpg')).toBe('café.jpg');
  });
});
