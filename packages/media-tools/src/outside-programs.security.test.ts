/**
 * Security sweep, "Outside programs" (Sprint 12, Module 20 section 1).
 *
 * What must hold: only the runner starts a program (see `guard.test.ts`),
 * always with an argument array and `shell: false`; no text a person or a
 * platform wrote reaches a flag position; `--` comes before every address;
 * yt-dlp always runs with `--ignore-config` and an allowlisted extractor.
 *
 * The yt-dlp half records every call the real downloader and the real flat
 * lister make (a scripted runner, nothing is started or fetched) and checks
 * each one, so a new call that forgets a rule fails here.
 */
import { readFileSync } from 'node:fs';
import {
  mkdtemp as mkdtempAsync,
  rm as rmAsync,
  writeFile as writeFileAsync,
} from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ChannelRef, LinkRef } from '@postgear/video-engine';
import * as ts from 'typescript';
import flatKick from '../fixtures/ytdlp/flat-kick-videos.json';
import flatTwitch from '../fixtures/ytdlp/flat-twitch-videos.json';
import flatYoutube from '../fixtures/ytdlp/flat-youtube-tab.json';
import kickStream from '../fixtures/ytdlp/probe-kick-stream.json';
import twitchStream from '../fixtures/ytdlp/probe-twitch-stream.json';
import youtubeTalk from '../fixtures/ytdlp/probe-youtube-talk.json';
import { createYtDlpFlatLister } from './channels/flat.lister';
import { LISTING_EXTRACTOR_ALLOWLIST } from './channels/flat-list.args';
import { DownloaderError } from './downloader/types';
import { FORMAT_ID_PATTERN, formatSelector, IMPORT_EXTRACTORS } from './downloader/yt-dlp.args';
import { createYtDlpDownloader } from './downloader/yt-dlp.downloader';
import type { RunTool, RunToolOptions, ToolName } from './run/types';

const RUNNER = path.join(__dirname, 'run', 'runner.ts');

interface Call {
  tool: ToolName;
  args: string[];
  options: RunToolOptions;
}

const paths = { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe', ytDlp: 'yt-dlp', jsRuntime: null };

/** yt-dlp flags that would let a config, a file, a browser or a command in. Never passed. */
const BANNED_YTDLP_FLAGS = [
  '--exec',
  '--exec-before-download',
  '--batch-file',
  '-a',
  '--config-location',
  '--config-locations',
  '--load-info-json',
  '--enable-file-urls',
  '--cookies-from-browser',
  '--plugin-dirs',
  '--remote-components',
  '--update',
  '-U',
  '--update-to',
  '--netrc',
  '--netrc-cmd',
  '--username',
  '--password',
  '--print-traffic',
  '--write-pages',
];

/** Hosts an address handed to yt-dlp may name, per platform. */
const PLATFORM_HOSTS = new Set([
  'www.youtube.com',
  'youtube.com',
  'm.youtube.com',
  'youtu.be',
  'www.twitch.tv',
  'twitch.tv',
  'clips.twitch.tv',
  'm.twitch.tv',
  'kick.com',
  'www.kick.com',
]);

/**
 * The rules every yt-dlp call keeps, whatever it is for. `allowedExtractors`
 * is the import list or the listing list, never both.
 */
function expectSafeYtDlpCall(args: readonly string[], allowedExtractors: readonly string[]): void {
  expect(args).toContain('--ignore-config');
  // One `--`, second to last, with the only address after it.
  expect(args.filter((arg) => arg === '--')).toHaveLength(1);
  expect(args[args.length - 2]).toBe('--');
  const url = new URL(args[args.length - 1] as string);
  expect(url.protocol).toBe('https:');
  expect(url.username + url.password + url.port).toBe('');
  expect(PLATFORM_HOSTS.has(url.hostname)).toBe(true);
  // Nothing before `--` is an address (the operator's `--proxy` value aside), and no banned flag is anywhere.
  args.slice(0, -2).forEach((arg, i) => {
    if (args[i - 1] !== '--proxy') {
      expect(arg).not.toMatch(/^[a-z][a-z0-9+.-]*:\/\//i);
    }
    expect(arg).not.toMatch(/[\0\r\n]/);
  });
  for (const flag of BANNED_YTDLP_FLAGS) {
    expect(args).not.toContain(flag);
    expect(args.some((arg) => arg.startsWith(`${flag}=`))).toBe(false);
  }
  // Exactly one extractor list, and every name on it is allowlisted.
  const at = args.indexOf('--use-extractors');
  expect(at).toBeGreaterThan(-1);
  expect(args.filter((arg) => arg === '--use-extractors')).toHaveLength(1);
  for (const name of (args[at + 1] as string).split(',')) {
    expect(allowedExtractors).toContain(name);
  }
  // A format, when asked for, is only ids yt-dlp printed: never a flag, never selector syntax.
  const f = args.indexOf('-f');
  if (f > -1) {
    for (const id of (args[f + 1] as string).split('+')) {
      expect(id).toMatch(FORMAT_ID_PATTERN);
      expect(id.startsWith('-')).toBe(false);
    }
  }
}

/**
 * A scripted yt-dlp and FFmpeg: `-J` prints the given probe JSON, a download
 * writes its output, FFmpeg writes its last argument. Every call is kept.
 */
function recordingRunTool(calls: Call[], probe: unknown, downloadExt = 'mp4'): RunTool {
  return async (tool, args, options) => {
    calls.push({ tool, args: [...args], options });
    if (tool === 'yt-dlp' && args.includes('--dump-single-json')) {
      return { exitCode: 0, stdout: `${JSON.stringify(probe)}\n`, stderrTail: '', durationMs: 1 };
    }
    if (tool === 'yt-dlp') {
      const template = args[args.indexOf('-o') + 1] as string;
      await writeFileAsync(template.replace('%(ext)s', downloadExt), Buffer.alloc(100, 2));
      return { exitCode: 0, stdout: '', stderrTail: '', durationMs: 1 };
    }
    options.onStdoutLine?.('progress=end');
    await writeFileAsync(args[args.length - 1] as string, Buffer.alloc(80, 3));
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

describe('the runner starts programs without a shell', () => {
  const text = readFileSync(RUNNER, 'utf8');
  const source = ts.createSourceFile(RUNNER, text, ts.ScriptTarget.Latest, true);

  /** Every call to a function named `name` in the runner. */
  function callsOf(name: string): ts.CallExpression[] {
    const found: ts.CallExpression[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const callee = node.expression;
        const called = ts.isIdentifier(callee)
          ? callee.text
          : ts.isPropertyAccessExpression(callee)
            ? callee.name.text
            : '';
        if (called === name) found.push(node);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    return found;
  }

  it('passes `shell: false` and an argument array to every spawn', () => {
    const spawns = callsOf('spawn');
    expect(spawns.length).toBeGreaterThanOrEqual(2);
    for (const call of spawns) {
      const [, argv, options] = call.arguments;
      // The arguments are an array literal, never one string to be split by a shell.
      expect(argv && ts.isArrayLiteralExpression(argv)).toBe(true);
      expect(options && ts.isObjectLiteralExpression(options)).toBe(true);
      const shell = (options as ts.ObjectLiteralExpression).properties.find(
        (p): p is ts.PropertyAssignment =>
          ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === 'shell',
      );
      expect(shell?.initializer.kind).toBe(ts.SyntaxKind.FalseKeyword);
    }
  });

  it('never uses the shell-backed starters (exec, execSync, execFile with a shell, fork)', () => {
    for (const name of ['exec', 'execSync', 'execFile', 'execFileSync', 'spawnSync', 'fork']) {
      expect(callsOf(name)).toEqual([]);
    }
  });
});

describe('every yt-dlp call the downloader makes', () => {
  let dir: string;
  const signal = new AbortController().signal;
  beforeEach(async () => {
    dir = await mkdtempAsync(path.join(os.tmpdir(), 'pg-sweep-ytdlp-'));
  });
  afterEach(async () => {
    await rmAsync(dir, { recursive: true, force: true });
  });

  const cases: Array<{ name: string; link: LinkRef; probe: unknown }> = [
    { name: 'YouTube', link: youtube, probe: youtubeTalk },
    { name: 'Twitch', link: twitch, probe: twitchStream },
    { name: 'Kick', link: kick, probe: kickStream },
  ];

  it.each(cases)('$name: the probe and the light copy keep every rule', async ({ link, probe }) => {
    const calls: Call[] = [];
    const downloader = createYtDlpDownloader({
      paths,
      proxy: 'http://proxy.internal:3128',
      extractorArgs: 'youtube:player_client=mweb',
      runTool: recordingRunTool(calls, probe),
      scratchDir: dir,
    });
    await downloader.probe(link, signal);
    await downloader.fetchProxy(
      {
        link,
        maxHeight: 720,
        outFile: path.join(dir, 'proxy.mp4'),
        maxBytes: 10_000_000,
        maxDurationMs: 12 * 3_600_000,
      },
      () => undefined,
      signal,
    );
    const ytDlp = calls.filter((call) => call.tool === 'yt-dlp');
    expect(ytDlp.length).toBeGreaterThanOrEqual(3);
    for (const call of ytDlp) {
      expectSafeYtDlpCall(call.args, IMPORT_EXTRACTORS[link.platform]);
      expect(call.args[call.args.length - 1]).toBe(link.canonicalUrl);
    }
  });

  it('a section range (YouTube, and Twitch behind a proxy) keeps every rule', async () => {
    for (const { link, probe } of [
      { link: youtube, probe: youtubeTalk },
      { link: twitch, probe: twitchStream },
    ]) {
      const calls: Call[] = [];
      const downloader = createYtDlpDownloader({
        paths,
        proxy: 'socks5://proxy.internal:1080',
        runTool: recordingRunTool(calls, probe, 'mkv'),
        scratchDir: dir,
      });
      await downloader.fetchRange(
        { link, fromMs: 10_000, toMs: 40_000, maxHeight: 720, outFile: path.join(dir, 'r.mp4') },
        () => undefined,
        signal,
      );
      const ytDlp = calls.filter((call) => call.tool === 'yt-dlp');
      expect(ytDlp.some((call) => call.args.includes('--download-sections'))).toBe(true);
      for (const call of ytDlp) {
        expectSafeYtDlpCall(call.args, IMPORT_EXTRACTORS[link.platform]);
      }
    }
  });

  it('never hands the platform a flag through a format id it printed', async () => {
    // A platform (or a broken extractor) that names its formats like flags.
    const hostile = JSON.parse(JSON.stringify(youtubeTalk)) as {
      formats: Array<{ format_id: string }>;
    };
    for (const format of hostile.formats) {
      format.format_id = `--exec=calc-${format.format_id}`;
    }
    const calls: Call[] = [];
    const downloader = createYtDlpDownloader({
      paths,
      runTool: recordingRunTool(calls, hostile),
      scratchDir: dir,
    });
    const error = await downloader
      .fetchProxy(
        {
          link: youtube,
          maxHeight: 720,
          outFile: path.join(dir, 'proxy.mp4'),
          maxBytes: 10_000_000,
          maxDurationMs: 7_200_000,
        },
        () => undefined,
        signal,
      )
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DownloaderError);
    // A probe with no usable format reads as a platform change; either way nothing is fetched.
    expect(['format_gone', 'tool_failed']).toContain((error as DownloaderError).code);
    // Only the probe ran: nothing was downloaded with the hostile ids.
    expect(calls.map((call) => call.tool)).toEqual(['yt-dlp']);
    expect(calls.flatMap((call) => call.args).some((arg) => arg.includes('--exec'))).toBe(false);
  });

  it('refuses a format id that starts like a flag, even one yt-dlp could print', () => {
    for (const id of ['-x', '--exec', '.hidden', '-', '--']) {
      expect(FORMAT_ID_PATTERN.test(id)).toBe(false);
      expect(() => formatSelector([id])).toThrow(DownloaderError);
    }
    for (const id of ['137', 'hls-720p60', '1080p60', 'audio_only', 'dash-1.2']) {
      expect(formatSelector([id])).toBe(id);
    }
  });

  it('refuses a link that is not the canonical address before anything starts', async () => {
    const calls: Call[] = [];
    const downloader = createYtDlpDownloader({
      paths,
      runTool: recordingRunTool(calls, youtubeTalk),
      scratchDir: dir,
    });
    const hostile: LinkRef[] = [
      { ...youtube, canonicalUrl: '--exec=calc' },
      { ...youtube, canonicalUrl: '-o/etc/passwd' },
      { ...youtube, canonicalUrl: 'https://www.youtube.com/watch?v=x\n--exec calc' },
      { ...youtube, canonicalUrl: 'https://www.youtube.com.evil.example/watch?v=simtalk0001' },
      { ...youtube, canonicalUrl: 'ytsearch:cats' },
      { ...twitch, canonicalUrl: 'https://kick.com/simstreamer/videos/1' },
    ];
    for (const link of hostile) {
      await expect(downloader.probe(link, signal)).rejects.toBeInstanceOf(DownloaderError);
    }
    expect(calls).toEqual([]);
  });
});

describe('every yt-dlp call the channel lister makes', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtempAsync(path.join(os.tmpdir(), 'pg-sweep-flat-'));
  });
  afterEach(async () => {
    await rmAsync(dir, { recursive: true, force: true });
  });

  function answering(json: unknown, calls: Call[]): RunTool {
    return async (tool, args, options) => {
      calls.push({ tool, args: [...args], options });
      return { exitCode: 0, stdout: JSON.stringify(json), stderrTail: '', durationMs: 1 };
    };
  }

  const refs: Array<{
    ref: ChannelRef;
    json: unknown;
    kinds: Array<'streams' | 'clips' | 'uploads'>;
  }> = [
    {
      ref: {
        platform: 'kick',
        handle: 'acme',
        externalId: 'acme',
        displayName: 'Acme',
        avatarUrl: null,
      },
      json: flatKick,
      kinds: ['streams', 'clips'],
    },
    {
      ref: {
        platform: 'twitch',
        handle: 'acme',
        externalId: 'acme',
        displayName: 'Acme',
        avatarUrl: null,
      },
      json: flatTwitch,
      kinds: ['streams', 'clips'],
    },
    {
      ref: {
        platform: 'youtube',
        handle: '@acme',
        externalId: 'UCsimacme000000000000001',
        displayName: 'Acme',
        avatarUrl: null,
      },
      json: flatYoutube,
      kinds: ['uploads', 'streams'],
    },
  ];

  it('lists with a listing extractor only, the page it built after --, and no cookies', async () => {
    for (const { ref, json, kinds } of refs) {
      const calls: Call[] = [];
      const lister = createYtDlpFlatLister(ref.platform, {
        paths,
        proxy: 'http://proxy.internal:3128',
        runTool: answering(json, calls),
        scratchDir: dir,
      });
      for (const kind of kinds) {
        await lister.list(ref, { kind, limit: 5 }).catch(() => undefined);
      }
      expect(calls.length).toBeGreaterThan(0);
      for (const call of calls) {
        expectSafeYtDlpCall(call.args, LISTING_EXTRACTOR_ALLOWLIST);
        expect(call.args).not.toContain('--cookies');
        // The listing extractors never overlap the import ones.
        const extractor = call.args[call.args.indexOf('--use-extractors') + 1] as string;
        expect(IMPORT_EXTRACTORS[ref.platform]).not.toContain(extractor);
      }
    }
  });

  it('refuses a channel name that could leave its page before anything starts', async () => {
    const calls: Call[] = [];
    const lister = createYtDlpFlatLister('twitch', {
      paths,
      runTool: answering(flatTwitch, calls),
      scratchDir: dir,
    });
    for (const handle of [
      '--exec',
      'a b',
      '../admin',
      'acme/videos?x=1',
      'x'.repeat(200),
      'ac%2Fme',
    ]) {
      const ref: ChannelRef = {
        platform: 'twitch',
        handle,
        externalId: handle,
        displayName: handle,
        avatarUrl: null,
      };
      await expect(lister.list(ref, { kind: 'streams', limit: 5 })).rejects.toBeTruthy();
    }
    expect(calls).toEqual([]);
  });
});
