import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { createRunTool, type RunTool, type ToolPaths, toolPaths } from '@postgear/media-tools';
import type { StickerAssetMeta } from '@postgear/video-engine';
import { FakePrivateStorage } from '../testing/fakes';
import { checkStickerUpload, type StickerAssetRow, type StickerCheckRows } from './check';

const ORG = 'seed-demo-org';
const ASSET = '5d1e2f3a-4b5c-4d6e-8f70-819203a4b5c6';
const ORIGINAL = 'clips/seed-demo-org/library/aaaaaaaaaaaaaaaa.png';

class FakeCheckRows implements StickerCheckRows {
  rows = new Map<string, StickerAssetRow & { bytes: number; mimeType: string | null }>();
  /** Set to make the row vanish between the read and the write (deleted while checking). */
  vanish = false;
  async stickerAsset(organizationId: string, id: string) {
    const row = this.rows.get(id);
    return row && row.organizationId === organizationId ? row : null;
  }
  private checking(organizationId: string, id: string) {
    const row = this.rows.get(id);
    if (this.vanish) this.rows.delete(id);
    return row && !this.vanish && row.organizationId === organizationId && (row.meta as StickerAssetMeta).status === 'checking'
      ? row
      : null;
  }
  async markStickerReady(organizationId: string, id: string, made: { key: string; bytes: number; mimeType: string; meta: StickerAssetMeta }) {
    const row = this.checking(organizationId, id);
    if (!row) return false;
    Object.assign(row, { key: made.key, bytes: made.bytes, mimeType: made.mimeType, meta: made.meta });
    return true;
  }
  async markStickerFailed(organizationId: string, id: string, meta: StickerAssetMeta) {
    const row = this.checking(organizationId, id);
    if (!row) return false;
    Object.assign(row, { bytes: 0, meta });
    return true;
  }
}

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
if (!PATHS) console.warn('Sticker upload check tests skipped: ffmpeg and ffprobe are not on the PATH.');

describeWithFfmpeg('the uploaded sticker check (real FFmpeg)', () => {
  let dir: string;
  let scratchRoot: string;
  let runTool: RunTool;
  let png: Buffer;
  let storage: FakePrivateStorage;
  let rows: FakeCheckRows;
  const run = { signal: new AbortController().signal, attempt: 1 };

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'pg-sticker-check-'));
    runTool = createRunTool(PATHS as ToolPaths);
    await runTool(
      'ffmpeg',
      ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=orange:s=800x400', '-frames:v', '1', '-pix_fmt', 'rgba', 'in.png'],
      { cwd: dir, timeoutMs: 60_000 },
    );
    png = readFileSync(path.join(dir, 'in.png'));
  }, 60_000);
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  beforeEach(() => {
    scratchRoot = mkdtempSync(path.join(tmpdir(), 'pg-sticker-scratch-'));
    storage = new FakePrivateStorage();
    rows = new FakeCheckRows();
    rows.rows.set(ASSET, {
      id: ASSET,
      organizationId: ORG,
      key: ORIGINAL,
      meta: { status: 'checking', name: 'Big Orange' },
      bytes: 1,
      mimeType: null,
    });
  });
  afterEach(() => rmSync(scratchRoot, { recursive: true, force: true }));

  const deps = () => ({ rows, privateStorage: storage, runTool, scratchRoot });

  it('makes a picture a PNG at most 512 px, with its preview, and drops the original', async () => {
    storage.objects.set(ORIGINAL, png);
    const answer = await checkStickerUpload(deps(), { organizationId: ORG, assetId: ASSET }, run);
    expect(answer).toMatchObject({
      status: 'ready',
      meta: { status: 'ready', name: 'Big Orange', animated: false, width: 512, height: 256, fps: null, frames: null },
    });
    const row = rows.rows.get(ASSET);
    expect(row?.key).toMatch(/^clips\/seed-demo-org\/library\/[0-9a-f]+\.png$/);
    expect(row?.mimeType).toBe('image/png');
    expect(storage.objects.has(ORIGINAL)).toBe(false);
    expect(storage.objects.has(row?.key as string)).toBe(true);
    const meta = row?.meta as Extract<StickerAssetMeta, { status: 'ready' }>;
    expect(meta.previewKey).toMatch(/\.webp$/);
    expect(row?.bytes).toBe(
      (storage.objects.get(row?.key as string) as Buffer).length + (storage.objects.get(meta.previewKey) as Buffer).length,
    );
    // Asked again (a retry), it answers what the row says and touches nothing.
    const puts = storage.puts;
    expect(await checkStickerUpload(deps(), { organizationId: ORG, assetId: ASSET }, run)).toMatchObject({ status: 'ready' });
    expect(storage.puts).toBe(puts);
  }, 60_000);

  it('marks a file that is not a picture failed, weighing nothing, with its file deleted', async () => {
    storage.objects.set(ORIGINAL, Buffer.from('MZ this is a program, not a picture'));
    expect(await checkStickerUpload(deps(), { organizationId: ORG, assetId: ASSET }, run)).toEqual({
      status: 'failed',
      error: 'sticker_unusable',
    });
    expect(rows.rows.get(ASSET)).toMatchObject({ bytes: 0, meta: { status: 'failed', name: 'Big Orange', error: 'sticker_unusable' } });
    expect(storage.objects.has(ORIGINAL)).toBe(false);
  }, 60_000);

  it('a PNG header on bytes FFmpeg cannot read is refused the same way', async () => {
    storage.objects.set(ORIGINAL, Buffer.concat([png.subarray(0, 16), Buffer.from('garbage after the header')]));
    expect(await checkStickerUpload(deps(), { organizationId: ORG, assetId: ASSET }, run)).toEqual({
      status: 'failed',
      error: 'sticker_unusable',
    });
  }, 60_000);

  it('cleans up what it made when the sticker was deleted while it was being checked', async () => {
    storage.objects.set(ORIGINAL, png);
    rows.vanish = true;
    expect(await checkStickerUpload(deps(), { organizationId: ORG, assetId: ASSET }, run)).toEqual({ status: 'gone' });
    // Only the original is left for the API's own delete; nothing the check made stays behind.
    expect([...storage.objects.keys()]).toEqual([ORIGINAL]);
  }, 60_000);

  it('answers gone for a row that is not there, or a file that is not in storage', async () => {
    expect(await checkStickerUpload(deps(), { organizationId: 'other-org', assetId: ASSET }, run)).toEqual({ status: 'gone' });
    expect(await checkStickerUpload(deps(), { organizationId: ORG, assetId: ASSET }, run)).toEqual({ status: 'gone' });
  });
});
