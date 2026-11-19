/**
 * A Media video's poster and length (Module 19), with a fake public storage
 * and an in-memory `prisma.media`: the facts and the poster are written; a
 * missing or unreadable file still gets `factsCheckedAt`; a poster that
 * fails keeps the length; a checked, foreign or deleted row is left alone;
 * a tool fault throws for the retry. The last block runs real FFmpeg on a
 * generated two second video (skipped when FFmpeg is not installed).
 */
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import {
  createRunTool,
  FfmpegError,
  type MediaFacts,
  ProbeError,
  probeFile,
  toolPaths,
} from '@postgear/media-tools';
import type { StorageBody } from '@postgear/storage';
import { FakeMediaDb, MEDIA_ID, MEDIA_ORG, MEDIA_PATH, mediaRow } from '../testing/media-fakes';
import {
  buildWebpPosterArgs,
  type MediaFactsTools,
  type MediaVideoFactsDeps,
  makeWebpPoster,
  mediaPosterSize,
  runMediaVideoFacts,
} from './facts';
import { mediaFactsRows } from './rows';

jest.setTimeout(120_000);

const NOW = new Date('2026-11-19T09:00:00Z');
const POSTER_KEY = '2026/11/0123456789abcdef0123456789abcdef.thumb.webp';
const input = { organizationId: MEDIA_ORG, mediaId: MEDIA_ID };

/** The public media space in memory; a file body is read when it is put, as the real one streams it. */
class FakeStorage {
  readonly objects = new Map<string, { bytes: Buffer; contentType: string }>();
  readonly reads: string[] = [];
  readonly deleted: string[] = [];

  read = jest.fn(async (key: string) => {
    this.reads.push(key);
    return this.objects.get(key)?.bytes ?? null;
  });

  put = jest.fn(async (key: string, body: StorageBody, contentType: string) => {
    const bytes = Buffer.isBuffer(body) ? body : readFileSync(body.filePath);
    this.objects.set(key, { bytes, contentType });
  });

  delete = jest.fn(async (key: string) => {
    this.deleted.push(key);
    this.objects.delete(key);
  });
}

function facts(overrides: Partial<MediaFacts> = {}): MediaFacts {
  return {
    durationMs: 42_400,
    width: 1080,
    height: 1920,
    fps: 29.97,
    constantFrameRate: true,
    rotation: 0,
    videoCodec: 'h264',
    pixelFormat: 'yuv420p',
    hasAudio: true,
    audioCodec: 'aac',
    sampleRate: 48_000,
    audioChannels: 2,
    bitRate: 2_000_000,
    container: 'mp4',
    ...overrides,
  };
}

/** Tools that write a small "poster" file instead of running FFmpeg. */
function fakeTools(overrides: Partial<MediaFactsTools> = {}): MediaFactsTools & {
  probe: jest.Mock;
  poster: jest.Mock;
} {
  return {
    probe: jest.fn(async () => facts()),
    poster: jest.fn(async (opts: { output: string }) => {
      await writeFile(opts.output, 'RIFF-poster');
      return { file: opts.output, bytes: 11 };
    }),
    ...overrides,
  } as MediaFactsTools & { probe: jest.Mock; poster: jest.Mock };
}

let scratchRoot: string;

beforeAll(async () => {
  scratchRoot = await mkdtemp(path.join(tmpdir(), 'postgear-media-facts-'));
});

afterAll(async () => {
  await rm(scratchRoot, { recursive: true, force: true });
});

function setup(
  options: {
    rows?: ReturnType<typeof mediaRow>[];
    tools?: MediaFactsTools;
    file?: Buffer | null;
  } = {},
) {
  const db = new FakeMediaDb(options.rows ?? [mediaRow()]);
  const storage = new FakeStorage();
  if (options.file !== null) {
    storage.objects.set(MEDIA_PATH, {
      bytes: options.file ?? Buffer.from('not really an mp4'),
      contentType: 'video/mp4',
    });
  }
  const tools = options.tools ?? fakeTools();
  const deps: MediaVideoFactsDeps = {
    rows: mediaFactsRows(db.asDb()),
    storage,
    tools,
    now: () => NOW,
    heartbeat: jest.fn(),
    signal: new AbortController().signal,
    scratch: async (fn) => {
      const dir = await mkdtemp(path.join(scratchRoot, 'job-'));
      try {
        return await fn(dir);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  };
  return { db, storage, tools, deps };
}

describe('runMediaVideoFacts', () => {
  it('writes the length, size and frame rate, and stores a WebP poster beside the file', async () => {
    const { db, storage, deps } = setup();

    await expect(runMediaVideoFacts(deps, input)).resolves.toEqual({
      status: 'written',
      poster: true,
    });

    expect(db.row(MEDIA_ID)).toMatchObject({
      thumbnail: POSTER_KEY,
      durationMs: 42_400,
      width: 1080,
      height: 1920,
      fps: 29.97,
      factsCheckedAt: NOW,
    });
    expect(storage.objects.get(POSTER_KEY)).toEqual({
      bytes: Buffer.from('RIFF-poster'),
      contentType: 'image/webp',
    });
  });

  it('marks a missing file checked, with no facts, so it is not tried every pass', async () => {
    const { db, deps, tools } = setup({ file: null });

    await expect(runMediaVideoFacts(deps, input)).resolves.toEqual({ status: 'unreadable' });

    expect(db.row(MEDIA_ID)).toMatchObject({
      factsCheckedAt: NOW,
      thumbnail: null,
      durationMs: null,
    });
    expect((tools as ReturnType<typeof fakeTools>).probe).not.toHaveBeenCalled();
  });

  it('marks a file that is not a readable video checked, with no facts', async () => {
    const tools = fakeTools({
      probe: jest.fn().mockRejectedValue(new ProbeError('upload_not_video')),
    });
    const { db, storage, deps } = setup({ tools });

    await expect(runMediaVideoFacts(deps, input)).resolves.toEqual({ status: 'unreadable' });

    expect(db.row(MEDIA_ID)).toMatchObject({ factsCheckedAt: NOW, durationMs: null });
    expect(tools.poster).not.toHaveBeenCalled();
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('keeps the length when the poster cannot be made', async () => {
    const tools = fakeTools({
      poster: jest.fn().mockRejectedValue(new FfmpegError('tool_failed')),
    });
    const { db, storage, deps } = setup({ tools });

    await expect(runMediaVideoFacts(deps, input)).resolves.toEqual({
      status: 'written',
      poster: false,
    });

    expect(db.row(MEDIA_ID)).toMatchObject({
      thumbnail: null,
      durationMs: 42_400,
      factsCheckedAt: NOW,
    });
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('throws on a tool fault, so the next attempt runs, and writes nothing', async () => {
    const tools = fakeTools({ probe: jest.fn().mockRejectedValue(new ProbeError('tool_failed')) });
    const { db, deps } = setup({ tools });

    await expect(runMediaVideoFacts(deps, input)).rejects.toBeInstanceOf(ProbeError);
    expect(db.row(MEDIA_ID)?.factsCheckedAt).toBeNull();
  });

  it('leaves a row that was already checked alone', async () => {
    const { db, storage, deps } = setup({
      rows: [mediaRow({ factsCheckedAt: new Date('2026-11-18T00:00:00Z') })],
    });

    await expect(runMediaVideoFacts(deps, input)).resolves.toEqual({ status: 'skipped' });
    expect(storage.read).not.toHaveBeenCalled();
    expect(db.updates).toHaveLength(0);
  });

  it("never reads or writes another workspace's video", async () => {
    const { db, storage, deps } = setup({ rows: [mediaRow({ organizationId: 'other-org' })] });

    await expect(runMediaVideoFacts(deps, input)).resolves.toEqual({ status: 'skipped' });
    expect(storage.read).not.toHaveBeenCalled();
    expect(db.row(MEDIA_ID)?.factsCheckedAt).toBeNull();
  });

  it('skips deleted rows and images', async () => {
    for (const row of [
      mediaRow({ deletedAt: new Date('2026-11-18T00:00:00Z') }),
      mediaRow({ type: 'image', path: '2026/11/0123456789abcdef0123456789abcdef.jpg' }),
    ]) {
      const { storage, deps } = setup({ rows: [row] });
      await expect(runMediaVideoFacts(deps, input)).resolves.toEqual({ status: 'skipped' });
      expect(storage.read).not.toHaveBeenCalled();
    }
  });

  it('keeps a picture the row already has and only adds the length', async () => {
    const existing = '2026/11/fedcba9876543210fedcba9876543210.jpg';
    const { db, storage, tools, deps } = setup({ rows: [mediaRow({ thumbnail: existing })] });

    await expect(runMediaVideoFacts(deps, input)).resolves.toEqual({
      status: 'written',
      poster: false,
    });
    expect((tools as ReturnType<typeof fakeTools>).poster).not.toHaveBeenCalled();
    expect(storage.put).not.toHaveBeenCalled();
    expect(db.row(MEDIA_ID)).toMatchObject({ thumbnail: existing, durationMs: 42_400 });
  });

  it('removes the poster again when the row was deleted while it was made', async () => {
    const tools = fakeTools();
    const { db, storage, deps } = setup({ tools });
    tools.probe.mockImplementation(async () => {
      // Someone deletes the video from Media while FFmpeg works.
      const row = db.row(MEDIA_ID);
      if (row) row.deletedAt = new Date('2026-11-19T08:59:00Z');
      return facts();
    });

    await expect(runMediaVideoFacts(deps, input)).resolves.toEqual({ status: 'skipped' });
    expect(storage.deleted).toEqual([POSTER_KEY]);
    expect(storage.objects.has(POSTER_KEY)).toBe(false);
  });

  it('never writes beside a row whose path is not a media key', async () => {
    const { db, storage, deps } = setup({ rows: [mediaRow({ path: 'avatars/../secret.mp4' })] });

    await expect(runMediaVideoFacts(deps, input)).resolves.toEqual({ status: 'unreadable' });
    expect(storage.read).not.toHaveBeenCalled();
    expect(db.row(MEDIA_ID)?.factsCheckedAt).toEqual(NOW);
  });
});

describe('mediaFactsRows.markChecked (the workflow gave up)', () => {
  it('marks an unchecked row and never moves an earlier check', async () => {
    const earlier = new Date('2026-11-01T00:00:00Z');
    const db = new FakeMediaDb([
      mediaRow(),
      mediaRow({ id: 'checked-row', factsCheckedAt: earlier }),
    ]);
    const rows = mediaFactsRows(db.asDb());

    await rows.markChecked(MEDIA_ORG, MEDIA_ID, NOW);
    await rows.markChecked(MEDIA_ORG, 'checked-row', NOW);

    expect(db.row(MEDIA_ID)?.factsCheckedAt).toEqual(NOW);
    expect(db.row('checked-row')?.factsCheckedAt).toEqual(earlier);
  });
});

describe('the WebP poster', () => {
  it('fits inside 480 px and never enlarges', () => {
    expect(mediaPosterSize(1920, 1080)).toEqual({ width: 480, height: 270 });
    expect(mediaPosterSize(1080, 1920)).toEqual({ width: 270, height: 480 });
    expect(mediaPosterSize(320, 240)).toEqual({ width: 320, height: 240 });
  });

  it('asks libwebp for its own quality, not the JPEG scale', () => {
    const args = buildWebpPosterArgs({
      input: '/scratch/source.mp4',
      output: '/scratch/poster.webp',
      atMs: 1_000,
      width: 480,
      height: 270,
    });
    expect(args).toEqual(
      expect.arrayContaining(['-c:v', 'libwebp', '-quality', '70', '-f', 'webp']),
    );
    expect(args[args.indexOf('-ss') + 1]).toBe('1.000');
    expect(args).not.toContain('-q:v');
  });
});

// --- Real FFmpeg -------------------------------------------------------------------

function findTool(program: string): boolean {
  if (path.isAbsolute(program)) return existsSync(program);
  const dirs = (process.env.PATH ?? process.env.Path ?? '').split(path.delimiter).filter(Boolean);
  const names = process.platform === 'win32' ? [`${program}.exe`, program] : [program];
  return dirs.some((dir) => names.some((name) => existsSync(path.join(dir, name))));
}

const paths = (() => {
  try {
    const found = toolPaths(process.env);
    return findTool(found.ffmpeg) && findTool(found.ffprobe) ? found : null;
  } catch {
    return null;
  }
})();
const describeReal = paths ? describe : describe.skip;
if (!paths) console.warn('Real Media poster test skipped: FFmpeg is not installed.');

describeReal('with real FFmpeg', () => {
  async function sample(seconds: number): Promise<Buffer> {
    const dir = await mkdtemp(path.join(scratchRoot, 'sample-'));
    const file = path.join(dir, 'sample.mp4');
    // Through the shared runner: only media-tools may start a process.
    await createRunTool(paths as NonNullable<typeof paths>)(
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
        `testsrc=duration=${seconds}:size=640x360:rate=30`,
        '-c:v',
        'mpeg4',
        '-pix_fmt',
        'yuv420p',
        'sample.mp4',
      ],
      { cwd: dir, timeoutMs: 60_000 },
    );
    return readFile(file);
  }

  function realTools(): MediaFactsTools {
    const runTool = createRunTool(paths as NonNullable<typeof paths>);
    return {
      probe: (file, opts) => probeFile(runTool, file, opts),
      poster: (opts) => makeWebpPoster({ ...opts, runTool }),
    };
  }

  it.each([
    ['a two second video, one second in', 2, 2_000],
    ['a half second video, its first frame', 0.5, 500],
  ])('gives %s', async (_name, seconds, expectedMs) => {
    const { db, storage, deps } = setup({ file: await sample(seconds), tools: realTools() });

    await expect(runMediaVideoFacts(deps, input)).resolves.toEqual({
      status: 'written',
      poster: true,
    });

    const row = db.row(MEDIA_ID);
    expect(row).toMatchObject({ width: 640, height: 360, thumbnail: POSTER_KEY });
    expect(Math.abs((row?.durationMs ?? 0) - expectedMs)).toBeLessThan(150);
    expect(row?.fps).toBeCloseTo(30, 0);
    const poster = storage.objects.get(POSTER_KEY)?.bytes ?? Buffer.alloc(0);
    expect(poster.subarray(0, 4).toString('latin1')).toBe('RIFF');
    expect(poster.subarray(8, 12).toString('latin1')).toBe('WEBP');
  });
});
