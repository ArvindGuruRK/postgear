/**
 * yt-dlp argument builders for import, range fetch and download.
 *
 * The argument list is a security boundary, so it is built here and nowhere
 * else, and snapshot-tested. Rules (research 04, sections 2.3 and 2.4):
 * - a fixed base on every call: no config files, no playlists, a fixed
 *   extractor allowlist per platform, retries and timeouts set by us;
 * - the only address is `LinkRef.canonicalUrl`, always after `--`;
 * - format selectors are made only from format ids yt-dlp itself printed,
 *   checked against a strict pattern, never from user text;
 * - proxy, cookies and extractor settings come from the operator's env only.
 */
import type { ClipPlatformId, LinkRef } from '@postgear/video-engine';
import { jsRuntimeArg } from '../run/paths';
import type { ToolPaths } from '../run/types';
import { YTDLP_PROGRESS_TEMPLATE } from './progress';
import { DownloaderError } from './types';

/**
 * The extractors an import may use, per platform. List extractors
 * (`youtube:tab`, `twitch:videos`, `kick:videos` and friends) are never on
 * this list: only the channel lister has those, in its own builder.
 */
export const IMPORT_EXTRACTORS: Readonly<Record<ClipPlatformId, readonly string[]>> = Object.freeze(
  {
    youtube: Object.freeze(['youtube', 'youtube:clip']),
    twitch: Object.freeze(['twitch:vod', 'twitch:clips']),
    kick: Object.freeze(['kick:vod', 'kick:clip']),
  },
);

/** Hosts a canonical link may use, per platform (what `recogniseLink` builds). */
const CANONICAL_HOSTS: Readonly<Record<ClipPlatformId, readonly string[]>> = Object.freeze({
  youtube: ['www.youtube.com', 'youtube.com', 'm.youtube.com', 'youtu.be'],
  twitch: ['www.twitch.tv', 'twitch.tv', 'clips.twitch.tv', 'm.twitch.tv'],
  kick: ['kick.com', 'www.kick.com'],
});

/** yt-dlp's own network timeout, in seconds. */
export const YTDLP_SOCKET_TIMEOUT_SEC = 20;

/** A format id from yt-dlp we are willing to put in `-f`: no selector syntax can hide in it. */
export const FORMAT_ID_PATTERN = /^[A-Za-z0-9_.-]{1,80}$/;

/** What every yt-dlp call needs from the environment. */
export interface YtDlpConfig {
  paths: ToolPaths;
  /** `YTDLP_PROXY`: HTTP, HTTPS or SOCKS. */
  proxy?: string | null;
  /** `YTDLP_COOKIES_FILE`: an operator account only. Each run gets its own copy. */
  cookiesFile?: string | null;
  /** `YTDLP_EXTRACTOR_ARGS`, for example `youtube:player_client=mweb`. */
  extractorArgs?: string | null;
  /** A folder yt-dlp may cache player code in. Without it, `--no-cache-dir`. */
  cacheDir?: string | null;
}

/** Reads the optional yt-dlp settings from the environment. Blank values count as unset. */
export function ytDlpConfigFromEnv(
  env: Record<string, string | undefined>,
): Pick<YtDlpConfig, 'proxy' | 'cookiesFile' | 'extractorArgs'> {
  const read = (name: string): string | null => {
    const value = env[name]?.trim() ?? '';
    return value.length > 0 ? value : null;
  };
  return {
    proxy: read('YTDLP_PROXY'),
    cookiesFile: read('YTDLP_COOKIES_FILE'),
    extractorArgs: read('YTDLP_EXTRACTOR_ARGS'),
  };
}

/** A value that is about to become one argument: no line breaks, no NUL, not empty. */
export function assertArgValue(value: string): string {
  if (value.length === 0 || value.length > 4096 || /[\0\r\n]/.test(value)) {
    throw new DownloaderError('tool_failed', {
      retryable: false,
      cause: new Error('A yt-dlp setting is empty or holds a line break.'),
    });
  }
  return value;
}

/**
 * Checks the canonical link before it reaches yt-dlp: https, a host of its
 * platform, no credentials. It was built by `recogniseLink`, so a failure
 * here is a bug upstream, answered as "not a video" rather than run.
 */
export function assertCanonicalUrl(link: LinkRef): string {
  let url: URL;
  try {
    url = new URL(link.canonicalUrl);
  } catch {
    throw new DownloaderError('link_not_a_video', { retryable: false });
  }
  const hosts = CANONICAL_HOSTS[link.platform];
  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    url.port !== '' ||
    hosts === undefined ||
    !hosts.includes(url.hostname) ||
    /[\0\r\n\s]/.test(link.canonicalUrl)
  ) {
    throw new DownloaderError('link_not_a_video', { retryable: false });
  }
  return link.canonicalUrl;
}

/**
 * The flags on every import call. `cookiesPath` is the job's own copy of the
 * operator's cookies file (yt-dlp writes to it), or null.
 */
export function ytDlpBaseArgs(
  config: YtDlpConfig,
  platform: ClipPlatformId,
  cookiesPath: string | null,
): string[] {
  const args = [
    '--ignore-config',
    '--no-playlist',
    '--no-warnings',
    '--abort-on-unavailable-fragments',
    '--use-extractors',
    IMPORT_EXTRACTORS[platform].join(','),
    '--color',
    'never',
    '--socket-timeout',
    String(YTDLP_SOCKET_TIMEOUT_SEC),
    '--retries',
    '3',
    '--fragment-retries',
    '3',
    '--restrict-filenames',
  ];
  args.push(...ytDlpEnvArgs(config, cookiesPath));
  return args;
}

/** Cache, JavaScript runtime, proxy, cookies and extractor settings. Shared with the lister. */
export function ytDlpEnvArgs(config: YtDlpConfig, cookiesPath: string | null): string[] {
  const args: string[] = [];
  if (config.cacheDir) {
    args.push('--cache-dir', assertArgValue(config.cacheDir));
  } else {
    args.push('--no-cache-dir');
  }
  if (config.paths.jsRuntime) {
    args.push('--js-runtimes', assertArgValue(jsRuntimeArg(config.paths.jsRuntime)));
  }
  if (config.proxy) {
    args.push('--proxy', assertArgValue(config.proxy));
  }
  if (cookiesPath) {
    args.push('--cookies', assertArgValue(cookiesPath));
  }
  if (config.extractorArgs) {
    args.push('--extractor-args', assertArgValue(config.extractorArgs));
  }
  return args;
}

/** `yt-dlp -J`: one JSON line describing the video, nothing downloaded. */
export function ytDlpProbeArgs(
  config: YtDlpConfig,
  link: LinkRef,
  cookiesPath: string | null,
): string[] {
  const url = assertCanonicalUrl(link);
  return [
    ...ytDlpBaseArgs(config, link.platform, cookiesPath),
    '--dump-single-json',
    '--skip-download',
    '--',
    url,
  ];
}

/** A time range of the source, in seconds, for `--download-sections`. */
export interface SectionRange {
  fromSec: number;
  toSec: number;
}

export interface YtDlpDownloadOptions {
  /** yt-dlp format ids from the probe: one, or a video id then an audio id. */
  formatIds: readonly string[];
  /** Absolute output template inside the job's folder, ending in `.%(ext)s`. */
  outTemplate: string;
  /** `mp4` for the proxy and video formats, `mkv` for a range that is re-encoded anyway. */
  mergeFormat: 'mp4' | 'mkv' | null;
  /** Second lock: yt-dlp skips a longer video. Seconds. */
  maxDurationSec: number | null;
  /** Only the plain HTTP downloader honours it; the runner's size watch covers HLS. */
  maxBytes: number | null;
  /** A time range, fetched with keyframes forced at the cuts so it starts exactly. */
  section: SectionRange | null;
  cookiesPath: string | null;
}

/** The `-f` value: ids joined with `+`, each checked. */
export function formatSelector(formatIds: readonly string[]): string {
  if (formatIds.length === 0 || formatIds.length > 2) {
    throw new DownloaderError('format_gone', { retryable: false });
  }
  for (const id of formatIds) {
    if (!FORMAT_ID_PATTERN.test(id)) {
      throw new DownloaderError('format_gone', { retryable: false });
    }
  }
  return formatIds.join('+');
}

/** Seconds with three decimals, never negative, for `--download-sections`. */
function sectionSeconds(sec: number): string {
  return Math.max(0, sec).toFixed(3);
}

/** A download: progress lines, the match filter, our chosen formats, our output path. */
export function ytDlpDownloadArgs(
  config: YtDlpConfig,
  link: LinkRef,
  options: YtDlpDownloadOptions,
): string[] {
  const url = assertCanonicalUrl(link);
  const outTemplate = assertArgValue(options.outTemplate);
  if (!outTemplate.endsWith('.%(ext)s') || outTemplate.slice(0, -8).includes('%')) {
    throw new DownloaderError('tool_failed', {
      retryable: false,
      cause: new Error('The output template must be a plain path ending in .%(ext)s.'),
    });
  }
  const filters = ['!is_live', 'live_status!=is_upcoming', 'live_status!=post_live'];
  if (options.maxDurationSec !== null) {
    filters.push(`duration<=?${Math.max(1, Math.ceil(options.maxDurationSec))}`);
  }
  const args = [
    ...ytDlpBaseArgs(config, link.platform, options.cookiesPath),
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
    filters.join(' & '),
    '-f',
    formatSelector(options.formatIds),
    '-o',
    outTemplate,
  ];
  if (options.mergeFormat) {
    args.push('--merge-output-format', options.mergeFormat);
  }
  if (options.maxBytes !== null && options.maxBytes > 0) {
    args.push('--max-filesize', String(Math.floor(options.maxBytes)));
  }
  if (options.section) {
    const { fromSec, toSec } = options.section;
    if (!(Number.isFinite(fromSec) && Number.isFinite(toSec) && toSec > fromSec)) {
      throw new DownloaderError('tool_failed', { retryable: false });
    }
    args.push(
      '--download-sections',
      `*${sectionSeconds(fromSec)}-${sectionSeconds(toSec)}`,
      '--force-keyframes-at-cuts',
    );
  }
  args.push('--', url);
  return args;
}
