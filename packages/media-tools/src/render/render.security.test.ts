/**
 * Security sweep, "Render" (Sprint 12, Module 20 section 1), the executor half.
 *
 * What must hold: FFmpeg reads only files the plan names inside its own
 * scratch folder; the graph and every ASS file are written there as files
 * and passed by name, never built into an argument; every input carries a
 * protocol allowlist; nothing is written outside the folder. A plan that
 * breaks any of this is refused before FFmpeg starts.
 *
 * The pure half (names the plan accepts, hostile ASS text) is in
 * `packages/video-engine/src/render/render.security.test.ts`; `font_missing`
 * is proved in `execute.test.ts` ("stops at the first font libass picked on
 * its own", "refuses to start when a font file the text needs is not in the
 * fonts folder").
 */
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { CompiledFfmpeg } from '@postgear/video-engine';
import type { RunTool, RunToolOptions } from '../run/types';
import { RenderError, renderClip } from './execute';

let root: string;
let scratch: string;
let outside: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'pg-sweep-render-'));
  scratch = path.join(root, 'job');
  outside = path.join(root, 'other-job');
  await mkdir(scratch);
  await mkdir(outside);
  await writeFile(path.join(scratch, 'sharp.mp4'), 'fake video');
  await writeFile(path.join(outside, 'secret.mp4'), 'another workspace');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function compiled(overrides: Partial<CompiledFfmpeg> = {}): CompiledFfmpeg {
  return {
    inputs: [{ file: 'sharp.mp4', seekMs: 2_000, options: [] }],
    filterComplexScript: '[0:v]ass=filename=captions.ass:fontsdir=fonts,format=yuv420p[v]',
    assFiles: [{ name: 'captions.ass', content: '[Script Info]\nScriptType: v4.00+\n' }],
    outputArgs: ['-map', '[v]', '-t', '2.000', '-c:v', 'libx264'],
    durationMs: 2_000,
    fonts: null,
    ...overrides,
  };
}

/** A stand-in FFmpeg that records its calls and finishes cleanly. */
function recordingFfmpeg(
  seen: Array<{ args: readonly string[]; options: RunToolOptions }>,
): RunTool {
  return async (_tool, args, options) => {
    seen.push({ args, options });
    await writeFile(path.join(options.cwd, args[args.length - 1] as string), 'mp4 bytes');
    options.onStdoutLine?.('out_time_us=2000000');
    options.onStdoutLine?.('progress=end');
    return { exitCode: 0, stdout: '', stderrTail: '', durationMs: 1 };
  };
}

async function refusal(plan: CompiledFfmpeg, outFile = 'render.mp4'): Promise<RenderError> {
  const seen: Array<{ args: readonly string[]; options: RunToolOptions }> = [];
  const error = await renderClip({
    runTool: recordingFfmpeg(seen),
    scratchDir: scratch,
    compiled: plan,
    outFile,
  }).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(RenderError);
  // FFmpeg never started.
  expect(seen).toEqual([]);
  return error as RenderError;
}

describe('the render executor', () => {
  it('runs FFmpeg in the scratch folder with the graph by file and every input allowlisted', async () => {
    const seen: Array<{ args: readonly string[]; options: RunToolOptions }> = [];
    await renderClip({
      runTool: recordingFfmpeg(seen),
      scratchDir: scratch,
      compiled: compiled({
        inputs: [
          { file: 'sharp.mp4', seekMs: 2_000, options: [] },
          { file: 'sharp.mp4', seekMs: null, options: ['-loop', '1'] },
        ],
      }),
      outFile: 'render.mp4',
    });
    expect(seen).toHaveLength(1);
    const { args, options } = seen[0] as { args: readonly string[]; options: RunToolOptions };
    expect(options.cwd).toBe(path.resolve(scratch));
    expect(args[args.indexOf('-/filter_complex') + 1]).toBe('graph.txt');
    expect(await readFile(path.join(scratch, 'graph.txt'), 'utf8')).toContain(
      'ass=filename=captions.ass',
    );
    expect(existsSync(path.join(scratch, 'captions.ass'))).toBe(true);
    // Every `-i` has `-protocol_whitelist file` among its own options.
    let since = 0;
    let inputs = 0;
    args.forEach((arg, i) => {
      if (arg !== '-i') return;
      inputs += 1;
      const own = args.slice(since, i);
      expect(own[own.lastIndexOf('-protocol_whitelist') + 1]).toBe('file');
      expect(path.isAbsolute(args[i + 1] as string)).toBe(false);
      since = i + 2;
    });
    expect(inputs).toBe(2);
    // The graph text is never an argument.
    expect(args.some((arg) => arg.includes('ass=') || arg.includes('[0:v]'))).toBe(false);
  });

  it('refuses an input outside the scratch folder, even one that exists', async () => {
    for (const file of [
      '../other-job/secret.mp4',
      path.join(outside, 'secret.mp4'),
      'sub/../../other-job/secret.mp4',
    ]) {
      const error = await refusal(compiled({ inputs: [{ file, seekMs: null, options: [] }] }));
      expect(error.code).toBe('tool_failed');
    }
  });

  it('refuses an input whose name is not a plain name, even when the file is there', async () => {
    // Real files in the folder, named as no plan would name them.
    for (const name of ['-x.mp4', 'a b.mp4', "it's.mp4", 'x;y.mp4']) {
      await writeFile(path.join(scratch, name), 'fake video');
      const error = await refusal(
        compiled({ inputs: [{ file: name, seekMs: null, options: [] }] }),
      );
      expect(error.code).toBe('tool_failed');
    }
    const absolute = path.join(scratch, 'sharp.mp4');
    const error = await refusal(
      compiled({ inputs: [{ file: absolute, seekMs: null, options: [] }] }),
    );
    expect(error.code).toBe('tool_failed');
  });

  it('refuses an input that is not a file in the folder (a protocol, a list, a folder)', async () => {
    await mkdir(path.join(scratch, 'fonts'));
    for (const file of [
      'concat:sharp.mp4|sharp.mp4',
      'http://127.0.0.1:9/x.mp4',
      'pipe:0',
      'missing.mp4',
      'fonts',
    ]) {
      const error = await refusal(compiled({ inputs: [{ file, seekMs: null, options: [] }] }));
      expect(error.code).toBe('tool_failed');
    }
  });

  it('refuses an ASS file whose name is a path, and writes nothing outside the folder', async () => {
    for (const name of [
      '../escape.ass',
      'sub/captions.ass',
      '.hidden.ass',
      'graph.txt',
      '-x.ass',
    ]) {
      const error = await refusal(compiled({ assFiles: [{ name, content: 'x' }] }));
      expect(error.code).toBe('tool_failed');
    }
    expect(existsSync(path.join(root, 'escape.ass'))).toBe(false);
  });

  it('refuses an output outside the scratch folder', async () => {
    for (const out of ['../other-job/render.mp4', path.join(outside, 'render.mp4')]) {
      const error = await refusal(compiled(), out);
      expect(error.code).toBe('tool_failed');
    }
    expect(existsSync(path.join(outside, 'render.mp4'))).toBe(false);
  });

  it('refuses a fonts folder that is a path out', async () => {
    const error = await refusal(
      compiled({ fonts: { dir: '../other-job', files: ['secret.mp4'], psNames: ['X'] } }),
    );
    expect(error.code).toBe('tool_failed');
  });
});
