import { canonicalLinkFor, isLinkRefusal, recogniseLink } from './recognise';
import { DEFAULT_ON_SITES, SITES, siteById, siteForHost } from './sites';
import { CLIP_PLATFORMS, type LinkRef, PLATFORM_NAMES } from './types';

describe('the sites table', () => {
  it('has one entry per platform id, in the same order, with the same names', () => {
    expect(SITES.map((site) => site.id)).toEqual([...CLIP_PLATFORMS]);
    for (const site of SITES) expect(site.name).toBe(PLATFORM_NAMES[site.id]);
  });

  it('has unique ids and lower-case hosts that belong to one site only', () => {
    expect(new Set(SITES.map((site) => site.id)).size).toBe(SITES.length);
    const seen = new Map<string, string>();
    for (const site of SITES) {
      for (const host of [...site.hosts, ...(site.shortHosts ?? [])]) {
        expect(host).toBe(host.toLowerCase());
        expect(seen.get(host)).toBeUndefined();
        seen.set(host, site.id);
        expect(siteForHost(host)?.id).toBe(site.id);
      }
      for (const extractor of site.extractors) expect(extractor).toBe(extractor.toLowerCase());
    }
  });

  it('switches on the ten sites of D13-08 and keeps four built but off', () => {
    expect(DEFAULT_ON_SITES).toEqual([
      'youtube',
      'twitch',
      'kick',
      'vimeo',
      'rumble',
      'dailymotion',
      'loom',
      'x',
      'facebook',
      'linkedin',
      'reddit',
      'pinterest',
    ]);
    for (const id of ['threads', 'zoom', 'tiktok', 'instagram', 'dropbox']) {
      expect(siteById(id)?.defaultOn).toBe(false);
      expect(siteById(id)?.notes).toBeTruthy();
    }
  });

  it('keeps Sprint 12 sites on their hand-written readers', () => {
    for (const id of ['youtube', 'twitch', 'kick']) expect(siteById(id)?.shapes).toEqual([]);
  });

  it('gives every site that is on an extractor; Threads has none yet', () => {
    for (const site of SITES) {
      if (site.defaultOn) expect(site.extractors.length).toBeGreaterThan(0);
    }
    expect(siteById('threads')?.extractors).toEqual([]);
  });

  it('only matches a sub-host of a suffix, never the suffix glued to another name', () => {
    expect(siteForHost('us02web.zoom.us')?.id).toBe('zoom');
    expect(siteForHost('evilzoom.us')).toBeUndefined();
    expect(siteForHost('.zoom.us')).toBeUndefined();
  });
});

type Want = Pick<LinkRef, 'platform' | 'kind' | 'externalId' | 'canonicalUrl'> & {
  channel?: string;
};

const VIMEO = 'https://vimeo.com/123456789';
const X_POST = 'https://x.com/i/status/1854123456789012345';
const FB_WATCH = 'https://www.facebook.com/watch/?v=1234567890123456';
const LI = 'simsamples_postgear-sample-video-activity-7254123456789012345-AbCd';
const REDDIT = 'https://www.reddit.com/comments/1abcdef/';

const VALID: [string, Want][] = [
  // Vimeo
  [VIMEO, { platform: 'vimeo', kind: 'video', externalId: '123456789', canonicalUrl: VIMEO }],
  [
    'vimeo.com/123456789?share=copy',
    { platform: 'vimeo', kind: 'video', externalId: '123456789', canonicalUrl: VIMEO },
  ],
  [
    'https://vimeo.com/123456789/abcdef1234',
    {
      platform: 'vimeo',
      kind: 'video',
      externalId: '123456789/abcdef1234',
      canonicalUrl: 'https://vimeo.com/123456789/abcdef1234',
    },
  ],
  [
    'https://player.vimeo.com/video/123456789?h=abcdef1234&badge=0',
    {
      platform: 'vimeo',
      kind: 'video',
      externalId: '123456789/abcdef1234',
      canonicalUrl: 'https://vimeo.com/123456789/abcdef1234',
    },
  ],
  [
    'https://vimeo.com/channels/staffpicks/123456789',
    { platform: 'vimeo', kind: 'video', externalId: '123456789', canonicalUrl: VIMEO },
  ],
  // Rumble
  [
    'https://rumble.com/v4abcde-postgear-sample-talk.html?mref=abc',
    {
      platform: 'rumble',
      kind: 'video',
      externalId: 'v4abcde-postgear-sample-talk',
      canonicalUrl: 'https://rumble.com/v4abcde-postgear-sample-talk.html',
    },
  ],
  // Dailymotion
  [
    'https://www.dailymotion.com/video/x8abcde',
    {
      platform: 'dailymotion',
      kind: 'video',
      externalId: 'x8abcde',
      canonicalUrl: 'https://www.dailymotion.com/video/x8abcde',
    },
  ],
  [
    'https://dai.ly/x8abcde',
    {
      platform: 'dailymotion',
      kind: 'video',
      externalId: 'x8abcde',
      canonicalUrl: 'https://www.dailymotion.com/video/x8abcde',
    },
  ],
  [
    'https://geo.dailymotion.com/player.html?video=x8abcde',
    {
      platform: 'dailymotion',
      kind: 'video',
      externalId: 'x8abcde',
      canonicalUrl: 'https://www.dailymotion.com/video/x8abcde',
    },
  ],
  // Loom
  [
    'https://www.loom.com/share/0123456789abcdef0123456789abcdef?sid=1',
    {
      platform: 'loom',
      kind: 'video',
      externalId: '0123456789abcdef0123456789abcdef',
      canonicalUrl: 'https://www.loom.com/share/0123456789abcdef0123456789abcdef',
    },
  ],
  // X
  [
    'https://x.com/postgear/status/1854123456789012345?s=20',
    { platform: 'x', kind: 'video', externalId: '1854123456789012345', canonicalUrl: X_POST },
  ],
  [
    'https://twitter.com/postgear/status/1854123456789012345/video/1',
    { platform: 'x', kind: 'video', externalId: '1854123456789012345', canonicalUrl: X_POST },
  ],
  [
    'https://mobile.twitter.com/i/web/status/1854123456789012345',
    { platform: 'x', kind: 'video', externalId: '1854123456789012345', canonicalUrl: X_POST },
  ],
  // Facebook
  [
    FB_WATCH,
    { platform: 'facebook', kind: 'video', externalId: '1234567890123456', canonicalUrl: FB_WATCH },
  ],
  [
    'https://www.facebook.com/postgear/videos/1234567890123456/',
    { platform: 'facebook', kind: 'video', externalId: '1234567890123456', canonicalUrl: FB_WATCH },
  ],
  [
    'https://m.facebook.com/postgear/videos/a-title/1234567890123456',
    { platform: 'facebook', kind: 'video', externalId: '1234567890123456', canonicalUrl: FB_WATCH },
  ],
  [
    'https://www.facebook.com/reel/1234567890123456',
    {
      platform: 'facebook',
      kind: 'short',
      externalId: '1234567890123456',
      canonicalUrl: 'https://www.facebook.com/reel/1234567890123456',
    },
  ],
  // LinkedIn
  [
    `https://www.linkedin.com/posts/${LI}?utm_source=share`,
    {
      platform: 'linkedin',
      kind: 'video',
      externalId: LI,
      canonicalUrl: `https://www.linkedin.com/posts/${LI}`,
    },
  ],
  // Reddit
  [
    'https://www.reddit.com/r/videos/comments/1abcdef/a_post_title/',
    { platform: 'reddit', kind: 'video', externalId: '1abcdef', canonicalUrl: REDDIT },
  ],
  [
    'https://old.reddit.com/r/videos/comments/1abcdef',
    { platform: 'reddit', kind: 'video', externalId: '1abcdef', canonicalUrl: REDDIT },
  ],
  [
    'https://redd.it/1abcdef',
    { platform: 'reddit', kind: 'video', externalId: '1abcdef', canonicalUrl: REDDIT },
  ],
  // Pinterest
  [
    'https://in.pinterest.com/pin/123456789012345678/',
    {
      platform: 'pinterest',
      kind: 'video',
      externalId: '123456789012345678',
      canonicalUrl: 'https://www.pinterest.com/pin/123456789012345678/',
    },
  ],
  // Threads (built, off)
  [
    'https://www.threads.net/@postgear/post/DAbC123xyz_',
    {
      platform: 'threads',
      kind: 'video',
      externalId: 'DAbC123xyz_',
      channel: 'postgear',
      canonicalUrl: 'https://www.threads.com/@postgear/post/DAbC123xyz_',
    },
  ],
  // Zoom (built, off)
  [
    'https://us02web.zoom.us/rec/share/AbC-123_def.ghiJKL456?startTime=1',
    {
      platform: 'zoom',
      kind: 'video',
      externalId: 'AbC-123_def.ghiJKL456',
      canonicalUrl: 'https://zoom.us/rec/share/AbC-123_def.ghiJKL456',
    },
  ],
  // TikTok (built, off)
  [
    'https://www.tiktok.com/@postgear/video/7254123456789012345?lang=en',
    {
      platform: 'tiktok',
      kind: 'short',
      externalId: '7254123456789012345',
      channel: 'postgear',
      canonicalUrl: 'https://www.tiktok.com/@postgear/video/7254123456789012345',
    },
  ],
  // Instagram (built, off)
  [
    'https://www.instagram.com/reel/CzAbC123xyz/?igsh=1',
    {
      platform: 'instagram',
      kind: 'short',
      externalId: 'CzAbC123xyz',
      canonicalUrl: 'https://www.instagram.com/reel/CzAbC123xyz/',
    },
  ],
  [
    'https://www.instagram.com/p/CzAbC123xyz/',
    {
      platform: 'instagram',
      kind: 'video',
      externalId: 'CzAbC123xyz',
      canonicalUrl: 'https://www.instagram.com/p/CzAbC123xyz/',
    },
  ],
  // Dropbox (built, off)
  [
    'https://www.dropbox.com/scl/fi/abc123def456ghi/talk.mp4?rlkey=zyx987wvu654tsr&dl=0',
    {
      platform: 'dropbox',
      kind: 'video',
      externalId: 'abc123def456ghi~zyx987wvu654tsr',
      channel: 'talk.mp4',
      canonicalUrl:
        'https://www.dropbox.com/scl/fi/abc123def456ghi/talk.mp4?rlkey=zyx987wvu654tsr&dl=0',
    },
  ],
  [
    'https://www.dropbox.com/s/abc123def456ghi/talk.mp4?dl=1',
    {
      platform: 'dropbox',
      kind: 'video',
      externalId: 'abc123def456ghi',
      channel: 'talk.mp4',
      canonicalUrl: 'https://www.dropbox.com/s/abc123def456ghi/talk.mp4?dl=0',
    },
  ],
];

const REFUSED: [string, string][] = [
  // Pages of a site that are not one video.
  ['https://vimeo.com/postgear', 'link_not_a_video'],
  ['https://vimeo.com/channels/staffpicks', 'link_not_a_video'],
  ['https://www.loom.com/share/folder/0123456789abcdef0123456789abcdef', 'link_not_a_video'],
  ['https://x.com/postgear', 'link_not_a_video'],
  ['https://x.com/postgear/status/1854123456789012345/photo/1/extra', 'link_not_a_video'],
  ['https://www.facebook.com/postgear', 'link_not_a_video'],
  ['https://www.linkedin.com/in/someone', 'link_not_a_video'],
  ['https://www.reddit.com/r/videos/', 'link_not_a_video'],
  ['https://www.pinterest.com/postgear/sample-board/', 'link_not_a_video'],
  ['https://www.tiktok.com/@postgear', 'link_not_a_video'],
  ['https://www.instagram.com/postgear/', 'link_not_a_video'],
  ['https://www.dropbox.com/scl/fi/abc123def456ghi/talk.mp4', 'link_not_a_video'],
  ['https://www.dropbox.com/home', 'link_not_a_video'],
  // Short links cannot be read without following them.
  ['https://fb.watch/abcDEF123/', 'link_unsupported'],
  ['https://pin.it/1AbCdEf', 'link_unsupported'],
  ['https://vm.tiktok.com/ZMabcdef/', 'link_unsupported'],
  ['https://t.co/AbCdEf123', 'link_unsupported'],
  // Look-alikes and bad ids.
  ['https://vimeo.com.evil.example/123456789', 'link_unsupported'],
  ['https://evilvimeo.com/123456789', 'link_unsupported'],
  ['http://vimeo.com/123456789', 'link_unsupported'],
  ['https://vimeo.com/123456789/NOTHEX', 'link_not_a_video'],
  ['https://www.dailymotion.com/video/../../x8abcde', 'link_not_a_video'],
  ['https://x.com/i/status/notanumber', 'link_not_a_video'],
  ['https://www.reddit.com/r/videos/comments/AB$CD/', 'link_not_a_video'],
  ['https://evil.zoom.us.example/rec/share/AbC-123_def.ghiJKL456', 'link_unsupported'],
  [
    'https://www.dropbox.com/scl/fi/abc123def456ghi/notes.txt?rlkey=zyx987wvu654tsr',
    'link_not_a_video',
  ],
];

describe('recogniseLink on Module 12 sites', () => {
  it.each(VALID)('reads %s', (link, want) => {
    expect(recogniseLink(link)).toEqual(want);
  });

  it.each(REFUSED)('refuses %s', (link, code) => {
    const got = recogniseLink(link);
    expect(isLinkRefusal(got) ? got.code : got).toBe(code);
  });

  it.each(VALID)('reads its own canonical address back the same (%s)', (_link, want) => {
    const again = recogniseLink(want.canonicalUrl);
    expect(again).toEqual(want);
    expect(canonicalLinkFor(want)).toBe(want.canonicalUrl);
  });

  it('names Riverside and StreamYard, which have no extractor, so the sentence says to upload', () => {
    expect(recogniseLink('https://riverside.fm/studio/abc/recordings/xyz')).toEqual({
      refused: true,
      code: 'link_upload_only',
      site: 'Riverside',
    });
    expect(recogniseLink('https://streamyard.com/watch/AbCdEf')).toEqual({
      refused: true,
      code: 'link_upload_only',
      site: 'StreamYard',
    });
  });

  it('builds no address for an id or channel that fails its pattern', () => {
    expect(canonicalLinkFor({ platform: 'vimeo', kind: 'video', externalId: '../1' })).toBeNull();
    expect(
      canonicalLinkFor({ platform: 'tiktok', kind: 'short', externalId: '7254123456789012345' }),
    ).toBeNull();
    expect(
      canonicalLinkFor({
        platform: 'tiktok',
        kind: 'short',
        externalId: '7254123456789012345',
        channel: 'a/b',
      }),
    ).toBeNull();
    expect(
      canonicalLinkFor({ platform: 'reddit', kind: 'clip', externalId: '1abcdef' }),
    ).toBeNull();
  });
});
