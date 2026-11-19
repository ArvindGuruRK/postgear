/**
 * Security sweep, "Links" (Sprint 12, Module 20 section 1), the last gate.
 *
 * What must hold: only the canonical address rebuilt from a video's id
 * reaches yt-dlp for an import or a download. The API builds it with
 * `recogniseLink` (tested in `packages/video-engine/src/links/recognise.test.ts`);
 * this checks that the downloader's own gate, `assertCanonicalUrl`, refuses
 * anything else even on an allowed host, so a job input that was built
 * wrongly can never point yt-dlp at a list, another video or a page.
 */
import { canonicalLinkFor, type LinkRef } from '@postgear/video-engine';
import { DownloaderError } from './types';
import { assertCanonicalUrl, ytDlpDownloadArgs, ytDlpProbeArgs } from './yt-dlp.args';

const paths = { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe', ytDlp: 'yt-dlp', jsRuntime: null };
const config = { paths };

const YT = 'dQw4w9WgXcQ';
const KICK_UUID = '00000000-0000-4000-8000-000000000001';

const youtube: LinkRef = {
  platform: 'youtube',
  kind: 'video',
  externalId: YT,
  canonicalUrl: `https://www.youtube.com/watch?v=${YT}`,
};
const twitch: LinkRef = {
  platform: 'twitch',
  kind: 'past_stream',
  externalId: '900000001',
  canonicalUrl: 'https://www.twitch.tv/videos/900000001',
};
const twitchClip: LinkRef = {
  platform: 'twitch',
  kind: 'clip',
  externalId: 'BraveSlugName-abc123',
  canonicalUrl: 'https://clips.twitch.tv/BraveSlugName-abc123',
};
const kick: LinkRef = {
  platform: 'kick',
  kind: 'past_stream',
  externalId: KICK_UUID,
  canonicalUrl: `https://kick.com/simstreamer/videos/${KICK_UUID}`,
  channel: 'simstreamer',
};

describe('the downloader gate', () => {
  it('passes the address recognition rebuilds from the id, and only that', () => {
    for (const link of [youtube, twitch, twitchClip, kick]) {
      expect(canonicalLinkFor(link)).toBe(link.canonicalUrl);
      expect(assertCanonicalUrl(link)).toBe(link.canonicalUrl);
    }
  });

  const onAllowedHosts: Array<[string, LinkRef]> = [
    [
      'another video on the same host',
      { ...youtube, canonicalUrl: 'https://www.youtube.com/watch?v=aaaaaaaaaaa' },
    ],
    [
      'the same video with a playlist',
      {
        ...youtube,
        canonicalUrl: `https://www.youtube.com/watch?v=${YT}&list=PL590L5WQmH8fJ54F369BLDSqIwcs-TCfs`,
      },
    ],
    [
      'a playlist page',
      {
        ...youtube,
        canonicalUrl: 'https://www.youtube.com/playlist?list=PL590L5WQmH8fJ54F369BLDSqIwcs-TCfs',
      },
    ],
    ['a channel page', { ...youtube, canonicalUrl: 'https://www.youtube.com/@vikram/videos' }],
    ['a search', { ...youtube, canonicalUrl: 'https://www.youtube.com/results?search_query=cats' }],
    ['a live page', { ...youtube, canonicalUrl: 'https://www.youtube.com/@vikram/live' }],
    [
      'a short link with extra parameters',
      { ...youtube, canonicalUrl: `https://youtu.be/${YT}?t=10` },
    ],
    ['a Twitch channel list', { ...twitch, canonicalUrl: 'https://www.twitch.tv/vikram/videos' }],
    [
      'a Twitch collection',
      { ...twitch, canonicalUrl: 'https://www.twitch.tv/collections/abcDEF123' },
    ],
    ['another Twitch video', { ...twitch, canonicalUrl: 'https://www.twitch.tv/videos/900000002' }],
    ['a Kick channel list', { ...kick, canonicalUrl: 'https://kick.com/simstreamer/videos' }],
    [
      'a Kick video on another id',
      {
        ...kick,
        canonicalUrl: 'https://kick.com/simstreamer/videos/00000000-0000-4000-8000-000000000002',
      },
    ],
    ['a platform mismatch', { ...twitch, canonicalUrl: youtube.canonicalUrl }],
    ['a fragment', { ...youtube, canonicalUrl: `${youtube.canonicalUrl}#t=1` }],
  ];

  it.each(onAllowedHosts)('refuses %s, even on an allowed host', (_name, link) => {
    expect(() => assertCanonicalUrl(link)).toThrow(DownloaderError);
    expect(() => ytDlpProbeArgs(config, link, null)).toThrow(DownloaderError);
    expect(() =>
      ytDlpDownloadArgs(config, link, {
        formatIds: ['137'],
        outTemplate: '/scratch/media.%(ext)s',
        mergeFormat: 'mp4',
        maxDurationSec: null,
        maxBytes: null,
        section: null,
        cookiesPath: null,
      }),
    ).toThrow(DownloaderError);
  });

  it('refuses other schemes, credentials, ports, look-alikes and very long input', () => {
    for (const canonicalUrl of [
      `http://www.youtube.com/watch?v=${YT}`,
      `https://user:pass@www.youtube.com/watch?v=${YT}`,
      `https://www.youtube.com:8443/watch?v=${YT}`,
      `https://www.youtube.com.evil.example/watch?v=${YT}`,
      `https://www.yоutube.com/watch?v=${YT}`,
      `file:///etc/passwd`,
      `ytsearch1:${YT}`,
      `https://www.youtube.com/watch?v=${YT}${'&x=1'.repeat(1_000)}`,
    ]) {
      expect(() => assertCanonicalUrl({ ...youtube, canonicalUrl })).toThrow(DownloaderError);
    }
  });
});
