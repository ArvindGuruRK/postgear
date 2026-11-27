/**
 * yt-dlp exits with 1 for almost every failure, so the cause is read from
 * its last lines against the strings research 04 (section 10) lists. The
 * text is matched, never passed on: a person only ever sees the sentence
 * for the code.
 */
import { ToolError } from '../run/types';
import { DownloaderError, type DownloaderErrorCode } from './types';

interface Rule {
  code: DownloaderErrorCode;
  /** Lower-case substrings; the first rule with a hit wins, so the most specific come first. */
  needles: readonly string[];
}

/**
 * Ordered most specific first: a missing tool before anything that names a
 * site, the rate limit before "video unavailable" (YouTube's rate-limit text
 * contains both), the live and private checks before "not found".
 */
const RULES: readonly Rule[] = [
  {
    code: 'tool_failed',
    needles: [
      'ffmpeg is not installed',
      'ffprobe and ffmpeg not found',
      'ffmpeg not found',
      'no such file or directory',
      'unable to open for writing',
    ],
  },
  {
    code: 'platform_resting',
    needles: [
      "sign in to confirm you're not a bot",
      'sign in to confirm you’re not a bot',
      'confirm you are not a bot',
      'your ip is likely being blocked',
      'captcha',
      'http error 429',
      'too many requests',
      "this content isn't available, try again later",
      'this content isn’t available, try again later',
      'rate-limited',
      'rate limited',
      // Module 12 sites (TikTok, Instagram).
      'ip address is blocked',
      'your ip address has been blocked',
    ],
  },
  {
    code: 'link_live',
    needles: [
      'this live event will begin',
      'premieres in',
      'is not currently live',
      'does not pass filter',
      'the vod is still being processed',
    ],
  },
  {
    code: 'link_private',
    needles: [
      'private video',
      'this video is private',
      'only available for registered users',
      'subscriber-only',
      'subscriber only',
      'requires a channel subscription',
      'members-only',
      'members only',
      'join this channel',
      'confirm your age',
      'age-restricted',
      'age restricted',
      'inappropriate for some users',
      'drm protected',
      'not available from your location',
      'geo restriction',
      'available in your country',
      'vod_manifest_restricted',
      'unauthorized_entitlements',
      'you must be logged in',
      'login required',
      // Module 12 sites: anything behind a login, a password or an adult gate is private.
      'protected by a password',
      'video-password',
      'passcode',
      'requires authentication',
      'nsfw',
      'over 18',
      'log in to',
      'logged-in',
      'this content is not available to you',
    ],
  },
  {
    code: 'format_gone',
    needles: ['requested format is not available', 'cannot be partially downloaded'],
  },
  {
    code: 'link_not_a_video',
    needles: ['unsupported url'],
  },
  {
    code: 'link_not_found',
    needles: [
      'video unavailable',
      'this video is unavailable',
      'does not exist',
      'no longer available',
      'has been removed',
      'http error 404',
      'http error 410',
      // Module 12 sites.
      'no video could be found in this tweet',
      'this tweet is unavailable',
      'post is unavailable',
      'recording has expired',
      'content has been deleted',
      'video not available',
      'the requested file was not found',
    ],
  },
];

/**
 * The code for yt-dlp's stderr. `ERROR:` lines are read first (with
 * `--no-warnings` they are the cause); without one, the whole tail. An
 * unmatched failure is `tool_failed` ("platform changed" in research 04).
 */
export function mapYtDlpError(stderr: string): DownloaderErrorCode {
  const lines = stderr.split(/\r?\n/);
  const errorLines = lines.filter((line) => line.trimStart().startsWith('ERROR:'));
  const haystacks = errorLines.length > 0 ? [errorLines.join('\n'), stderr] : [stderr];
  for (const haystack of haystacks) {
    const text = haystack.toLowerCase();
    for (const rule of RULES) {
      if (rule.needles.some((needle) => text.includes(needle))) {
        return rule.code;
      }
    }
  }
  return 'tool_failed';
}

/** True for the `AbortError` a cancelled `fetch` or timer throws. */
function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
}

/**
 * Any failure inside a fetch, as a `DownloaderError`. A `ToolError` from
 * yt-dlp is read for its cause; from FFmpeg it is `tool_failed` (a segment
 * that will not load usually means its signed address ran out, which a
 * retry fixes). The original error is kept as `cause` for the log.
 */
export function toDownloaderError(error: unknown): DownloaderError {
  if (error instanceof DownloaderError) return error;
  if (error instanceof ToolError) {
    if (error.aborted) return new DownloaderError('cancelled', { retryable: false, cause: error });
    if (error.timedOut)
      return new DownloaderError('tool_failed', { retryable: true, cause: error });
    if (error.tool === 'yt-dlp') {
      return new DownloaderError(mapYtDlpError(error.stderrTail), { cause: error });
    }
    return new DownloaderError('tool_failed', { cause: error });
  }
  if (isAbortError(error))
    return new DownloaderError('cancelled', { retryable: false, cause: error });
  return new DownloaderError('tool_failed', { cause: error });
}
