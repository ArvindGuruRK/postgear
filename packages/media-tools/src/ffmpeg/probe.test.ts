import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createRunTool } from '../run/runner';
import { type RunTool, type RunToolResult, ToolError } from '../run/types';
import {
  buildProbeArgs,
  fileInput,
  INPUT_FORMAT_ALLOWLIST,
  mediaFactsFromProbe,
  ProbeError,
  probeFile,
} from './probe';

/** Trimmed from real ffprobe 9.0.2 output (`-show_format -show_streams`), extra fields kept on purpose. */
function recordedMp4(
  overrides: { video?: object; audio?: object | null; format?: object } = {},
): unknown {
  const streams: object[] = [
    {
      index: 0,
      codec_name: 'h264',
      codec_long_name: 'H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10',
      profile: 'High',
      codec_type: 'video',
      codec_tag_string: 'avc1',
      width: 1280,
      height: 720,
      pix_fmt: 'yuv420p',
      r_frame_rate: '30000/1001',
      avg_frame_rate: '30000/1001',
      time_base: '1/30000',
      duration: '25.000000',
      disposition: { default: 1, attached_pic: 0 },
      tags: { language: 'und', handler_name: 'VideoHandler' },
      ...overrides.video,
    },
  ];
  if (overrides.audio !== null) {
    streams.push({
      index: 1,
      codec_name: 'aac',
      codec_type: 'audio',
      sample_fmt: 'fltp',
      sample_rate: '48000',
      channels: 2,
      channel_layout: 'stereo',
      duration: '25.000000',
      disposition: { default: 1, attached_pic: 0 },
      ...overrides.audio,
    });
  }
  return {
    streams,
    format: {
      filename: 'C:/secret/scratch/proxy.mp4',
      nb_streams: streams.length,
      format_name: 'mov,mp4,m4a,3gp,3g2,mj2',
      format_long_name: 'QuickTime / MOV',
      duration: '25.000000',
      size: '2770237',
      bit_rate: '886472',
      tags: { major_brand: 'isom', minor_version: '512', encoder: 'Lavf62.3.100' },
      ...overrides.format,
    },
  };
}

describe('mediaFactsFromProbe', () => {
  it('maps a normal MP4 to facts, keeping only the allowlisted fields', () => {
    expect(mediaFactsFromProbe(recordedMp4())).toEqual({
      durationMs: 25_000,
      width: 1280,
      height: 720,
      fps: 29.97,
      constantFrameRate: true,
      rotation: 0,
      videoCodec: 'h264',
      pixelFormat: 'yuv420p',
      hasAudio: true,
      audioCodec: 'aac',
      sampleRate: 48_000,
      audioChannels: 2,
      bitRate: 886_472,
      container: 'mp4',
    });
  });

  it('applies a phone rotation from the display matrix (counter-clockwise) to the size', () => {
    const facts = mediaFactsFromProbe(
      recordedMp4({
        video: {
          side_data_list: [{ side_data_type: 'Display Matrix', displaymatrix: 'x', rotation: -90 }],
        },
      }),
    );
    expect(facts).toMatchObject({ rotation: 90, width: 720, height: 1280 });
    const other = mediaFactsFromProbe(
      recordedMp4({
        video: { side_data_list: [{ side_data_type: 'Display Matrix', rotation: 90 }] },
      }),
    );
    expect(other.rotation).toBe(270);
  });

  it('reads the old clockwise rotate tag', () => {
    const facts = mediaFactsFromProbe(recordedMp4({ video: { tags: { rotate: '180' } } }));
    expect(facts).toMatchObject({ rotation: 180, width: 1280, height: 720 });
  });

  it('tells MOV from MP4 by the brand and reads Matroska', () => {
    expect(
      mediaFactsFromProbe(recordedMp4({ format: { tags: { major_brand: 'qt  ' } } })).container,
    ).toBe('mov');
    expect(
      mediaFactsFromProbe(recordedMp4({ format: { format_name: 'matroska,webm', tags: {} } }))
        .container,
    ).toBe('matroska');
  });

  it('flags a variable frame rate', () => {
    const facts = mediaFactsFromProbe(
      recordedMp4({ video: { r_frame_rate: '30/1', avg_frame_rate: '2997/125' } }),
    );
    expect(facts.constantFrameRate).toBe(false);
    expect(facts.fps).toBe(23.976);
  });

  it('keeps a video whose sound we cannot use, without the sound', () => {
    const facts = mediaFactsFromProbe(recordedMp4({ audio: { codec_name: 'truehd' } }));
    expect(facts).toMatchObject({ hasAudio: false, audioCodec: null, sampleRate: null });
    expect(mediaFactsFromProbe(recordedMp4({ audio: null })).hasAudio).toBe(false);
  });

  it.each([
    [
      'a file with no video stream',
      {
        streams: [{ codec_type: 'audio', codec_name: 'aac' }],
        format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: '3' },
      },
    ],
    [
      'cover art only',
      recordedMp4({ video: { codec_name: 'mjpeg', disposition: { attached_pic: 1 } } }),
    ],
    ['an HLS playlist', recordedMp4({ format: { format_name: 'hls' } })],
    ['an image sequence', recordedMp4({ format: { format_name: 'image2' } })],
    ['an unknown video codec', recordedMp4({ video: { codec_name: 'gif' } })],
    ['no length', recordedMp4({ format: { duration: 'N/A' }, video: { duration: undefined } })],
    ['a zero size', recordedMp4({ video: { width: 0, height: 0 } })],
    ['an absurd size', recordedMp4({ video: { width: 20000 } })],
    ['no frame rate', recordedMp4({ video: { r_frame_rate: '0/0', avg_frame_rate: '0/0' } })],
    ['nonsense', { hello: 'world' }],
    ['null', null],
  ])('refuses %s as upload_not_video', (_label, json) => {
    expect(() => mediaFactsFromProbe(json)).toThrow(ProbeError);
    try {
      mediaFactsFromProbe(json);
    } catch (error) {
      expect((error as ProbeError).code).toBe('upload_not_video');
    }
  });
});

describe('buildProbeArgs', () => {
  it('reads with the demuxer and protocol allowlists and the file: prefix', () => {
    const args = buildProbeArgs(path.join(os.tmpdir(), '-dangerous name.mp4'));
    expect(args).toContain('-format_whitelist');
    expect(args).toContain(INPUT_FORMAT_ALLOWLIST);
    expect(args[args.indexOf('-protocol_whitelist') + 1]).toBe('file');
    const last = args[args.length - 1];
    expect(last.startsWith('file:')).toBe(true);
    expect(last).not.toContain('\\');
  });

  it('turns Windows separators into forward slashes', () => {
    expect(fileInput(['C:', 'work', 'a.mp4'].join(path.sep))).toBe('file:C:/work/a.mp4');
  });
});

describe('probeFile with a fake runner', () => {
  const ok = (stdout: string): RunToolResult => ({
    exitCode: 0,
    stdout,
    stderrTail: '',
    durationMs: 5,
  });

  it('runs ffprobe with the safe arguments and maps the answer', async () => {
    const calls: Array<{ tool: string; args: readonly string[]; cwd: string }> = [];
    const fake: RunTool = async (tool, args, options) => {
      calls.push({ tool, args, cwd: options.cwd });
      return ok(JSON.stringify(recordedMp4()));
    };
    const facts = await probeFile(fake, '/scratch/job/in.mp4');
    expect(facts.durationMs).toBe(25_000);
    expect(calls[0].tool).toBe('ffprobe');
    expect(calls[0].cwd).toBe(path.dirname('/scratch/job/in.mp4'));
  });

  it.each([
    [
      'ffprobe said no',
      new ToolError({ tool: 'ffprobe', exitCode: 1, stderrTail: 'moov atom not found' }),
      'upload_not_video',
    ],
    ['a cancel', new ToolError({ tool: 'ffprobe', exitCode: null, aborted: true }), 'cancelled'],
    [
      'a timeout',
      new ToolError({ tool: 'ffprobe', exitCode: null, timedOut: true }),
      'tool_failed',
    ],
    ['something else', new Error('spawn failed'), 'tool_failed'],
  ])('maps %s', async (_label, thrown, code) => {
    const fake: RunTool = async () => {
      throw thrown;
    };
    const error = (await probeFile(fake, '/x/in.mp4').catch((e: unknown) => e)) as ProbeError;
    expect(error).toBeInstanceOf(ProbeError);
    expect(error.code).toBe(code);
    expect(error.message).not.toContain('moov');
  });

  it('refuses output that is not JSON', async () => {
    const fake: RunTool = async () => ok('not json');
    await expect(probeFile(fake, '/x/in.mp4')).rejects.toMatchObject({ code: 'upload_not_video' });
  });
});

describe('probeFile with the real ffprobe', () => {
  const runTool = createRunTool({
    ffmpeg: 'ffmpeg',
    ffprobe: 'ffprobe',
    ytDlp: 'yt-dlp',
    jsRuntime: null,
  });
  let dir: string;
  let available = false;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'probe-test-'));
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
        'testsrc2=d=2:s=320x180:r=25',
        '-f',
        'lavfi',
        '-i',
        'sine=d=2:sample_rate=44100',
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-shortest',
        'sample.mp4',
      ],
      { cwd: dir, timeoutMs: 60_000 },
    ).then(
      () => true,
      () => false,
    );
    if (!available) console.warn('FFmpeg is not on PATH: the real probe tests are skipped.');
    // As long as the ffmpeg call may take: Jest's 5 s default is too short on a busy machine.
  }, 60_000);

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });

  it('reads a real MP4', async () => {
    if (!available) return;
    const facts = await probeFile(runTool, path.join(dir, 'sample.mp4'));
    expect(facts).toMatchObject({
      width: 320,
      height: 180,
      fps: 25,
      videoCodec: 'h264',
      hasAudio: true,
      audioCodec: 'aac',
      container: 'mp4',
    });
    expect(Math.abs(facts.durationMs - 2_000)).toBeLessThan(100);
  });

  it('refuses a text file named video.mp4 and an HLS playlist', async () => {
    if (!available) return;
    await writeFile(path.join(dir, 'video.mp4'), 'just some text');
    await writeFile(
      path.join(dir, 'list.m3u8'),
      '#EXTM3U\n#EXTINF:2,\nsample.mp4\n#EXT-X-ENDLIST\n',
    );
    await expect(probeFile(runTool, path.join(dir, 'video.mp4'))).rejects.toMatchObject({
      code: 'upload_not_video',
    });
    await expect(probeFile(runTool, path.join(dir, 'list.m3u8'))).rejects.toMatchObject({
      code: 'upload_not_video',
    });
  });
});
