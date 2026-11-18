/**
 * A workspace's own sounds (Module 14 section 4) with storage, the worker and
 * the rows faked: the type comes from the bytes (a text file named `.mp3` is
 * refused), the 20 MB cap, the storage gauge before anything is kept, the
 * check waited on, a refused file deleted and answered in one sentence, a
 * stuck check started again (and given up on), the in-use refusal with its
 * count, tenancy, and the editor's file lookup (a hidden library sound plays,
 * a removed one says so, an upload only once ready).
 */
import { HttpException } from '@nestjs/common';
import type { ClipAsset } from '@postgear/db';
import type { PrivateStorage } from '@postgear/storage';
import { SOUND_UPLOAD_MAX_BYTES, type SoundAssetMeta } from '@postgear/video-engine';
import type { SchedulingService } from '../../scheduling/scheduling.service';
import type { ClipLimitsGuard } from '../limits/clip-limits.guard';
import type { ClipPlaybackService } from '../videos/clip-playback.service';
import type { ClipLibraryService } from './clip-library.service';
import type { ClipSoundUploadsRepository } from './clip-sound-uploads.repository';
import {
  ClipSoundUploadsService,
  SOUND_CHECK_GIVE_UP_MS,
  SOUND_CHECK_RESTART_MS,
  type SoundUploadFile,
} from './clip-sound-uploads.service';
import { sniffSound } from './sound-file-type';
import type { ResolvedSound, SoundProvider } from './sound-provider';

const ORG = 'seed-demo-org';
const OTHER_ORG = 'seed-second-org';
const MP3_HEAD = Buffer.from('ID3\u0004\u0000\u0000\u0000\u0000\u0000\u0000', 'latin1');
const FRAME_HEAD = Buffer.from([0xff, 0xfb, 0x90, 0x64]);
const WAV_HEAD = Buffer.from('RIFF\u0000\u0000\u0000\u0000WAVEfmt ', 'latin1');
const M4A_HEAD = Buffer.from('\u0000\u0000\u0000 ftypM4A \u0000\u0000', 'latin1');
const ADTS_HEAD = Buffer.from([0xff, 0xf1, 0x50, 0x80]);
const LIBRARY_ID = '43c9d3e8-90cf-406d-bf4b-883caad5a985';
const REMOVED_ID = '53c9d3e8-90cf-406d-bf4b-883caad5a985';
const NOW = new Date('2026-11-19T10:00:00Z');
const PEAKS = Array.from({ length: 100 }, (_, k) => k);

function file(head: Buffer, size = 3_000, name = 'my_intro.mp3'): SoundUploadFile {
  const buffer = Buffer.concat([head, Buffer.alloc(Math.max(0, size - head.length))]);
  return { buffer, originalname: name, size: buffer.length };
}

type CheckResult = 'ready' | 'failed' | 'slow';

function setup(options: { check?: CheckResult; inUse?: number } = {}) {
  const rows = new Map<string, ClipAsset>();
  const objects = new Map<string, number>();
  const checks: Array<{ assetId: string; waitMs: number; workflowType: string }> = [];
  let next = 0;
  const makeId = () => {
    next += 1;
    return `6e2f3a4b-5c6d-4e7f-8a91-${String(next).padStart(12, '0')}`;
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
          kind: 'AUDIO',
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
  const ready = (row: ClipAsset): SoundAssetMeta => ({
    status: 'ready',
    purpose: 'sound',
    name: (row.meta as { name: string }).name,
    durationMs: 4_250,
    peaks: PEAKS,
  });
  const scheduling = {
    runClipQuery: jest.fn(
      async (request: {
        workflowType: string;
        args: Array<{ assetId: string }>;
        waitMs: number;
      }) => {
        const { assetId } = request.args[0] as { assetId: string };
        checks.push({ assetId, waitMs: request.waitMs, workflowType: request.workflowType });
        const row = rows.get(assetId);
        if (!row) return { outcome: 'answered', value: { status: 'gone' } };
        const result = options.check ?? 'ready';
        if (result === 'slow') return { outcome: 'unavailable' };
        row.meta = (
          result === 'ready'
            ? ready(row)
            : { status: 'failed', purpose: 'sound', name: 'my intro', error: 'sound_unusable' }
        ) as never;
        return { outcome: 'answered', value: { status: result } };
      },
    ),
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
  const hidden: ResolvedSound = {
    id: LIBRARY_ID,
    name: 'Soft Ding',
    kind: 'sfx',
    category: 'alerts',
    tags: ['ding'],
    durationMs: 900,
    bpm: null,
    previewUrl: 'http://localhost:3001/uploads/library/sounds/ab/ab.m4a',
    peaks: PEAKS,
    isFavourite: false,
    credit: null,
    details: {
      source: 'PostGear Sounds',
      author: 'PostGear',
      licence: 'OWN',
      licenceUrl: 'own://licence',
      sourceUrl: 'own://sounds/soft-ding',
    },
    active: false,
  };
  const provider: SoundProvider = {
    search: jest.fn(),
    resolve: jest.fn(async () => ({ sounds: [hidden], removed: [REMOVED_ID] })),
  };
  const service = new ClipSoundUploadsService(
    repository as unknown as ClipSoundUploadsRepository,
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

describe('the sound sniff', () => {
  it('knows MP3, WAV, M4A and AAC by their bytes, and nothing else', () => {
    expect(sniffSound(MP3_HEAD)).toEqual({ ext: 'mp3', mimeType: 'audio/mpeg' });
    expect(sniffSound(FRAME_HEAD)).toEqual({ ext: 'mp3', mimeType: 'audio/mpeg' });
    expect(sniffSound(WAV_HEAD)).toEqual({ ext: 'wav', mimeType: 'audio/wav' });
    expect(sniffSound(M4A_HEAD)).toEqual({ ext: 'm4a', mimeType: 'audio/mp4' });
    expect(sniffSound(ADTS_HEAD)).toEqual({ ext: 'aac', mimeType: 'audio/aac' });
    expect(sniffSound(Buffer.from('This is a text file named .mp3'))).toBeNull();
    expect(sniffSound(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
    expect(sniffSound(Buffer.from('OggS'))).toBeNull();
  });
});

describe('uploading a sound', () => {
  it('keeps an MP3 checking, waits for the check, and answers it ready with a signed address', async () => {
    const { service, objects, checks, limits, library } = setup();
    const { sound } = await service.upload(ORG, file(MP3_HEAD));
    expect(library.admit).toHaveBeenCalledWith(ORG);
    expect(limits.assertStorage).toHaveBeenCalledWith(ORG, 3_000);
    expect([...objects.keys()]).toEqual([
      expect.stringMatching(/^clips\/seed-demo-org\/library\/[0-9a-f]+\.mp3$/),
    ]);
    expect(checks).toEqual([
      { assetId: sound.id, waitMs: 25_000, workflowType: 'clipSoundCheckWorkflow' },
    ]);
    expect(sound).toMatchObject({
      name: 'my intro',
      status: 'ready',
      error: null,
      durationMs: 4_250,
      peaks: PEAKS,
      fileUrl: expect.stringMatching(/^signed:clips\/seed-demo-org\/library\//),
    });
  });

  it('refuses a text file named .mp3 before keeping anything, in one sentence', async () => {
    const { service, objects, limits } = setup();
    expect(
      await refusal(service.upload(ORG, file(Buffer.from('just some words, not a sound')))),
    ).toEqual({
      status: 415,
      code: 'sound_unusable',
      message: 'This file is not a sound we can use. Upload an MP3, WAV, M4A or AAC file.',
    });
    expect(await refusal(service.upload(ORG, undefined))).toMatchObject({ code: 'sound_unusable' });
    expect(objects.size).toBe(0);
    expect(limits.assertStorage).not.toHaveBeenCalled();
  });

  it('refuses a file over 20 MB', async () => {
    const { service, objects } = setup();
    expect(
      await refusal(service.upload(ORG, file(MP3_HEAD, SOUND_UPLOAD_MAX_BYTES + 1))),
    ).toMatchObject({
      status: 413,
      code: 'sound_upload_too_big',
    });
    expect(objects.size).toBe(0);
  });

  it('deletes a file the check refuses and answers why', async () => {
    const { service, rows } = setup({ check: 'failed' });
    expect(await refusal(service.upload(ORG, file(WAV_HEAD, 3_000, 'loop.wav')))).toMatchObject({
      status: 422,
      code: 'sound_unusable',
    });
    expect(rows.size).toBe(0);
  });

  it('answers checking when the worker is slow, starts it again after a minute, and gives up after fifteen', async () => {
    const { service, checks } = setup({ check: 'slow' });
    const { sound } = await service.upload(ORG, file(M4A_HEAD, 3_000, 'voice.m4a'));
    expect(sound).toMatchObject({ status: 'checking', fileUrl: null, peaks: null });
    expect((await service.list(ORG, new Date(NOW.getTime() + 10_000))).sounds[0]?.status).toBe(
      'checking',
    );
    expect(checks).toHaveLength(1);
    await service.list(ORG, new Date(NOW.getTime() + SOUND_CHECK_RESTART_MS));
    expect(checks).toHaveLength(2);
    expect(checks[1]).toMatchObject({ assetId: sound.id, waitMs: 1 });
    const late = await service.list(ORG, new Date(NOW.getTime() + SOUND_CHECK_GIVE_UP_MS));
    expect(late.sounds[0]).toMatchObject({ status: 'failed' });
    expect(checks).toHaveLength(2);
  });

  it('lists only the workspace own sounds', async () => {
    const { service } = setup();
    await service.upload(ORG, file(MP3_HEAD));
    expect((await service.list(ORG)).sounds).toHaveLength(1);
    expect((await service.list(OTHER_ORG)).sounds).toHaveLength(0);
  });
});

describe('deleting a sound', () => {
  it('refuses while a clip plays it, with the count, then deletes it and its file', async () => {
    const used = setup({ inUse: 2 });
    const { sound } = await used.service.upload(ORG, file(MP3_HEAD));
    expect(await refusal(used.service.remove(ORG, sound.id))).toEqual({
      status: 409,
      code: 'sound_in_use',
      message: 'This sound is in 2 clips. Take it out of them first, then delete it.',
    });
    const free = setup();
    const added = await free.service.upload(ORG, file(MP3_HEAD));
    expect(await free.service.remove(ORG, added.sound.id)).toEqual({ message: 'Sound deleted.' });
    expect(free.objects.size).toBe(0);
  });

  it('answers 404 for another workspace sound or a bad id', async () => {
    const { service } = setup();
    const { sound } = await service.upload(ORG, file(MP3_HEAD));
    expect(await refusal(service.remove(OTHER_ORG, sound.id))).toMatchObject({
      status: 404,
      code: 'sound_not_found',
    });
    expect(await refusal(service.remove(ORG, 'not-an-id'))).toMatchObject({ status: 404 });
  });
});

describe('the files of the sounds a clip has', () => {
  it('plays a hidden library sound, says a removed one was removed, and an upload only once ready', async () => {
    const ready = setup();
    const { sound } = await ready.service.upload(ORG, file(MP3_HEAD));
    const unknown = '73c9d3e8-90cf-406d-bf4b-883caad5a985';
    const { files } = await ready.service.files(ORG, {
      library: [LIBRARY_ID, REMOVED_ID, unknown],
      asset: [sound.id],
    });
    expect(files).toEqual([
      {
        key: `library:${LIBRARY_ID}`,
        missing: false,
        name: 'Soft Ding',
        kind: 'sfx',
        durationMs: 900,
        fileUrl: 'http://localhost:3001/uploads/library/sounds/ab/ab.m4a',
        peaks: PEAKS,
      },
      { key: `library:${REMOVED_ID}`, missing: true, removed: true },
      { key: `library:${unknown}`, missing: true, removed: false },
      {
        key: `asset:${sound.id}`,
        missing: false,
        name: 'my intro',
        kind: 'sfx',
        durationMs: 4_250,
        fileUrl: expect.stringMatching(/^signed:/),
        peaks: PEAKS,
      },
    ]);

    const slow = setup({ check: 'slow' });
    const checking = await slow.service.upload(ORG, file(MP3_HEAD));
    expect((await slow.service.files(ORG, { asset: [checking.sound.id] })).files).toEqual([
      { key: `asset:${checking.sound.id}`, missing: true, removed: false },
    ]);
    // Another workspace's upload is never handed out.
    expect((await ready.service.files(OTHER_ORG, { asset: [sound.id] })).files).toEqual([
      { key: `asset:${sound.id}`, missing: true, removed: false },
    ]);
  });
});
