jest.mock('@postgear/db', () => ({
  prisma: {},
  Prisma: { PrismaClientKnownRequestError: class {} },
  ClipLibraryStatus: {},
  ClipStickerKind: {},
}));
jest.mock('@postgear/seo-engine', () => ({ fetchBinarySafely: jest.fn() }));

import { INGEST_REFUSAL, main, ownPackDir, parseFlags } from './cli';

describe('the library commands', () => {
  const saved = process.env.CLIPS_LIBRARY_INGEST;
  afterEach(() => {
    if (saved === undefined) delete process.env.CLIPS_LIBRARY_INGEST;
    else process.env.CLIPS_LIBRARY_INGEST = saved;
  });

  it('refuse to start unless the operator set CLIPS_LIBRARY_INGEST=true in the shell', async () => {
    delete process.env.CLIPS_LIBRARY_INGEST;
    await expect(main(['ingest', '--source', 'own'])).rejects.toThrow(INGEST_REFUSAL);
    process.env.CLIPS_LIBRARY_INGEST = 'yes';
    await expect(main(['seed'])).rejects.toThrow(INGEST_REFUSAL);
  });

  it('refuse a command or a source they do not know, before touching anything', async () => {
    process.env.CLIPS_LIBRARY_INGEST = 'true';
    await expect(main(['crawl'])).rejects.toThrow(/Use ingest, publish, hide, remove or seed/);
    await expect(main(['ingest', '--source', 'giphy'])).rejects.toThrow(/No source called giphy/);
    await expect(main(['ingest', '--source', 'kenney'])).rejects.toThrow(
      /--path must point at the unzipped Kenney pack/,
    );
    await expect(main(['hide', '--id', 'x'])).rejects.toThrow(/--reason is required/);
  });

  it('read flags with and without values, and refuse a stray word', () => {
    expect([...parseFlags(['--source', 'own', '--dry-run', '--limit', '5'])]).toEqual([
      ['source', 'own'],
      ['dry-run', true],
      ['limit', '5'],
    ]);
    expect(() => parseFlags(['own'])).toThrow(/Unexpected own/);
  });

  it('find the drawn pack in the cache folder unless a folder is set', () => {
    const before = process.env.CLIPS_STICKERS_OWN_DIR;
    delete process.env.CLIPS_STICKERS_OWN_DIR;
    expect(ownPackDir('/repo').replace(/\\/g, '/')).toMatch(/\/repo\/\.cache\/clips-stickers-own$/);
    if (before !== undefined) process.env.CLIPS_STICKERS_OWN_DIR = before;
  });
});
