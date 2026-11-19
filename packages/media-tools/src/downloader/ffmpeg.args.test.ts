import { mkdtemp, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createRunTool } from '../run/runner';
import { probeSound } from '../sounds/normalise';
import { MP3_BITRATE, mp3Args } from './ffmpeg.args';

/**
 * Audio Only downloads (Module 18): the MP3 arguments as a fixed list, then
 * one real FFmpeg run when FFmpeg is on PATH (a two second tone made with
 * lavfi, so no outside file is ever read).
 */
describe('mp3Args', () => {
  it('encodes the first sound to a 192 kbps MP3 with no picture and no tags', () => {
    expect(mp3Args('in.m4a', 'out.mp3')).toEqual([
      '-hide_banner',
      '-nostdin',
      '-y',
      '-nostats',
      '-progress',
      'pipe:1',
      '-loglevel',
      'error',
      '-protocol_whitelist',
      'file',
      '-i',
      'in.m4a',
      '-map',
      '0:a:0',
      '-vn',
      '-map_metadata',
      '-1',
      '-c:a',
      'libmp3lame',
      '-b:a',
      '192k',
      '-f',
      'mp3',
      'out.mp3',
    ]);
    expect(MP3_BITRATE).toBe('192k');
  });
});

describe('mp3Args with FFmpeg', () => {
  const runTool = createRunTool({
    ffmpeg: process.env.FFMPEG_PATH || 'ffmpeg',
    ffprobe: process.env.FFPROBE_PATH || 'ffprobe',
    ytDlp: 'yt-dlp',
    jsRuntime: null,
  });
  let dir: string;
  let available = false;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'mp3-args-'));
    available = await runTool('ffmpeg', ['-hide_banner', '-version'], {
      cwd: dir,
      timeoutMs: 20_000,
    })
      .then(() => true)
      .catch(() => false);
    if (!available) console.warn('FFmpeg is not on PATH: the real MP3 test is skipped.');
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('turns an M4A into an MP3 that ffprobe reads as MP3 of the same length', async () => {
    if (!available) return;
    await runTool(
      'ffmpeg',
      [
        '-hide_banner',
        '-nostdin',
        '-loglevel',
        'error',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:duration=2',
        '-c:a',
        'aac',
        '-f',
        'mp4',
        'tone.m4a',
      ],
      { cwd: dir, timeoutMs: 30_000 },
    );
    await runTool('ffmpeg', mp3Args('tone.m4a', 'tone.mp3'), { cwd: dir, timeoutMs: 30_000 });
    const facts = await probeSound(runTool, path.join(dir, 'tone.mp3'), { cwd: dir });
    expect(facts.codec).toBe('mp3');
    expect(Math.abs(facts.durationMs - 2_000)).toBeLessThan(150);
  }, 60_000);
});
