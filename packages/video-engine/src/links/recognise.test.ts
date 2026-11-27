import {
  canonicalLinkFor,
  isLinkRefusal,
  LINK_MAX_LENGTH,
  linkRefForListedItem,
  recogniseLink,
} from './recognise';
import type { LinkRef, LinkRefusalCode } from './types';

const YT = 'dQw4w9WgXcQ';
const YT_WATCH = `https://www.youtube.com/watch?v=${YT}`;
const KICK_UUID = '00000000-0000-4000-8000-000000000001';

type Expected = Pick<LinkRef, 'platform' | 'kind' | 'externalId' | 'canonicalUrl'> & {
  channel?: string;
};

const VALID: [string, Expected][] = [
  // YouTube
  [YT_WATCH, { platform: 'youtube', kind: 'video', externalId: YT, canonicalUrl: YT_WATCH }],
  [
    `https://youtube.com/watch?v=${YT}&list=PL590L5WQmH8fJ54F369BLDSqIwcs-TCfs&index=2&t=42s`,
    { platform: 'youtube', kind: 'video', externalId: YT, canonicalUrl: YT_WATCH },
  ],
  [
    `https://m.youtube.com/watch?v=${YT}&feature=share`,
    { platform: 'youtube', kind: 'video', externalId: YT, canonicalUrl: YT_WATCH },
  ],
  [
    `https://music.youtube.com/watch?v=${YT}&si=abc`,
    { platform: 'youtube', kind: 'video', externalId: YT, canonicalUrl: YT_WATCH },
  ],
  [
    `https://youtu.be/${YT}?si=XyZ123&t=10`,
    { platform: 'youtube', kind: 'video', externalId: YT, canonicalUrl: YT_WATCH },
  ],
  [
    `youtu.be/${YT}`,
    { platform: 'youtube', kind: 'video', externalId: YT, canonicalUrl: YT_WATCH },
  ],
  [
    `www.youtube.com/watch?v=${YT}`,
    { platform: 'youtube', kind: 'video', externalId: YT, canonicalUrl: YT_WATCH },
  ],
  [
    `  https://WWW.YOUTUBE.COM/watch?v=${YT}  `,
    { platform: 'youtube', kind: 'video', externalId: YT, canonicalUrl: YT_WATCH },
  ],
  [
    `https://www.youtube.com./watch?v=${YT}#comments`,
    { platform: 'youtube', kind: 'video', externalId: YT, canonicalUrl: YT_WATCH },
  ],
  [
    'https://www.youtube.com/shorts/aBcDeFgHiJk/',
    {
      platform: 'youtube',
      kind: 'short',
      externalId: 'aBcDeFgHiJk',
      canonicalUrl: 'https://www.youtube.com/shorts/aBcDeFgHiJk',
    },
  ],
  [
    'https://www.youtube.com/live/aBc-eFg_iJk?si=x',
    {
      platform: 'youtube',
      kind: 'video',
      externalId: 'aBc-eFg_iJk',
      canonicalUrl: 'https://www.youtube.com/watch?v=aBc-eFg_iJk',
    },
  ],
  [
    `https://www.youtube.com/embed/${YT}?start=30`,
    { platform: 'youtube', kind: 'video', externalId: YT, canonicalUrl: YT_WATCH },
  ],
  [
    'https://www.youtube.com/clip/UgkxU2HSeGL_NvmDJ-nQJrlLwllwMlGCnaVA',
    {
      platform: 'youtube',
      kind: 'clip',
      externalId: 'UgkxU2HSeGL_NvmDJ-nQJrlLwllwMlGCnaVA',
      canonicalUrl: 'https://www.youtube.com/clip/UgkxU2HSeGL_NvmDJ-nQJrlLwllwMlGCnaVA',
    },
  ],
  [
    'https://www.youtube.com/watch?v=simtalk0001',
    {
      platform: 'youtube',
      kind: 'video',
      externalId: 'simtalk0001',
      canonicalUrl: 'https://www.youtube.com/watch?v=simtalk0001',
    },
  ],
  // Twitch
  [
    'https://www.twitch.tv/videos/900000001',
    {
      platform: 'twitch',
      kind: 'past_stream',
      externalId: '900000001',
      canonicalUrl: 'https://www.twitch.tv/videos/900000001',
    },
  ],
  [
    'https://twitch.tv/videos/2245678901?t=1h2m3s&filter=archives',
    {
      platform: 'twitch',
      kind: 'past_stream',
      externalId: '2245678901',
      canonicalUrl: 'https://www.twitch.tv/videos/2245678901',
    },
  ],
  [
    'https://m.twitch.tv/videos/123456789',
    {
      platform: 'twitch',
      kind: 'past_stream',
      externalId: '123456789',
      canonicalUrl: 'https://www.twitch.tv/videos/123456789',
    },
  ],
  [
    'https://www.twitch.tv/vikram/v/123456789',
    {
      platform: 'twitch',
      kind: 'past_stream',
      externalId: '123456789',
      canonicalUrl: 'https://www.twitch.tv/videos/123456789',
    },
  ],
  [
    'https://go.twitch.tv/vikram/video/123456789',
    {
      platform: 'twitch',
      kind: 'past_stream',
      externalId: '123456789',
      canonicalUrl: 'https://www.twitch.tv/videos/123456789',
    },
  ],
  [
    'https://player.twitch.tv/?video=v123456789&parent=example.com',
    {
      platform: 'twitch',
      kind: 'past_stream',
      externalId: '123456789',
      canonicalUrl: 'https://www.twitch.tv/videos/123456789',
    },
  ],
  [
    'https://clips.twitch.tv/AwkwardHelplessSalamanderSwiftRage',
    {
      platform: 'twitch',
      kind: 'clip',
      externalId: 'AwkwardHelplessSalamanderSwiftRage',
      canonicalUrl: 'https://clips.twitch.tv/AwkwardHelplessSalamanderSwiftRage',
    },
  ],
  [
    'https://clips.twitch.tv/embed?clip=AwkwardHelplessSalamanderSwiftRage&parent=x',
    {
      platform: 'twitch',
      kind: 'clip',
      externalId: 'AwkwardHelplessSalamanderSwiftRage',
      canonicalUrl: 'https://clips.twitch.tv/AwkwardHelplessSalamanderSwiftRage',
    },
  ],
  [
    'https://www.twitch.tv/Vikram/clip/CleverSlickSquidCoolCat-AbCdEf12345_x?filter=clips&range=7d',
    {
      platform: 'twitch',
      kind: 'clip',
      externalId: 'CleverSlickSquidCoolCat-AbCdEf12345_x',
      canonicalUrl: 'https://clips.twitch.tv/CleverSlickSquidCoolCat-AbCdEf12345_x',
      channel: 'vikram',
    },
  ],
  // Kick
  [
    `https://kick.com/simstreamer/videos/${KICK_UUID}`,
    {
      platform: 'kick',
      kind: 'past_stream',
      externalId: KICK_UUID,
      canonicalUrl: `https://kick.com/simstreamer/videos/${KICK_UUID}`,
      channel: 'simstreamer',
    },
  ],
  [
    'https://www.kick.com/Sim_Streamer/videos/0A1B2C3D-4E5F-4A6B-8C7D-9E0F1A2B3C4D?utm_source=x',
    {
      platform: 'kick',
      kind: 'past_stream',
      externalId: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
      canonicalUrl: 'https://kick.com/sim_streamer/videos/0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
      channel: 'sim_streamer',
    },
  ],
  [
    'https://kick.com/vikram/clips/clip_01HXABCDEF0123456789',
    {
      platform: 'kick',
      kind: 'clip',
      externalId: 'clip_01HXABCDEF0123456789',
      canonicalUrl: 'https://kick.com/vikram/clips/clip_01HXABCDEF0123456789',
      channel: 'vikram',
    },
  ],
  [
    'https://kick.com/vikram?clip=clip_01HXABCDEF0123456789',
    {
      platform: 'kick',
      kind: 'clip',
      externalId: 'clip_01HXABCDEF0123456789',
      canonicalUrl: 'https://kick.com/vikram/clips/clip_01HXABCDEF0123456789',
      channel: 'vikram',
    },
  ],
];

const REFUSED: [string, LinkRefusalCode][] = [
  // Lists, channels, search and home pages.
  ['https://www.youtube.com/playlist?list=PL590L5WQmH8fJ54F369BLDSqIwcs-TCfs', 'link_not_a_video'],
  ['https://www.youtube.com/watch?list=PL590L5WQmH8fJ54F369BLDSqIwcs-TCfs', 'link_not_a_video'],
  ['https://www.youtube.com/@vikram', 'link_not_a_video'],
  ['https://www.youtube.com/@vikram/videos', 'link_not_a_video'],
  ['https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw', 'link_not_a_video'],
  ['https://www.youtube.com/c/SomeName', 'link_not_a_video'],
  ['https://www.youtube.com/results?search_query=cats', 'link_not_a_video'],
  ['https://www.youtube.com/', 'link_not_a_video'],
  ['https://youtu.be/', 'link_not_a_video'],
  ['https://www.twitch.tv/vikram', 'link_not_a_video'],
  ['https://www.twitch.tv/vikram/videos', 'link_not_a_video'],
  ['https://www.twitch.tv/vikram/clips?filter=clips', 'link_not_a_video'],
  ['https://www.twitch.tv/collections/abcDEF123', 'link_not_a_video'],
  ['https://www.twitch.tv/directory/category/just-chatting', 'link_not_a_video'],
  ['https://www.twitch.tv/videos', 'link_not_a_video'],
  ['https://www.twitch.tv/', 'link_not_a_video'],
  ['https://clips.twitch.tv/', 'link_not_a_video'],
  ['https://kick.com/vikram', 'link_not_a_video'],
  ['https://kick.com/vikram/videos', 'link_not_a_video'],
  ['https://kick.com/vikram/clips', 'link_not_a_video'],
  ['https://kick.com/', 'link_not_a_video'],
  ['https://kick.com/categories/just-chatting', 'link_not_a_video'],
  // Pages that always play what is live now.
  ['https://www.youtube.com/@vikram/live', 'link_live'],
  ['https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw/live', 'link_live'],
  ['https://player.twitch.tv/?channel=vikram&parent=example.com', 'link_live'],
  // Other sites, schemes and look-alikes.
  // Module 12 reads Vimeo; another site we do not read stands in for it.
  ['https://www.bilibili.com/video/BV1xx411c7mD', 'link_unsupported'],
  [`http://www.youtube.com/watch?v=${YT}`, 'link_unsupported'],
  [`ftp://www.youtube.com/watch?v=${YT}`, 'link_unsupported'],
  ['javascript:alert(1)', 'link_unsupported'],
  [`data:text/html,${YT_WATCH}`, 'link_unsupported'],
  [`https://youtube.com.evil.example/watch?v=${YT}`, 'link_unsupported'],
  [`https://evil-youtube.com/watch?v=${YT}`, 'link_unsupported'],
  [`https://www.yоutube.com/watch?v=${YT}`, 'link_unsupported'],
  [`https://www.youtube-nocookie.com/embed/${YT}`, 'link_unsupported'],
  [`https://user:pass@www.youtube.com/watch?v=${YT}`, 'link_unsupported'],
  [`https://www.youtube.com:8443/watch?v=${YT}`, 'link_unsupported'],
  [`https://www.youtube.com/watch?v=${YT} https://vimeo.com/1`, 'link_unsupported'],
  [`https://www.youtube.com/watch?v=${YT}\nhttps://evil.example`, 'link_unsupported'],
  ['', 'link_unsupported'],
  ['    ', 'link_unsupported'],
  ['not a link', 'link_unsupported'],
  [`https://www.youtube.com/watch?v=${'a'.repeat(LINK_MAX_LENGTH)}`, 'link_unsupported'],
  ['x'.repeat(5_000), 'link_unsupported'],
  // Our hosts, but an id that is not one.
  ['https://www.youtube.com/watch?v=dQw4w9WgXc', 'link_unsupported'],
  ['https://www.youtube.com/watch?v=dQw4w9WgXcQQ', 'link_unsupported'],
  ['https://www.youtube.com/watch?v=dQw4w9Wg$cQ', 'link_unsupported'],
  ['https://www.youtube.com/watch?v=dQw4w9WgXc%00', 'link_unsupported'],
  ['https://www.youtube.com/shorts/short', 'link_unsupported'],
  ['https://www.twitch.tv/videos/abc', 'link_unsupported'],
  ['https://www.twitch.tv/videos/1234567890123456', 'link_unsupported'],
  ['https://clips.twitch.tv/slug/extra', 'link_unsupported'],
  ['https://kick.com/vikram/videos/not-a-uuid', 'link_unsupported'],
  [`https://kick.com/video/${KICK_UUID}`, 'link_unsupported'],
  ['https://kick.com/vikram/clips/01HXABCDEF', 'link_unsupported'],
  [`https://kick.com/${'a'.repeat(26)}/videos/${KICK_UUID}`, 'link_unsupported'],
];

describe('recogniseLink', () => {
  it.each(VALID)('reads %s', (link, expected) => {
    expect(recogniseLink(link)).toEqual(expected);
  });

  it.each(REFUSED)('refuses %s', (link, code) => {
    expect(recogniseLink(link)).toEqual({ refused: true, code });
  });

  it('never returns the pasted text as the address', () => {
    for (const [link] of VALID) {
      const ref = recogniseLink(link);
      if (isLinkRefusal(ref)) {
        throw new Error(`Refused ${link}`);
      }
      // The canonical address reads back to the same video.
      const again = recogniseLink(ref.canonicalUrl);
      expect(isLinkRefusal(again)).toBe(false);
      if (!isLinkRefusal(again)) {
        expect([again.platform, again.kind, again.externalId, again.canonicalUrl]).toEqual([
          ref.platform,
          ref.kind,
          ref.externalId,
          ref.canonicalUrl,
        ]);
      }
      expect(ref.canonicalUrl).not.toMatch(/[?&](si|t|list|feature|utm_[a-z]+)=/);
    }
  });
});

describe('canonicalLinkFor', () => {
  it('builds each kind of address', () => {
    expect(canonicalLinkFor({ platform: 'youtube', kind: 'past_stream', externalId: YT })).toBe(
      YT_WATCH,
    );
    expect(canonicalLinkFor({ platform: 'twitch', kind: 'video', externalId: '42' })).toBe(
      'https://www.twitch.tv/videos/42',
    );
    expect(
      canonicalLinkFor({
        platform: 'kick',
        kind: 'clip',
        externalId: 'clip_X1',
        channel: 'Vikram',
      }),
    ).toBe('https://kick.com/vikram/clips/clip_X1');
  });

  it('refuses what has no address', () => {
    expect(
      canonicalLinkFor({ platform: 'youtube', kind: 'video', externalId: '../../etc' }),
    ).toBeNull();
    expect(canonicalLinkFor({ platform: 'twitch', kind: 'short', externalId: '42' })).toBeNull();
    expect(
      canonicalLinkFor({ platform: 'kick', kind: 'past_stream', externalId: KICK_UUID }),
    ).toBeNull();
    expect(
      canonicalLinkFor({
        platform: 'kick',
        kind: 'past_stream',
        externalId: KICK_UUID,
        channel: 'a/b',
      }),
    ).toBeNull();
    expect(
      canonicalLinkFor({
        platform: 'kick',
        kind: 'short',
        externalId: KICK_UUID,
        channel: 'vikram',
      }),
    ).toBeNull();
  });
});

describe('linkRefForListedItem', () => {
  it.each([
    [
      'twitch',
      { externalId: '900000001', kind: 'vod' },
      'past_stream',
      'https://www.twitch.tv/videos/900000001',
    ],
    [
      'twitch',
      { externalId: '900000002', kind: 'highlight' },
      'past_stream',
      'https://www.twitch.tv/videos/900000002',
    ],
    [
      'twitch',
      { externalId: '900000003', kind: 'upload' },
      'video',
      'https://www.twitch.tv/videos/900000003',
    ],
    [
      'twitch',
      { externalId: 'FunnySlug-abc', kind: 'clip', channel: 'acme' },
      'clip',
      'https://clips.twitch.tv/FunnySlug-abc',
    ],
    ['youtube', { externalId: YT, kind: 'upload' }, 'video', YT_WATCH],
    ['youtube', { externalId: YT, kind: 'vod' }, 'past_stream', YT_WATCH],
    [
      'youtube',
      { externalId: 'aBcDeFgHiJk', kind: 'short' },
      'short',
      'https://www.youtube.com/shorts/aBcDeFgHiJk',
    ],
    [
      'kick',
      { externalId: KICK_UUID, kind: 'vod', channel: 'Acme' },
      'past_stream',
      `https://kick.com/acme/videos/${KICK_UUID}`,
    ],
    [
      'kick',
      { externalId: 'clip_ABC123', kind: 'clip', channel: 'acme' },
      'clip',
      'https://kick.com/acme/clips/clip_ABC123',
    ],
  ] as const)('%s %o is a %s at %s', (platform, item, kind, url) => {
    const ref = linkRefForListedItem(platform, item);
    expect(ref).toMatchObject({ platform, kind, canonicalUrl: url });
    // The probe reads it like any pasted link.
    const read = recogniseLink(url);
    expect(isLinkRefusal(read)).toBe(false);
  });

  it('refuses a row it cannot build an address for', () => {
    expect(linkRefForListedItem('kick', { externalId: KICK_UUID, kind: 'vod' })).toBeNull();
    expect(linkRefForListedItem('twitch', { externalId: 'abc', kind: 'vod' })).toBeNull();
    expect(linkRefForListedItem('twitch', { externalId: '1', kind: 'short' })).toBeNull();
    expect(linkRefForListedItem('youtube', { externalId: 'bad id', kind: 'upload' })).toBeNull();
  });
});
