import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import {
  createRunTool,
  probeSound,
  type RunTool,
  type ToolPaths,
  toolPaths,
} from '@postgear/media-tools';
import type { SoundAssetMeta } from '@postgear/video-engine';
import { FakePrivateStorage } from '../testing/fakes';
import { checkSoundUpload, type SoundAssetRow, type SoundCheckRows } from './check';

const ORG = 'seed-demo-org';
const ASSET = '6e2f3a4b-5c6d-4e7f-8a91-92a3b4c5d6e7';
const ORIGINAL = 'clips/seed-demo-org/library/bbbbbbbbbbbbbbbb.mp3';

class FakeSoundRows implements SoundCheckRows {
  rows = new Map<string, SoundAssetRow & { bytes: number; mimeType: string | null }>();
  /** Set to make the row vanish between the read and the write (deleted while checking). */
  vanish = false;
  async soundAsset(organizationId: string, id: string) {
    const row = this.rows.get(id);
    return row && row.organizationId === organizationId ? row : null;
  }
  private checking(organizationId: string, id: string) {
    const row = this.rows.get(id);
    if (this.vanish) this.rows.delete(id);
    return row &&
      !this.vanish &&
      row.organizationId === organizationId &&
      (row.meta as SoundAssetMeta).status === 'checking'
      ? row
      : null;
  }
  async markSoundReady(
    organizationId: string,
    id: string,
    made: { key: string; bytes: number; mimeType: string; meta: SoundAssetMeta },
  ) {
    const row = this.checking(organizationId, id);
    if (!row) return false;
    Object.assign(row, {
      key: made.key,
      bytes: made.bytes,
      mimeType: made.mimeType,
      meta: made.meta,
    });
    return true;
  }
  async markSoundFailed(organizationId: string, id: string, meta: SoundAssetMeta) {
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
if (!PATHS)
  console.warn('Sound upload check tests skipped: ffmpeg and ffprobe are not on the PATH.');

describeWithFfmpeg('the uploaded sound check (real FFmpeg)', () => {
  let dir: string;
  let scratchRoot: string;
  let runTool: RunTool;
  let mp3: Buffer;
  let storage: FakePrivateStorage;
  let rows: FakeSoundRows;
  const run = { signal: new AbortController().signal, attempt: 1 };

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'pg-sound-check-'));
    runTool = createRunTool(PATHS as ToolPaths);
    // A mono MP3, 2 s, at 44.1 kHz: the check makes it stereo 48 kHz AAC.
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
        "aevalsrc=exprs='0.5*sin(2*PI*440*t)':s=44100:d=2",
        '-c:a',
        'libmp3lame',
        '-b:a',
        '128k',
        'in.mp3',
      ],
      { cwd: dir, timeoutMs: 60_000 },
    );
    mp3 = readFileSync(path.join(dir, 'in.mp3'));
  }, 60_000);
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  beforeEach(() => {
    scratchRoot = mkdtempSync(path.join(tmpdir(), 'pg-sound-scratch-'));
    storage = new FakePrivateStorage();
    rows = new FakeSoundRows();
    rows.rows.set(ASSET, {
      id: ASSET,
      organizationId: ORG,
      key: ORIGINAL,
      meta: { status: 'checking', purpose: 'sound', name: 'My Jingle' },
      bytes: 1,
      mimeType: null,
    });
  });
  afterEach(() => rmSync(scratchRoot, { recursive: true, force: true }));

  const deps = () => ({ rows, privateStorage: storage, runTool, scratchRoot });

  it('makes an MP3 a stereo 48 kHz AAC .m4a with 100 peaks, and drops the original', async () => {
    storage.objects.set(ORIGINAL, mp3);
    const answer = await checkSoundUpload(deps(), { organizationId: ORG, assetId: ASSET }, run);
    expect(answer).toMatchObject({
      status: 'ready',
      meta: { status: 'ready', purpose: 'sound', name: 'My Jingle' },
    });
    const row = rows.rows.get(ASSET);
    expect(row?.key).toMatch(/^clips\/seed-demo-org\/library\/[0-9a-f]+\.m4a$/);
    expect(row?.mimeType).toBe('audio/mp4');
    expect(storage.objects.has(ORIGINAL)).toBe(false);
    const made = storage.objects.get(row?.key as string) as Buffer;
    expect(row?.bytes).toBe(made.length);
    const meta = row?.meta as Extract<SoundAssetMeta, { status: 'ready' }>;
    expect(meta.durationMs).toBeGreaterThan(1_900);
    expect(meta.durationMs).toBeLessThan(2_200);
    expect(meta.peaks).toHaveLength(100);
    expect(Math.max(...meta.peaks)).toBeGreaterThan(100);

    // The made file really is stereo AAC at 48 kHz.
    const check = mkdtempSync(path.join(tmpdir(), 'pg-sound-made-'));
    try {
      writeFileSync(path.join(check, 'made.m4a'), made);
      const facts = await probeSound(runTool, 'made.m4a', { cwd: check });
      expect(facts).toMatchObject({ channels: 2, sampleRate: 48_000, codec: 'aac' });
    } finally {
      rmSync(check, { recursive: true, force: true });
    }

    // Asked again (a retry), it answers what the row says and touches nothing.
    const puts = storage.puts;
    expect(
      await checkSoundUpload(deps(), { organizationId: ORG, assetId: ASSET }, run),
    ).toMatchObject({
      status: 'ready',
    });
    expect(storage.puts).toBe(puts);
  }, 60_000);

  it('marks a text file named .mp3 failed, weighing nothing, with its file deleted', async () => {
    storage.objects.set(ORIGINAL, Buffer.from('This is a text file, not a sound at all.'));
    expect(await checkSoundUpload(deps(), { organizationId: ORG, assetId: ASSET }, run)).toEqual({
      status: 'failed',
      error: 'sound_unusable',
    });
    expect(rows.rows.get(ASSET)).toMatchObject({
      bytes: 0,
      meta: { status: 'failed', purpose: 'sound', name: 'My Jingle', error: 'sound_unusable' },
    });
    expect(storage.objects.has(ORIGINAL)).toBe(false);
  }, 60_000);

  it('an MP3 header on bytes FFmpeg cannot read is refused the same way', async () => {
    storage.objects.set(ORIGINAL, Buffer.concat([Buffer.from('ID3'), Buffer.alloc(64, 7)]));
    expect(await checkSoundUpload(deps(), { organizationId: ORG, assetId: ASSET }, run)).toEqual({
      status: 'failed',
      error: 'sound_unusable',
    });
  }, 60_000);

  it('cleans up what it made when the sound was deleted while it was being checked', async () => {
    storage.objects.set(ORIGINAL, mp3);
    rows.vanish = true;
    expect(await checkSoundUpload(deps(), { organizationId: ORG, assetId: ASSET }, run)).toEqual({
      status: 'gone',
    });
    expect([...storage.objects.keys()]).toEqual([ORIGINAL]);
  }, 60_000);

  it('answers gone for a row that is not there, not a sound upload, or a file not in storage', async () => {
    expect(
      await checkSoundUpload(deps(), { organizationId: 'other-org', assetId: ASSET }, run),
    ).toEqual({ status: 'gone' });
    expect(await checkSoundUpload(deps(), { organizationId: ORG, assetId: ASSET }, run)).toEqual({
      status: 'gone',
    });
    rows.rows.set(ASSET, {
      id: ASSET,
      organizationId: ORG,
      key: ORIGINAL,
      meta: { kind: 'analysis' },
      bytes: 1,
      mimeType: null,
    });
    expect(await checkSoundUpload(deps(), { organizationId: ORG, assetId: ASSET }, run)).toEqual({
      status: 'gone',
    });
  });
});
