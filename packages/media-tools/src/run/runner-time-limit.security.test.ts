/**
 * Security sweep, the Limits line (Sprint 12, Module 20 section 1): a job
 * cannot outlive its timeout, down to the programs it starts.
 *
 * `runner.test.ts` shows a program is killed at its time limit ("kills the
 * program at the timeout"). This file shows there is no way round it: a call
 * with no usable limit (missing, zero, negative, not a number, or endless) is
 * refused before anything starts, so no FFmpeg or yt-dlp run can be left
 * without a clock.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createRunTool } from './runner';
import { ToolError, type ToolPaths } from './types';

/** Node stands in for the programs: if the guard were gone, this would really run. */
const NODE_PATHS: ToolPaths = {
  ffmpeg: process.execPath,
  ffprobe: process.execPath,
  ytDlp: process.execPath,
  jsRuntime: null,
};
const runTool = createRunTool(NODE_PATHS);

let cwd: string;

beforeAll(async () => {
  cwd = await mkdtemp(path.join(os.tmpdir(), 'runner-limit-'));
});

afterAll(async () => {
  await rm(cwd, { recursive: true, force: true });
});

describe('a program is never started without a time limit', () => {
  it.each([
    ['missing', undefined],
    ['zero', 0],
    ['negative', -1],
    ['not a number', Number.NaN],
    ['endless', Number.POSITIVE_INFINITY],
  ])('refuses a %s limit before starting anything', async (_label, timeoutMs) => {
    const onStart = jest.fn();
    const error = await runTool('yt-dlp', ['-e', 'process.exit(0)'], {
      cwd,
      timeoutMs: timeoutMs as number,
      onStart,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ToolError);
    expect((error as ToolError).message).toBe('yt-dlp was given no time limit');
    expect((error as ToolError).exitCode).toBeNull();
    expect(onStart).not.toHaveBeenCalled();
  });

  it('runs the same call once it has a limit (the refusal is the limit, nothing else)', async () => {
    const onStart = jest.fn();
    await expect(
      runTool('yt-dlp', ['-e', 'process.exit(0)'], { cwd, timeoutMs: 20_000, onStart }),
    ).resolves.toMatchObject({ exitCode: 0 });
    expect(onStart).toHaveBeenCalledTimes(1);
  });
});
