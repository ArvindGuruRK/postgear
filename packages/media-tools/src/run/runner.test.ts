import { mkdtemp, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { FfmpegProgressParser } from '../ffmpeg/progress';
import { createRunTool, LineSplitter, minimalEnv, ToolMissingError } from './runner';
import { ToolError, type ToolPaths } from './types';

/**
 * Node itself stands in for yt-dlp and ffprobe here, so every behaviour of
 * the runner (arguments, lines, environment, exit codes, timeout, abort,
 * caps) is tested with a real process and no outside download. FFmpeg is
 * used for the last few tests when it is on PATH.
 */
const NODE_PATHS: ToolPaths = {
  ffmpeg: 'ffmpeg',
  ffprobe: process.execPath,
  ytDlp: process.execPath,
  jsRuntime: null,
};
const runTool = createRunTool(NODE_PATHS);

let cwd: string;
let ffmpegAvailable = false;

beforeAll(async () => {
  cwd = await mkdtemp(path.join(os.tmpdir(), 'runner-test-'));
  ffmpegAvailable = await runTool('ffmpeg', ['-hide_banner', '-version'], {
    cwd,
    timeoutMs: 20_000,
  })
    .then(() => true)
    .catch(() => false);
  if (!ffmpegAvailable) {
    console.warn('FFmpeg is not on PATH: the real FFmpeg runner tests are skipped.');
  }
});

afterAll(async () => {
  await rm(cwd, { recursive: true, force: true });
});

function node(script: string, ...extra: string[]): string[] {
  return ['-e', script, ...extra];
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitUntil(check: () => boolean, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return check();
}

describe('LineSplitter', () => {
  it('splits on \\n, \\r\\n and a lone \\r, across chunk edges', () => {
    const lines: string[] = [];
    const splitter = new LineSplitter((line) => lines.push(line));
    for (const part of ['one\ntw', 'o\r', '\nthree\rfo', 'ur\n', 'tail']) {
      splitter.push(Buffer.from(part));
    }
    splitter.end();
    expect(lines).toEqual(['one', 'two', 'three', 'four', 'tail']);
  });

  it('keeps a multi-byte character split between chunks', () => {
    const lines: string[] = [];
    const splitter = new LineSplitter((line) => lines.push(line));
    const bytes = Buffer.from('தமிழ்\n');
    splitter.push(bytes.subarray(0, 4));
    splitter.push(bytes.subarray(4));
    splitter.end();
    expect(lines).toEqual(['தமிழ்']);
  });
});

describe('minimalEnv', () => {
  it('passes only the allowlist plus the extras', () => {
    const env = minimalEnv(
      { PATH: '/bin', SECRET_TOKEN: 'x', DATABASE_URL: 'y', HOME: '/home/a' },
      { YTDLP_PROXY: 'p' },
    );
    expect(env).toEqual({ PATH: '/bin', HOME: '/home/a', YTDLP_PROXY: 'p' });
  });

  it('finds Windows names in any case', () => {
    expect(minimalEnv({ Path: 'C:\\bin', SystemRoot: 'C:\\Windows' }, undefined)).toEqual({
      PATH: 'C:\\bin',
      SYSTEMROOT: 'C:\\Windows',
    });
  });
});

describe('createRunTool with a real process', () => {
  it('passes every argument as is, with no shell in between', async () => {
    const tricky = ['a b', '$(whoami)', '"quoted"', '&& echo hi', '; rm -rf /', '|', '%PATH%'];
    const result = await runTool(
      'yt-dlp',
      node('process.stdout.write(JSON.stringify(process.argv.slice(1)))', ...tricky),
      { cwd, timeoutMs: 20_000 },
    );
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(tricky);
  });

  it('calls back once per line on stdout and stderr', async () => {
    const out: string[] = [];
    const err: string[] = [];
    const script = [
      "process.stdout.write('a\\nb\\r\\n');",
      "setTimeout(() => { process.stdout.write('c\\rd'); process.stderr.write('e\\nf'); }, 30);",
    ].join('');
    await runTool('yt-dlp', node(script), {
      cwd,
      timeoutMs: 20_000,
      onStdoutLine: (line) => out.push(line),
      onStderrLine: (line) => err.push(line),
    });
    expect(out).toEqual(['a', 'b', 'c', 'd']);
    expect(err).toEqual(['e', 'f']);
  });

  it('gives the program a minimal environment', async () => {
    process.env.POSTGEAR_TEST_SECRET = 'do-not-leak';
    try {
      const result = await runTool(
        'yt-dlp',
        node('process.stdout.write(JSON.stringify(process.env))'),
        {
          cwd,
          timeoutMs: 20_000,
          env: { EXTRA_ONE: '1' },
        },
      );
      const env = JSON.parse(result.stdout) as Record<string, string>;
      expect(env.POSTGEAR_TEST_SECRET).toBeUndefined();
      expect(env.EXTRA_ONE).toBe('1');
    } finally {
      delete process.env.POSTGEAR_TEST_SECRET;
    }
  });

  it('runs in the given folder', async () => {
    const result = await runTool('yt-dlp', node('process.stdout.write(process.cwd())'), {
      cwd,
      timeoutMs: 20_000,
    });
    expect(path.resolve(result.stdout).toLowerCase()).toBe(path.resolve(cwd).toLowerCase());
  });

  it('rejects a non-zero exit with a ToolError whose message holds none of the output', async () => {
    const error = await runTool(
      'yt-dlp',
      node("process.stderr.write('C:/secret/path failed'); process.exit(3)"),
      { cwd, timeoutMs: 20_000 },
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ToolError);
    const toolError = error as ToolError;
    expect(toolError.exitCode).toBe(3);
    expect(toolError.timedOut).toBe(false);
    expect(toolError.aborted).toBe(false);
    expect(toolError.message).not.toContain('secret');
    expect(toolError.stderrTail).toContain('secret');
  });

  it('keeps only the last 8 KB of stderr', async () => {
    const error = (await runTool(
      'yt-dlp',
      node("process.stderr.write('x'.repeat(50000) + 'END'); process.exit(1)"),
      { cwd, timeoutMs: 20_000 },
    ).catch((e: unknown) => e)) as ToolError;
    expect(error.stderrTail.length).toBeLessThanOrEqual(8 * 1024);
    expect(error.stderrTail.endsWith('END')).toBe(true);
  });

  it('kills the program at the timeout', async () => {
    const started = Date.now();
    const error = (await runTool('yt-dlp', node('setTimeout(() => {}, 60000)'), {
      cwd,
      timeoutMs: 300,
    }).catch((e: unknown) => e)) as ToolError;
    expect(error).toBeInstanceOf(ToolError);
    expect(error.timedOut).toBe(true);
    expect(Date.now() - started).toBeLessThan(8_000);
  });

  it('kills the whole process tree on abort', async () => {
    const cp = ['child', 'process'].join('_');
    const script = [
      `const { spawn } = require('${cp}');`,
      "const kid = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });",
      "process.stdout.write(String(kid.pid) + '\\n');",
      'setTimeout(() => {}, 60000);',
    ].join('');
    const controller = new AbortController();
    let grandchild = 0;
    const error = (await runTool('yt-dlp', node(script), {
      cwd,
      timeoutMs: 30_000,
      signal: controller.signal,
      onStdoutLine: (line) => {
        grandchild = Number(line);
        controller.abort();
      },
    }).catch((e: unknown) => e)) as ToolError;
    expect(error).toBeInstanceOf(ToolError);
    expect(error.aborted).toBe(true);
    expect(grandchild).toBeGreaterThan(0);
    expect(await waitUntil(() => !isAlive(grandchild), 5_000)).toBe(true);
  });

  it('refuses to start when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const error = (await runTool('yt-dlp', node('1'), {
      cwd,
      timeoutMs: 1_000,
      signal: controller.signal,
    }).catch((e: unknown) => e)) as ToolError;
    expect(error.aborted).toBe(true);
  });

  it('kills the program when stdout passes the cap', async () => {
    const error = (await runTool(
      'yt-dlp',
      node("process.stdout.write('y'.repeat(200000)); setTimeout(() => {}, 60000)"),
      { cwd, timeoutMs: 20_000, maxStdoutBytes: 1_000 },
    ).catch((e: unknown) => e)) as ToolError;
    expect(error).toBeInstanceOf(ToolError);
    expect(error.message).toContain('more output than allowed');
  });

  it('stops the program when the watcher throws, with the watcher error', async () => {
    let calls = 0;
    const stop = new Error('too big');
    const error = await runTool('yt-dlp', node('setTimeout(() => {}, 60000)'), {
      cwd,
      timeoutMs: 20_000,
      watch: {
        everyMs: 50,
        check: () => {
          calls += 1;
          if (calls >= 2) throw stop;
        },
      },
    }).catch((e: unknown) => e);
    expect(error).toBe(stop);
  });

  it('says a missing program is missing', async () => {
    const missing = createRunTool({ ...NODE_PATHS, ytDlp: 'no-such-program-postgear' });
    const error = await missing('yt-dlp', ['--version'], { cwd, timeoutMs: 5_000 }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ToolMissingError);
  });

  it('refuses a working folder that does not exist', async () => {
    const error = (await runTool('yt-dlp', node('1'), {
      cwd: path.join(cwd, 'nope'),
      timeoutMs: 5_000,
    }).catch((e: unknown) => e)) as ToolError;
    expect(error).toBeInstanceOf(ToolError);
    expect(error.message).not.toContain(cwd);
  });

  it('refuses an argument with a NUL character', async () => {
    await expect(
      runTool('yt-dlp', ['-e', 'a\0b'], { cwd, timeoutMs: 5_000 }),
    ).rejects.toBeInstanceOf(ToolError);
  });
});

/**
 * Jest's own limit matches the tool's 30 seconds: starting the real FFmpeg
 * took over Jest's default 5 seconds once while every workspace ran its
 * tests at the same time (`npm run validate`, 2026-11-19).
 */
const FFMPEG_TEST_MS = 30_000;

describe('createRunTool with FFmpeg', () => {
  const ffmpeg = createRunTool({ ...NODE_PATHS, ffmpeg: process.env.FFMPEG_PATH || 'ffmpeg' });

  it(
    'runs a tiny lavfi render to the null muxer and reports progress to the end',
    async () => {
      if (!ffmpegAvailable) return;
      const parser = new FfmpegProgressParser(1_000);
      const result = await ffmpeg(
        'ffmpeg',
        [
          '-hide_banner',
          '-nostdin',
          '-loglevel',
          'error',
          '-progress',
          'pipe:1',
          '-nostats',
          '-f',
          'lavfi',
          '-i',
          'testsrc=d=1:s=160x90:r=30',
          '-f',
          'null',
          '-',
        ],
        { cwd, timeoutMs: 30_000, onStdoutLine: (line) => parser.push(line) },
      );
      expect(result.exitCode).toBe(0);
      expect(parser.ended).toBe(true);
      expect(parser.snapshot().percent).toBe(100);
    },
    FFMPEG_TEST_MS,
  );

  it(
    'stops an endless FFmpeg run on abort',
    async () => {
      if (!ffmpegAvailable) return;
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 500);
      const started = Date.now();
      const error = (await ffmpeg(
        'ffmpeg',
        [
          '-hide_banner',
          '-nostdin',
          '-re',
          '-f',
          'lavfi',
          '-i',
          'testsrc=s=160x90',
          '-f',
          'null',
          '-',
        ],
        { cwd, timeoutMs: 30_000, signal: controller.signal },
      ).catch((e: unknown) => e)) as ToolError;
      expect(error).toBeInstanceOf(ToolError);
      expect(error.aborted).toBe(true);
      expect(Date.now() - started).toBeLessThan(10_000);
    },
    FFMPEG_TEST_MS,
  );
});
