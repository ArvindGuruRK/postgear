/**
 * Security sweep, "Uploads" (Sprint 12, Module 20 section 1).
 *
 * What must hold: every uploaded file (video, sound, sticker) is identified
 * by its bytes and probed before FFmpeg opens it; a playlist or a script
 * renamed to a media name is refused; FFmpeg and ffprobe read a person's
 * file only through a protocol allowlist.
 *
 * The first part runs the real ffprobe when it is on PATH (skipped with a
 * warning otherwise, like `ffmpeg/probe.test.ts`). Every hostile file names
 * only local or closed addresses, and the allowlists mean nothing is opened
 * anyway, so the tests never reach a network.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  audioArgs,
  HLS_PROTOCOLS,
  hlsCopyArgs,
  mp3Args,
  normaliseArgs,
  remuxArgs,
} from './downloader/ffmpeg.args';
import {
  buildAnalysisAudioArgs,
  buildDeriveArgs,
  buildFilmstripArgs,
  buildNormaliseArgs,
  buildPosterArgs,
  buildRemuxArgs,
} from './ffmpeg/import';
import { buildProbeArgs, INPUT_FORMAT_ALLOWLIST, probeFile } from './ffmpeg/probe';
import { buildOutputFactsArgs } from './render/output-facts';
import { createRunTool } from './run/runner';
import type { RunTool, ToolName } from './run/types';
import { loudnessArgs } from './signals/loudness';
import { sceneArgs } from './signals/scene';
import {
  buildSoundProbeArgs,
  convertSoundArgs,
  encodeSoundArgs,
  measureSoundArgs,
  peaksDecodeArgs,
  probeSound,
  sniffSoundType,
  trimSoundArgs,
} from './sounds/normalise';
import {
  buildStickerHeaderProbeArgs,
  buildStickerProbeArgs,
  movingStickerArgs,
  previewStickerArgs,
  probeSticker,
  sniffStickerType,
  stillStickerArgs,
} from './stickers/normalise';

/** Text files that are not media but that FFmpeg would happily follow if allowed. */
const HOSTILE_TEXT: Record<string, string> = {
  hls: '#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXTINF:2,\nhttp://127.0.0.1:9/a.ts\n#EXTINF:2,\nfile:../../secret.ts\n#EXT-X-ENDLIST\n',
  ffconcat: "ffconcat version 1.0\nfile '../../secret.mp4'\nfile 'http://127.0.0.1:9/b.mp4'\n",
  dash: '<?xml version="1.0"?><MPD xmlns="urn:mpeg:dash:schema:mpd:2011"><Period><AdaptationSet><Representation><BaseURL>http://127.0.0.1:9/</BaseURL></Representation></AdaptationSet></Period></MPD>\n',
  sdp: 'v=0\no=- 0 0 IN IP4 127.0.0.1\ns=x\nc=IN IP4 127.0.0.1\nt=0 0\nm=video 9 RTP/AVP 96\na=rtpmap:96 H264/90000\n',
  pls: '[playlist]\nFile1=http://127.0.0.1:9/c.mp3\nNumberOfEntries=1\n',
  script: '#!/bin/sh\nrm -rf /\n',
  svg: '<svg xmlns="http://www.w3.org/2000/svg"><image href="file:///etc/passwd"/></svg>\n',
};

const bytes = (text: string): Uint8Array => new Uint8Array(Buffer.from(text, 'utf8'));

/** For every `-i`, the options since the previous input name a protocol allowlist. */
function protocolsPerInput(args: readonly string[]): string[] {
  const found: string[] = [];
  let since = 0;
  args.forEach((arg, i) => {
    if (arg !== '-i') return;
    const options = args.slice(since, i);
    const at = options.lastIndexOf('-protocol_whitelist');
    found.push(at === -1 ? '' : (options[at + 1] as string));
    since = i + 2;
  });
  return found;
}

describe('a renamed playlist or script is refused by its bytes', () => {
  it('is never taken for a sound', () => {
    for (const text of Object.values(HOSTILE_TEXT)) {
      expect(sniffSoundType(bytes(text).subarray(0, 16))).toBeNull();
    }
  });

  it('is never taken for a sticker', () => {
    for (const text of Object.values(HOSTILE_TEXT)) {
      expect(sniffStickerType(bytes(text).subarray(0, 16))).toBeNull();
    }
  });
});

describe('every FFmpeg and ffprobe call on a file reads it through a protocol allowlist', () => {
  const size = { width: 256, height: 256 };
  const plan = {
    mode: 'encode' as const,
    width: 1280,
    height: 720,
    fps: { arg: '30', value: 30 },
    audio: true,
  };

  const ffmpegCalls: Record<string, string[]> = {
    'import remux': buildRemuxArgs('in.mp4', 'out.mp4', plan),
    'import normalise': buildNormaliseArgs('in.mp4', 'out.mp4', plan),
    'import analysis sound': buildAnalysisAudioArgs('in.mp4', 'a.wav'),
    'import filmstrip': buildFilmstripArgs('in.mp4', 'strips', 2000),
    'import derive': buildDeriveArgs({
      input: 'in.mp4',
      outDir: 'strips',
      intervalMs: 2000,
      analysisOut: 'a.wav',
    }),
    'import poster': buildPosterArgs({
      input: 'in.mp4',
      output: 'p.jpg',
      atMs: 1000,
      width: 320,
      height: 180,
    }),
    'download cut': normaliseArgs({
      inFile: 'in.mkv',
      outFile: 'out.mp4',
      startMs: 0,
      durationMs: 1000,
      fps: 30,
    }),
    'download remux': remuxArgs('in.mkv', 'out.mp4', null),
    'download mp3': mp3Args('in.m4a', 'out.mp3'),
    'download audio': audioArgs('in.webm', 'out.m4a', false, null),
    'sound trim': trimSoundArgs('in.mp3', 'out.wav', 2),
    'sound measure': measureSoundArgs('in.mp3'),
    'sound encode': encodeSoundArgs('in.wav', 'out.m4a', { gainDb: 0, durationMs: 2000 }),
    'sound convert': convertSoundArgs('in.mp3', 'out.m4a', 2),
    'sound peaks': peaksDecodeArgs('in.m4a', 'p.wav'),
    'sticker still': stillStickerArgs('in.png', 'out.png', size),
    'sticker moving': movingStickerArgs('in.gif', 'out.png', size, 12),
    'sticker preview': previewStickerArgs('in.png', 'out.webp', false, 1),
    'signals loudness': loudnessArgs('analysis.wav'),
    'signals scene': sceneArgs('proxy.mp4'),
  };

  it.each(Object.entries(ffmpegCalls))('%s: only plain files', (_name, args) => {
    const protocols = protocolsPerInput(args);
    expect(protocols.length).toBeGreaterThan(0);
    for (const value of protocols) {
      expect(value).toBe('file');
    }
  });

  it('the HLS copy of a platform playlist allows the web, never `concat`, `subfile` or `data`', () => {
    const args = hlsCopyArgs({
      playlistFile: 'range.m3u8',
      outFile: 'range.ts',
      headers: {},
      proxy: null,
      reencodeAudio: false,
    });
    expect(protocolsPerInput(args)).toEqual([HLS_PROTOCOLS]);
    for (const banned of ['concat', 'subfile', 'data', 'pipe', 'rtmp', 'udp', 'ftp']) {
      expect(HLS_PROTOCOLS.split(',')).not.toContain(banned);
    }
  });

  const probes: Record<string, string[]> = {
    'video probe': buildProbeArgs('/scratch/original.mp4'),
    'sound probe': buildSoundProbeArgs('upload.mp3'),
    'sticker header probe': buildStickerHeaderProbeArgs('upload.png'),
    'sticker probe': buildStickerProbeArgs('upload.png'),
    'render facts probe': buildOutputFactsArgs('/scratch/render.mp4'),
  };

  it.each(Object.entries(probes))('%s: a demuxer allowlist and only plain files', (_name, args) => {
    expect(args[args.indexOf('-protocol_whitelist') + 1]).toBe('file');
    expect(args).toContain('-format_whitelist');
  });
});

describe('the real ffprobe refuses a renamed playlist or script before FFmpeg opens it', () => {
  const realRunTool = createRunTool({
    ffmpeg: 'ffmpeg',
    ffprobe: 'ffprobe',
    ytDlp: 'yt-dlp',
    jsRuntime: null,
  });
  let dir: string;
  let available = false;
  let started: Array<{ tool: ToolName; args: readonly string[] }> = [];
  const runTool: RunTool = (tool, args, options) => {
    started.push({ tool, args });
    return realRunTool(tool, args, options);
  };

  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'pg-sweep-uploads-'));
    available = await realRunTool('ffprobe', ['-hide_banner', '-version'], {
      cwd: dir,
      timeoutMs: 20_000,
    }).then(
      () => true,
      () => false,
    );
    if (!available)
      console.warn('ffprobe is not on PATH: the real upload refusal tests are skipped.');
  }, 30_000);

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });

  beforeEach(() => {
    started = [];
  });

  const videoNames = ['original.mp4', 'original.mov', 'original.mkv', 'original.webm'];

  it('a video: every hostile file under every video name is upload_not_video, and only ffprobe ran', async () => {
    if (!available) return;
    for (const [kind, text] of Object.entries(HOSTILE_TEXT)) {
      for (const name of videoNames) {
        const file = path.join(dir, `${kind}-${name}`);
        await writeFile(file, text);
        await expect(probeFile(runTool, file, { timeoutMs: 20_000 })).rejects.toMatchObject({
          code: 'upload_not_video',
        });
      }
    }
    expect(started.length).toBe(Object.keys(HOSTILE_TEXT).length * videoNames.length);
    for (const call of started) {
      expect(call.tool).toBe('ffprobe');
      expect(call.args[call.args.indexOf('-format_whitelist') + 1]).toBe(INPUT_FORMAT_ALLOWLIST);
      expect(call.args[call.args.indexOf('-protocol_whitelist') + 1]).toBe('file');
      expect(call.args[call.args.length - 1]).toMatch(/^file:/);
    }
  }, 120_000);

  it('a sound: a playlist behind an MP3 tag is still refused by the probe', async () => {
    if (!available) return;
    // "ID3" passes the byte sniff as MP3; the audio-only demuxer list still refuses the playlist.
    await writeFile(path.join(dir, 'upload.mp3'), `ID3${HOSTILE_TEXT.hls}`);
    await expect(probeSound(runTool, 'upload.mp3', { cwd: dir })).rejects.toMatchObject({
      code: 'sound_unusable',
    });
    expect(started.map((call) => call.tool)).toEqual(['ffprobe']);
  }, 30_000);

  it('a sticker: a playlist behind a GIF header is still refused by the probe', async () => {
    if (!available) return;
    await writeFile(path.join(dir, 'upload.gif'), `GIF89a${HOSTILE_TEXT.hls}`);
    await expect(probeSticker(runTool, 'upload.gif', { cwd: dir })).rejects.toMatchObject({
      code: 'sticker_unusable',
    });
    expect(started.every((call) => call.tool === 'ffprobe')).toBe(true);
  }, 30_000);
});
