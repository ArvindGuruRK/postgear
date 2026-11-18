import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { createRunTool, type RunTool, type ToolPaths, toolPaths } from '@postgear/media-tools';
import { fakeSoundLibrary } from '../testing/sound-library-fakes';
import { kenneySoundName, kenneySoundsAdapter } from './adapters/kenney-sounds';
import { openGameArtAdapter } from './adapters/opengameart';
import {
  FREESOUND_REFUSAL,
  freesoundSoundsAdapter,
  OPENVERSE_REFUSAL,
  openverseLicence,
  openverseSoundsAdapter,
} from './adapters/openverse-sounds';
import { ownSoundsAdapter } from './adapters/own-sounds';
import { loadBrands, soundBrands } from './brands';
import { ingestSounds, type SoundIngestDeps } from './ingest-sounds';
import { guardSoundCandidate, namesAnArtist } from './sound-licence';
import { kenneyPackHint, soundCategoryFor, soundTags } from './sound-taxonomy';
import { hideLibrarySound, publishLibraryRun, removeLibrarySound } from './status';
import type { LibraryCandidate, LibrarySourceMeta, SoundAdapter } from './types';

const BRANDS = loadBrands(null);
const CC0 = 'https://creativecommons.org/publicdomain/zero/1.0/';
const SOURCE: LibrarySourceMeta = {
  code: 'test-sounds',
  name: 'Test Sounds',
  author: 'Tester',
  url: 'https://example.org/sounds',
  licence: 'CC0-1.0',
  licenceUrl: CC0,
  creditLine: null,
  changeNote: null,
  noticeText: null,
  requiresCredit: false,
  creditPerItem: false,
};

function candidate(originId: string, overrides: Partial<LibraryCandidate> = {}): LibraryCandidate {
  return {
    name: `Bell ${originId}`,
    tags: ['bell'],
    category: 'alerts',
    creator: 'Tester',
    creatorUrl: 'https://example.org/tester',
    licenceRaw: 'CC0 1.0',
    licenceUrl: CC0,
    sourceUrl: `https://example.org/sounds/${originId}`,
    originId,
    path: `${originId}.wav`,
    mature: false,
    originalWork: true,
    ...overrides,
  };
}

describe('the sound guard', () => {
  const guard = (overrides: Partial<LibraryCandidate>) =>
    guardSoundCandidate(candidate('one', overrides), { brands: BRANDS });

  it('keeps OWN, CC0 and the Public Domain Mark, with the kind its category belongs to', () => {
    expect(guard({ licenceRaw: 'OWN', licenceUrl: null, creator: '' })).toMatchObject({
      ok: true,
      licence: 'OWN',
      category: 'alerts',
      kind: 'sfx',
    });
    expect(guard({})).toMatchObject({ ok: true, licence: 'CC0-1.0' });
    expect(
      guard({
        licenceRaw: 'Public Domain Mark 1.0',
        licenceUrl: 'https://creativecommons.org/publicdomain/mark/1.0/',
        category: 'calm',
      }),
    ).toMatchObject({ ok: true, licence: 'PDM-1.0', kind: 'music' });
  });

  it('refuses CC BY for sounds (a credit cannot ride inside a sound), and NC, SA, GPL, OGA-BY and unknown licences', () => {
    expect(
      guard({
        licenceRaw: 'CC BY 4.0',
        licenceUrl: 'https://creativecommons.org/licenses/by/4.0/',
      }),
    ).toEqual({
      ok: false,
      reason: 'licence_not_allowed',
      detail: 'CC-BY-4.0 is not allowed for sounds',
    });
    for (const licenceRaw of [
      'CC BY-NC 4.0',
      'CC BY-SA 3.0',
      'GPL 3.0',
      'OGA-BY 3.0',
      'MIT',
      'Royalty Free',
      '',
    ]) {
      expect(guard({ licenceRaw })).toMatchObject({ ok: false, reason: 'licence_not_allowed' });
    }
  });

  it('refuses a licence link that points somewhere else, and missing evidence', () => {
    expect(guard({ licenceUrl: 'https://example.org/cc0' })).toMatchObject({
      reason: 'licence_url_mismatch',
    });
    expect(guard({ creator: ' ' })).toMatchObject({
      reason: 'missing_metadata',
      detail: 'no creator',
    });
    expect(guard({ path: undefined })).toMatchObject({
      reason: 'missing_metadata',
      detail: 'no file',
    });
    expect(guard({ name: '' })).toMatchObject({ reason: 'missing_metadata' });
  });

  it('refuses mature items, brand names (sound-only ones too) and derivative signals', () => {
    expect(guard({ mature: true })).toMatchObject({ reason: 'mature' });
    expect(guard({ name: 'Windows 10 Notification' })).toMatchObject({
      reason: 'brand_name',
      detail: 'windows',
    });
    expect(guard({ name: 'Nintendo Switch Click' })).toMatchObject({ reason: 'brand_name' });
    expect(guard({ name: 'Message', tags: ['iphone'] })).toMatchObject({
      reason: 'brand_name',
      detail: 'iphone',
    });
    // A kick is a drum, not the platform, in a sound.
    expect(guard({ name: 'Kick Drum Hit', category: 'impacts' })).toMatchObject({ ok: true });
    expect(guard({ name: 'Epic Battle Remix' })).toMatchObject({
      reason: 'derivative_signal',
      detail: 'remix',
    });
    expect(
      guard({ name: 'Main Theme', description: 'Theme from the game we all love' }),
    ).toMatchObject({
      reason: 'derivative_signal',
    });
    expect(guard({ name: 'Boss Fight OST' })).toMatchObject({
      reason: 'derivative_signal',
      detail: 'ost',
    });
    expect(guard({ name: 'Moonlight Sonata by Beethoven' })).toMatchObject({
      reason: 'derivative_signal',
      detail: 'named after an artist',
    });
    expect(guard({ name: 'Fast Fly By', category: 'whooshes' })).toMatchObject({ ok: true });
  });

  it('sends an item the source does not show is original to the review, not the catalogue', () => {
    expect(guard({ originalWork: false })).toEqual({
      ok: false,
      reason: 'needs_review',
      detail: 'the source does not show it is an original work',
    });
  });

  it('maps source words to a category, a pair before its words, and refuses what maps to none', () => {
    expect(guard({ category: undefined, name: 'Big Punch', tags: [] })).toMatchObject({
      category: 'impacts',
    });
    expect(guard({ category: undefined, name: 'Office', tags: ['room tone'] })).toMatchObject({
      category: 'ambient',
    });
    expect(guard({ category: undefined, name: 'Power Up', tags: [] })).toMatchObject({
      category: 'gaming',
    });
    expect(
      guard({ category: undefined, name: 'Evening', tags: ['relaxing'], kindHint: 'music' }),
    ).toMatchObject({ category: 'calm', kind: 'music' });
    expect(guard({ category: undefined, name: 'Thing', tags: ['blue'] })).toMatchObject({
      reason: 'no_category',
    });
    // A music slug given for an effect is not taken; its words decide.
    expect(soundCategoryFor('calm', ['whoosh'], 'sfx')).toBe('whooshes');
  });

  it('keeps tags lowercase, plain, deduplicated, brand-free and at most 12', () => {
    expect(
      soundTags(
        [
          'Bell',
          'bell',
          'Ding!',
          'Windows',
          'x',
          ...'abcdefghijklmn'.split('').map((c) => `${c}${c}`),
        ],
        soundBrands(BRANDS),
      ),
    ).toEqual(['bell', 'ding', 'aa', 'bb', 'cc', 'dd', 'ee', 'ff', 'gg', 'hh', 'ii', 'jj']);
  });

  it('reads "by <Artist>" as a credit, and "Fly By" as a movement', () => {
    expect(namesAnArtist('Nocturne by Chopin')).toBe(true);
    expect(namesAnArtist('Car Drive By Fast')).toBe(false);
    expect(namesAnArtist('Step By Step')).toBe(false);
    expect(namesAnArtist('Rain By The Window')).toBe(false);
  });

  it('takes Kenney pack names as hints', () => {
    expect(kenneyPackHint('Kenney Impact Sounds')).toMatchObject({
      kind: 'sfx',
      category: 'impacts',
    });
    expect(kenneyPackHint('Kenney Interface Sounds')).toMatchObject({ category: 'alerts' });
    expect(kenneyPackHint('Kenney UI Audio')).toMatchObject({ category: 'alerts' });
    expect(kenneyPackHint('Kenney Sci-fi Sounds')).toMatchObject({ category: 'gaming' });
    expect(kenneyPackHint('Kenney Music Jingles')).toMatchObject({
      kind: 'music',
      shortCategory: 'reactions',
    });
    expect(kenneySoundName('Audio/jingles_NES00.ogg')).toBe('Jingles Chiptune 1');
    expect(kenneySoundName('Audio/impactPunch_heavy_002.ogg')).toBe('Impact Punch Heavy 3');
  });
});

describe('the sound adapters', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'pg-sound-adapters-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('own reads the made pack and its licences.json, every sound an original OWN work', async () => {
    mkdirSync(path.join(dir, 'alerts'));
    writeFileSync(path.join(dir, 'alerts', 'soft-ding.wav'), 'RIFF');
    writeFileSync(
      path.join(dir, 'licences.json'),
      JSON.stringify({
        licence: 'OWN',
        creator: 'PostGear',
        items: [
          {
            file: 'alerts/soft-ding.wav',
            originId: 'sounds/soft-ding',
            name: 'Soft Ding',
            category: 'alerts',
            kind: 'sfx',
            tags: ['ding'],
            bpm: null,
          },
        ],
      }),
    );
    const adapter = ownSoundsAdapter(dir);
    expect(adapter.source).toMatchObject({
      code: 'own-sounds',
      name: 'PostGear Sounds',
      licence: 'OWN',
    });
    const [one] = await adapter.candidates();
    expect(one).toMatchObject({
      originId: 'sounds/soft-ding',
      sourceUrl: 'own://sounds/soft-ding',
      licenceRaw: 'OWN',
      originalWork: true,
      kindHint: 'sfx',
    });
    expect((await adapter.read(one as LibraryCandidate, 100)).toString()).toBe('RIFF');
    expect(guardSoundCandidate(one as LibraryCandidate, { brands: BRANDS })).toMatchObject({
      ok: true,
    });
    await expect(ownSoundsAdapter(path.join(dir, 'nothing')).candidates()).rejects.toThrow(
      /clips:sounds:make/,
    );
  });

  it('kenney refuses a pack whose License.txt does not say CC0, and names the rest from its folder', async () => {
    const pack = path.join(dir, 'kenney_impact-sounds');
    mkdirSync(path.join(pack, 'Audio'), { recursive: true });
    writeFileSync(path.join(pack, 'Audio', 'impactPunch_heavy_000.ogg'), 'OggS');
    writeFileSync(path.join(pack, 'Preview.ogg'), 'OggS');
    writeFileSync(path.join(pack, 'License.txt'), 'All rights reserved.');
    await expect(kenneySoundsAdapter(pack).candidates()).rejects.toThrow(/does not say CC0/);
    writeFileSync(path.join(pack, 'License.txt'), 'License: (Creative Commons Zero, CC0)');
    const adapter = kenneySoundsAdapter(pack);
    expect(adapter.source).toMatchObject({
      code: 'kenney-impact-sounds',
      name: 'Kenney Impact Sounds',
      url: 'https://kenney.nl/assets/impact-sounds',
    });
    const items = await adapter.candidates();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      name: 'Impact Punch Heavy 1',
      category: 'impacts',
      originId: 'impact-sounds/Audio/impactPunch_heavy_000.ogg',
      originalWork: true,
    });
  });

  it('opengameart keeps a named account as original, sends the rest to review, and fetches from the site only', async () => {
    const list = path.join(dir, 'list.json');
    const entry = {
      page: 'https://opengameart.org/content/soft-chime',
      title: 'Soft Chime',
      author: 'someone',
      authorUrl: 'https://opengameart.org/users/someone',
      licence: 'CC0',
      licenceUrl: CC0,
      file: 'https://opengameart.org/sites/default/files/chime.ogg',
      tags: ['chime'],
    };
    writeFileSync(
      list,
      JSON.stringify([
        entry,
        { ...entry, page: 'https://opengameart.org/content/other', authorUrl: null },
        {
          ...entry,
          page: 'https://opengameart.org/content/third',
          file: 'https://evil.example/x.ogg',
        },
      ]),
    );
    const fetch = jest.fn(async () => Buffer.from('OggS'));
    const adapter = openGameArtAdapter({ listFile: list, fetch });
    const [named, anonymous, offsite] = await adapter.candidates();
    expect(named).toMatchObject({ originalWork: true, originId: 'soft-chime/chime.ogg' });
    expect(guardSoundCandidate(anonymous as LibraryCandidate, { brands: BRANDS })).toMatchObject({
      reason: 'needs_review',
    });
    await adapter.read(named as LibraryCandidate, 1_000);
    expect(fetch).toHaveBeenCalledWith('https://opengameart.org/sites/default/files/chime.ogg', {
      maxBytes: 1_000,
      timeoutMs: 30_000,
    });
    await expect(adapter.read(offsite as LibraryCandidate, 1_000)).rejects.toThrow(
      /opengameart\.org/,
    );
  });

  it('openverse and freesound refuse to run until their switches are on, and map licences', async () => {
    const fetch = jest.fn();
    const file = path.join(dir, 'answer.json');
    expect(() => openverseSoundsAdapter({ enabled: false, answerFile: file, fetch })).toThrow(
      OPENVERSE_REFUSAL,
    );
    expect(() => freesoundSoundsAdapter({ enabled: false, answerFile: file, fetch })).toThrow(
      FREESOUND_REFUSAL,
    );
    expect(openverseLicence('cc0', '1.0')).toBe('CC0 1.0');
    expect(openverseLicence('by', '4.0')).toBe('CC BY 4.0');
    writeFileSync(
      file,
      JSON.stringify({
        results: [
          {
            id: 'ov-1',
            title: 'Gentle Rain',
            foreign_landing_url: 'https://example.org/rain',
            url: 'https://example.org/rain.mp3',
            creator: 'Someone',
            creator_url: 'https://example.org/someone',
            license: 'cc0',
            license_version: '1.0',
            license_url: CC0,
            tags: [{ name: 'rain' }],
            category: 'sound_effect',
          },
        ],
      }),
    );
    const [rain] = await openverseSoundsAdapter({
      enabled: true,
      answerFile: file,
      fetch,
    }).candidates();
    expect(guardSoundCandidate(rain as LibraryCandidate, { brands: BRANDS })).toMatchObject({
      ok: true,
      category: 'ambient',
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});

/** Whether a program can be found: an absolute setting that exists, or a name on PATH. */
function findTool(program: string): boolean {
  if (path.isAbsolute(program)) return existsSync(program);
  const dirs = (process.env.PATH ?? process.env.Path ?? '').split(path.delimiter).filter(Boolean);
  const names = process.platform === 'win32' ? [`${program}.exe`, program] : [program];
  return dirs.some((folder) => names.some((name) => existsSync(path.join(folder, name))));
}

function safeToolPaths(): ToolPaths | null {
  try {
    const paths = toolPaths(process.env);
    return findTool(paths.ffmpeg) && findTool(paths.ffprobe) ? paths : null;
  } catch {
    return null;
  }
}

const PATHS = safeToolPaths();
const describeWithFfmpeg = PATHS ? describe : describe.skip;
if (!PATHS)
  console.warn('Sound ingest tests with FFmpeg skipped: ffmpeg and ffprobe are not on the PATH.');

/** A source held in memory: each candidate's bytes. */
function memoryAdapter(origin: string, items: Array<[LibraryCandidate, Buffer]>): SoundAdapter {
  return {
    origin,
    source: SOURCE,
    async candidates() {
      return items.map(([c]) => c);
    },
    async read(c) {
      const body = items.find(([item]) => item.originId === c.originId)?.[1];
      if (!body) throw new Error('missing');
      return body;
    },
  };
}

describeWithFfmpeg('the sound ingest (real FFmpeg)', () => {
  let dir: string;
  let runTool: RunTool;
  let bell: Buffer;
  let blip: Buffer;
  let loop: Buffer;
  let jingle: Buffer;

  async function sound(name: string, graph: string, seconds: number): Promise<Buffer> {
    await runTool(
      'ffmpeg',
      [
        '-hide_banner',
        '-nostdin',
        '-y',
        '-loglevel',
        'error',
        '-f',
        'lavfi',
        '-i',
        graph,
        '-t',
        String(seconds),
        '-c:a',
        'pcm_s16le',
        name,
      ],
      { cwd: dir, timeoutMs: 60_000 },
    );
    return readFileSync(path.join(dir, name));
  }

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'pg-sound-ingest-'));
    runTool = createRunTool(PATHS as ToolPaths);
    bell = await sound('bell.wav', "aevalsrc=exprs='0.2*sin(2*PI*880*t)*exp(-3*t)':s=44100", 1);
    blip = await sound('blip.wav', "aevalsrc=exprs='0.3*sin(2*PI*1000*t)':s=44100", 0.05);
    loop = await sound(
      'loop.wav',
      "aevalsrc=exprs='0.1*sin(2*PI*220*t)+0.05*sin(2*PI*330*t)':s=48000",
      6,
    );
    jingle = await sound('jingle.wav', "aevalsrc=exprs='0.2*sin(2*PI*523*t)':s=48000", 2);
  }, 60_000);
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  function deps(lib = fakeSoundLibrary()): {
    lib: ReturnType<typeof fakeSoundLibrary>;
    deps: SoundIngestDeps;
  } {
    return {
      lib,
      deps: {
        store: lib.store,
        storage: lib.storage,
        privateStorage: lib.privateStorage,
        runTool,
        scratchRoot: dir,
        brands: BRANDS,
        now: () => new Date('2026-11-19T10:00:00Z'),
      },
    };
  }

  it('stages each good sound with its evidence and refuses the rest with a counted reason', async () => {
    const { lib, deps: d } = deps();
    const adapter = memoryAdapter('test', [
      [candidate('bell'), bell],
      [candidate('copy', { name: 'Bell Again' }), bell],
      [candidate('blip', { name: 'Blip' }), blip],
      [candidate('text', { name: 'Text' }), Buffer.from('this is not a sound at all')],
      [candidate('loop', { name: 'Morning Loop', category: 'calm', bpm: 90 }), loop],
      [
        candidate('jingle', {
          name: 'Short Jingle',
          category: 'upbeat',
          shortCategory: 'reactions',
        }),
        jingle,
      ],
      [
        candidate('byline', {
          name: 'Licensed',
          licenceRaw: 'CC BY 4.0',
          licenceUrl: 'https://creativecommons.org/licenses/by/4.0/',
        }),
        bell,
      ],
      [candidate('review', { name: 'Unknown Origin', originalWork: false }), bell],
    ]);
    const result = await ingestSounds(adapter, d);

    expect(result.report.accepted.map((item) => [item.originId, item.kind, item.category])).toEqual(
      [
        ['bell', 'sfx', 'alerts'],
        ['loop', 'music', 'calm'],
        ['jingle', 'sfx', 'reactions'],
      ],
    );
    expect(result.report.rejectionsByReason).toEqual({
      duplicate: 1,
      too_short: 1,
      not_a_sound: 1,
      licence_not_allowed: 1,
      needs_review: 1,
    });
    expect(lib.rows).toHaveLength(3);
    expect(lib.rows.every((row) => row.status === 'STAGED')).toBe(true);
    const bellRow = lib.rows.find((row) => row.originId === 'bell');
    expect(bellRow).toMatchObject({
      kind: 'sfx',
      licence: 'CC0-1.0',
      licenceUrl: CC0,
      author: 'Tester',
      origin: 'test',
      originalWork: true,
      tags: ['bell'],
      retrievedAt: new Date('2026-11-19T10:00:00Z'),
    });
    expect(bellRow?.fileKey).toMatch(/^library\/sounds\/[0-9a-f]{2}\/[0-9a-f]{64}\.m4a$/);
    expect(bellRow?.peaks).toHaveLength(100);
    // A short effect is peak-levelled to about -3 dBFS.
    expect(bellRow?.truePeakDb).toBeGreaterThan(-4.5);
    expect(bellRow?.truePeakDb).toBeLessThanOrEqual(-1);
    const loopRow = lib.rows.find((row) => row.originId === 'loop');
    expect(loopRow).toMatchObject({ kind: 'music', bpm: 90 });
    expect(loopRow?.loudnessLufs).toBeGreaterThan(-17.5);
    expect(loopRow?.loudnessLufs).toBeLessThan(-14.5);
    expect(lib.publicFiles.get(bellRow?.fileKey as string)?.contentType).toBe('audio/mp4');

    // The report: one line per accepted sound with its evidence, and the review list.
    expect(result.reportKey).toBe(`ops/library-runs/${result.runId}.md`);
    const markdown = lib.privateFiles.get(result.reportKey as string) as string;
    expect(markdown).toContain('# Sound Licence Report: Test Sounds');
    expect(markdown).toContain(
      '| Bell bell | sfx | alerts | CC0-1.0 | Tester | https://example.org/sounds/bell | 2026-11-19 |',
    );
    expect(markdown).toContain('## Needs A Review');
    expect(markdown).toContain('| Unknown Origin | review |');
    expect(lib.runs[0]?.finished).toMatchObject({ accepted: 3, rejected: 5 });

    // Run again: everything is already there.
    const again = await ingestSounds(adapter, d);
    expect(again.report.accepted).toHaveLength(0);
    expect(lib.rows).toHaveLength(3);
  }, 120_000);

  it('a dry run writes nothing at all', async () => {
    const { lib, deps: d } = deps();
    const result = await ingestSounds(memoryAdapter('test', [[candidate('bell'), bell]]), d, {
      dryRun: true,
    });
    expect(result.report.accepted).toHaveLength(1);
    expect(result.reportKey).toBeNull();
    expect(lib.rows).toHaveLength(0);
    expect(lib.runs).toHaveLength(0);
    expect(lib.sources.size).toBe(0);
    expect(lib.publicFiles.size).toBe(0);
    expect(lib.privateFiles.size).toBe(0);
  }, 60_000);

  it('publishes straight away only for own and kenney; publish, hide and remove work on sounds', async () => {
    const { lib, deps: d } = deps();
    await expect(
      ingestSounds(memoryAdapter('opengameart', [[candidate('bell'), bell]]), d, {
        autoPublish: true,
      }),
    ).rejects.toThrow(/may not use --auto-publish/);
    const staged = await ingestSounds(memoryAdapter('opengameart', [[candidate('bell'), bell]]), d);
    expect(lib.rows[0]?.status).toBe('STAGED');
    expect(await publishLibraryRun(lib.store as never, staged.runId)).toBe(1);
    expect(lib.rows[0]?.status).toBe('ACTIVE');

    const id = lib.rows[0]?.id as string;
    await hideLibrarySound(lib.store, id, 'checking a claim');
    expect(lib.rows[0]?.status).toBe('HIDDEN');
    await expect(removeLibrarySound(lib.store, lib.storage, id, ' ')).rejects.toThrow(
      /needs a reason/,
    );
    await removeLibrarySound(lib.store, lib.storage, id, 'rights request');
    expect(lib.rows[0]?.status).toBe('REMOVED');
    expect(lib.publicFiles.size).toBe(0);
    expect(lib.denied).toHaveLength(1);
    await expect(hideLibrarySound(lib.store, id, 'again')).rejects.toThrow(/removed sound/);

    // A denied sound never comes back, even from a new run under another id.
    const back = await ingestSounds(
      memoryAdapter('own', [[candidate('bell-again', { originId: 'bell-again' }), bell]]),
      d,
      { autoPublish: true },
    );
    expect(back.report.rejectionsByReason).toEqual({ denied: 1 });
  }, 120_000);
});
