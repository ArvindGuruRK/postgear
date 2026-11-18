import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { soundRefKey } from '@postgear/video-engine';
import { FakePrivateStorage } from '../testing/fakes';
import { fetchSoundFiles } from './files';
import type { SoundFileRows } from './rows';

const ORG = 'seed-demo-org';
const PEAKS = Array.from({ length: 100 }, () => 9);

/** A document with the given sound refs, one audio track (only `tracks` is read). */
function docWith(refs: Array<{ library: 'sound'; id: string } | { asset: string }>) {
  return {
    tracks: [
      {
        kind: 'audio',
        items: refs.map((ref, k) => ({ id: `s${k}`, ref })),
      },
    ],
  } as never;
}

describe('fetchSoundFiles', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'pg-sound-files-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function deps() {
    const library = new Map<string, { fileKey: string; durationMs: number }>([
      ['lib-a', { fileKey: 'library/sounds/aa/a.m4a', durationMs: 1_200 }],
      ['lib-lost', { fileKey: 'library/sounds/bb/lost.m4a', durationMs: 900 }],
    ]);
    const assets = new Map<
      string,
      { id: string; organizationId: string; key: string; meta: unknown }
    >([
      [
        'up-ready',
        {
          id: 'up-ready',
          organizationId: ORG,
          key: 'clips/seed-demo-org/library/ready.m4a',
          meta: {
            status: 'ready',
            purpose: 'sound',
            name: 'Mine',
            durationMs: 4_000,
            peaks: PEAKS,
          },
        },
      ],
      [
        'up-checking',
        {
          id: 'up-checking',
          organizationId: ORG,
          key: 'clips/seed-demo-org/library/checking.mp3',
          meta: { status: 'checking', purpose: 'sound', name: 'Later' },
        },
      ],
    ]);
    const rows: SoundFileRows = {
      async librarySound(id) {
        return library.get(id) ?? null;
      },
      async soundAsset(organizationId, id) {
        const row = assets.get(id);
        return row && row.organizationId === organizationId ? row : null;
      },
    };
    const publicFiles = new Map<string, Buffer>([
      ['library/sounds/aa/a.m4a', Buffer.from('library sound')],
    ]);
    const privateStorage = new FakePrivateStorage();
    privateStorage.objects.set('clips/seed-demo-org/library/ready.m4a', Buffer.from('my upload'));
    privateStorage.objects.set('clips/seed-demo-org/library/checking.mp3', Buffer.from('not yet'));
    return {
      rows,
      storage: { read: async (key: string) => publicFiles.get(key) ?? null },
      privateStorage,
    };
  }

  it('fetches each sound once, as sound-<k>.m4a keyed by soundRefKey, with its length', async () => {
    const doc = docWith([
      { library: 'sound', id: 'lib-a' },
      { asset: 'up-ready' },
      { library: 'sound', id: 'lib-a' },
    ]);
    const files = await fetchSoundFiles(
      deps() as never,
      ORG,
      doc,
      dir,
      new AbortController().signal,
    );
    expect(files).toEqual({
      [soundRefKey({ library: 'sound', id: 'lib-a' })]: { file: 'sound-0.m4a', durationMs: 1_200 },
      [soundRefKey({ asset: 'up-ready' })]: { file: 'sound-1.m4a', durationMs: 4_000 },
    });
    expect(readFileSync(path.join(dir, 'sound-0.m4a'), 'utf8')).toBe('library sound');
    expect(readFileSync(path.join(dir, 'sound-1.m4a'), 'utf8')).toBe('my upload');
  });

  it('leaves out a removed or unknown library sound, a lost file, an upload still checking, or another workspace', async () => {
    const doc = docWith([
      { library: 'sound', id: 'gone' },
      { library: 'sound', id: 'lib-lost' },
      { asset: 'up-checking' },
      { asset: 'nobody' },
      { asset: 'up-ready' },
    ]);
    const files = await fetchSoundFiles(
      deps() as never,
      ORG,
      doc,
      dir,
      new AbortController().signal,
    );
    expect(Object.keys(files)).toEqual(['asset:up-ready']);
    expect(files['asset:up-ready']?.file).toBe('sound-0.m4a');
    const other = await fetchSoundFiles(
      deps() as never,
      'other-org',
      docWith([{ asset: 'up-ready' }]),
      dir,
      new AbortController().signal,
    );
    expect(other).toEqual({});
  });

  it('stops when the job is cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      fetchSoundFiles(
        deps() as never,
        ORG,
        docWith([{ library: 'sound', id: 'lib-a' }]),
        dir,
        controller.signal,
      ),
    ).rejects.toThrow();
  });
});
