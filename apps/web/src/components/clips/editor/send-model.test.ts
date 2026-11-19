import {
  CAPTION_MAX,
  captionCount,
  channelChoices,
  composerHref,
  factsOf,
  sentExport,
} from './send-model';
import { SEND_PROVIDERS, sendChannel, sendExport, sendJob } from './send-fixtures';

const MINUTE = 60_000;

describe('channelChoices', () => {
  const channels = [
    sendChannel('yt-1', 'youtube', 'Acme Shorts'),
    sendChannel('ig-1', 'instagram-standalone', 'Acme Reels'),
    sendChannel('tt-1', 'tiktok', 'Acme TikTok'),
    sendChannel('li-1', 'linkedin', 'Acme On LinkedIn'),
  ];

  it('lets a short vertical clip go everywhere that takes video, and says why LinkedIn cannot', () => {
    const choices = channelChoices(channels, SEND_PROVIDERS, {
      durationMs: 42_000,
      width: 1080,
      height: 1920,
      bytes: 26 * 1024 * 1024,
    });
    expect(choices.map((choice) => [choice.channel.id, choice.platform, choice.reason])).toEqual([
      ['yt-1', 'YouTube', null],
      ['ig-1', 'Instagram', null],
      ['tt-1', 'TikTok', null],
      ['li-1', 'LinkedIn', 'LinkedIn does not take video here.'],
    ]);
  });

  it('holds a long clip to each platform limit, in the same sentence the API uses', () => {
    const choices = channelChoices(channels, SEND_PROVIDERS, {
      durationMs: 11 * MINUTE,
      width: 1080,
      height: 1920,
      bytes: null,
    });
    const reasons = Object.fromEntries(choices.map((choice) => [choice.channel.id, choice.reason]));
    expect(reasons['yt-1']).toBeNull();
    expect(reasons['tt-1']).toBe('This clip is 11 min. TikTok takes up to 10 minutes.');
  });

  it('says when a clip is too short or too wide for Instagram', () => {
    const short = channelChoices(channels, SEND_PROVIDERS, {
      durationMs: 2_000,
      width: 1080,
      height: 1920,
      bytes: null,
    });
    expect(short[1]?.reason).toBe('This clip is shorter than Instagram allows.');
    const wide = channelChoices(channels, SEND_PROVIDERS, {
      durationMs: 42_000,
      width: 3840,
      height: 2160,
      bytes: null,
    });
    expect(wide[1]?.reason).toBe('This clip is 3840 pixels wide. Instagram takes up to 1920.');
  });

  it('never offers a channel still being set up, switched off, or with no provider here', () => {
    const choices = channelChoices(
      [
        sendChannel('a', 'youtube', 'Half Done', { inBetweenSteps: true }),
        sendChannel('b', 'youtube', 'Needs Setup', { health: 'needs_setup' }),
        sendChannel('c', 'youtube', 'Off', { disabled: true }),
        sendChannel('d', 'mastodon', 'Elsewhere', { providerName: 'Mastodon' }),
      ],
      SEND_PROVIDERS,
      { durationMs: 42_000, width: 1080, height: 1920, bytes: null },
    );
    expect(choices.map((choice) => choice.reason)).toEqual([
      'Finish setting up this channel on the Channels page first.',
      'Finish setting up this channel on the Channels page first.',
      'This channel is turned off.',
      'Mastodon cannot be posted to from here.',
    ]);
  });
});

describe('sentExport and factsOf', () => {
  it('reads the facts of the file a send posts, else the newest finished one', () => {
    const exports = [
      sendExport('new', { id: 'media-new', durationMs: 50_000 }),
      { ...sendExport('running', { id: 'media-running' }), job: sendJob('job-running', 'RUNNING') },
      sendExport('old', { id: 'media-old', durationMs: 40_000, width: 1920, height: 1080 }),
    ];
    expect(sentExport(exports, 'media-old')?.media?.id).toBe('media-old');
    expect(sentExport(exports, 'gone')?.media?.id).toBe('media-new');
    expect(sentExport(exports, null)?.media?.id).toBe('media-new');
    expect(sentExport([], 'media-old')).toBeNull();

    expect(factsOf(sentExport(exports, 'media-old'), 99_000)).toEqual({
      durationMs: 40_000,
      width: 1920,
      height: 1080,
      bytes: 26 * 1024 * 1024,
    });
    // With no file read yet, the clip's own length and nothing else.
    expect(factsOf(null, 42_000)).toEqual({
      durationMs: 42_000,
      width: null,
      height: null,
      bytes: null,
    });
  });
});

describe('captionCount and composerHref', () => {
  it('counts against the cap and builds the composer address', () => {
    expect(captionCount('')).toBe(`0 / ${CAPTION_MAX.toLocaleString('en-US')}`);
    expect(captionCount('Big moment')).toBe('10 / 3,000');
    expect(composerHref('seed-demo-org', 'group 1')).toBe(
      '/seed-demo-org/composer?group=group%201',
    );
  });
});
