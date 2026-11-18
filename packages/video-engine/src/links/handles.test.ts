import { channelListUrl, type HandleCheck, validateHandle } from './handles';
import type { ClipPlatformId } from './types';

const CHANNEL_ID = 'UCuAXFkgsw1L7xaCfnd5JJOw';

const CASES: [ClipPlatformId, string, HandleCheck][] = [
  // Twitch: 4 to 25 of a-z, 0-9 and _, lower-cased.
  ['twitch', 'Vikram_Plays', { ok: true, platform: 'twitch', handle: 'vikram_plays' }],
  ['twitch', '@vikram', { ok: true, platform: 'twitch', handle: 'vikram' }],
  ['twitch', '  acme  ', { ok: true, platform: 'twitch', handle: 'acme' }],
  ['twitch', 'https://www.twitch.tv/Vikram', { ok: true, platform: 'twitch', handle: 'vikram' }],
  [
    'twitch',
    'twitch.tv/vikram/videos?filter=archives',
    { ok: true, platform: 'twitch', handle: 'vikram' },
  ],
  [
    'twitch',
    'https://m.twitch.tv/vikram/clips',
    { ok: true, platform: 'twitch', handle: 'vikram' },
  ],
  ['twitch', 'abc', { ok: false, code: 'channel_not_found' }],
  ['twitch', 'a'.repeat(26), { ok: false, code: 'channel_not_found' }],
  ['twitch', 'vik-ram', { ok: false, code: 'channel_not_found' }],
  ['twitch', 'vik ram', { ok: false, code: 'channel_not_found' }],
  ['twitch', 'https://www.twitch.tv/directory', { ok: false, code: 'channel_not_found' }],
  [
    'twitch',
    'https://www.twitch.tv/vikram/schedule/extra',
    { ok: false, code: 'channel_not_found' },
  ],
  ['twitch', 'https://www.youtube.com/@vikram', { ok: false, code: 'channel_not_found' }],
  ['twitch', 'https://user:pw@twitch.tv/vikram', { ok: false, code: 'channel_not_found' }],
  ['twitch', 'http://twitch.tv/vikram', { ok: false, code: 'channel_not_found' }],
  ['twitch', 'https://twitch.tv.evil.example/vikram', { ok: false, code: 'channel_not_found' }],
  ['twitch', 'https://www.twitch.tv/videos/123456789', { ok: false, code: 'link_is_a_video' }],
  ['twitch', 'https://www.twitch.tv/vikram/clip/FunnySlug', { ok: false, code: 'link_is_a_video' }],
  ['twitch', 'https://youtu.be/dQw4w9WgXcQ', { ok: false, code: 'link_is_a_video' }],
  // YouTube: @ plus 3 to 30 of letters, digits, . _ -, or a UC channel id.
  ['youtube', '@Priya.Yoga', { ok: true, platform: 'youtube', handle: '@Priya.Yoga' }],
  ['youtube', 'priya-yoga', { ok: true, platform: 'youtube', handle: '@priya-yoga' }],
  [
    'youtube',
    'https://www.youtube.com/@PriyaYoga/videos',
    { ok: true, platform: 'youtube', handle: '@PriyaYoga' },
  ],
  ['youtube', 'youtube.com/@PriyaYoga', { ok: true, platform: 'youtube', handle: '@PriyaYoga' }],
  [
    'youtube',
    'https://m.youtube.com/@PriyaYoga/live',
    { ok: true, platform: 'youtube', handle: '@PriyaYoga' },
  ],
  [
    'youtube',
    CHANNEL_ID,
    { ok: true, platform: 'youtube', handle: CHANNEL_ID, channelId: CHANNEL_ID },
  ],
  [
    'youtube',
    `https://www.youtube.com/channel/${CHANNEL_ID}/streams`,
    { ok: true, platform: 'youtube', handle: CHANNEL_ID, channelId: CHANNEL_ID },
  ],
  ['youtube', '@ab', { ok: false, code: 'channel_not_found' }],
  ['youtube', `@${'a'.repeat(31)}`, { ok: false, code: 'channel_not_found' }],
  ['youtube', '@priya/yoga', { ok: false, code: 'channel_not_found' }],
  ['youtube', '@pri%ya', { ok: false, code: 'channel_not_found' }],
  ['youtube', 'https://www.youtube.com/c/LegacyName', { ok: false, code: 'channel_not_found' }],
  [
    'youtube',
    'https://www.youtube.com/playlist?list=PL123',
    { ok: false, code: 'channel_not_found' },
  ],
  [
    'youtube',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    { ok: false, code: 'link_is_a_video' },
  ],
  ['youtube', 'https://www.youtube.com/shorts/aBcDeFgHiJk', { ok: false, code: 'link_is_a_video' }],
  // Kick: letters, digits, _ and -, at most 25, lower-cased.
  ['kick', 'SimStreamer', { ok: true, platform: 'kick', handle: 'simstreamer' }],
  ['kick', 'a', { ok: true, platform: 'kick', handle: 'a' }],
  ['kick', 'sim-streamer_2', { ok: true, platform: 'kick', handle: 'sim-streamer_2' }],
  [
    'kick',
    'https://kick.com/simstreamer/clips',
    { ok: true, platform: 'kick', handle: 'simstreamer' },
  ],
  ['kick', 'kick.com/SimStreamer', { ok: true, platform: 'kick', handle: 'simstreamer' }],
  ['kick', 'a'.repeat(26), { ok: false, code: 'channel_not_found' }],
  ['kick', 'bad.name', { ok: false, code: 'channel_not_found' }],
  ['kick', 'https://kick.com/categories', { ok: false, code: 'channel_not_found' }],
  [
    'kick',
    'https://kick.com/simstreamer/videos/00000000-0000-4000-8000-000000000001',
    { ok: false, code: 'link_is_a_video' },
  ],
  // Anything.
  ['kick', '', { ok: false, code: 'channel_not_found' }],
  ['twitch', 'x'.repeat(5_000), { ok: false, code: 'channel_not_found' }],
  ['youtube', 'javascript:alert(1)', { ok: false, code: 'channel_not_found' }],
];

describe('validateHandle', () => {
  it.each(CASES)('%s %p', (platform, text, expected) => {
    expect(validateHandle(platform, text)).toEqual(expected);
  });
});

describe('channelListUrl', () => {
  it.each([
    [
      { platform: 'twitch', handle: 'acme' },
      'streams',
      'https://www.twitch.tv/acme/videos?filter=archives',
    ],
    [{ platform: 'twitch', handle: 'acme' }, 'clips', 'https://www.twitch.tv/acme/clips'],
    [{ platform: 'twitch', handle: 'acme' }, 'uploads', null],
    [{ platform: 'kick', handle: 'acme' }, 'streams', 'https://kick.com/acme/videos'],
    [{ platform: 'kick', handle: 'acme' }, 'clips', 'https://kick.com/acme/clips'],
    [{ platform: 'kick', handle: 'acme' }, 'shorts', null],
    [{ platform: 'youtube', handle: '@acme' }, 'uploads', 'https://www.youtube.com/@acme/videos'],
    [{ platform: 'youtube', handle: '@acme' }, 'streams', 'https://www.youtube.com/@acme/streams'],
    [{ platform: 'youtube', handle: '@acme' }, 'shorts', 'https://www.youtube.com/@acme/shorts'],
    [{ platform: 'youtube', handle: '@acme' }, 'clips', null],
    [
      { platform: 'youtube', handle: CHANNEL_ID, channelId: CHANNEL_ID },
      'uploads',
      `https://www.youtube.com/channel/${CHANNEL_ID}/videos`,
    ],
    [{ platform: 'twitch', handle: '../admin' }, 'streams', null],
    [{ platform: 'kick', handle: 'a/b' }, 'streams', null],
  ] as const)('%o %s is %p', (channel, kind, expected) => {
    expect(channelListUrl(channel, kind)).toBe(expected);
  });
});
