import type { LinkRef } from '@postgear/video-engine';
import { YTDLP_PROGRESS_TEMPLATE } from './progress';
import { DownloaderError } from './types';
import {
  assertCanonicalUrl,
  formatSelector,
  IMPORT_EXTRACTORS,
  type YtDlpConfig,
  ytDlpConfigFromEnv,
  ytDlpDownloadArgs,
  ytDlpProbeArgs,
} from './yt-dlp.args';

const paths = { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe', ytDlp: 'yt-dlp', jsRuntime: null };
const plain: YtDlpConfig = { paths };

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
  channel: 'simstreamer',
};

/** Every argument that follows a flag is a value we chose; the URL is last, right after `--`. */
function expectUrlLastAfterDashes(args: string[], url: string): void {
  expect(args[args.length - 1]).toBe(url);
  expect(args[args.length - 2]).toBe('--');
  expect(args.filter((arg) => arg === '--')).toHaveLength(1);
  expect(args.filter((arg) => arg === url)).toHaveLength(1);
}

describe('ytDlpProbeArgs', () => {
  it('builds the fixed base for a YouTube probe', () => {
    expect(ytDlpProbeArgs(plain, youtube, null)).toEqual([
      '--ignore-config',
      '--no-playlist',
      '--no-warnings',
      '--abort-on-unavailable-fragments',
      '--use-extractors',
      'youtube,youtube:clip',
      '--color',
      'never',
      '--socket-timeout',
      '20',
      '--retries',
      '3',
      '--fragment-retries',
      '3',
      '--restrict-filenames',
      '--no-cache-dir',
      '--dump-single-json',
      '--skip-download',
      '--',
      'https://www.youtube.com/watch?v=simtalk0001',
    ]);
  });

  it('uses each platform its own import extractors, never a list extractor', () => {
    for (const link of [youtube, twitch, kick]) {
      const args = ytDlpProbeArgs(plain, link, null);
      const extractors = args[args.indexOf('--use-extractors') + 1];
      expect(extractors).toBe(IMPORT_EXTRACTORS[link.platform].join(','));
      expect(extractors).not.toMatch(/youtube:tab|:videos|kick:clips/);
      expectUrlLastAfterDashes(args, link.canonicalUrl);
    }
  });

  it('adds the runtime, proxy, cookies copy, extractor settings and cache only when set', () => {
    const config: YtDlpConfig = {
      paths: { ...paths, jsRuntime: '/opt/deno/deno' },
      proxy: 'http://proxy.internal:3128',
      extractorArgs: 'youtube:player_client=mweb',
      cacheDir: '/scratch/yt-cache',
    };
    const args = ytDlpProbeArgs(config, youtube, '/scratch/job/cookies.txt');
    expect(args).toEqual(
      expect.arrayContaining([
        '--cache-dir',
        '/scratch/yt-cache',
        '--js-runtimes',
        'deno:/opt/deno/deno',
        '--proxy',
        'http://proxy.internal:3128',
        '--cookies',
        '/scratch/job/cookies.txt',
        '--extractor-args',
        'youtube:player_client=mweb',
      ]),
    );
    expect(args).not.toContain('--no-cache-dir');
    expect(args[args.indexOf('--proxy') + 1]).toBe('http://proxy.internal:3128');
    expectUrlLastAfterDashes(args, youtube.canonicalUrl);
  });

  it('never passes the dangerous flags', () => {
    const args = ytDlpProbeArgs(plain, youtube, null).join(' ');
    for (const flag of [
      '--exec',
      '--enable-file-urls',
      '--cookies-from-browser',
      '--remote-components',
      '--live-from-start',
      '--print-traffic',
      '--load-info-json',
      '--batch-file',
    ]) {
      expect(args).not.toContain(flag);
    }
  });

  it('refuses a canonical link that is not on its platform host', () => {
    const bad: LinkRef[] = [
      { ...youtube, canonicalUrl: 'https://youtube.com.evil.example/watch?v=simtalk0001' },
      { ...youtube, canonicalUrl: 'http://www.youtube.com/watch?v=simtalk0001' },
      { ...youtube, canonicalUrl: 'https://user:pass@www.youtube.com/watch?v=simtalk0001' },
      { ...youtube, canonicalUrl: '--exec=rm' },
      { ...twitch, canonicalUrl: 'https://www.youtube.com/watch?v=simtalk0001' },
      { ...kick, canonicalUrl: 'https://kick.com:8443/simstreamer/videos/x' },
      { ...youtube, canonicalUrl: 'file:///etc/passwd' },
    ];
    for (const link of bad) {
      expect(() => assertCanonicalUrl(link)).toThrow(DownloaderError);
      expect(() => ytDlpProbeArgs(plain, link, null)).toThrow(DownloaderError);
    }
  });

  it('refuses a setting with a line break', () => {
    expect(() => ytDlpProbeArgs({ paths, proxy: 'http://a\r\n--exec x' }, youtube, null)).toThrow(
      DownloaderError,
    );
  });
});

describe('ytDlpDownloadArgs', () => {
  const base = {
    formatIds: ['136', '140'],
    outTemplate: '/scratch/job/.fetch-1/media.%(ext)s',
    mergeFormat: 'mp4' as const,
    maxDurationSec: 7200,
    maxBytes: 2_000_000_000,
    section: null,
    cookiesPath: null,
  };

  it('builds a proxy download with progress, the match filter and our format ids', () => {
    const args = ytDlpDownloadArgs(plain, youtube, base);
    expect(args.slice(16)).toEqual([
      '--newline',
      '--progress-delta',
      '1',
      '--progress-template',
      YTDLP_PROGRESS_TEMPLATE,
      '--no-mtime',
      '--no-part',
      '--sleep-requests',
      '0.75',
      '--match-filters',
      '!is_live & live_status!=is_upcoming & live_status!=post_live & duration<=?7200',
      '-f',
      '136+140',
      '-o',
      '/scratch/job/.fetch-1/media.%(ext)s',
      '--merge-output-format',
      'mp4',
      '--max-filesize',
      '2000000000',
      '--',
      'https://www.youtube.com/watch?v=simtalk0001',
    ]);
  });

  it('asks for an exact section with keyframes forced at the cuts', () => {
    const args = ytDlpDownloadArgs(plain, youtube, {
      ...base,
      mergeFormat: 'mkv',
      maxDurationSec: null,
      maxBytes: null,
      section: { fromSec: 58, toSec: 122.5 },
    });
    const at = args.indexOf('--download-sections');
    expect(args.slice(at, at + 3)).toEqual([
      '--download-sections',
      '*58.000-122.500',
      '--force-keyframes-at-cuts',
    ]);
    expect(args).not.toContain('--max-filesize');
    expect(args[args.indexOf('--match-filters') + 1]).toBe(
      '!is_live & live_status!=is_upcoming & live_status!=post_live',
    );
    expectUrlLastAfterDashes(args, youtube.canonicalUrl);
  });

  it('refuses format ids that could carry selector syntax', () => {
    for (const ids of [['best[height<=720]'], ['137/best'], ['137', '140', '251'], [], ['a b']]) {
      expect(() => formatSelector(ids)).toThrow(DownloaderError);
    }
    expect(formatSelector(['1080p60'])).toBe('1080p60');
    expect(formatSelector(['hls-720p60'])).toBe('hls-720p60');
  });

  it('refuses an output template that is not a plain path', () => {
    expect(() =>
      ytDlpDownloadArgs(plain, twitch, { ...base, outTemplate: '/scratch/%(title)s.%(ext)s' }),
    ).toThrow(DownloaderError);
    expect(() =>
      ytDlpDownloadArgs(plain, twitch, { ...base, outTemplate: '/scratch/media.mp4' }),
    ).toThrow(DownloaderError);
  });

  it('keeps every value in its own argument (no shell syntax is ever joined in)', () => {
    const args = ytDlpDownloadArgs(plain, kick, base);
    for (const arg of args) {
      expect(arg).not.toMatch(/[\r\n]/);
    }
    expect(args.some((arg) => arg.includes(' -- '))).toBe(false);
    expectUrlLastAfterDashes(args, kick.canonicalUrl);
  });
});

describe('ytDlpConfigFromEnv', () => {
  it('reads the three optional settings and treats blank as unset', () => {
    expect(
      ytDlpConfigFromEnv({
        YTDLP_PROXY: ' socks5://h:1080 ',
        YTDLP_COOKIES_FILE: '',
        YTDLP_EXTRACTOR_ARGS: undefined,
      }),
    ).toEqual({ proxy: 'socks5://h:1080', cookiesFile: null, extractorArgs: null });
  });
});
