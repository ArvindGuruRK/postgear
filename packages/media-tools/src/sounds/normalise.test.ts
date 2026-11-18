import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { toolPaths } from '../run/paths';
import { createRunTool } from '../run/runner';
import type { RunTool, ToolPaths } from '../run/types';
import {
  buildSoundProbeArgs,
  convertSoundArgs,
  convertUploadedSound,
  encodeSoundArgs,
  measureSound,
  normaliseSound,
  parseEbur128Summary,
  peaksDecodeArgs,
  probeSound,
  SOUND_FORMAT_ALLOWLIST,
  SOUND_LIMITS,
  SoundError,
  sniffSoundType,
  soundFactsFromProbe,
  soundGainDb,
  soundLengthProblem,
  soundPeaksFromWav,
  stereoFilter,
  trimSoundArgs,
} from './normalise';

describe('what a sound file really is', () => {
  const bytes = (...values: number[]) => Uint8Array.from(values);
  const text = (value: string, pad = 16) =>
    Uint8Array.from([...value].map((c) => c.charCodeAt(0)).concat(new Array(pad).fill(0)));

  it('knows WAV, M4A, OGG, FLAC, MP3 (tagged or not) and ADTS AAC by their first bytes', () => {
    expect(sniffSoundType(text('RIFF\u0000\u0000\u0000\u0000WAVEfmt '))).toBe('wav');
    expect(sniffSoundType(text('\u0000\u0000\u0000 ftypM4A '))).toBe('m4a');
    expect(sniffSoundType(text('OggS'))).toBe('ogg');
    expect(sniffSoundType(text('fLaC'))).toBe('flac');
    expect(sniffSoundType(text('ID3\u0004'))).toBe('mp3');
    // MPEG-1 layer III frame sync.
    expect(sniffSoundType(bytes(0xff, 0xfb, 0x90, 0x64))).toBe('mp3');
    // ADTS AAC, MPEG-4, no CRC.
    expect(sniffSoundType(bytes(0xff, 0xf1, 0x50, 0x80))).toBe('aac');
  });

  it('refuses text, pictures and anything shorter than a header', () => {
    expect(sniffSoundType(text('hello, this is not a sound'))).toBeNull();
    expect(sniffSoundType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBeNull();
    expect(sniffSoundType(bytes(0xff))).toBeNull();
    // MPEG layer II is not a sound we take.
    expect(sniffSoundType(bytes(0xff, 0xfd, 0x90, 0x64))).toBeNull();
  });
});

describe('reading a sound with ffprobe', () => {
  const json = (streams: Array<Record<string, unknown>>, duration = '2.5') => ({
    streams,
    format: { format_name: 'mp3', duration },
  });

  it('reads with only the audio demuxers, from a file', () => {
    const args = buildSoundProbeArgs('in.mp3');
    expect(args).toEqual(expect.arrayContaining(['-format_whitelist', SOUND_FORMAT_ALLOWLIST]));
    expect(args).toEqual(expect.arrayContaining(['-protocol_whitelist', 'file']));
    expect(args.at(-1)).toBe('file:in.mp3');
  });

  it('takes a sound with a cover picture, and refuses a video, no sound or an unknown codec', () => {
    expect(
      soundFactsFromProbe(
        json([
          { codec_type: 'audio', codec_name: 'mp3', sample_rate: '44100', channels: 2 },
          { codec_type: 'video', codec_name: 'mjpeg', disposition: { attached_pic: 1 } },
        ]),
      ),
    ).toEqual({ format: 'mp3', codec: 'mp3', durationMs: 2500, sampleRate: 44100, channels: 2 });
    expect(() =>
      soundFactsFromProbe(
        json([
          { codec_type: 'audio', codec_name: 'aac', sample_rate: '48000', channels: 2 },
          { codec_type: 'video', codec_name: 'h264', disposition: { attached_pic: 0 } },
        ]),
      ),
    ).toThrow(SoundError);
    expect(() => soundFactsFromProbe(json([]))).toThrow(SoundError);
    expect(() =>
      soundFactsFromProbe(
        json([{ codec_type: 'audio', codec_name: 'dts', sample_rate: '48000', channels: 6 }]),
      ),
    ).toThrow(SoundError);
    expect(() =>
      soundFactsFromProbe(
        json([{ codec_type: 'audio', codec_name: 'mp3', sample_rate: '44100', channels: 2 }], '0'),
      ),
    ).toThrow(SoundError);
  });
});

describe('the FFmpeg arguments', () => {
  it('duplicates a mono source at full level, keeps stereo, and mixes more channels down', () => {
    expect(stereoFilter(1)).toBe('pan=stereo|c0=c0|c1=c0');
    expect(stereoFilter(2)).toBeNull();
    expect(stereoFilter(6)).toBe('aformat=channel_layouts=stereo');
  });

  it('trims silence at both ends into a float WAV, safely', () => {
    expect(trimSoundArgs('in.ogg', 'x.trimmed.wav', 1)).toMatchSnapshot();
  });

  it('encodes AAC-LC 128 kbps, 48 kHz, two channels, .m4a, with the gain, 5 ms fades and no tags', () => {
    const args = encodeSoundArgs('x.trimmed.wav', 'out.m4a', { gainDb: -4.256, durationMs: 1500 });
    expect(args).toMatchSnapshot();
    expect(args.join(' ')).toContain(
      'volume=-4.26dB,afade=t=in:st=0:d=0.005,afade=t=out:st=1.495:d=0.005',
    );
    expect(args).toEqual(
      expect.arrayContaining(['-map_metadata', '-1', '-c:a', 'aac', '-b:a', '128k']),
    );
    // No gain filter when there is nothing to change.
    expect(
      encodeSoundArgs('a.wav', 'b.m4a', { gainDb: 0, durationMs: 1000 }).join(' '),
    ).not.toContain('volume=');
  });

  it('converts an upload without touching its level, and decodes peaks from one 16 kHz channel', () => {
    const convert = convertSoundArgs('upload.mp3', 'sound.m4a', 1);
    expect(convert.join(' ')).toContain('-af pan=stereo|c0=c0|c1=c0,aresample=48000');
    expect(convert.join(' ')).not.toContain('volume=');
    expect(peaksDecodeArgs('sound.m4a', 'p.wav').join(' ')).toContain(
      '-af pan=mono|c0=0.5*c0+0.5*c1,aresample=16000',
    );
  });
});

describe('levels and lengths', () => {
  const summary = [
    '[Parsed_ebur128_0 @ 0000] Summary:',
    '',
    '  Integrated loudness:',
    '    I:         -23.4 LUFS',
    '    Threshold: -33.6 LUFS',
    '',
    '  Loudness range:',
    '    LRA:         2.1 LU',
    '',
    '  Sample peak:',
    '    Peak:       -6.2 dBFS',
    '',
    '  True peak:',
    '    Peak:       -5.9 dBFS',
  ];

  it("reads ebur128's summary, and an ungated loudness as none", () => {
    expect(parseEbur128Summary(summary)).toEqual({
      loudnessLufs: -23.4,
      samplePeakDb: -6.2,
      truePeakDb: -5.9,
    });
    const quiet = summary.map((line) => line.replace('-23.4 LUFS', '-70.0 LUFS'));
    expect(parseEbur128Summary(quiet).loudnessLufs).toBeNull();
    expect(parseEbur128Summary(['no summary here'])).toEqual({
      loudnessLufs: null,
      samplePeakDb: null,
      truePeakDb: null,
    });
  });

  it('peak-normalises short effects to -3 dBFS and levels the rest to -16 LUFS under a -1.5 dB peak', () => {
    const levels = { loudnessLufs: -23.4, samplePeakDb: -6.2, truePeakDb: -5.9 };
    expect(soundGainDb(levels, { kind: 'sfx', category: 'impacts', durationMs: 800 })).toBeCloseTo(
      3.2,
    );
    // Music: 7.4 dB would reach -16 LUFS, the peak allows 4.4 dB, so the peak wins.
    expect(
      soundGainDb(levels, { kind: 'music', category: 'calm', durationMs: 20_000 }),
    ).toBeCloseTo(4.4);
    // Ambient sounds are levelled like music, however short.
    expect(
      soundGainDb(levels, { kind: 'sfx', category: 'ambient', durationMs: 2_000 }),
    ).toBeCloseTo(4.4);
    const soft = { loudnessLufs: -30, samplePeakDb: -20, truePeakDb: -20 };
    expect(soundGainDb(soft, { kind: 'music', category: 'calm', durationMs: 20_000 })).toBeCloseTo(
      14,
    );
    // Too short to gate: levelled by its peak; silence: nothing to level.
    expect(
      soundGainDb(
        { loudnessLufs: null, samplePeakDb: -12, truePeakDb: -11 },
        { kind: 'sfx', category: 'gaming', durationMs: 5_000 },
      ),
    ).toBeCloseTo(10.5);
    expect(
      soundGainDb(
        { loudnessLufs: null, samplePeakDb: null, truePeakDb: null },
        { kind: 'sfx', category: 'alerts', durationMs: 500 },
      ),
    ).toBeNull();
  });

  it('allows effects of 0.1 to 15 s and music of 5 s to 10 minutes', () => {
    expect(soundLengthProblem('sfx', 99)).toBe('sound_too_short');
    expect(soundLengthProblem('sfx', 100)).toBeNull();
    expect(soundLengthProblem('sfx', 15_001)).toBe('sound_too_long');
    expect(soundLengthProblem('music', 4_999)).toBe('sound_too_short');
    expect(soundLengthProblem('music', SOUND_LIMITS.musicMaxMs)).toBeNull();
    expect(soundLengthProblem('music', SOUND_LIMITS.musicMaxMs + 1)).toBe('sound_too_long');
  });
});

describe('peaks', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'pg-sound-peaks-'));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  function wav(samples: number[], channels = 1): string {
    const data = Buffer.alloc(samples.length * 2);
    samples.forEach((value, k) => {
      data.writeInt16LE(value, k * 2);
    });
    const head = Buffer.alloc(44);
    head.write('RIFF', 0, 'ascii');
    head.writeUInt32LE(36 + data.length, 4);
    head.write('WAVE', 8, 'ascii');
    head.write('fmt ', 12, 'ascii');
    head.writeUInt32LE(16, 16);
    head.writeUInt16LE(1, 20);
    head.writeUInt16LE(channels, 22);
    head.writeUInt32LE(16_000, 24);
    head.writeUInt32LE(16_000 * 2 * channels, 28);
    head.writeUInt16LE(2 * channels, 32);
    head.writeUInt16LE(16, 34);
    head.write('data', 36, 'ascii');
    head.writeUInt32LE(data.length, 40);
    const file = path.join(dir, `p${Math.random().toString(16).slice(2)}.wav`);
    writeFileSync(file, Buffer.concat([head, data]));
    return file;
  }

  it('gives 100 values, the loudest sample of any channel in each hundredth', async () => {
    const samples = new Array<number>(1_000).fill(0);
    samples[5] = 32767;
    samples[995] = -16384;
    const peaks = await soundPeaksFromWav(wav(samples));
    expect(peaks).toHaveLength(100);
    expect(peaks[0]).toBe(255);
    expect(peaks[99]).toBe(128);
    expect(peaks.slice(1, 99).every((value) => value === 0)).toBe(true);
    // Stereo: the louder channel counts.
    const stereo = await soundPeaksFromWav(wav([1000, -32000, 0, 0], 2), 2);
    expect(stereo).toEqual([249, 0]);
  });

  it('repeats a very short sound so there are always 100', async () => {
    const peaks = await soundPeaksFromWav(wav([16384, 0, 32767]));
    expect(peaks).toHaveLength(100);
    expect(peaks[0]).toBe(128);
    expect(peaks[99]).toBe(255);
  });
});

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
  console.warn('Sound tests with FFmpeg skipped: ffmpeg and ffprobe are not on the PATH.');

describeWithFfmpeg('normaliseSound and convertUploadedSound (real FFmpeg)', () => {
  let dir: string;
  let runTool: RunTool;

  async function make(args: string[]): Promise<void> {
    await runTool('ffmpeg', ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error', ...args], {
      cwd: dir,
      timeoutMs: 60_000,
    });
  }

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'pg-sound-real-'));
    runTool = createRunTool(PATHS as ToolPaths);
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('trims the silence off a quiet mono blip, peaks it at -3 dBFS and makes a stereo 48 kHz .m4a', async () => {
    // Half a second of silence, a 0.6 s 880 Hz blip at about -20 dBFS, then a second of silence.
    await make([
      '-f',
      'lavfi',
      '-i',
      "aevalsrc=exprs='0.1*sin(2*PI*880*t)*between(t,0.5,1.1)':s=44100:d=2.1",
      '-c:a',
      'pcm_s16le',
      'blip.wav',
    ]);
    const made = await normaliseSound({
      runTool,
      cwd: dir,
      input: 'blip.wav',
      output: 'blip.m4a',
      kind: 'sfx',
      category: 'alerts',
    });
    expect(made.file).toBe('blip.m4a');
    expect(made.durationMs).toBeGreaterThanOrEqual(550);
    expect(made.durationMs).toBeLessThanOrEqual(700);
    expect(made.truePeakDb).toBeGreaterThan(-4);
    expect(made.truePeakDb).toBeLessThan(-1.5);
    expect(made.peaks).toHaveLength(100);
    expect(Math.max(...made.peaks)).toBeGreaterThan(150);
    expect(made.bytes).toBe(statSync(path.join(dir, 'blip.m4a')).size);
    const facts = await probeSound(runTool, 'blip.m4a', { cwd: dir });
    expect(facts).toMatchObject({ codec: 'aac', sampleRate: 48_000, channels: 2 });
    // Mono duplicated at full level: both channels as loud as the source would be on its own.
    const levels = await measureSound(runTool, 'blip.m4a', { cwd: dir });
    expect(levels.samplePeakDb).toBeGreaterThan(-3.6);
  }, 60_000);

  it('levels a quiet music loop to about -16 LUFS without going over -1.5 dB', async () => {
    await make([
      '-f',
      'lavfi',
      '-i',
      "aevalsrc=exprs='0.05*sin(2*PI*220*t)+0.05*sin(2*PI*330*t)*(0.5+0.5*sin(2*PI*2*t))':s=48000:d=8",
      '-ac',
      '2',
      '-c:a',
      'pcm_s16le',
      'loop.wav',
    ]);
    const made = await normaliseSound({
      runTool,
      cwd: dir,
      input: 'loop.wav',
      output: 'loop.m4a',
      kind: 'music',
      category: 'calm',
    });
    expect(made.durationMs).toBeGreaterThan(7_900);
    expect(made.loudnessLufs).toBeGreaterThan(-17.5);
    expect(made.loudnessLufs).toBeLessThan(-14.5);
    expect(made.truePeakDb).toBeLessThanOrEqual(-1);
  }, 60_000);

  it('refuses a music loop shorter than 5 s, and a text file named .mp3', async () => {
    await make(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', 'short.wav']);
    await expect(
      normaliseSound({
        runTool,
        cwd: dir,
        input: 'short.wav',
        output: 'short.m4a',
        kind: 'music',
        category: 'calm',
      }),
    ).rejects.toMatchObject({ code: 'sound_too_short' });
    writeFileSync(
      path.join(dir, 'fake.mp3'),
      'this is just some text pretending to be a song\n'.repeat(50),
    );
    await expect(
      convertUploadedSound({ runTool, cwd: dir, input: 'fake.mp3', output: 'fake.m4a' }),
    ).rejects.toMatchObject({ code: 'sound_unusable' });
  }, 60_000);

  it("converts an uploaded MP3 to the editor's format, keeping its level, with its peaks", async () => {
    await make([
      '-f',
      'lavfi',
      '-i',
      "aevalsrc=exprs='0.5*sin(2*PI*330*t)':s=44100:d=3",
      '-c:a',
      'libmp3lame',
      '-b:a',
      '128k',
      'upload.mp3',
    ]);
    const made = await convertUploadedSound({
      runTool,
      cwd: dir,
      input: 'upload.mp3',
      output: 'upload.m4a',
    });
    expect(made.durationMs).toBeGreaterThan(2_900);
    expect(made.durationMs).toBeLessThan(3_200);
    expect(made.peaks).toHaveLength(100);
    // About -6 dBFS kept: 0.5 of full scale is about 128 of 255.
    expect(Math.max(...made.peaks)).toBeGreaterThan(110);
    expect(Math.max(...made.peaks)).toBeLessThan(150);
    expect(await probeSound(runTool, 'upload.m4a', { cwd: dir })).toMatchObject({
      codec: 'aac',
      sampleRate: 48_000,
      channels: 2,
    });
  }, 60_000);
});
