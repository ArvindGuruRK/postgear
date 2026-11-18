import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { LinkRef } from '@postgear/video-engine';
import kickStream from '../../fixtures/ytdlp/probe-kick-stream.json';
import twitchStream from '../../fixtures/ytdlp/probe-twitch-stream.json';
import youtubeTalk from '../../fixtures/ytdlp/probe-youtube-talk.json';
import { type RunTool, type RunToolOptions, ToolError, type ToolName } from '../run/types';
import type { FetchText } from './fetch-text';
import { DownloaderError, type FetchProgress } from './types';
import { createYtDlpDownloader } from './yt-dlp.downloader';

interface Call {
  tool: ToolName;
  args: readonly string[];
  options: RunToolOptions;
}

const paths = { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe', ytDlp: 'yt-dlp', jsRuntime: null };

/**
 * A scripted yt-dlp and FFmpeg: `-J` prints the given probe JSON (or fails
 * with the given stderr), a download writes `<stem>.<ext>` and prints
 * progress lines, FFmpeg writes its last argument. Nothing is executed.
 */
function scriptedRunTool(
  calls: Call[],
  script: {
    probe: unknown;
    probeError?: string;
    downloadExt?: string;
    downloadWritesNothing?: boolean;
  },
): RunTool {
  return async (tool, args, options) => {
    calls.push({ tool, args: [...args], options });
    if (tool === 'yt-dlp' && args.includes('--dump-single-json')) {
      if (script.probeError) {
        throw new ToolError({ tool, exitCode: 1, stderrTail: script.probeError });
      }
      return {
        exitCode: 0,
        stdout: `${JSON.stringify(script.probe)}\n`,
        stderrTail: '',
        durationMs: 1,
      };
    }
    if (tool === 'yt-dlp') {
      const template = args[args.indexOf('-o') + 1] as string;
      options.onStdoutLine?.('PG|downloading|500|1000|NA|NA|NA|5');
      options.onStdoutLine?.('PG|finished|1000|1000|NA|NA|NA|0');
      if (!script.downloadWritesNothing) {
        await writeFile(
          template.replace('%(ext)s', script.downloadExt ?? 'mp4'),
          Buffer.alloc(100, 2),
        );
      }
      return { exitCode: 0, stdout: '', stderrTail: '', durationMs: 1 };
    }
    options.onStdoutLine?.('out_time_us=1000000');
    await writeFile(args[args.length - 1] as string, Buffer.alloc(80, 3));
    return { exitCode: 0, stdout: '', stderrTail: '', durationMs: 1 };
  };
}

const youtube: LinkRef = {
  platform: 'youtube',
  kind: 'video',
  externalId: 'simtalk0001',
  canonicalUrl: 'https://www.youtube.com/watch?v=simtalk0001',
};
const twitch: LinkRef = {
  platform: 'twitch',
  kind: 'past_stream',
  externalId: '900000001',
  canonicalUrl: 'https://www.twitch.tv/videos/900000001',
};
const kick: LinkRef = {
  platform: 'kick',
  kind: 'past_stream',
  externalId: '00000000-0000-4000-8000-000000000001',
  canonicalUrl: 'https://kick.com/simstreamer/videos/00000000-0000-4000-8000-000000000001',
};

const PLAYLIST = ['#EXTM3U', '#EXT-X-TARGETDURATION:10']
  .concat(Array.from({ length: 60 }, (_, i) => [`#EXTINF:10.000,`, `${i}.ts`]).flat())
  .concat('#EXT-X-ENDLIST')
  .join('\n');

describe('createYtDlpDownloader', () => {
  let dir: string;
  let calls: Call[];
  const signal = new AbortController().signal;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'pg-ytdlp-'));
    calls = [];
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('probes with the canonical link after -- and maps the answer', async () => {
    const downloader = createYtDlpDownloader({
      paths,
      runTool: scriptedRunTool(calls, { probe: youtubeTalk }),
      scratchDir: dir,
    });
    expect(downloader.simulated).toBe(false);
    const info = await downloader.probe(youtube, signal);
    expect(info.durationMs).toBe(180_000);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args.slice(-2)).toEqual(['--', youtube.canonicalUrl]);
    expect(calls[0]?.options.timeoutMs).toBeLessThanOrEqual(20_000);
  });

  it('maps a probe failure to our code without the tool text', async () => {
    const downloader = createYtDlpDownloader({
      paths,
      runTool: scriptedRunTool(calls, {
        probe: null,
        probeError: "ERROR: [youtube] x: Sign in to confirm you're not a bot",
      }),
      scratchDir: dir,
    });
    const error = await downloader.probe(youtube, signal).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DownloaderError);
    expect((error as DownloaderError).code).toBe('platform_resting');
    expect((error as Error).message).not.toContain('bot');
  });

  it('fetches a proxy: probe, length check, our ids, a size watch, and the file moved into place', async () => {
    const downloader = createYtDlpDownloader({
      paths,
      runTool: scriptedRunTool(calls, { probe: youtubeTalk }),
      scratchDir: dir,
    });
    const seen: FetchProgress[] = [];
    const out = path.join(dir, 'proxy.mp4');
    const file = await downloader.fetchProxy(
      {
        link: youtube,
        maxHeight: 720,
        outFile: out,
        maxBytes: 1_000_000,
        maxDurationMs: 7_200_000,
      },
      (p) => seen.push(p),
      signal,
    );
    expect(file).toEqual({ path: out, bytes: 100 });
    const download = calls[1];
    expect(download?.tool).toBe('yt-dlp');
    expect(download?.args[download.args.indexOf('-f') + 1]).toBe('136+140');
    expect(download?.args.slice(-2)).toEqual(['--', youtube.canonicalUrl]);
    expect(download?.options.watch?.everyMs).toBeGreaterThan(0);
    expect(seen.at(-1)).toEqual({ percent: 100, bytes: 100 });
    // The working folder is gone.
    const left = await import('node:fs/promises').then((fs) => fs.readdir(dir));
    expect(left).toEqual(['proxy.mp4']);
  });

  it('refuses a proxy longer than the plan before fetching anything', async () => {
    const downloader = createYtDlpDownloader({
      paths,
      runTool: scriptedRunTool(calls, { probe: youtubeTalk }),
      scratchDir: dir,
    });
    const error = await downloader
      .fetchProxy(
        {
          link: youtube,
          maxHeight: 720,
          outFile: path.join(dir, 'p.mp4'),
          maxBytes: 1e9,
          maxDurationMs: 60_000,
        },
        () => undefined,
        signal,
      )
      .catch((e: unknown) => e);
    expect((error as DownloaderError).code).toBe('clips_video_too_long');
    expect(calls).toHaveLength(1);
  });

  it('treats a download that wrote nothing (the match filter skipped it) as live', async () => {
    const downloader = createYtDlpDownloader({
      paths,
      runTool: scriptedRunTool(calls, { probe: twitchStream, downloadWritesNothing: true }),
      scratchDir: dir,
    });
    const error = await downloader
      .fetchProxy(
        {
          link: twitch,
          maxHeight: 720,
          outFile: path.join(dir, 'p.mp4'),
          maxBytes: 1e9,
          maxDurationMs: 1e9,
        },
        () => undefined,
        signal,
      )
      .catch((e: unknown) => e);
    expect((error as DownloaderError).code).toBe('link_live');
  });

  it('fetches a Twitch range by slicing the playlist, copying segments, then the exact cut', async () => {
    const fetched: string[] = [];
    const fetchText: FetchText = async (url) => {
      fetched.push(url);
      return PLAYLIST;
    };
    const downloader = createYtDlpDownloader({
      paths,
      runTool: scriptedRunTool(calls, { probe: twitchStream }),
      scratchDir: dir,
      fetchText,
    });
    const out = path.join(dir, 'range.mp4');
    await downloader.fetchRange(
      { link: twitch, fromMs: 125_000, toMs: 185_000, maxHeight: 1080, outFile: out },
      () => undefined,
      signal,
    );
    expect(fetched).toEqual(['https://cdn.sim.invalid/vod/900000001/chunked/index-dvr.m3u8']);
    const [probe, copy, normalise] = calls;
    expect(probe?.tool).toBe('yt-dlp');
    expect(calls.filter((c) => c.tool === 'yt-dlp')).toHaveLength(1);
    expect(copy?.args).toEqual(
      expect.arrayContaining([
        '-f',
        'hls',
        '-c:v',
        'copy',
        '-protocol_whitelist',
        'file,http,https,tcp,tls,crypto',
      ]),
    );
    expect(copy?.args).toEqual(
      expect.arrayContaining(['-user_agent', 'Mozilla/5.0 (PostGear simulation)']),
    );
    // Segments 12 to 18 cover 120 s to 190 s, so the cut starts 5 s in and lasts 60 s.
    expect(normalise?.args[normalise.args.indexOf('-ss') + 1]).toBe('5.000000');
    expect(normalise?.args[normalise.args.indexOf('-t') + 1]).toBe('60.000000');
    expect(normalise?.args[normalise.args.indexOf('-i') + 1]).toMatch(/range\.ts$/);
    expect(await readFile(out)).toHaveLength(80);
  });

  it('retries the segment copy once with the sound re-encoded', async () => {
    let copies = 0;
    const base = scriptedRunTool(calls, { probe: kickStream });
    const runTool: RunTool = async (tool, args, options) => {
      if (tool === 'ffmpeg' && args.includes('hls') && copies++ === 0) {
        calls.push({ tool, args: [...args], options });
        throw new ToolError({ tool, exitCode: 1, stderrTail: 'bad audio' });
      }
      return base(tool, args, options);
    };
    const downloader = createYtDlpDownloader({
      paths,
      runTool,
      scratchDir: dir,
      fetchText: async () => PLAYLIST,
    });
    await downloader.fetchRange(
      { link: kick, fromMs: 0, toMs: 30_000, maxHeight: 720, outFile: path.join(dir, 'r.mp4') },
      () => undefined,
      signal,
    );
    const hlsRuns = calls.filter((c) => c.tool === 'ffmpeg' && c.args.includes('hls'));
    expect(hlsRuns).toHaveLength(2);
    expect(hlsRuns[1]?.args).toEqual(expect.arrayContaining(['-c:a', 'aac']));
  });

  it('fetches a YouTube range with a padded section and keyframes forced, then the exact cut', async () => {
    const downloader = createYtDlpDownloader({
      paths,
      runTool: scriptedRunTool(calls, { probe: youtubeTalk, downloadExt: 'mkv' }),
      scratchDir: dir,
    });
    const seen: FetchProgress[] = [];
    await downloader.fetchRange(
      {
        link: youtube,
        fromMs: 60_000,
        toMs: 90_000,
        maxHeight: 1080,
        outFile: path.join(dir, 'r.mp4'),
      },
      (p) => seen.push(p),
      signal,
    );
    const download = calls[1];
    const at = download?.args.indexOf('--download-sections') ?? -1;
    expect(download?.args.slice(at, at + 3)).toEqual([
      '--download-sections',
      '*58.000-92.000',
      '--force-keyframes-at-cuts',
    ]);
    expect(download?.args[(download?.args.indexOf('-f') ?? 0) + 1]).toBe('137+140');
    const cut = calls[2];
    expect(cut?.args[cut.args.indexOf('-ss') + 1]).toBe('2.000000');
    expect(cut?.args[cut.args.indexOf('-t') + 1]).toBe('30.000000');
    // No number while yt-dlp fetches a section, then done.
    expect(seen[0]).toEqual({ percent: null });
    expect(seen.at(-1)?.percent).toBe(100);
  });

  it('falls back to the section path when a proxy is set and no proxy-aware playlist reader was given', async () => {
    const downloader = createYtDlpDownloader({
      paths,
      proxy: 'socks5://proxy.internal:1080',
      runTool: scriptedRunTool(calls, { probe: twitchStream, downloadExt: 'mkv' }),
      scratchDir: dir,
    });
    await downloader.fetchRange(
      { link: twitch, fromMs: 0, toMs: 20_000, maxHeight: 720, outFile: path.join(dir, 'r.mp4') },
      () => undefined,
      signal,
    );
    expect(calls[1]?.args).toContain('--download-sections');
    expect(calls[1]?.args).toEqual(
      expect.arrayContaining(['--proxy', 'socks5://proxy.internal:1080']),
    );
  });

  it('fetches an audio format and pulls the sound into M4A', async () => {
    const downloader = createYtDlpDownloader({
      paths,
      runTool: scriptedRunTool(calls, { probe: kickStream }),
      scratchDir: dir,
    });
    await downloader.fetchFormat(
      { link: kick, formatId: 'audio', outFile: path.join(dir, 'a.m4a'), maxBytes: 1e9 },
      () => undefined,
      signal,
    );
    expect(calls[1]?.args[calls[1].args.indexOf('-f') + 1]).toBe('hls-360p30');
    expect(calls[2]?.args).toEqual(expect.arrayContaining(['-vn', '-c:a', 'copy']));
    const missing = await downloader
      .fetchFormat(
        { link: kick, formatId: 'h4320', outFile: path.join(dir, 'x.mp4'), maxBytes: 1e9 },
        () => undefined,
        signal,
      )
      .catch((e: unknown) => e);
    expect((missing as DownloaderError).code).toBe('format_gone');
  });

  it('gives each run its own copy of the cookies file', async () => {
    const cookies = path.join(dir, 'operator-cookies.txt');
    await writeFile(cookies, '# Netscape HTTP Cookie File\n');
    const downloader = createYtDlpDownloader({
      paths,
      cookiesFile: cookies,
      runTool: scriptedRunTool(calls, { probe: youtubeTalk }),
      scratchDir: dir,
    });
    await downloader.probe(youtube, signal);
    const passed = calls[0]?.args[(calls[0]?.args.indexOf('--cookies') ?? 0) + 1];
    expect(passed).not.toBe(cookies);
    expect(passed).toMatch(/cookies\.txt$/);
  });
});
