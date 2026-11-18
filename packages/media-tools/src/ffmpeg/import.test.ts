import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createRunTool } from '../run/runner';
import {
  buildAnalysisAudioArgs,
  buildDeriveArgs,
  buildFilmstripArgs,
  buildNormaliseArgs,
  buildPosterArgs,
  buildRemuxArgs,
  collectFilmstrip,
  computeWaveformFromWav,
  deriveAnalysisAndFilmstrip,
  filmstripFilter,
  makePoster,
  normaliseVideo,
  planNormalise,
  posterTimeMs,
  readWavHeader,
  targetRate,
  targetSize,
  writeEmptyWaveform,
} from './import';
import { type MediaFacts, probeFile } from './probe';
import { FfmpegError } from './run';

const FACTS: MediaFacts = {
  durationMs: 25_000,
  width: 1280,
  height: 720,
  fps: 30,
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
};

/** Shell syntax that must never appear in an argument (filter text uses commas, colons and brackets only). */
const SHELL_BITS = /(&&|\|\||[|;`<>]|\$\(|\$\{|\r|\n)/;

function expectSafeArgs(args: unknown): void {
  expect(Array.isArray(args)).toBe(true);
  const list = args as unknown[];
  expect(list.length).toBeGreaterThan(5);
  for (const arg of list) {
    expect(typeof arg).toBe('string');
    expect(arg as string).not.toMatch(SHELL_BITS);
  }
  expect(list).not.toContain('-filter_complex_script');
  expect(list).not.toContain('-vsync');
}

function valueAfter(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index < 0 ? undefined : args[index + 1];
}

describe('sizes and rates', () => {
  it('keeps the short side at or under the target, both sides even, never upscaling', () => {
    expect(targetSize(1920, 1080, 720)).toEqual({ width: 1280, height: 720 });
    expect(targetSize(1080, 1920, 720)).toEqual({ width: 720, height: 1280 });
    expect(targetSize(853, 481, 720)).toEqual({ width: 852, height: 480 });
    expect(targetSize(3840, 1634, 480)).toEqual({ width: 1128, height: 480 });
    expect(targetSize(1, 1, 720)).toEqual({ width: 2, height: 2 });
  });

  it('rounds to a whole rate like the sharp range does, and brings fast ones down to 60', () => {
    expect(targetRate(29.97)).toEqual({ arg: '30', value: 30 });
    expect(targetRate(23.976).arg).toBe('24');
    expect(targetRate(59.94).arg).toBe('60');
    expect(targetRate(25)).toEqual({ arg: '25', value: 25 });
    expect(targetRate(120)).toEqual({ arg: '60', value: 60 });
    expect(targetRate(Number.NaN)).toEqual({ arg: '30', value: 30 });
  });
});

describe('planNormalise', () => {
  it('remuxes a file that already fits', () => {
    expect(planNormalise(FACTS, 720)).toMatchObject({ mode: 'remux', width: 1280, height: 720 });
  });

  it.each<[string, Partial<MediaFacts>]>([
    ['too tall', { width: 1920, height: 1080 }],
    ['not H.264', { videoCodec: 'vp9' }],
    ['a variable rate', { constantFrameRate: false }],
    ['a rotation flag', { rotation: 90, width: 720, height: 1280 }],
    ['10-bit colour', { pixelFormat: 'yuv420p10le' }],
    ['Opus sound', { audioCodec: 'opus' }],
    ['Matroska', { container: 'matroska' }],
    ['an odd width', { width: 1279 }],
    ['over 60 fps', { fps: 120 }],
    ['an NTSC rate', { fps: 29.97 }],
  ])('encodes %s', (_label, change) => {
    const plan = planNormalise({ ...FACTS, ...change }, 720);
    expect(plan.mode).toBe('encode');
    expect(plan.width % 2).toBe(0);
    expect(plan.height % 2).toBe(0);
    expect(Math.min(plan.width, plan.height)).toBeLessThanOrEqual(720);
  });

  it('drops sound when the file has none we keep', () => {
    expect(planNormalise({ ...FACTS, hasAudio: false, audioCodec: null }, 720).audio).toBe(false);
  });
});

describe('argument builders', () => {
  const input = path.join(os.tmpdir(), 'job', 'in.mkv');
  const output = path.join(os.tmpdir(), 'job', 'proxy.mp4');

  it('encodes H.264 High and AAC with a constant rate and a closed two second GOP', () => {
    const plan = planNormalise({ ...FACTS, width: 1920, height: 1080, fps: 29.97 }, 720);
    const args = buildNormaliseArgs(input, output, plan);
    expectSafeArgs(args);
    expect(valueAfter(args, '-c:v')).toBe('libx264');
    expect(valueAfter(args, '-profile:v')).toBe('high');
    expect(valueAfter(args, '-pix_fmt')).toBe('yuv420p');
    expect(valueAfter(args, '-g')).toBe('60');
    expect(valueAfter(args, '-keyint_min')).toBe('60');
    expect(valueAfter(args, '-sc_threshold')).toBe('0');
    expect(valueAfter(args, '-flags')).toBe('+cgop');
    expect(valueAfter(args, '-fps_mode')).toBe('cfr');
    expect(valueAfter(args, '-r')).toBe('30');
    expect(valueAfter(args, '-c:a')).toBe('aac');
    expect(valueAfter(args, '-ar')).toBe('48000');
    expect(valueAfter(args, '-movflags')).toBe('+faststart');
    expect(valueAfter(args, '-vf')).toBe(
      'scale=1280:720:flags=bicubic,fps=30,setsar=1,format=yuv420p',
    );
    expect(valueAfter(args, '-progress')).toBe('pipe:1');
    expect(args).toContain('-nostdin');
    expect(valueAfter(args, '-i')?.startsWith('file:')).toBe(true);
    expect(args[args.length - 1].startsWith('file:')).toBe(true);
  });

  it('leaves the sound out of a silent video', () => {
    const plan = planNormalise(
      { ...FACTS, videoCodec: 'vp9', hasAudio: false, audioCodec: null },
      720,
    );
    const args = buildNormaliseArgs(input, output, plan);
    expect(args).toContain('-an');
    expect(args).not.toContain('-c:a');
    expect(args).not.toContain('0:a:0');
  });

  it('remuxes with stream copy and the index first', () => {
    const args = buildRemuxArgs(input, output, planNormalise(FACTS, 720));
    expectSafeArgs(args);
    expect(valueAfter(args, '-c')).toBe('copy');
    expect(valueAfter(args, '-movflags')).toBe('+faststart');
    expect(args).not.toContain('libx264');
  });

  it('writes the analysis sound as 16 kHz mono 16-bit WAV', () => {
    const args = buildAnalysisAudioArgs(input, path.join(os.tmpdir(), 'job', 'analysis.wav'));
    expectSafeArgs(args);
    expect(valueAfter(args, '-ar')).toBe('16000');
    expect(valueAfter(args, '-ac')).toBe('1');
    expect(valueAfter(args, '-c:a')).toBe('pcm_s16le');
    expect(valueAfter(args, '-f')).toBe('wav');
  });

  it('builds filmstrip sheets of 160 by 90 tiles, ten by ten', () => {
    expect(filmstripFilter(5_000)).toBe(
      'fps=fps=1000/5000,scale=160:90:force_original_aspect_ratio=decrease:flags=bilinear,' +
        'pad=160:90:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,tile=10x10',
    );
    const args = buildFilmstripArgs(input, path.join(os.tmpdir(), 'job'), 2_000, {
      keyframesOnly: true,
    });
    expectSafeArgs(args);
    expect(valueAfter(args, '-skip_frame:v')).toBe('nokey');
    expect(valueAfter(args, '-fps_mode')).toBe('passthrough');
    expect(args[args.length - 1]).toMatch(/^file:.*filmstrip-%03d\.jpg$/);
  });

  it('derives both in one decode, or the strip alone for a silent video', () => {
    const both = buildDeriveArgs({
      input,
      outDir: os.tmpdir(),
      intervalMs: 2_000,
      analysisOut: 'a.wav',
    });
    expectSafeArgs(both);
    expect(both.filter((a) => a === '-i')).toHaveLength(1);
    expect(both).toContain('pcm_s16le');
    const silent = buildDeriveArgs({
      input,
      outDir: os.tmpdir(),
      intervalMs: 2_000,
      analysisOut: null,
    });
    expect(silent).not.toContain('pcm_s16le');
  });

  it('takes the poster a tenth of the way in, seeking before the input', () => {
    expect(posterTimeMs(25_000)).toBe(2_500);
    const args = buildPosterArgs({
      input,
      output: 'poster.jpg',
      atMs: 2_500,
      width: 640,
      height: 360,
    });
    expectSafeArgs(args);
    expect(args.indexOf('-ss')).toBeLessThan(args.indexOf('-i'));
    expect(valueAfter(args, '-ss')).toBe('2.500');
    expect(valueAfter(args, '-frames:v')).toBe('1');
  });
});

/** A 16-bit PCM WAV header plus samples, built by hand. */
function wav(samples: Int16Array, sampleRate: number, channels = 1): Buffer {
  const data = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

describe('waveform peaks', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'waveform-test-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes one byte per twentieth of a second, the loudest sample in each', async () => {
    const rate = 16_000;
    // 1.5 s: silence for 0.5 s, half volume for 0.5 s, full volume for 0.5 s.
    const samples = new Int16Array(rate * 1.5);
    for (let i = 0; i < samples.length; i += 1) {
      const level = i < rate / 2 ? 0 : i < rate ? 16_384 : 32_767;
      samples[i] = Math.round(level * Math.sin(i / 3));
    }
    await writeFile(path.join(dir, 'a.wav'), wav(samples, rate));
    const result = await computeWaveformFromWav({
      wavFile: path.join(dir, 'a.wav'),
      output: path.join(dir, 'peaks.bin'),
    });
    expect(result.meta).toEqual({ perSecond: 20, count: 30 });
    const bytes = await readFile(path.join(dir, 'peaks.bin'));
    expect(bytes.length).toBe(30);
    expect(Math.max(...bytes.subarray(0, 10))).toBe(0);
    for (const b of bytes.subarray(10, 20)) expect(Math.abs(b - 128)).toBeLessThanOrEqual(2);
    for (const b of bytes.subarray(20, 30)) expect(b).toBeGreaterThanOrEqual(253);
  });

  it('counts a part-full last bucket and reads stereo', async () => {
    const samples = new Int16Array(8_000 * 2 * 0.12).fill(1000);
    await writeFile(path.join(dir, 's.wav'), wav(samples, 8_000, 2));
    const result = await computeWaveformFromWav({
      wavFile: path.join(dir, 's.wav'),
      output: path.join(dir, 'peaks.bin'),
    });
    expect(result.meta.count).toBe(3);
  });

  it('refuses a file that is not a 16-bit PCM WAV', async () => {
    await writeFile(path.join(dir, 'bad.wav'), 'not a wav at all, just text');
    await expect(readWavHeader(path.join(dir, 'bad.wav'))).rejects.toBeInstanceOf(FfmpegError);
  });

  it('writes an empty waveform for a silent video', async () => {
    const result = await writeEmptyWaveform(path.join(dir, 'empty.bin'));
    expect(result.meta).toEqual({ perSecond: 20, count: 0 });
    expect((await readFile(path.join(dir, 'empty.bin'))).length).toBe(0);
  });

  it('stops when the signal is aborted', async () => {
    await writeFile(path.join(dir, 'a.wav'), wav(new Int16Array(16_000), 16_000));
    const controller = new AbortController();
    controller.abort();
    await expect(
      computeWaveformFromWav({
        wavFile: path.join(dir, 'a.wav'),
        output: path.join(dir, 'p.bin'),
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: 'cancelled' });
  });
});

describe('collectFilmstrip', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'filmstrip-test-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('counts the tiles and removes a stray extra sheet', async () => {
    for (const name of [
      'filmstrip-000.jpg',
      'filmstrip-001.jpg',
      'filmstrip-002.jpg',
      'other.jpg',
    ]) {
      await writeFile(path.join(dir, name), 'x');
    }
    // 250 s at one tile every 2 s is 125 tiles: two sheets.
    const result = await collectFilmstrip(dir, 250_000, 2_000);
    expect(result.meta).toEqual({
      tileWidth: 160,
      tileHeight: 90,
      columns: 10,
      rows: 10,
      intervalMs: 2_000,
      count: 125,
      sheets: 2,
    });
    expect(result.files.map((f) => path.basename(f))).toEqual([
      'filmstrip-000.jpg',
      'filmstrip-001.jpg',
    ]);
    expect(existsSync(path.join(dir, 'filmstrip-002.jpg'))).toBe(false);
  });

  it('fails when FFmpeg wrote no sheet', async () => {
    await expect(collectFilmstrip(dir, 10_000, 2_000)).rejects.toBeInstanceOf(FfmpegError);
  });
});

describe('the import passes with the real FFmpeg', () => {
  const runTool = createRunTool({
    ffmpeg: 'ffmpeg',
    ffprobe: 'ffprobe',
    ytDlp: 'yt-dlp',
    jsRuntime: null,
  });
  let dir: string;
  let available = false;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'import-test-'));
    const make = (args: string[]): Promise<boolean> =>
      runTool('ffmpeg', ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error', ...args], {
        cwd: dir,
        timeoutMs: 120_000,
      }).then(
        () => true,
        () => false,
      );
    // A 25 s Matroska file, 960x540 at 25 fps with Opus sound: it must be encoded.
    available = await make([
      '-f',
      'lavfi',
      '-i',
      'testsrc2=d=25:s=960x540:r=25',
      '-f',
      'lavfi',
      '-i',
      'sine=d=25:frequency=440',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'libopus',
      '-shortest',
      'source.mkv',
    ]);
    if (available) {
      await make([
        '-f',
        'lavfi',
        '-i',
        'testsrc2=d=6:s=320x180:r=30',
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-pix_fmt',
        'yuv420p',
        'silent.mp4',
      ]);
    } else {
      console.warn('FFmpeg is not on PATH: the real import tests are skipped.');
    }
  }, 180_000);

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('normalises, derives, peaks and takes a poster', async () => {
    if (!available) return;
    const sourceFacts = await probeFile(runTool, path.join(dir, 'source.mkv'));
    expect(planNormalise(sourceFacts, 480).mode).toBe('encode');

    const percents: number[] = [];
    const proxy = await normaliseVideo({
      runTool,
      cwd: dir,
      input: path.join(dir, 'source.mkv'),
      output: path.join(dir, 'proxy.mp4'),
      facts: sourceFacts,
      maxShortSide: 480,
      onProgress: (p) => percents.push(p),
    });
    expect(proxy.mode).toBe('encode');
    expect(proxy.meta).toEqual({ width: 852, height: 480, fps: 25 });
    expect(percents.length).toBeGreaterThan(0);
    expect(percents[percents.length - 1]).toBe(100);
    for (let i = 1; i < percents.length; i += 1)
      expect(percents[i]).toBeGreaterThanOrEqual(percents[i - 1]);

    const facts = await probeFile(runTool, proxy.file);
    expect(facts).toMatchObject({
      width: 852,
      height: 480,
      fps: 25,
      constantFrameRate: true,
      videoCodec: 'h264',
      audioCodec: 'aac',
      sampleRate: 48_000,
      container: 'mp4',
    });
    expect(planNormalise(facts, 480).mode).toBe('remux');

    // Keyframes every 2 s exactly: 0, 2, 4 ... 24.
    const keyframes = await runTool(
      'ffprobe',
      [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-skip_frame',
        'nokey',
        '-show_entries',
        'frame=pts_time',
        '-of',
        'csv=p=0',
        'proxy.mp4',
      ],
      { cwd: dir, timeoutMs: 60_000 },
    );
    // A line can carry a trailing comma for side data ("0.000000,").
    const times = keyframes.stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => Number.parseFloat(line));
    expect(times.slice(0, 4)).toEqual([0, 2, 4, 6]);

    const remuxed = await normaliseVideo({
      runTool,
      cwd: dir,
      input: proxy.file,
      output: path.join(dir, 'remuxed.mp4'),
      facts,
      maxShortSide: 480,
    });
    expect(remuxed.mode).toBe('remux');

    const derived = await deriveAnalysisAndFilmstrip({
      runTool,
      cwd: dir,
      input: proxy.file,
      outDir: dir,
      analysisOut: path.join(dir, 'analysis.wav'),
      facts,
      keyframesOnly: true,
    });
    expect(derived.analysisAudio?.meta).toEqual({ sampleRate: 16_000, channels: 1 });
    expect(derived.filmstrip.meta).toMatchObject({ intervalMs: 2_000, count: 13, sheets: 1 });
    const header = await readWavHeader(path.join(dir, 'analysis.wav'));
    expect(header).toMatchObject({ sampleRate: 16_000, channels: 1 });

    const waveform = await computeWaveformFromWav({
      wavFile: path.join(dir, 'analysis.wav'),
      output: path.join(dir, 'waveform.bin'),
    });
    expect(Math.abs(waveform.meta.count - 500)).toBeLessThanOrEqual(1);
    const peaks = await readFile(path.join(dir, 'waveform.bin'));
    // The test tone sits at about an eighth of full scale.
    expect(peaks[100]).toBeGreaterThan(20);

    const poster = await makePoster({
      runTool,
      cwd: dir,
      input: proxy.file,
      output: path.join(dir, 'poster.jpg'),
      facts,
    });
    expect(poster.meta).toEqual({ atMs: 2_500, width: 852, height: 480 });
    expect(poster.bytes).toBeGreaterThan(1_000);
  }, 180_000);

  it('handles a silent video without failing', async () => {
    if (!available) return;
    const facts = await probeFile(runTool, path.join(dir, 'silent.mp4'));
    expect(facts.hasAudio).toBe(false);
    const sub = path.join(dir, 'silent');
    await rm(sub, { recursive: true, force: true });
    await mkdir(sub);
    const derived = await deriveAnalysisAndFilmstrip({
      runTool,
      cwd: sub,
      input: path.join(dir, 'silent.mp4'),
      outDir: sub,
      analysisOut: path.join(sub, 'analysis.wav'),
      facts,
    });
    expect(derived.analysisAudio).toBeNull();
    expect(derived.filmstrip.meta.count).toBe(3);
    expect(existsSync(path.join(sub, 'analysis.wav'))).toBe(false);
  }, 60_000);

  it('stops on abort, says cancelled, and leaves no output', async () => {
    if (!available) return;
    const facts = await probeFile(runTool, path.join(dir, 'source.mkv'));
    const controller = new AbortController();
    const output = path.join(dir, 'cancelled.mp4');
    const pending = normaliseVideo({
      runTool,
      cwd: dir,
      input: path.join(dir, 'source.mkv'),
      output,
      facts: { ...facts, durationMs: 25_000 },
      maxShortSide: 720,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 100);
    const error = (await pending.catch((e: unknown) => e)) as FfmpegError;
    expect(error).toBeInstanceOf(FfmpegError);
    expect(error.code).toBe('cancelled');
    expect(existsSync(output)).toBe(false);
  }, 60_000);
});
