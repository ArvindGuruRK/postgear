import { chmod, mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import {
  clearStaleScratch,
  type RunTool,
  type RunToolOptions,
  ToolError,
  type ToolPaths,
} from '@postgear/media-tools';
import { findProgram, SELF_UPDATE_DIR, selfUpdateYtDlp } from './yt-dlp-update';

const isWindows = process.platform === 'win32';
const programName = isWindows ? 'yt-dlp.exe' : 'yt-dlp';

interface Call {
  ytDlp: string;
  args: readonly string[];
  options: RunToolOptions;
}

/** A run tool that records each call and answers like the updater would. */
function fakeUpdater(answer: () => Promise<string>) {
  const calls: Call[] = [];
  const makeRunTool = (paths: ToolPaths): RunTool => {
    return async (tool, args, options) => {
      expect(tool).toBe('yt-dlp');
      calls.push({ ytDlp: paths.ytDlp, args, options });
      const stdout = await answer();
      return { exitCode: 0, stdout, stderrTail: '', durationMs: 1 };
    };
  };
  return { calls, makeRunTool };
}

describe('selfUpdateYtDlp', () => {
  let root: string;
  let bin: string;
  let program: string;
  let scratchRoot: string;
  const quiet = { log: () => undefined, warn: () => undefined };

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'pg-ytdlp-update-'));
    bin = path.join(root, 'bin');
    scratchRoot = path.join(root, 'scratch');
    await mkdir(bin, { recursive: true });
    program = path.join(bin, programName);
    await writeFile(program, 'image copy');
    if (!isWindows) await chmod(program, 0o755);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const paths = (ytDlp: string): ToolPaths => ({
    ffmpeg: 'ffmpeg',
    ffprobe: 'ffprobe',
    ytDlp,
    jsRuntime: 'deno',
  });

  it('off by default: the configured yt-dlp, nothing copied, the updater never runs', async () => {
    const fake = fakeUpdater(async () => '');
    const result = await selfUpdateYtDlp({
      enabled: false,
      simulation: false,
      importsLinks: true,
      paths: paths(program),
      scratchRoot,
      makeRunTool: fake.makeRunTool,
      ...quiet,
    });
    expect(result).toEqual({ paths: paths(program), outcome: 'off' });
    expect(fake.calls).toHaveLength(0);
    await expect(stat(path.join(scratchRoot, SELF_UPDATE_DIR))).rejects.toThrow();
  });

  it('harmless in simulation: nothing is fetched and the configured yt-dlp stays', async () => {
    const fake = fakeUpdater(async () => '');
    const log = jest.fn();
    const result = await selfUpdateYtDlp({
      enabled: true,
      simulation: true,
      importsLinks: true,
      paths: paths(program),
      scratchRoot,
      makeRunTool: fake.makeRunTool,
      log,
      warn: () => undefined,
    });
    expect(result.outcome).toBe('skipped');
    expect(result.paths.ytDlp).toBe(program);
    expect(fake.calls).toHaveLength(0);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('CLIPS_SIMULATION=true'));
  });

  it('skipped on a worker that never imports links (render only)', async () => {
    const fake = fakeUpdater(async () => '');
    const result = await selfUpdateYtDlp({
      enabled: true,
      simulation: false,
      importsLinks: false,
      paths: paths(program),
      scratchRoot,
      makeRunTool: fake.makeRunTool,
      ...quiet,
    });
    expect(result.outcome).toBe('skipped');
    expect(fake.calls).toHaveLength(0);
  });

  it('copies yt-dlp into the hidden scratch folder, runs its updater there and uses the copy', async () => {
    const fake = fakeUpdater(async () => 'Updated yt-dlp to stable@2026.11.12 from yt-dlp/yt-dlp');
    const log = jest.fn();
    const result = await selfUpdateYtDlp({
      enabled: true,
      simulation: false,
      importsLinks: true,
      paths: paths(program),
      scratchRoot,
      makeRunTool: fake.makeRunTool,
      log,
      warn: () => undefined,
    });

    const copy = path.join(scratchRoot, SELF_UPDATE_DIR, programName);
    expect(result).toEqual({ paths: paths(copy), outcome: 'updated' });
    expect(await readFile(copy, 'utf8')).toBe('image copy');
    expect(await readFile(program, 'utf8')).toBe('image copy');
    if (!isWindows) {
      expect((await stat(copy)).mode & 0o111).not.toBe(0);
    }
    expect(fake.calls).toEqual([
      {
        ytDlp: copy,
        args: ['--ignore-config', '--update'],
        options: expect.objectContaining({ cwd: path.join(scratchRoot, SELF_UPDATE_DIR) }),
      },
    ]);
    expect(fake.calls[0]?.options.timeoutMs).toBeGreaterThan(0);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('yt-dlp 2026.11.12'));
  });

  it('a failed update keeps the image copy and only warns', async () => {
    const fake = fakeUpdater(async () => {
      throw new ToolError({ tool: 'yt-dlp', exitCode: 1, stderrTail: 'ERROR: no network' });
    });
    const warn = jest.fn();
    const result = await selfUpdateYtDlp({
      enabled: true,
      simulation: false,
      importsLinks: true,
      paths: paths(program),
      scratchRoot,
      makeRunTool: fake.makeRunTool,
      log: () => undefined,
      warn,
    });
    expect(result).toEqual({ paths: paths(program), outcome: 'failed' });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('exited with code 1'));
    // The tool's own output never reaches the log line.
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('no network'));
  });

  it('a missing yt-dlp is a warning, never a stop', async () => {
    const fake = fakeUpdater(async () => '');
    const warn = jest.fn();
    const result = await selfUpdateYtDlp({
      enabled: true,
      simulation: false,
      importsLinks: true,
      paths: paths(path.join(bin, 'not-there')),
      scratchRoot,
      makeRunTool: fake.makeRunTool,
      log: () => undefined,
      warn,
    });
    expect(result.outcome).toBe('not-found');
    expect(fake.calls).toHaveLength(0);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('finds a bare program name on the search path', async () => {
    const fake = fakeUpdater(
      async () => 'yt-dlp is up to date (stable@2026.10.26 from yt-dlp/yt-dlp)',
    );
    const result = await selfUpdateYtDlp({
      enabled: true,
      simulation: false,
      importsLinks: true,
      paths: paths('yt-dlp'),
      scratchRoot,
      searchPath: [path.join(root, 'empty'), bin].join(isWindows ? ';' : ':'),
      makeRunTool: fake.makeRunTool,
      ...quiet,
    });
    expect(result.outcome).toBe('updated');
    expect(result.paths.ytDlp).toBe(path.join(scratchRoot, SELF_UPDATE_DIR, programName));
  });

  it('the stale-scratch sweep at boot never removes the copy', async () => {
    const fake = fakeUpdater(async () => '');
    await selfUpdateYtDlp({
      enabled: true,
      simulation: false,
      importsLinks: true,
      paths: paths(program),
      scratchRoot,
      makeRunTool: fake.makeRunTool,
      ...quiet,
    });
    const folder = path.join(scratchRoot, SELF_UPDATE_DIR);
    const old = new Date(Date.now() - 24 * 60 * 60_000);
    await utimes(folder, old, old);
    await utimes(path.join(folder, programName), old, old);
    await clearStaleScratch(scratchRoot, Date.now(), 0);
    expect((await stat(folder)).isDirectory()).toBe(true);
  });
});

describe('findProgram', () => {
  it('refuses a relative path with folders in it', async () => {
    expect(await findProgram('./bin/yt-dlp', '/usr/bin')).toBeNull();
    expect(await findProgram('bin\\yt-dlp', 'C:\\bin', 'win32')).toBeNull();
  });
});
