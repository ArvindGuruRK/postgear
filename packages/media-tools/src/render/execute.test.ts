import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { CompiledFfmpeg } from '@postgear/video-engine';
import { probeFile } from '../ffmpeg/probe';
import { createRunTool } from '../run/runner';
import { type RunTool, type RunToolOptions, ToolError } from '../run/types';
import { RenderError, type RenderProgress, renderClip } from './execute';

let scratch: string;

beforeEach(async () => {
  scratch = await mkdtemp(path.join(os.tmpdir(), 'render-test-'));
  await writeFile(path.join(scratch, 'sharp.mp4'), 'fake video');
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

function compiled(overrides: Partial<CompiledFfmpeg> = {}): CompiledFfmpeg {
  return {
    inputs: [{ file: 'sharp.mp4', seekMs: 2_000, options: [] }],
    filterComplexScript:
      '[0:v]trim=start=0:end=20,setpts=PTS-STARTPTS,fps=30,setsar=1,format=yuv420p[v]',
    assFiles: [{ name: 'captions.ass', content: '[Script Info]\nScriptType: v4.00+\n' }],
    outputArgs: ['-map', '[v]', '-t', '20.000', '-c:v', 'libx264'],
    durationMs: 20_000,
    ...overrides,
  };
}

function progressLines(us: number, end = false): string[] {
  return [
    `frame=1`,
    `out_time_us=${us}`,
    `out_time_ms=${us}`,
    'speed=2x',
    `progress=${end ? 'end' : 'continue'}`,
  ];
}

/** A fake FFmpeg that writes its output file and prints progress, or fails as told. */
function fakeFfmpeg(behaviour: {
  write?: boolean;
  lines?: string[];
  throws?: Error;
  seen?: Array<{ args: readonly string[]; options: RunToolOptions }>;
}): RunTool {
  return async (_tool, args, options) => {
    behaviour.seen?.push({ args, options });
    if (behaviour.write !== false) {
      await writeFile(path.join(options.cwd, args[args.length - 1]), 'mp4 bytes');
    }
    for (const line of behaviour.lines ?? []) options.onStdoutLine?.(line);
    if (behaviour.throws) throw behaviour.throws;
    return { exitCode: 0, stdout: '', stderrTail: '', durationMs: 10 };
  };
}

describe('renderClip with a fake FFmpeg', () => {
  it('writes the graph and ASS files, runs in the scratch folder and renames the part file', async () => {
    const seen: Array<{ args: readonly string[]; options: RunToolOptions }> = [];
    const progress: RenderProgress[] = [];
    const result = await renderClip({
      runTool: fakeFfmpeg({
        seen,
        lines: [
          ...progressLines(10_000_000),
          ...progressLines(8_000_000),
          ...progressLines(20_000_000, true),
        ],
      }),
      scratchDir: scratch,
      compiled: compiled(),
      outFile: 'render.mp4',
      onProgress: (p) => progress.push(p),
    });

    expect(await readFile(path.join(scratch, 'graph.txt'), 'utf8')).toBe(
      compiled().filterComplexScript,
    );
    expect(existsSync(path.join(scratch, 'captions.ass'))).toBe(true);

    const { args, options } = seen[0];
    expect(options.cwd).toBe(path.resolve(scratch));
    expect(args).toContain('-/filter_complex');
    expect(args[args.indexOf('-/filter_complex') + 1]).toBe('graph.txt');
    expect(args).not.toContain('-filter_complex_script');
    expect(args).not.toContain('-vsync');
    expect(args.slice(-3)).toEqual(['-f', 'mp4', 'render.mp4.part']);
    expect(args[args.indexOf('-ss') + 1]).toBe('2.000');

    expect(result.file).toBe(path.join(path.resolve(scratch), 'render.mp4'));
    expect(existsSync(result.file)).toBe(true);
    expect(existsSync(`${result.file}.part`)).toBe(false);
    expect(progress.map((p) => p.percent)).toEqual([50, 50, 100]);
    expect(progress[0].etaSeconds).toBe(5);
  });

  it('keeps a format the compiler already set', async () => {
    const seen: Array<{ args: readonly string[]; options: RunToolOptions }> = [];
    await renderClip({
      runTool: fakeFfmpeg({ seen, lines: progressLines(20_000_000, true) }),
      scratchDir: scratch,
      compiled: compiled({ outputArgs: ['-map', '[v]', '-f', 'mp4'] }),
      outFile: 'render.mp4',
    });
    expect(seen[0].args.filter((a) => a === '-f')).toHaveLength(1);
  });

  it('fails when FFmpeg exits cleanly without finishing, and removes the part file', async () => {
    const error = (await renderClip({
      runTool: fakeFfmpeg({ lines: progressLines(5_000_000) }),
      scratchDir: scratch,
      compiled: compiled(),
      outFile: 'render.mp4',
    }).catch((e: unknown) => e)) as RenderError;
    expect(error).toBeInstanceOf(RenderError);
    expect(error.code).toBe('tool_failed');
    expect(existsSync(path.join(scratch, 'render.mp4.part'))).toBe(false);
    expect(existsSync(path.join(scratch, 'render.mp4'))).toBe(false);
  });

  it('says cancelled when stopped and leaves no part file', async () => {
    const error = (await renderClip({
      runTool: fakeFfmpeg({
        throws: new ToolError({ tool: 'ffmpeg', exitCode: null, aborted: true }),
      }),
      scratchDir: scratch,
      compiled: compiled(),
      outFile: 'render.mp4',
    }).catch((e: unknown) => e)) as RenderError;
    expect(error.code).toBe('cancelled');
    expect(existsSync(path.join(scratch, 'render.mp4.part'))).toBe(false);
  });

  it('says font_missing when libass could not open a font, without its text in the message', async () => {
    const error = (await renderClip({
      runTool: fakeFfmpeg({
        throws: new ToolError({
          tool: 'ffmpeg',
          exitCode: 1,
          stderrTail: '[Parsed_ass_3 @ 0x1] Error opening memory font: C:/fonts/anton-400.woff2',
        }),
      }),
      scratchDir: scratch,
      compiled: compiled(),
      outFile: 'render.mp4',
    }).catch((e: unknown) => e)) as RenderError;
    expect(error.code).toBe('font_missing');
    expect(error.message).not.toContain('anton');
    expect(error.stderrTail).toContain('anton');
  });

  it('says tool_failed for any other failure, and for a timeout', async () => {
    const failed = (await renderClip({
      runTool: fakeFfmpeg({
        throws: new ToolError({ tool: 'ffmpeg', exitCode: 1, stderrTail: 'Invalid argument' }),
      }),
      scratchDir: scratch,
      compiled: compiled(),
      outFile: 'render.mp4',
    }).catch((e: unknown) => e)) as RenderError;
    expect(failed.code).toBe('tool_failed');
    const timedOut = (await renderClip({
      runTool: fakeFfmpeg({
        throws: new ToolError({ tool: 'ffmpeg', exitCode: null, timedOut: true }),
      }),
      scratchDir: scratch,
      compiled: compiled(),
      outFile: 'render.mp4',
    }).catch((e: unknown) => e)) as RenderError;
    expect(timedOut).toMatchObject({ code: 'tool_failed', timedOut: true });
  });

  it.each<[string, Partial<CompiledFfmpeg>, string]>([
    [
      'a missing input',
      { inputs: [{ file: 'gone.mp4', seekMs: null, options: [] }] },
      'render.mp4',
    ],
    [
      'an input outside the folder',
      { inputs: [{ file: '../x.mp4', seekMs: null, options: [] }] },
      'render.mp4',
    ],
    [
      'an ASS name with a folder',
      { assFiles: [{ name: '../evil.ass', content: '' }] },
      'render.mp4',
    ],
    ['an output outside the folder', {}, '../render.mp4'],
    ['an output with no known format', {}, 'render.xyz'],
  ])('refuses %s before starting FFmpeg', async (_label, change, outFile) => {
    const seen: Array<{ args: readonly string[]; options: RunToolOptions }> = [];
    const error = (await renderClip({
      runTool: fakeFfmpeg({ seen }),
      scratchDir: scratch,
      compiled: compiled(change),
      outFile,
    }).catch((e: unknown) => e)) as RenderError;
    expect(error).toBeInstanceOf(RenderError);
    expect(error.code).toBe('tool_failed');
    expect(seen).toHaveLength(0);
  });

  it('refuses at once when already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      renderClip({
        runTool: fakeFfmpeg({}),
        scratchDir: scratch,
        compiled: compiled(),
        outFile: 'render.mp4',
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: 'cancelled' });
  });
});

describe('renderClip with the real FFmpeg', () => {
  const runTool = createRunTool({
    ffmpeg: 'ffmpeg',
    ffprobe: 'ffprobe',
    ytDlp: 'yt-dlp',
    jsRuntime: null,
  });
  let dir: string;
  let available = false;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'render-real-'));
    available = await runTool(
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
        'testsrc2=d=20:s=640x360:r=30',
        '-f',
        'lavfi',
        '-i',
        'sine=d=20',
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-pix_fmt',
        'yuv420p',
        '-g',
        '30',
        '-c:a',
        'aac',
        '-shortest',
        'sharp.mp4',
      ],
      { cwd: dir, timeoutMs: 120_000 },
    ).then(
      () => true,
      () => false,
    );
    if (!available) console.warn('FFmpeg is not on PATH: the real render tests are skipped.');
  }, 180_000);

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  /** A Fullscreen-style plan by hand: one segment, the graph by file, an exact length. */
  function realPlan(seconds: number): CompiledFfmpeg {
    const end = seconds.toFixed(3);
    return {
      inputs: [{ file: 'sharp.mp4', seekMs: 1_000, options: [] }],
      filterComplexScript: [
        `[0:v]trim=start=0:end=${end},crop=202:360:219:0,setpts=PTS-STARTPTS,fps=30,setsar=1[v0];`,
        `[0:a]atrim=start=0:end=${end},asetpts=PTS-STARTPTS,aresample=48000[a0];`,
        '[v0][a0]concat=n=1:v=1:a=1[vc][ac];',
        '[vc]fps=30,format=yuv420p[v];',
        `[ac]apad=whole_dur=${end}[a]`,
      ].join('\n'),
      assFiles: [],
      outputArgs: [
        '-map',
        '[v]',
        '-map',
        '[a]',
        '-t',
        end,
        '-r',
        '30',
        '-c:v',
        'libx264',
        '-profile:v',
        'high',
        '-pix_fmt',
        'yuv420p',
        '-preset',
        'ultrafast',
        '-g',
        '60',
        '-keyint_min',
        '60',
        '-sc_threshold',
        '0',
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        '-ar',
        '48000',
        '-ac',
        '2',
        '-movflags',
        '+faststart',
      ],
      durationMs: seconds * 1000,
    };
  }

  it('renders a two second clip with the graph passed by file', async () => {
    if (!available) return;
    const progress: number[] = [];
    const result = await renderClip({
      runTool,
      scratchDir: dir,
      compiled: realPlan(2),
      outFile: 'render.mp4',
      onProgress: (p) => progress.push(p.percent),
    });
    expect(progress[progress.length - 1]).toBe(100);
    const facts = await probeFile(runTool, result.file);
    expect(facts).toMatchObject({
      width: 202,
      height: 360,
      fps: 30,
      videoCodec: 'h264',
      audioCodec: 'aac',
    });
    expect(Math.abs(facts.durationMs - 2_000)).toBeLessThanOrEqual(50);
    expect((await readdir(dir)).some((name) => name.endsWith('.part'))).toBe(false);
  }, 120_000);

  it('stops a render on cancel and leaves no part file', async () => {
    if (!available) return;
    const controller = new AbortController();
    const pending = renderClip({
      runTool,
      scratchDir: dir,
      compiled: {
        ...realPlan(18),
        outputArgs: realPlan(18).outputArgs.map((a) => (a === 'ultrafast' ? 'veryslow' : a)),
      },
      outFile: 'cancelled.mp4',
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 300);
    const error = (await pending.catch((e: unknown) => e)) as RenderError;
    expect(error).toBeInstanceOf(RenderError);
    expect(error.code).toBe('cancelled');
    const names = await readdir(dir);
    expect(names).not.toContain('cancelled.mp4.part');
    expect(names).not.toContain('cancelled.mp4');
  }, 60_000);
});
