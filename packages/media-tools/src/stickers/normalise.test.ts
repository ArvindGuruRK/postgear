import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { toolPaths } from '../run/paths';
import { createRunTool } from '../run/runner';
import { type RunTool, ToolError, type ToolPaths } from '../run/types';
import {
  buildStickerHeaderProbeArgs,
  buildStickerProbeArgs,
  checkStickerHeader,
  fitSize,
  movingStickerArgs,
  normaliseSticker,
  previewStickerArgs,
  STICKER_FORMAT_ALLOWLIST,
  STICKER_LIMITS,
  STICKER_MAX_PIXELS,
  StickerError,
  sniffStickerType,
  stickerFactsFromProbe,
  stickerFps,
  stillStickerArgs,
} from './normalise';

function probeJson(stream: Record<string, unknown>, format = 'png_pipe') {
  return { streams: [{ codec_type: 'video', ...stream }], format: { format_name: format } };
}

describe('reading a picture', () => {
  it('reads with only the picture demuxers, from a file, counting every frame', () => {
    const args = buildStickerProbeArgs('in.webp');
    expect(args).toEqual(expect.arrayContaining(['-format_whitelist', STICKER_FORMAT_ALLOWLIST]));
    expect(args).toEqual(expect.arrayContaining(['-protocol_whitelist', 'file', '-count_frames']));
    expect(args.join(' ')).toContain('-max_pixels 16777216');
    expect(args.at(-1)).toBe('file:in.webp');
  });

  it('reads the header first: no frame counted, and no frame bigger than 4096 by 4096 decoded', () => {
    expect(STICKER_MAX_PIXELS).toBe(16_777_216);
    const args = buildStickerHeaderProbeArgs('in.webp');
    expect(args).toEqual(expect.arrayContaining(['-format_whitelist', STICKER_FORMAT_ALLOWLIST]));
    expect(args).toEqual(expect.arrayContaining(['-protocol_whitelist', 'file']));
    expect(args.join(' ')).toContain('-max_pixels 16777216');
    expect(args).not.toContain('-count_frames');
    expect(args.join(' ')).not.toContain('frame=');
    expect(args.at(-1)).toBe('file:in.webp');
  });

  it('the header check refuses a giant, a zero size and a video, and passes a picture', () => {
    const code = (json: unknown) => {
      try {
        checkStickerHeader(json);
        return 'ok';
      } catch (error) {
        return (error as StickerError).code;
      }
    };
    expect(code(probeJson({ codec_name: 'png', width: 5000, height: 40 }))).toBe(
      'sticker_unusable',
    );
    expect(code(probeJson({ codec_name: 'png', width: 0, height: 0 }))).toBe('sticker_unusable');
    expect(code(probeJson({ codec_name: 'h264', width: 100, height: 100 }))).toBe(
      'sticker_unusable',
    );
    expect(code(probeJson({ codec_name: 'gif', width: 4096, height: 4096 }, 'gif'))).toBe('ok');
  });

  it('says a one-frame picture is still and a many-frame one moves', () => {
    expect(
      stickerFactsFromProbe(
        probeJson({
          codec_name: 'png',
          width: 300,
          height: 200,
          avg_frame_rate: '25/1',
          nb_read_frames: '1',
        }),
      ),
    ).toEqual({ format: 'png_pipe', width: 300, height: 200, frames: 1, fps: 25, animated: false });
    expect(
      stickerFactsFromProbe(
        probeJson(
          {
            codec_name: 'webp',
            width: 400,
            height: 400,
            avg_frame_rate: '0/0',
            r_frame_rate: '25/2',
            nb_read_frames: '40',
          },
          'webp_anim',
        ),
      ),
    ).toMatchObject({ frames: 40, fps: 12.5, animated: true });
  });

  it('takes the rate from the shortest frame, so a held frame repeats instead of slowing the loop', () => {
    const held = {
      ...probeJson(
        { codec_name: 'webp', width: 400, height: 160, avg_frame_rate: '9/1', nb_read_frames: '8' },
        'webp_anim',
      ),
      frames: ['0.747', '0.083', '0.083', '0.083', '0.083', '0.083', '0.083', '0.249'].map((d) => ({
        duration_time: d,
      })),
    };
    const facts = stickerFactsFromProbe(held);
    expect(facts.fps).toBeCloseTo(12.05, 2);
    expect(stickerFps(facts.fps)).toBe(12);
    // Frames that say nothing fall back to the stream's rate.
    expect(stickerFactsFromProbe({ ...held, frames: [{ duration_time: 'N/A' }, {}] }).fps).toBe(9);
  });

  it('refuses a video, an empty picture, a giant and anything it cannot read', () => {
    const refuse = (json: unknown) => () => stickerFactsFromProbe(json);
    expect(
      refuse(probeJson({ codec_name: 'h264', width: 100, height: 100, nb_read_frames: '1' })),
    ).toThrow(StickerError);
    expect(
      refuse(probeJson({ codec_name: 'png', width: 0, height: 100, nb_read_frames: '1' })),
    ).toThrow(StickerError);
    expect(
      refuse(probeJson({ codec_name: 'png', width: 5000, height: 100, nb_read_frames: '1' })),
    ).toThrow(StickerError);
    expect(
      refuse(probeJson({ codec_name: 'gif', width: 10, height: 10, nb_read_frames: '9999' })),
    ).toThrow(StickerError);
    expect(refuse({ nonsense: true })).toThrow(StickerError);
    try {
      stickerFactsFromProbe({ streams: [], format: { format_name: 'png_pipe' } });
    } catch (error) {
      expect((error as StickerError).code).toBe('sticker_unusable');
    }
  });
});

describe('what a file really is', () => {
  it('reads PNG (and so APNG), GIF and WebP from their first bytes, and nothing else', () => {
    const bytes = (...values: number[]) => Uint8Array.from(values);
    expect(sniffStickerType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe('png');
    expect(sniffStickerType(Buffer.from('GIF89a....'))).toBe('gif');
    expect(sniffStickerType(Buffer.from('GIF87a....'))).toBe('gif');
    expect(sniffStickerType(Buffer.from('RIFF\u0000\u0000\u0000\u0000WEBPVP8 '))).toBe('webp');
    expect(sniffStickerType(Buffer.from('RIFF\u0000\u0000\u0000\u0000WAVEfmt '))).toBeNull();
    expect(sniffStickerType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg">'))).toBeNull();
    expect(sniffStickerType(Buffer.from('not a picture'))).toBeNull();
    expect(sniffStickerType(new Uint8Array(0))).toBeNull();
  });
});

describe('sizes and rates', () => {
  it('fits the longest side, never makes a picture bigger, and keeps both sides even', () => {
    expect(fitSize(1024, 512, 512)).toEqual({ width: 512, height: 256 });
    expect(fitSize(100, 51, 512)).toEqual({ width: 100, height: 52 });
    expect(fitSize(3000, 3, 256)).toEqual({ width: 256, height: 2 });
  });

  it('keeps a moving sticker at its own rate, at most 20 frames a second', () => {
    expect(stickerFps(12.5)).toBe(13);
    expect(stickerFps(60)).toBe(20);
    expect(stickerFps(30, 15)).toBe(15);
    expect(stickerFps(0)).toBe(10);
  });
});

describe('the FFmpeg arguments', () => {
  it('a still is one RGBA frame as PNG, without metadata', () => {
    expect(stillStickerArgs('in.gif', 'out.png', { width: 512, height: 256 })).toEqual([
      '-hide_banner',
      '-nostdin',
      '-y',
      '-loglevel',
      'error',
      '-format_whitelist',
      STICKER_FORMAT_ALLOWLIST,
      '-protocol_whitelist',
      'file',
      '-i',
      'file:in.gif',
      '-frames:v',
      '1',
      '-vf',
      'scale=512:256:flags=lanczos,format=rgba',
      '-map_metadata',
      '-1',
      '-c:v',
      'png',
      '-f',
      'image2',
      'out.png',
    ]);
  });

  it('a moving one is an endless APNG at a constant rate, at most 6 s and 120 frames', () => {
    const args = movingStickerArgs('in.webp', 'out.apng', { width: 256, height: 256 }, 20);
    expect(args.join(' ')).toContain(
      '-i file:in.webp -t 6.000 -vf fps=20,scale=256:256:flags=lanczos,format=rgba -frames:v 120 -map_metadata -1 -plays 0 -f apng out.apng',
    );
  });

  it('the grid picture is a 128 px WebP, moving for a moving sticker', () => {
    expect(previewStickerArgs('s.apng', 'p.webp', true, 15).join(' ')).toContain(
      '-vf fps=15,scale=128:128:force_original_aspect_ratio=decrease:flags=lanczos,format=rgba -c:v libwebp_anim -loop 0',
    );
    expect(previewStickerArgs('s.png', 'p.webp', false, 1).join(' ')).toContain('-frames:v 1');
  });
});

/**
 * A stand-in for the runner: ffprobe answers from `facts` by file name, and
 * ffmpeg writes an output of the size `sizes` gives (called with the args).
 */
function fakeRunTool(
  dir: string,
  facts: Record<string, unknown>,
  sizes: (args: readonly string[]) => number,
): { runTool: RunTool; calls: Array<readonly string[]> } {
  const calls: Array<readonly string[]> = [];
  const runTool: RunTool = async (tool, args) => {
    calls.push(args);
    if (tool === 'ffprobe') {
      const file = String(args.at(-1)).replace(/^file:/, '');
      const json = facts[file];
      if (!json) throw new ToolError({ tool, exitCode: 1 });
      return { exitCode: 0, stdout: JSON.stringify(json), stderrTail: '', durationMs: 1 };
    }
    writeFileSync(path.join(dir, String(args.at(-1))), Buffer.alloc(sizes(args)));
    return { exitCode: 0, stdout: '', stderrTail: '', durationMs: 1 };
  };
  return { runTool, calls };
}

describe('normaliseSticker (with a stand-in runner)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'pg-sticker-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('makes a still PNG and its grid picture', async () => {
    const { runTool, calls } = fakeRunTool(
      dir,
      { 'in.png': probeJson({ codec_name: 'png', width: 1000, height: 500, nb_read_frames: 1 }) },
      () => 10_000,
    );
    const made = await normaliseSticker({
      runTool,
      cwd: dir,
      input: 'in.png',
      outputBase: 's',
      targetPx: 512,
    });
    expect(made).toEqual({
      file: 's.png',
      preview: 's.preview.webp',
      animated: false,
      width: 512,
      height: 256,
      fps: null,
      frames: null,
      durationMs: null,
      bytes: 10_000,
      previewBytes: 10_000,
    });
    // The header read, the counting read, the sticker and its grid picture.
    expect(calls).toHaveLength(4);
  });

  it('refuses a picture too big on a side from its header, before any frame is counted', async () => {
    const { runTool, calls } = fakeRunTool(
      dir,
      { 'in.png': probeJson({ codec_name: 'png', width: 5000, height: 40, nb_read_frames: 1 }) },
      () => 1,
    );
    await expect(
      normaliseSticker({ runTool, cwd: dir, input: 'in.png', outputBase: 's', targetPx: 512 }),
    ).rejects.toMatchObject({ code: 'sticker_unusable' });
    expect(calls).toHaveLength(1);
    expect(calls[0]).not.toContain('-count_frames');
  });

  it('makes a still smaller once when it is over 300 KB, then refuses', async () => {
    const facts = {
      'in.png': probeJson({ codec_name: 'png', width: 1000, height: 1000, nb_read_frames: 1 }),
    };
    const shrinks = fakeRunTool(dir, facts, (args) =>
      args.join(' ').includes('scale=512:512') ? STICKER_LIMITS.stillMaxBytes + 1 : 1_000,
    );
    const made = await normaliseSticker({
      ...shrinks,
      cwd: dir,
      input: 'in.png',
      outputBase: 's',
      targetPx: 512,
    });
    expect(made).toMatchObject({ width: 384, height: 384, bytes: 1_000 });

    const huge = fakeRunTool(dir, facts, () => STICKER_LIMITS.stillMaxBytes + 1);
    await expect(
      normaliseSticker({ ...huge, cwd: dir, input: 'in.png', outputBase: 's', targetPx: 512 }),
    ).rejects.toMatchObject({ code: 'sticker_too_large' });
  });

  it('makes a moving APNG, steps down once to 192 px at 15 fps when it is over 2 MB, then refuses', async () => {
    const facts = {
      'in.gif': probeJson(
        { codec_name: 'gif', width: 480, height: 480, avg_frame_rate: '25/1', nb_read_frames: 150 },
        'gif',
      ),
      // The made APNG is read back only for its frame count.
      's.apng': probeJson(
        { codec_name: 'apng', width: 192, height: 192, nb_read_frames: 90 },
        'apng',
      ),
    };
    const stepped = fakeRunTool(dir, facts, (args) =>
      args.join(' ').includes('fps=20,') ? STICKER_LIMITS.movingMaxBytes + 1 : 500_000,
    );
    const made = await normaliseSticker({
      ...stepped,
      cwd: dir,
      input: 'in.gif',
      outputBase: 's',
      targetPx: 512,
    });
    expect(made).toMatchObject({
      file: 's.apng',
      animated: true,
      width: 192,
      height: 192,
      fps: 15,
      frames: 90,
      durationMs: 6_000,
      bytes: 500_000,
    });

    const huge = fakeRunTool(dir, facts, () => STICKER_LIMITS.movingMaxBytes + 1);
    await expect(
      normaliseSticker({ ...huge, cwd: dir, input: 'in.gif', outputBase: 's', targetPx: 512 }),
    ).rejects.toMatchObject({ code: 'sticker_too_large' });
  });

  it('calls a file ffprobe cannot read unusable, and a stop a stop', async () => {
    const { runTool } = fakeRunTool(dir, {}, () => 1);
    await expect(
      normaliseSticker({ runTool, cwd: dir, input: 'in.png', outputBase: 's', targetPx: 512 }),
    ).rejects.toMatchObject({ code: 'sticker_unusable' });

    const stopped: RunTool = async (tool) => {
      throw new ToolError({ tool, exitCode: null, aborted: true });
    };
    await expect(
      normaliseSticker({
        runTool: stopped,
        cwd: dir,
        input: 'in.png',
        outputBase: 's',
        targetPx: 512,
      }),
    ).rejects.toMatchObject({ code: 'cancelled' });
  });
});

/** Whether a program can be found: an absolute setting that exists, or a name on PATH. */
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
  console.warn('Sticker tests with FFmpeg skipped: ffmpeg and ffprobe are not on the PATH.');

describeWithFfmpeg('normaliseSticker (real FFmpeg)', () => {
  let dir: string;
  let runTool: RunTool;

  async function make(args: string[]): Promise<void> {
    await runTool('ffmpeg', ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error', ...args], {
      cwd: dir,
      timeoutMs: 60_000,
    });
  }

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'pg-sticker-real-'));
    runTool = createRunTool(PATHS as ToolPaths);
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('turns a big still PNG with see-through parts into a 512 px PNG that keeps its alpha', async () => {
    await make([
      '-f',
      'lavfi',
      '-i',
      'color=c=red@0.5:s=1024x600',
      '-frames:v',
      '1',
      '-pix_fmt',
      'rgba',
      'big.png',
    ]);
    const made = await normaliseSticker({
      runTool,
      cwd: dir,
      input: 'big.png',
      outputBase: 'still',
      targetPx: 512,
    });
    expect(made).toMatchObject({ file: 'still.png', animated: false, width: 512, height: 300 });
    expect(made.bytes).toBe(statSync(path.join(dir, 'still.png')).size);
    // PNG colour type 6 is RGBA (byte 25 of the file).
    expect(readFileSync(path.join(dir, 'still.png'))[25]).toBe(6);
    expect(made.previewBytes).toBeGreaterThan(0);
  }, 60_000);

  it('turns a moving GIF into an endless 20 fps APNG with a moving grid picture', async () => {
    await make(['-f', 'lavfi', '-i', 'testsrc2=s=320x240:r=30:d=2', '-vf', 'fps=30', 'move.gif']);
    const made = await normaliseSticker({
      runTool,
      cwd: dir,
      input: 'move.gif',
      outputBase: 'move',
      targetPx: 256,
    });
    expect(made).toMatchObject({
      file: 'move.apng',
      animated: true,
      width: 256,
      height: 192,
      fps: 20,
    });
    expect(made.frames).toBeGreaterThanOrEqual(39);
    expect(made.frames).toBeLessThanOrEqual(41);
    expect(made.durationMs).toBeCloseTo(2_000, -2);
  }, 60_000);

  it('turns a moving WebP into an APNG cut at 6 seconds and 120 frames', async () => {
    await make([
      '-f',
      'lavfi',
      '-i',
      'testsrc2=s=200x200:r=20:d=8',
      '-c:v',
      'libwebp_anim',
      '-loop',
      '0',
      '-quality',
      '40',
      'long.webp',
    ]);
    const made = await normaliseSticker({
      runTool,
      cwd: dir,
      input: 'long.webp',
      outputBase: 'long',
      targetPx: 512,
    });
    expect(made).toMatchObject({
      animated: true,
      width: 200,
      height: 200,
      fps: 20,
      frames: 120,
      durationMs: 6_000,
    });
  }, 60_000);

  it('refuses a picture wider than 4096 px from its header', async () => {
    await make(['-f', 'lavfi', '-i', 'color=c=blue:s=5000x40', '-frames:v', '1', 'wide.png']);
    await expect(
      normaliseSticker({
        runTool,
        cwd: dir,
        input: 'wide.png',
        outputBase: 'wide-out',
        targetPx: 512,
      }),
    ).rejects.toMatchObject({ code: 'sticker_unusable' });
    expect(existsSync(path.join(dir, 'wide-out.png'))).toBe(false);
  }, 60_000);

  it('refuses a file that is not a picture', async () => {
    writeFileSync(path.join(dir, 'fake.png'), 'not a picture at all');
    await expect(
      normaliseSticker({ runTool, cwd: dir, input: 'fake.png', outputBase: 'fake', targetPx: 512 }),
    ).rejects.toMatchObject({ code: 'sticker_unusable' });
  }, 60_000);
});
