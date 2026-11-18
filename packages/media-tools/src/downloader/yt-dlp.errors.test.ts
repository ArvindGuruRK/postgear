import { ToolError } from '../run/types';
import { DownloaderError } from './types';
import { mapYtDlpError, toDownloaderError } from './yt-dlp.errors';

describe('mapYtDlpError', () => {
  const cases: Array<[string, string]> = [
    // Gated videos.
    [
      "ERROR: [youtube] abcdefghijk: Private video. Sign in if you've been granted access to this video",
      'link_private',
    ],
    [
      'ERROR: [youtube] abcdefghijk: This video is only available for registered users',
      'link_private',
    ],
    [
      'ERROR: [twitch:vod] 123: You must be logged into an account that has access to this subscriber-only content.',
      'link_private',
    ],
    ['ERROR: [kick:vod] uuid: This video requires a channel subscription', 'link_private'],
    [
      'ERROR: [youtube] abcdefghijk: Join this channel to get access to members-only content like this video',
      'link_private',
    ],
    [
      'ERROR: [youtube] abcdefghijk: Sign in to confirm your age. This video may be inappropriate for some users.',
      'link_private',
    ],
    [
      'ERROR: [youtube] abcdefghijk: The uploader has not made this video available in your country',
      'link_private',
    ],
    ['ERROR: [youtube] abcdefghijk: This video is DRM protected', 'link_private'],
    // Gone.
    ['ERROR: [youtube] abcdefghijk: Video unavailable', 'link_not_found'],
    ['ERROR: [twitch:vod] 900000004: Video 900000004 does not exist', 'link_not_found'],
    ['ERROR: [twitch:clips] Slug: This clip is no longer available', 'link_not_found'],
    [
      'ERROR: [kick:vod] x: Unable to download JSON metadata: HTTP Error 404: Not Found',
      'link_not_found',
    ],
    // Live.
    ['ERROR: [youtube] abcdefghijk: This live event will begin in 3 hours.', 'link_live'],
    ['ERROR: [youtube] abcdefghijk: Premieres in 2 days', 'link_live'],
    [
      '[youtube] abcdefghijk: does not pass filter (!is_live & live_status!=is_upcoming), skipping ..',
      'link_live',
    ],
    // The platform is resting.
    [
      "ERROR: [youtube] abcdefghijk: Sign in to confirm you're not a bot. Use --cookies-from-browser or --cookies",
      'platform_resting',
    ],
    ['ERROR: [youtube] abcdefghijk: Sign in to confirm you’re not a bot.', 'platform_resting'],
    [
      'ERROR: [youtube] abcdefghijk: All player responses are invalid. Your IP is likely being blocked by Youtube',
      'platform_resting',
    ],
    [
      "ERROR: [youtube] abcdefghijk: Video unavailable. This content isn't available, try again later.",
      'platform_resting',
    ],
    [
      'ERROR: [twitch:vod] 1: Unable to download JSON metadata: HTTP Error 429: Too Many Requests',
      'platform_resting',
    ],
    // Formats.
    [
      'ERROR: [youtube] abcdefghijk: Requested format is not available. Use --list-formats for a list of available formats',
      'format_gone',
    ],
    ['ERROR: This format cannot be partially downloaded. Aborting', 'format_gone'],
    // Lists and the rest.
    ['ERROR: Unsupported URL: https://www.youtube.com/@someone', 'link_not_a_video'],
    [
      'ERROR: You have requested merging of multiple formats but ffmpeg is not installed. Aborting due to --abort-on-error',
      'tool_failed',
    ],
    ['ERROR: [youtube] abcdefghijk: Unable to extract initial player response', 'tool_failed'],
    ['ERROR: [youtube] abcdefghijk: No video formats found!', 'tool_failed'],
    ['', 'tool_failed'],
  ];

  it.each(cases)('%s', (stderr, code) => {
    expect(mapYtDlpError(stderr)).toBe(code);
  });

  it('reads ERROR lines before the rest of the tail', () => {
    const stderr = [
      '[download] Destination: video unavailable notes.txt',
      'ERROR: [twitch:vod] 1: HTTP Error 429: Too Many Requests',
    ].join('\n');
    expect(mapYtDlpError(stderr)).toBe('platform_resting');
  });
});

describe('toDownloaderError', () => {
  it('maps a yt-dlp failure by its stderr and keeps the tool error as the cause', () => {
    const tool = new ToolError({
      tool: 'yt-dlp',
      exitCode: 1,
      stderrTail: 'ERROR: [youtube] x: Private video',
    });
    const mapped = toDownloaderError(tool);
    expect(mapped).toBeInstanceOf(DownloaderError);
    expect(mapped.code).toBe('link_private');
    expect(mapped.retryable).toBe(false);
    expect(mapped.message).not.toContain('Private video');
    expect((mapped as { cause?: unknown }).cause).toBe(tool);
  });

  it('maps an abort to cancelled and a timeout to a retryable tool failure', () => {
    expect(
      toDownloaderError(new ToolError({ tool: 'yt-dlp', exitCode: null, aborted: true })).code,
    ).toBe('cancelled');
    const timedOut = toDownloaderError(
      new ToolError({ tool: 'ffmpeg', exitCode: null, timedOut: true }),
    );
    expect(timedOut.code).toBe('tool_failed');
    expect(timedOut.retryable).toBe(true);
  });

  it('treats an FFmpeg failure as a tool failure whatever it printed', () => {
    const mapped = toDownloaderError(
      new ToolError({ tool: 'ffmpeg', exitCode: 1, stderrTail: 'Private video' }),
    );
    expect(mapped.code).toBe('tool_failed');
  });

  it('passes a DownloaderError through and wraps anything else', () => {
    const own = new DownloaderError('too_big');
    expect(toDownloaderError(own)).toBe(own);
    expect(toDownloaderError(new Error('boom')).code).toBe('tool_failed');
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    expect(toDownloaderError(abort).code).toBe('cancelled');
  });
});
