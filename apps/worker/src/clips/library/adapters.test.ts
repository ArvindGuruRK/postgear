import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { readInside } from './adapters/files';
import { kenneyAdapter, saysCc0 } from './adapters/kenney';
import { notoAdapter, notoCandidates, notoFileUrl } from './adapters/noto';
import { openPeepsAdapter } from './adapters/openpeeps';
import { OWN_LICENCE_FILE, ownAdapter } from './adapters/own';
import { loadBrands } from './brands';
import { guardCandidate } from './licence';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const BRANDS = loadBrands(null);

let dir = '';
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'pg-library-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function write(relative: string, body: string | Buffer) {
  mkdirSync(path.dirname(path.join(dir, relative)), { recursive: true });
  writeFileSync(path.join(dir, relative), body);
}

describe('the own pack', () => {
  it('offers every drawn piece as OWN art that passes the guard, emoji at 256 px', async () => {
    write('reactions/wow.png', PNG);
    write('animated-emoji/happy-face-moving.webp', PNG);
    write(
      OWN_LICENCE_FILE,
      JSON.stringify({
        licence: 'OWN',
        creator: 'PostGear',
        items: [
          {
            file: 'reactions/wow.png',
            originId: 'reactions/wow',
            name: 'Wow',
            category: 'reactions',
            tags: ['wow'],
            animated: false,
          },
          {
            file: 'animated-emoji/happy-face-moving.webp',
            originId: 'animated-emoji/happy-face-moving',
            name: 'Happy Face',
            category: 'animated-emoji',
            tags: ['happy'],
            animated: true,
          },
        ],
      }),
    );
    const adapter = ownAdapter(dir);
    const candidates = await adapter.candidates();
    expect(candidates.map((c) => [c.name, c.emojiLike, c.sourceUrl])).toEqual([
      ['Wow', false, 'own://stickers/reactions/wow'],
      ['Happy Face', true, 'own://stickers/animated-emoji/happy-face-moving'],
    ]);
    for (const c of candidates)
      expect(guardCandidate(c, { brands: BRANDS })).toMatchObject({ ok: true, licence: 'OWN' });
    expect(await adapter.read(candidates[0] as never, 1_000)).toEqual(PNG);
  });

  it('says to draw the pack first when it is not there, and refuses a list with a path that leaves the folder', async () => {
    await expect(ownAdapter(dir).candidates()).rejects.toThrow(/clips:stickers:draw/);
    write(
      OWN_LICENCE_FILE,
      JSON.stringify({
        licence: 'OWN',
        creator: 'PostGear',
        items: [
          {
            file: '../secret.png',
            originId: 'x',
            name: 'X',
            category: 'reactions',
            tags: [],
            animated: false,
          },
        ],
      }),
    );
    await expect(ownAdapter(dir).candidates()).rejects.toThrow(/not a sticker pack/);
  });
});

describe('reading files from a source folder', () => {
  it('never leaves the folder and keeps to the size cap', () => {
    write('a.png', PNG);
    expect(() => readInside(dir, '../outside.png', 100)).toThrow(/outside/);
    expect(() => readInside(dir, 'a.png', 4)).toThrow(/over the 4 byte cap/);
    expect(readInside(dir, 'a.png', 100)).toEqual(PNG);
  });
});

describe('a Kenney pack', () => {
  it('reads every picture under a CC0 pack, without its preview, with names from the files', async () => {
    write(
      'License.txt',
      'Emotes Pack by Kenney\nLicense: (Creative Commons Zero, CC0)\nhttp://creativecommons.org/publicdomain/zero/1.0/',
    );
    write('Preview.png', PNG);
    write('PNG/Vector/emote_heart.png', PNG);
    write('PNG/Vector/emote_laugh-2.png', PNG);
    const candidates = await kenneyAdapter(dir).candidates();
    expect(candidates.map((c) => [c.name, c.originId])).toEqual([
      ['Heart', 'emotes-pack/PNG/Vector/emote_heart.png'],
      ['Laugh 2', 'emotes-pack/PNG/Vector/emote_laugh-2.png'],
    ]);
    expect(guardCandidate(candidates[0] as never, { brands: BRANDS })).toMatchObject({
      ok: true,
      licence: 'CC0-1.0',
      category: 'reactions',
    });
  });

  it('refuses the whole pack when its licence does not say CC0, or it has none', async () => {
    write('PNG/emote_heart.png', PNG);
    await expect(kenneyAdapter(dir).candidates()).rejects.toThrow(/does not say CC0/);
    write('License.txt', 'Free for personal use only');
    await expect(kenneyAdapter(dir).candidates()).rejects.toThrow(/does not say CC0/);
    expect(saysCc0('Creative Commons Zero, CC0')).toBe(true);
  });
});

describe('Open Peeps', () => {
  it('reads only the PNG pictures as CC0 people drawings', async () => {
    write('png/peep-17.png', PNG);
    write('svg/peep-17.svg', '<svg/>');
    const candidates = await openPeepsAdapter(dir).candidates();
    expect(candidates.map((c) => c.name)).toEqual(['17 Person']);
    expect(guardCandidate(candidates[0] as never, { brands: BRANDS })).toMatchObject({
      ok: true,
      category: 'reactions',
    });
  });
});

describe('Noto Emoji Animation', () => {
  // A recorded slice of the index's likely shape (research 10): codepoint, categories and tags.
  const INDEX = {
    icons: [
      {
        name: 'smile',
        codepoint: '1f600',
        categories: ['Smileys and emotions'],
        tags: [':smile:', ':grinning-face:'],
      },
      { codepoint: '1f44d_1f3fb', categories: ['People'], tags: [':thumbs-up-light-skin-tone:'] },
      { codepoint: '../../evil', tags: [':x:'] },
      { nonsense: true },
    ],
  };

  it('turns the index into CC BY candidates with CDN addresses, skipping entries it cannot read', () => {
    const { candidates, unreadable } = notoCandidates(INDEX);
    expect(unreadable).toBe(2);
    expect(candidates.map((c) => [c.name, c.originId, c.downloadUrl])).toEqual([
      ['Smile', '1f600', 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f600/512.webp'],
      [
        'Thumbs Up Light Skin Tone',
        '1f44d_1f3fb',
        'https://fonts.gstatic.com/s/e/notoemoji/latest/1f44d_1f3fb/512.webp',
      ],
    ]);
    expect(guardCandidate(candidates[0] as never, { brands: BRANDS })).toMatchObject({
      ok: true,
      licence: 'CC-BY-4.0',
      category: 'animated-emoji',
    });
    expect(() => notoFileUrl('1f600/../../x')).toThrow(/codepoint/);
  });

  it('reads the index and the files through the injected fetch only, or from a release bundle', async () => {
    const fetched: string[] = [];
    const adapter = notoAdapter({
      fetch: async (url) => {
        fetched.push(url);
        return url.endsWith('api.json') ? Buffer.from(JSON.stringify(INDEX)) : PNG;
      },
    });
    const candidates = await adapter.candidates();
    await adapter.read(candidates[0] as never, 1_000);
    expect(fetched).toEqual([
      'https://googlefonts.github.io/noto-emoji-animation/data/api.json',
      'https://fonts.gstatic.com/s/e/notoemoji/latest/1f600/512.webp',
    ]);

    write('noto/api.json', JSON.stringify(INDEX));
    write('noto/files/1f600.webp', PNG);
    const offline = notoAdapter({
      fetch: async () => {
        throw new Error('no network in a bundle seed');
      },
      indexFile: path.join(dir, 'noto/api.json'),
      filesDir: path.join(dir, 'noto/files'),
    });
    const [first] = await offline.candidates();
    expect(await offline.read(first as never, 1_000)).toEqual(PNG);
  });
});
