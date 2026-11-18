import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { createRunTool, type RunTool, type ToolPaths, toolPaths } from '@postgear/media-tools';
import { fakeLibrary } from '../testing/library-fakes';
import { loadBrands } from './brands';
import { type IngestDeps, ingestStickers } from './ingest';
import { hideLibrarySticker, publishLibraryRun, removeLibrarySticker } from './status';
import type { LibraryCandidate, LibrarySourceMeta, StickerAdapter } from './types';

const BRANDS = loadBrands(null);
const SOURCE: LibrarySourceMeta = {
  code: 'test-pack',
  name: 'Test Pack',
  author: 'Tester',
  url: 'https://example.org/pack',
  licence: 'CC0-1.0',
  licenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
  creditLine: null,
  changeNote: 'Resized',
  noticeText: null,
  requiresCredit: false,
  creditPerItem: false,
};

function candidate(originId: string, overrides: Partial<LibraryCandidate> = {}): LibraryCandidate {
  return {
    name: `Item ${originId}`,
    tags: ['star'],
    category: 'arrows-shapes',
    creator: 'Tester',
    creatorUrl: 'https://example.org',
    licenceRaw: 'CC0 1.0',
    licenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    sourceUrl: `https://example.org/pack/${originId}`,
    originId,
    path: `${originId}.png`,
    mature: false,
    originalWork: true,
    ...overrides,
  };
}

/** A source held in memory: each candidate's bytes, or an error to throw when it is read. */
function memoryAdapter(
  origin: string,
  items: Array<[LibraryCandidate, Buffer | Error]>,
): StickerAdapter & { reads: string[] } {
  const reads: string[] = [];
  return {
    origin,
    source: SOURCE,
    reads,
    async candidates() {
      return items.map(([c]) => c);
    },
    async read(c) {
      reads.push(c.originId);
      const body = items.find(([item]) => item.originId === c.originId)?.[1];
      if (!body || body instanceof Error) throw body ?? new Error('missing');
      return body;
    },
  };
}

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
  console.warn('Library ingest tests with FFmpeg skipped: ffmpeg and ffprobe are not on the PATH.');

describeWithFfmpeg('the sticker ingest (real FFmpeg)', () => {
  let dir: string;
  let runTool: RunTool;
  let red: Buffer;
  let blue: Buffer;
  let green: Buffer;

  async function picture(name: string, colour: string): Promise<Buffer> {
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
        `color=c=${colour}:s=96x64`,
        '-frames:v',
        '1',
        '-pix_fmt',
        'rgba',
        name,
      ],
      { cwd: dir, timeoutMs: 60_000 },
    );
    return readFileSync(path.join(dir, name));
  }

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'pg-ingest-'));
    runTool = createRunTool(PATHS as ToolPaths);
    red = await picture('red.png', 'red');
    blue = await picture('blue.png', 'blue');
    green = await picture('green.png', 'green');
  }, 60_000);
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  function deps(lib = fakeLibrary()): { lib: ReturnType<typeof fakeLibrary>; deps: IngestDeps } {
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

  it('adds each open item once, under its content hash, and files the licence report privately', async () => {
    const { lib, deps: d } = deps();
    const adapter = memoryAdapter('own', [
      [candidate('a'), red],
      [candidate('b', { licenceRaw: 'CC BY-NC 4.0' }), blue],
      [candidate('c'), red],
      [candidate('d'), Buffer.from('not a picture at all')],
      [candidate('e'), new Error('the file went away')],
      [candidate('f', { name: 'Twitch Heart' }), green],
      [candidate('g'), blue],
    ]);
    const result = await ingestStickers(adapter, d, { autoPublish: true, args: { source: 'own' } });

    expect(result.report.accepted.map((item) => item.originId)).toEqual(['a', 'g']);
    expect(result.report.rejected.map((item) => [item.originId, item.reason])).toEqual([
      ['b', 'licence_not_allowed'],
      ['c', 'duplicate'],
      ['d', 'not_a_picture'],
      ['e', 'fetch_failed'],
      ['f', 'brand_name'],
    ]);
    // The guard runs on the source's own words, so a refused item is never read.
    expect(adapter.reads).toEqual(['a', 'c', 'd', 'e', 'g']);

    expect(
      lib.rows.map((row) => [
        row.originId,
        row.status,
        row.width,
        row.height,
        row.licence,
        row.category,
      ]),
    ).toEqual([
      ['a', 'ACTIVE', 96, 64, 'CC0-1.0', 'arrows-shapes'],
      ['g', 'ACTIVE', 96, 64, 'CC0-1.0', 'arrows-shapes'],
    ]);
    const [first] = lib.rows;
    expect(first?.fileKey).toMatch(/^library\/stickers\/[0-9a-f]{2}\/[0-9a-f]{64}\.png$/);
    expect(first?.previewKey).toMatch(/^library\/previews\/[0-9a-f]{2}\/[0-9a-f]{64}\.webp$/);
    expect(lib.publicFiles.get(first?.fileKey as string)?.contentType).toBe('image/png');
    expect(lib.publicFiles.size).toBe(4);

    expect(result.reportKey).toBe(`ops/library-runs/${result.runId}.md`);
    expect([...lib.privateFiles.keys()].sort()).toEqual([
      `ops/library-runs/${result.runId}.json`,
      `ops/library-runs/${result.runId}.md`,
    ]);
    expect(
      JSON.parse(lib.privateFiles.get(`ops/library-runs/${result.runId}.json`) as string),
    ).toMatchObject({
      accepted: [{ originId: 'a' }, { originId: 'g' }],
      rejectionsByReason: {
        licence_not_allowed: 1,
        duplicate: 1,
        not_a_picture: 1,
        fetch_failed: 1,
        brand_name: 1,
      },
    });
    expect(lib.privateFiles.get(result.reportKey as string)).toContain('licence_not_allowed');
    expect(lib.runs[0]?.finished).toMatchObject({
      accepted: 2,
      rejected: 5,
      reportKey: result.reportKey,
    });
  }, 120_000);

  it('turns away what the library already holds, and what was removed, on a second run', async () => {
    const { lib, deps: d } = deps();
    await ingestStickers(memoryAdapter('own', [[candidate('a'), red]]), d, { autoPublish: true });
    lib.denied.push({ sourceChecksum: 'none', origin: 'own', originId: 'b', reason: 'removed' });
    const again = await ingestStickers(
      memoryAdapter('own', [
        [candidate('a'), red],
        [candidate('a2'), red],
        [candidate('b'), blue],
      ]),
      d,
      { autoPublish: true },
    );
    expect(again.report.accepted).toEqual([]);
    expect(again.report.rejected.map((item) => [item.originId, item.reason])).toEqual([
      ['a', 'duplicate'],
      ['a2', 'duplicate'],
      ['b', 'denied'],
    ]);
  }, 120_000);

  it('refuses the same file under a new id once it was removed', async () => {
    const { lib, deps: d } = deps();
    await ingestStickers(memoryAdapter('own', [[candidate('a'), green]]), d, { autoPublish: true });
    const id = lib.rows[0]?.id as string;
    await removeLibrarySticker(lib.store, lib.storage, id, 'the creator asked');
    const back = await ingestStickers(memoryAdapter('own', [[candidate('renamed'), green]]), d, {
      autoPublish: true,
    });
    expect(back.report.rejected.map((item) => item.reason)).toEqual(['denied']);
  }, 120_000);

  it('a dry run reads and checks everything but writes nothing', async () => {
    const { lib, deps: d } = deps();
    const result = await ingestStickers(
      memoryAdapter('own', [
        [candidate('a'), red],
        [candidate('b'), blue],
      ]),
      d,
      { dryRun: true },
    );
    expect(result.report.accepted.map((item) => [item.originId, item.id])).toEqual([
      ['a', null],
      ['b', null],
    ]);
    expect(result.reportKey).toBeNull();
    expect(result.markdown).toContain('Test Pack');
    expect(lib.rows).toEqual([]);
    expect(lib.runs).toEqual([]);
    expect(lib.sources.size).toBe(0);
    expect(lib.publicFiles.size).toBe(0);
    expect(lib.privateFiles.size).toBe(0);
  }, 120_000);

  it('stages items for a review unless the source may publish on its own, and keeps to the limit and category', async () => {
    const { lib, deps: d } = deps();
    const items: Array<[LibraryCandidate, Buffer]> = [
      [candidate('a', { category: 'reactions', tags: ['face'] }), red],
      [candidate('b'), blue],
      [candidate('c'), green],
    ];
    await expect(
      ingestStickers(memoryAdapter('openpeeps', items), d, { autoPublish: true }),
    ).rejects.toThrow(/may not use --auto-publish/);

    const result = await ingestStickers(memoryAdapter('openpeeps', items), d, {
      category: 'arrows-shapes',
      limit: 1,
    });
    expect(result.report.accepted.map((item) => item.originId)).toEqual(['b']);
    expect(lib.rows.map((row) => row.status)).toEqual(['STAGED']);
    expect(await publishLibraryRun(lib.store, result.runId)).toBe(1);
    expect(lib.rows.map((row) => row.status)).toEqual(['ACTIVE']);
  }, 120_000);
});

describe('hiding and removing a library sticker', () => {
  async function seeded() {
    const lib = fakeLibrary();
    const id = (await lib.store.createSticker({
      sourceId: 'source-1',
      runId: 'run-1',
      animated: false,
      name: 'Wow',
      tags: ['wow'],
      category: 'reactions',
      width: 512,
      height: 300,
      durationMs: null,
      frames: null,
      fps: null,
      fileKey: 'library/stickers/ab/abc.png',
      previewKey: 'library/previews/ab/abc.webp',
      bytes: 1000,
      licence: 'OWN',
      licenceUrl: 'own://licence',
      author: 'PostGear',
      authorUrl: null,
      origin: 'own',
      originId: 'reactions/wow',
      sourceUrl: 'own://stickers/reactions/wow',
      originalWork: true,
      retrievedAt: new Date(),
      sourceChecksum: 'c'.repeat(64),
      publish: true,
    })) as string;
    lib.publicFiles.set('library/stickers/ab/abc.png', { bytes: 1000, contentType: 'image/png' });
    lib.publicFiles.set('library/previews/ab/abc.webp', { bytes: 100, contentType: 'image/webp' });
    return { lib, id };
  }

  it('hides an item from search but keeps its files', async () => {
    const { lib, id } = await seeded();
    await hideLibrarySticker(lib.store, id, 'looks off');
    expect(lib.rows[0]).toMatchObject({ status: 'HIDDEN', statusReason: 'looks off' });
    expect(lib.publicFiles.size).toBe(2);
  });

  it('removes an item for good: on the deny list first, then its files deleted', async () => {
    const { lib, id } = await seeded();
    await expect(removeLibrarySticker(lib.store, lib.storage, id, '  ')).rejects.toThrow(
      /needs a reason/,
    );
    await removeLibrarySticker(lib.store, lib.storage, id, 'the creator asked');
    expect(lib.rows[0]).toMatchObject({ status: 'REMOVED' });
    expect(lib.denied).toEqual([
      {
        sourceChecksum: 'c'.repeat(64),
        origin: 'own',
        originId: 'reactions/wow',
        reason: 'the creator asked',
      },
    ]);
    expect(lib.publicFiles.size).toBe(0);
    await expect(hideLibrarySticker(lib.store, id, 'x')).rejects.toThrow(/cannot be hidden/);
    await expect(hideLibrarySticker(lib.store, 'nope', 'x')).rejects.toThrow(/No sticker/);
  });
});
