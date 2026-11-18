import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { verifyOutput } from '@postgear/video-engine';
import { createRunTool, lowerPriority } from '../run/runner';
import type { RunTool } from '../run/types';
import { ToolError } from '../run/types';
import { RenderError } from './execute';
import {
  buildOutputFactsArgs,
  moovBeforeMdat,
  outputFactsFromProbe,
  readBoxHeader,
  readOutputFacts,
} from './output-facts';

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'output-facts-'));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

function box(type: string, size: number): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(size, 0);
  header.write(type, 4, 'latin1');
  return Buffer.concat([header, Buffer.alloc(size - 8)]);
}

describe('the MP4 box look', () => {
  it('finds moov first, mdat first, or neither', async () => {
    await writeFile(
      path.join(dir, 'fast.mp4'),
      Buffer.concat([box('ftyp', 24), box('moov', 40), box('mdat', 64)]),
    );
    await writeFile(
      path.join(dir, 'slow.mp4'),
      Buffer.concat([box('ftyp', 24), box('mdat', 64), box('moov', 40)]),
    );
    await writeFile(path.join(dir, 'none.mp4'), 'this is not an mp4 file');
    expect(await moovBeforeMdat(path.join(dir, 'fast.mp4'))).toBe(true);
    expect(await moovBeforeMdat(path.join(dir, 'slow.mp4'))).toBe(false);
    expect(await moovBeforeMdat(path.join(dir, 'none.mp4'))).toBeNull();
    expect(await moovBeforeMdat(path.join(dir, 'missing.mp4'))).toBeNull();
  });

  it('reads 64-bit and to-the-end sizes, and refuses a size that cannot be right', () => {
    const large = Buffer.alloc(16);
    large.writeUInt32BE(1, 0);
    large.write('mdat', 4, 'latin1');
    large.writeBigUInt64BE(5_000_000_000n, 8);
    expect(readBoxHeader(large, 6_000_000_000)).toEqual({ type: 'mdat', size: 5_000_000_000 });
    expect(readBoxHeader(large, 1_000)).toBeNull();
    const toEnd = box('mdat', 8);
    toEnd.writeUInt32BE(0, 0);
    expect(readBoxHeader(toEnd, 500)).toEqual({ type: 'mdat', size: 500 });
    const tiny = box('free', 8);
    tiny.writeUInt32BE(4, 0);
    expect(readBoxHeader(tiny, 500)).toBeNull();
  });
});

describe('outputFactsFromProbe', () => {
  it('maps the stream and sorts key frames from the stream start', () => {
    const facts = outputFactsFromProbe(
      {
        streams: [
          {
            codec_name: 'h264',
            profile: 'High',
            pix_fmt: 'yuv420p',
            width: 1080,
            height: 1920,
            avg_frame_rate: '30/1',
            duration: '20.000000',
            start_time: '0.100000',
          },
        ],
        packets: [
          { pts_time: '0.100000', flags: 'K__' },
          { pts_time: '0.200000', flags: '___' },
          { pts_time: '4.100000', flags: 'K__' },
          { pts_time: '2.100000', flags: 'K__' },
        ],
        format: { duration: '20.050000' },
      },
      123,
    );
    expect(facts).toEqual({
      durationMs: 20_000,
      width: 1080,
      height: 1920,
      fps: 30,
      codec: 'h264',
      profile: 'High',
      pixFmt: 'yuv420p',
      keyframesMs: [0, 2_000, 4_000],
      moovFirst: null,
      bytes: 123,
    });
  });

  it('falls back to the container length, and reads nothing from JSON it does not know', () => {
    expect(
      outputFactsFromProbe({ streams: [{ codec_name: 'h264' }], format: { duration: '3.5' } }, 9)
        .durationMs,
    ).toBe(3_500);
    expect(outputFactsFromProbe({ streams: 'no' }, 9)).toMatchObject({ codec: null, bytes: 9 });
    expect(outputFactsFromProbe({ streams: [] }, 9)).toMatchObject({ width: null });
  });

  it('asks ffprobe for the first picture stream through the allowlist, by argument array', () => {
    const args = buildOutputFactsArgs(path.join(dir, 'render.mp4'));
    expect(args).toContain('-format_whitelist');
    expect(args).toContain('v:0');
    expect(args[args.length - 1]).toMatch(/^file:/);
  });
});

describe('readOutputFacts with a fake ffprobe', () => {
  it('calls an empty or missing file empty without starting ffprobe', async () => {
    const runTool = jest.fn() as unknown as RunTool;
    await writeFile(path.join(dir, 'empty.mp4'), '');
    expect((await readOutputFacts(runTool, path.join(dir, 'empty.mp4'))).bytes).toBe(0);
    expect((await readOutputFacts(runTool, path.join(dir, 'gone.mp4'))).bytes).toBe(0);
    expect(runTool).not.toHaveBeenCalled();
  });

  it('turns an ffprobe refusal into empty facts, a stop into cancelled and a missing tool into tool_failed', async () => {
    const file = path.join(dir, 'broken.mp4');
    await writeFile(file, 'broken bytes');
    const refuses: RunTool = async () => {
      throw new ToolError({ tool: 'ffprobe', exitCode: 1 });
    };
    expect(await readOutputFacts(refuses, file)).toMatchObject({ codec: null, bytes: 12 });

    const stopped: RunTool = async () => {
      throw new ToolError({ tool: 'ffprobe', exitCode: null, aborted: true });
    };
    await expect(readOutputFacts(stopped, file)).rejects.toMatchObject({ code: 'cancelled' });

    const missing: RunTool = async () => {
      throw new ToolError({ tool: 'ffprobe', exitCode: null, reason: 'is not installed' });
    };
    const error = await readOutputFacts(missing, file).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RenderError);
    expect((error as RenderError).code).toBe('tool_failed');
  });

  it('passes low priority through to the runner', async () => {
    const file = path.join(dir, 'low.mp4');
    await writeFile(file, 'bytes');
    const seen: Array<string | undefined> = [];
    const runTool: RunTool = async (_tool, _args, options) => {
      seen.push(options.priority);
      return { exitCode: 0, stdout: '{}', stderrTail: '', durationMs: 1 };
    };
    await readOutputFacts(runTool, file, { priority: 'low' });
    await readOutputFacts(runTool, file);
    expect(seen).toEqual(['low', undefined]);
  });
});

describe('with the real FFmpeg', () => {
  const runTool = createRunTool({
    ffmpeg: process.env.FFMPEG_PATH || 'ffmpeg',
    ffprobe: process.env.FFPROBE_PATH || 'ffprobe',
    ytDlp: process.execPath,
    jsRuntime: null,
  });
  let available = false;

  /** The export's encode settings on a lavfi picture: 3 s, 30 fps, a key frame every 2 s. */
  function encode(out: string, extra: string[]): string[] {
    return [
      '-hide_banner',
      '-nostdin',
      '-y',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=d=3:s=320x568:r=30',
      '-c:v',
      'libx264',
      '-profile:v',
      'high',
      '-pix_fmt',
      'yuv420p',
      '-preset',
      'veryfast',
      '-g',
      '60',
      '-keyint_min',
      '60',
      '-sc_threshold',
      '0',
      ...extra,
      out,
    ];
  }

  beforeAll(async () => {
    available = await runTool('ffmpeg', encode('good.mp4', ['-movflags', '+faststart']), {
      cwd: dir,
      timeoutMs: 120_000,
    }).then(
      () => true,
      () => false,
    );
    if (!available) {
      console.warn('FFmpeg is not on PATH: the real output facts tests are skipped.');
      return;
    }
    await runTool('ffmpeg', encode('slow.mp4', []), { cwd: dir, timeoutMs: 120_000 });
  }, 180_000);

  it('reads a well made export and the check passes it', async () => {
    if (!available) return;
    const facts = await readOutputFacts(runTool, path.join(dir, 'good.mp4'));
    expect(facts).toMatchObject({
      width: 320,
      height: 568,
      fps: 30,
      codec: 'h264',
      profile: 'High',
      pixFmt: 'yuv420p',
      moovFirst: true,
    });
    expect(facts.keyframesMs[0]).toBe(0);
    expect(facts.keyframesMs).toContain(2_000);
    expect(
      verifyOutput(facts, { durationMs: 3_000, width: 320, height: 568, fps: 30, gopSeconds: 2 }),
    ).toEqual([]);
  }, 180_000);

  it('names the missing faststart and a wrong size', async () => {
    if (!available) return;
    const facts = await readOutputFacts(runTool, path.join(dir, 'slow.mp4'));
    expect(facts.moovFirst).toBe(false);
    expect(
      verifyOutput(facts, { durationMs: 3_000, width: 1080, height: 1920, fps: 30, gopSeconds: 2 }),
    ).toEqual(['size', 'moov']);
  }, 180_000);
});

describe('a low priority run', () => {
  const node = createRunTool({
    ffmpeg: 'ffmpeg',
    ffprobe: process.execPath,
    ytDlp: process.execPath,
    jsRuntime: null,
  });

  /** Starts a sleeping program, reads its priority from outside the moment it starts, then stops it. */
  async function priorityAtStart(priority?: 'low'): Promise<number> {
    const controller = new AbortController();
    let seen = Number.NaN;
    const error = await node('ffprobe', ['-e', 'setTimeout(() => undefined, 30000)'], {
      cwd: dir,
      timeoutMs: 60_000,
      signal: controller.signal,
      ...(priority ? { priority } : {}),
      onStart: (pid) => {
        seen = os.getPriority(pid);
        controller.abort();
      },
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ToolError);
    expect((error as ToolError).aborted).toBe(true);
    return seen;
  }

  it('moves the program below normal priority, and leaves an export at normal', async () => {
    expect(await priorityAtStart('low')).toBe(os.constants.priority.PRIORITY_BELOW_NORMAL);
    expect(await priorityAtStart()).toBe(os.constants.priority.PRIORITY_NORMAL);
  }, 60_000);

  it('answers false for a process that is not there', () => {
    expect(lowerPriority(2 ** 30)).toBe(false);
  });
});
