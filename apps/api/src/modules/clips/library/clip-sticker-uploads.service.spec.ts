/**
 * A workspace's own stickers (Module 12 section 5) with storage, the worker
 * and the rows faked: the type comes from the bytes, the 8 MB cap, the
 * storage gauge through the limits adapter before anything is kept, the
 * check waited on, a refused file deleted and answered in one sentence, a
 * stuck check started again (and given up on), the in-use refusal with its
 * count, tenancy, and the editor's file lookup with `missing`.
 */
import { HttpException } from '@nestjs/common';
import type { ClipAsset } from '@postgear/db';
import type { PrivateStorage } from '@postgear/storage';
import { STICKER_UPLOAD_MAX_BYTES, type StickerAssetMeta } from '@postgear/video-engine';
import type { SchedulingService } from '../../scheduling/scheduling.service';
import type { ClipLimitsGuard } from '../limits/clip-limits.guard';
import type { ClipPlaybackService } from '../videos/clip-playback.service';
import type { ClipLibraryService } from './clip-library.service';
import type { ClipStickerUploadsRepository } from './clip-sticker-uploads.repository';
import {
  ClipStickerUploadsService,
  STICKER_CHECK_GIVE_UP_MS,
  STICKER_CHECK_RESTART_MS,
  type StickerUploadFile,
} from './clip-sticker-uploads.service';
import type { ResolvedSticker, StickerProvider } from './sticker-provider';

const ORG = 'seed-demo-org';
const OTHER_ORG = 'seed-second-org';
const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPEG_HEAD = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]);
const LIBRARY_ID = '43c9d3e8-90cf-406d-bf4b-883caad5a985';
const NOW = new Date('2026-11-19T10:00:00Z');

function file(head: Buffer, size = 2_000, name = 'party_hat.png'): StickerUploadFile {
  const buffer = Buffer.concat([head, Buffer.alloc(Math.max(0, size - head.length))]);
  return { buffer, originalname: name, size: buffer.length };
}

type CheckResult = 'ready' | 'failed' | 'slow';

function setup(options: { check?: CheckResult; inUse?: number } = {}) {
  const rows = new Map<string, ClipAsset>();
  const objects = new Map<string, number>();
  const checks: Array<{ assetId: string; waitMs: number }> = [];
  let next = 0;
  const makeId = () => {
    next += 1;
    return `5d1e2f3a-4b5c-4d6e-8f70-${String(next).padStart(12, '0')}`;
  };

  const repository = {
    create: jest.fn(
      async (
        orgId: string,
        data: { key: string; bytes: number; mimeType: string; meta: unknown },
      ) => {
        const row = {
          id: makeId(),
          organizationId: orgId,
          videoId: null,
          clipId: null,
          kind: 'STICKER',
          key: data.key,
          bytes: BigInt(data.bytes),
          mimeType: data.mimeType,
          meta: data.meta,
          createdAt: NOW,
        } as unknown as ClipAsset;
        rows.set(row.id, row);
        return row;
      },
    ),
    list: jest.fn(async (orgId: string) =>
      [...rows.values()].filter((row) => row.organizationId === orgId),
    ),
    find: jest.fn(async (orgId: string, id: string) => {
      const row = rows.get(id);
      return row && row.organizationId === orgId ? row : null;
    }),
    findMany: jest.fn(async (orgId: string, ids: string[]) =>
      ids.flatMap((id) => {
        const row = rows.get(id);
        return row && row.organizationId === orgId ? [row] : [];
      }),
    ),
    remove: jest.fn(async (orgId: string, id: string) => {
      const row = rows.get(id);
      if (!row || row.organizationId !== orgId) return false;
      rows.delete(id);
      return true;
    }),
    clipsUsing: jest.fn(async () => options.inUse ?? 0),
  };
  const ready = (row: ClipAsset): StickerAssetMeta => ({
    status: 'ready',
    name: (row.meta as { name: string }).name,
    animated: false,
    width: 512,
    height: 256,
    fps: null,
    frames: null,
    durationMs: null,
    previewKey: `clips/${row.organizationId}/library/ffffffffffffffff.webp`,
  });
  const scheduling = {
    runClipQuery: jest.fn(async (request: { args: Array<{ assetId: string }>; waitMs: number }) => {
      const { assetId } = request.args[0] as { assetId: string };
      checks.push({ assetId, waitMs: request.waitMs });
      const row = rows.get(assetId);
      if (!row) return { outcome: 'answered', value: { status: 'gone' } };
      const result = options.check ?? 'ready';
      if (result === 'slow') return { outcome: 'unavailable' };
      row.meta = (
        result === 'ready'
          ? ready(row)
          : { status: 'failed', name: 'party hat', error: 'sticker_unusable' }
      ) as never;
      return { outcome: 'answered', value: { status: result } };
    }),
  };
  const storage = {
    put: jest.fn(async (key: string, body: Buffer) => {
      objects.set(key, body.length);
      return { bytes: body.length };
    }),
    delete: jest.fn(async (key: string) => {
      objects.delete(key);
    }),
  };
  const library = { admit: jest.fn(async () => undefined) };
  const limits = { assertStorage: jest.fn(async () => undefined) };
  const playback = {
    address: jest.fn(async (key: string) => ({
      url: `signed:${key}`,
      expiresAt: NOW.toISOString(),
    })),
  };
  const provider: StickerProvider = {
    search: jest.fn(),
    resolve: jest.fn(
      async (): Promise<ResolvedSticker[]> => [
        {
          id: LIBRARY_ID,
          name: 'Fire',
          kind: 'animated',
          category: 'reactions',
          tags: [],
          width: 400,
          height: 168,
          durationMs: 1_500,
          fps: 12,
          frames: 18,
          previewUrl: 'preview',
          fileUrl: 'file',
          isFavourite: false,
          credit: null,
          active: false,
        },
      ],
    ),
  };
  const service = new ClipStickerUploadsService(
    repository as unknown as ClipStickerUploadsRepository,
    library as unknown as ClipLibraryService,
    limits as unknown as ClipLimitsGuard,
    playback as unknown as ClipPlaybackService,
    scheduling as unknown as SchedulingService,
    storage as unknown as PrivateStorage,
    provider,
  );
  return { service, rows, objects, checks, repository, storage, limits, library };
}

async function refusal(
  promise: Promise<unknown>,
): Promise<{ status: number; code: string | undefined; message: string }> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpException) {
      const body = error.getResponse() as { code?: string; message: string };
      return { status: error.getStatus(), code: body.code, message: body.message };
    }
    throw error;
  }
  throw new Error('expected a refusal');
}

describe('uploading a sticker', () => {
  it('keeps a PNG checking, waits for the check, and answers it ready with signed addresses', async () => {
    const { service, objects, checks, limits, library } = setup();
    const { sticker } = await service.upload(ORG, file(PNG_HEAD));
    expect(library.admit).toHaveBeenCalledWith(ORG);
    expect(limits.assertStorage).toHaveBeenCalledWith(ORG, 2_000);
    expect([...objects.keys()]).toEqual([
      expect.stringMatching(/^clips\/seed-demo-org\/library\/[0-9a-f]+\.png$/),
    ]);
    expect(checks).toEqual([{ assetId: sticker.id, waitMs: 25_000 }]);
    expect(sticker).toMatchObject({
      name: 'party hat',
      status: 'ready',
      kind: 'static',
      width: 512,
      fileUrl: expect.stringMatching(/^signed:clips\/seed-demo-org\/library\//),
      previewUrl: 'signed:clips/seed-demo-org/library/ffffffffffffffff.webp',
    });
  });

  it('answers checking when the worker is slow, so the Uploaded tab shows it as it is', async () => {
    const { service } = setup({ check: 'slow' });
    expect((await service.upload(ORG, file(PNG_HEAD))).sticker).toMatchObject({
      status: 'checking',
      fileUrl: null,
    });
  });

  it('reads the type from the bytes: a JPEG or text named .png is refused before anything is kept', async () => {
    const { service, objects, limits } = setup();
    expect(await refusal(service.upload(ORG, file(JPEG_HEAD, 2_000, 'photo.png')))).toMatchObject({
      status: 415,
      code: 'sticker_unusable',
      message: 'This file is not a picture we can use. Upload a PNG, GIF or WebP.',
    });
    expect(
      await refusal(service.upload(ORG, file(Buffer.from('<svg onload=alert(1)>'), 100, 'x.png'))),
    ).toMatchObject({
      code: 'sticker_unusable',
    });
    expect(await refusal(service.upload(ORG, undefined))).toMatchObject({
      code: 'sticker_unusable',
    });
    expect(objects.size).toBe(0);
    expect(limits.assertStorage).not.toHaveBeenCalled();
  });

  it('refuses a file over 8 MB', async () => {
    const { service } = setup();
    expect(
      await refusal(service.upload(ORG, file(PNG_HEAD, STICKER_UPLOAD_MAX_BYTES + 1))),
    ).toEqual({
      status: 413,
      code: 'sticker_upload_too_big',
      message: 'This file is over 8 MB. Pick a smaller one.',
    });
  });

  it('a full workspace is refused by the resolver before the file is kept', async () => {
    const { service, objects, limits } = setup();
    limits.assertStorage.mockRejectedValueOnce(
      new HttpException({ message: 'full', code: 'clips_storage_full' }, 402),
    );
    expect(await refusal(service.upload(ORG, file(PNG_HEAD)))).toMatchObject({
      status: 402,
      code: 'clips_storage_full',
    });
    expect(objects.size).toBe(0);
  });

  it('a file the check refuses is not kept, and the person reads why', async () => {
    const { service, rows } = setup({ check: 'failed' });
    expect(await refusal(service.upload(ORG, file(PNG_HEAD)))).toMatchObject({
      status: 422,
      code: 'sticker_unusable',
    });
    expect(rows.size).toBe(0);
  });
});

describe('the Uploaded tab', () => {
  it('starts a check again after a minute, and gives up after fifteen', async () => {
    const { service, rows, checks } = setup({ check: 'slow' });
    const { sticker } = await service.upload(ORG, file(PNG_HEAD));
    checks.length = 0;
    const row = rows.get(sticker.id) as ClipAsset;

    await service.list(ORG, new Date(NOW.getTime() + STICKER_CHECK_RESTART_MS - 1));
    expect(checks).toEqual([]);
    const later = await service.list(ORG, new Date(NOW.getTime() + STICKER_CHECK_RESTART_MS));
    expect(checks).toEqual([{ assetId: row.id, waitMs: 1 }]);
    expect(later.stickers[0]).toMatchObject({ status: 'checking' });

    checks.length = 0;
    const given = await service.list(ORG, new Date(NOW.getTime() + STICKER_CHECK_GIVE_UP_MS));
    expect(checks).toEqual([]);
    expect(given.stickers[0]).toMatchObject({
      status: 'failed',
      error: 'Something went wrong on our side. Try again in a little while.',
    });
  });

  it("lists only the workspace's own stickers", async () => {
    const { service } = setup();
    await service.upload(ORG, file(PNG_HEAD));
    expect((await service.list(OTHER_ORG, NOW)).stickers).toEqual([]);
    expect((await service.list(ORG, NOW)).stickers).toHaveLength(1);
  });
});

describe('deleting an uploaded sticker', () => {
  it('deletes the row, the file and its preview', async () => {
    const { service, rows, storage } = setup();
    const { sticker } = await service.upload(ORG, file(PNG_HEAD));
    const key = (rows.get(sticker.id) as ClipAsset).key;
    expect(await service.remove(ORG, sticker.id)).toEqual({ message: 'Sticker deleted.' });
    expect(rows.size).toBe(0);
    expect(storage.delete).toHaveBeenCalledWith(key);
    expect(storage.delete).toHaveBeenCalledWith(
      'clips/seed-demo-org/library/ffffffffffffffff.webp',
    );
  });

  it('refuses with the count while clips use it, and is a 404 for another workspace', async () => {
    const used = setup({ inUse: 2 });
    const { sticker } = await used.service.upload(ORG, file(PNG_HEAD));
    expect(await refusal(used.service.remove(ORG, sticker.id))).toEqual({
      status: 409,
      code: 'sticker_in_use',
      message: 'This sticker is in 2 clips. Take it out of them first, then delete it.',
    });
    expect(used.rows.size).toBe(1);
    expect(await refusal(used.service.remove(OTHER_ORG, sticker.id))).toMatchObject({
      status: 404,
      code: 'sticker_not_found',
    });
    expect(await refusal(used.service.remove(ORG, 'not-a-uuid'))).toMatchObject({ status: 404 });
  });
});

describe('the files a clip draws', () => {
  it('answers library and uploaded stickers in the order asked, and missing for one that is gone', async () => {
    const { service } = setup();
    const { sticker } = await service.upload(ORG, file(PNG_HEAD));
    const gone = '11111111-1111-4111-8111-111111111111';
    const { files } = await service.files(ORG, {
      library: [LIBRARY_ID, gone],
      asset: [sticker.id],
    });
    expect(files.map((f) => [f.key, f.missing])).toEqual([
      [`library:${LIBRARY_ID}`, false],
      [`library:${gone}`, true],
      [`asset:${sticker.id}`, false],
    ]);
    expect(files[2]).toMatchObject({
      kind: 'static',
      width: 512,
      fileUrl: expect.stringMatching(/^signed:/),
    });
    // Another workspace cannot read this workspace's upload.
    const other = await service.files(OTHER_ORG, { asset: [sticker.id] });
    expect(other.files).toEqual([{ key: `asset:${sticker.id}`, missing: true }]);
  });
});
