/**
 * Avatars: presets, uploads, clearing, and the OAuth photo import.
 *
 * Images are real (built with sharp) and really processed, so the 256 px WebP
 * output is checked rather than assumed. Storage is a fake recording what was
 * put and deleted; `fetch` is mocked: no test reaches a network.
 */
jest.mock('@postgear/db', () => {
  const actual = jest.requireActual('@postgear/db');

  return {
    ...actual,
    prisma: {
      user: {
        findUniqueOrThrow: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    },
  };
});

import {
  BadRequestException,
  UnprocessableEntityException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { prisma } from '@postgear/db';
import sharp from 'sharp';
import type { StorageBackend } from '../media/storage/storage.interface';
import { isAvatarKey } from '../media/storage/storage-keys';
import { AvatarService, MAX_AVATAR_UPLOAD_BYTES } from './avatar.service';

const db = prisma as unknown as {
  user: Record<'findUniqueOrThrow' | 'update' | 'updateMany', jest.Mock>;
};

const USER = '3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e';
const OTHER_USER = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const BASE = 'http://localhost:3001/uploads/';

function fakeStorage() {
  const storage = {
    kind: 'local' as const,
    put: jest.fn(async () => undefined),
    delete: jest.fn(async () => undefined),
    publicUrl: jest.fn((key: string) => `${BASE}${key}`),
  };
  return storage satisfies StorageBackend;
}

async function png(width = 400, height = 300): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: '#1d4ed8' } })
    .png()
    .toBuffer();
}

function ownKey(userId = USER): string {
  return `avatars/${userId}/${'ab'.repeat(16)}.webp`;
}

let storage: ReturnType<typeof fakeStorage>;
let service: AvatarService;

beforeEach(() => {
  jest.clearAllMocks();
  storage = fakeStorage();
  service = new AvatarService(storage);
  db.user.findUniqueOrThrow.mockResolvedValue({ avatarUrl: null });
});

describe('setPreset', () => {
  it('stores the preset, clears any image and returns the session shape', async () => {
    db.user.update.mockResolvedValue({ avatarPreset: 'notionists-03', avatarUrl: null });

    const avatar = await service.setPreset(USER, 'notionists-03');

    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: USER },
      data: { avatarPreset: 'notionists-03', avatarUrl: null },
      select: { avatarPreset: true, avatarUrl: true },
    });
    expect(avatar).toEqual({ kind: 'preset', id: 'notionists-03' });
  });

  it('refuses an id outside the allowlist', async () => {
    await expect(service.setPreset(USER, 'notionists-99')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it('deletes the previous upload when it was this user’s object on our storage', async () => {
    db.user.findUniqueOrThrow.mockResolvedValue({ avatarUrl: `${BASE}${ownKey()}` });
    db.user.update.mockResolvedValue({ avatarPreset: 'notionists-01', avatarUrl: null });

    await service.setPreset(USER, 'notionists-01');

    expect(storage.delete).toHaveBeenCalledWith(ownKey());
  });

  it('never deletes a URL it did not mint, or another user’s object', async () => {
    db.user.update.mockResolvedValue({ avatarPreset: 'notionists-01', avatarUrl: null });

    for (const url of [
      'https://lh3.googleusercontent.com/a/photo',
      `https://cdn.example.com/${ownKey()}`,
      `${BASE}${ownKey(OTHER_USER)}`,
      `${BASE}avatars/${USER}/../../2026/09/${'ab'.repeat(16)}.jpg`,
    ]) {
      db.user.findUniqueOrThrow.mockResolvedValue({ avatarUrl: url });
      await service.setPreset(USER, 'notionists-01');
    }

    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('still succeeds when removing the old object fails', async () => {
    db.user.findUniqueOrThrow.mockResolvedValue({ avatarUrl: `${BASE}${ownKey()}` });
    db.user.update.mockResolvedValue({ avatarPreset: 'notionists-01', avatarUrl: null });
    storage.delete.mockRejectedValue(new Error('bucket down'));

    await expect(service.setPreset(USER, 'notionists-01')).resolves.toEqual({
      kind: 'preset',
      id: 'notionists-01',
    });
  });
});

describe('upload', () => {
  it('crops to a 256 px square WebP under avatars/<userId>/ and clears the preset', async () => {
    db.user.update.mockImplementation(async ({ data }) => ({
      avatarUrl: data.avatarUrl,
      avatarPreset: data.avatarPreset,
    }));
    const file = await png(400, 300);

    const avatar = await service.upload(USER, { buffer: file, size: file.length });

    expect(storage.put).toHaveBeenCalledTimes(1);
    const [key, body, contentType] = storage.put.mock.calls[0] as unknown as [
      string,
      Buffer,
      string,
    ];
    expect(key.startsWith(`avatars/${USER}/`)).toBe(true);
    expect(isAvatarKey(key)).toBe(true);
    expect(contentType).toBe('image/webp');

    const meta = await sharp(body).metadata();
    expect(meta).toMatchObject({ format: 'webp', width: 256, height: 256 });

    expect(db.user.update.mock.calls[0][0].data).toEqual({
      avatarUrl: `${BASE}${key}`,
      avatarPreset: null,
    });
    expect(avatar).toEqual({ kind: 'image', url: `${BASE}${key}` });
  });

  it('refuses a missing or empty file', async () => {
    await expect(service.upload(USER, undefined)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.upload(USER, { buffer: Buffer.alloc(0), size: 0 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('refuses anything over the size cap', async () => {
    const file = await png();
    await expect(
      service.upload(USER, { buffer: file, size: MAX_AVATAR_UPLOAD_BYTES + 1 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('decides the type from the bytes: GIF and markup are refused whatever they are called', async () => {
    const gif = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#000' } })
      .gif()
      .toBuffer();
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );

    for (const buffer of [gif, svg]) {
      await expect(service.upload(USER, { buffer, size: buffer.length })).rejects.toBeInstanceOf(
        UnsupportedMediaTypeException,
      );
    }
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('refuses a file with a PNG signature that does not decode', async () => {
    const fake = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(64, 1),
    ]);

    await expect(service.upload(USER, { buffer: fake, size: fake.length })).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('removes the stored object again when the database write fails', async () => {
    db.user.update.mockRejectedValue(new Error('db down'));
    const file = await png();

    await expect(service.upload(USER, { buffer: file, size: file.length })).rejects.toThrow(
      'db down',
    );

    const [key] = storage.put.mock.calls[0] as unknown as [string];
    expect(storage.delete).toHaveBeenCalledWith(key);
  });
});

describe('clear', () => {
  it('clears both columns and removes our previous image', async () => {
    db.user.findUniqueOrThrow.mockResolvedValue({ avatarUrl: `${BASE}${ownKey()}` });
    db.user.update.mockResolvedValue({ id: USER });

    await expect(service.clear(USER)).resolves.toBeNull();

    expect(db.user.update.mock.calls[0][0].data).toEqual({ avatarPreset: null, avatarUrl: null });
    expect(storage.delete).toHaveBeenCalledWith(ownKey());
  });
});

describe('importFromUrl (OAuth signup photo)', () => {
  const GOOGLE_PHOTO = 'https://lh3.googleusercontent.com/a/ACg8ocJ=s96-c';
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    fetchMock = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchMock.mockRestore();
  });

  it('re-hosts the photo as a 256 px WebP and sets it while no avatar is chosen', async () => {
    fetchMock.mockResolvedValue(new Response(new Uint8Array(await png(96, 96)), { status: 200 }));
    db.user.updateMany.mockResolvedValue({ count: 1 });

    const avatar = await service.importFromUrl(USER, GOOGLE_PHOTO);

    const [key, body] = storage.put.mock.calls[0] as unknown as [string, Buffer];
    expect(isAvatarKey(key)).toBe(true);
    expect(await sharp(body).metadata()).toMatchObject({ format: 'webp', width: 256, height: 256 });
    expect(db.user.updateMany).toHaveBeenCalledWith({
      where: { id: USER, avatarUrl: null, avatarPreset: null },
      data: { avatarUrl: `${BASE}${key}` },
    });
    expect(avatar).toEqual({ kind: 'image', url: `${BASE}${key}` });
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: 'manual' });
  });

  it('follows a redirect only to another allowed CDN host', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: 'https://scontent-lhr8-1.xx.fbcdn.net/v/photo.jpg' },
        }),
      )
      .mockResolvedValueOnce(new Response(new Uint8Array(await png()), { status: 200 }));
    db.user.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      service.importFromUrl(USER, 'https://platform-lookaside.fbsbx.com/platform/profilepic/'),
    ).resolves.toMatchObject({ kind: 'image' });

    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest' } }),
    );

    await expect(service.importFromUrl(USER, GOOGLE_PHOTO)).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a host that is not a provider CDN', 'https://evil.example.com/a.png'],
    ['plain http', 'http://lh3.googleusercontent.com/a/photo'],
    ['a look-alike host', 'https://googleusercontent.com.evil.example/a.png'],
  ])('never fetches %s', async (_label, url) => {
    await expect(service.importFromUrl(USER, url)).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.user.updateMany).not.toHaveBeenCalled();
  });

  it('falls back to no avatar, without throwing, when the request fails', async () => {
    fetchMock.mockRejectedValue(new Error('timeout'));
    await expect(service.importFromUrl(USER, GOOGLE_PHOTO)).resolves.toBeNull();

    fetchMock.mockResolvedValue(new Response('nope', { status: 404 }));
    await expect(service.importFromUrl(USER, GOOGLE_PHOTO)).resolves.toBeNull();

    fetchMock.mockResolvedValue(new Response('<html>not an image</html>', { status: 200 }));
    await expect(service.importFromUrl(USER, GOOGLE_PHOTO)).resolves.toBeNull();

    expect(storage.put).not.toHaveBeenCalled();
    expect(db.user.updateMany).not.toHaveBeenCalled();
  });

  it('refuses a body over the 2 MB cap', async () => {
    fetchMock.mockResolvedValue(
      new Response(Buffer.alloc(3 * 1024 * 1024), {
        status: 200,
        headers: { 'content-length': String(3 * 1024 * 1024) },
      }),
    );

    await expect(service.importFromUrl(USER, GOOGLE_PHOTO)).resolves.toBeNull();
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('falls back and cleans up when storage or the database fails', async () => {
    fetchMock.mockResolvedValue(new Response(new Uint8Array(await png()), { status: 200 }));
    db.user.updateMany.mockRejectedValue(new Error('db down'));

    await expect(service.importFromUrl(USER, GOOGLE_PHOTO)).resolves.toBeNull();
    const [key] = storage.put.mock.calls[0] as unknown as [string];
    expect(storage.delete).toHaveBeenCalledWith(key);
  });

  it('does not overwrite an avatar chosen in the meantime', async () => {
    fetchMock.mockResolvedValue(new Response(new Uint8Array(await png()), { status: 200 }));
    db.user.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.importFromUrl(USER, GOOGLE_PHOTO)).resolves.toBeNull();
    const [key] = storage.put.mock.calls[0] as unknown as [string];
    expect(storage.delete).toHaveBeenCalledWith(key);
  });

  it('does nothing without a URL', async () => {
    await expect(service.importFromUrl(USER, undefined)).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
