import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { assertFreeDisk, DiskSpaceError, freeDiskBytes } from './disk';
import { clearStaleScratch, SCRATCH_STALE_MS, ScratchError, scratchDirFor, withScratch } from './scratch';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'scratch-test-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('withScratch', () => {
  const jobId = '7d3f2a10-1b2c-4d5e-8f90-123456789abc';

  it('makes the folder, hands it over, and removes it afterwards', async () => {
    let seen = '';
    const result = await withScratch(root, jobId, async (dir) => {
      seen = dir;
      expect(existsSync(dir)).toBe(true);
      await writeFile(path.join(dir, 'proxy.mp4'), 'x');
      return 42;
    });
    expect(result).toBe(42);
    expect(seen).toBe(path.join(root, jobId));
    expect(existsSync(seen)).toBe(false);
  });

  it('removes the folder when the work throws, and rethrows the same error', async () => {
    const boom = new Error('boom');
    let seen = '';
    await expect(
      withScratch(root, jobId, async (dir) => {
        seen = dir;
        await writeFile(path.join(dir, 'half.part'), 'x');
        throw boom;
      }),
    ).rejects.toBe(boom);
    expect(existsSync(seen)).toBe(false);
  });

  it('empties a folder an earlier attempt left behind', async () => {
    const dir = path.join(root, jobId);
    await withScratch(root, jobId, async () => {
      await writeFile(path.join(dir, 'old.txt'), 'x');
      expect(existsSync(path.join(dir, 'old.txt'))).toBe(true);
    });
    await withScratch(root, jobId, async () => {
      expect(existsSync(path.join(dir, 'old.txt'))).toBe(false);
    });
  });

  it.each([
    '..',
    '../escape',
    '..\\escape',
    'a/b',
    'a\\b',
    '',
    '.hidden',
    'C:',
    '/abs',
    'x'.repeat(200),
    'name with space',
  ])('refuses the id %j', async (bad) => {
    await expect(withScratch(root, bad, async () => 1)).rejects.toBeInstanceOf(ScratchError);
  });

  it('refuses a relative root', () => {
    expect(() => scratchDirFor('relative/root', jobId)).toThrow(ScratchError);
  });

  it('accepts an attempt suffix', () => {
    expect(scratchDirFor(root, `${jobId}_2`)).toBe(path.join(root, `${jobId}_2`));
  });
});

describe('assertFreeDisk', () => {
  it('passes when the disk has room', async () => {
    await expect(assertFreeDisk(root, 1, { marginBytes: 0 })).resolves.toBeUndefined();
  });

  it('throws a typed error with whole numbers when it does not', async () => {
    const free = await freeDiskBytes(root);
    const error = (await assertFreeDisk(root, free * 2 + 1).catch(
      (e: unknown) => e,
    )) as DiskSpaceError;
    expect(error).toBeInstanceOf(DiskSpaceError);
    expect(error.code).toBe('disk_full');
    expect(Number.isInteger(error.bytesFree)).toBe(true);
    expect(error.bytesNeeded).toBeGreaterThan(error.bytesFree);
    expect(error.message).not.toContain(root);
  });

  it('checks the nearest existing folder when the scratch root is not made yet', async () => {
    await expect(
      assertFreeDisk(path.join(root, 'not', 'made', 'yet'), 1, { marginBytes: 0 }),
    ).resolves.toBeUndefined();
  });
});

describe('clearStaleScratch (Module 19)', () => {
  const old = (Date.now() - SCRATCH_STALE_MS - 60_000) / 1000;

  async function folder(name: string, stale: boolean): Promise<string> {
    const dir = path.join(root, name);
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, 'part.mp4');
    await writeFile(file, 'x');
    if (stale) {
      await utimes(file, old, old);
      await utimes(dir, old, old);
    }
    return dir;
  }

  it('removes job folders idle for two hours and keeps busy ones and strangers', async () => {
    const crashed = await folder('7d3f2a10-1b2c-4d5e-8f90-123456789abc', true);
    const busy = await folder('8d3f2a10-1b2c-4d5e-8f90-123456789abc', false);
    const stranger = await folder('.cache', true);
    const loose = path.join(root, 'notes.txt');
    await writeFile(loose, 'x');

    expect(await clearStaleScratch(root)).toBe(1);
    expect(existsSync(crashed)).toBe(false);
    expect(existsSync(busy)).toBe(true);
    expect(existsSync(stranger)).toBe(true);
    expect(existsSync(loose)).toBe(true);
    expect(existsSync(root)).toBe(true);
  });

  it('never throws: a missing or relative root removes nothing', async () => {
    await expect(clearStaleScratch(path.join(root, 'missing'))).resolves.toBe(0);
    await expect(clearStaleScratch('relative/root')).resolves.toBe(0);
  });
});
