import type { LinkRef } from '@postgear/video-engine';
import kickStream from '../../fixtures/ytdlp/probe-kick-stream.json';
import twitchStream from '../../fixtures/ytdlp/probe-twitch-stream.json';
import youtubeTalk from '../../fixtures/ytdlp/probe-youtube-talk.json';
import { DownloaderError } from './types';
import { chooseVideo, mapProbeJson, pickFormats } from './yt-dlp.probe';

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

function withFields(base: unknown, fields: Record<string, unknown>): unknown {
  return { ...(base as Record<string, unknown>), ...fields };
}

describe('mapProbeJson', () => {
  it('maps the YouTube talk: facts, H.264 per height with AAC, one audio entry, the heat map', () => {
    const { info, picks, sectionMs } = mapProbeJson(youtubeTalk, youtube);
    expect(info).toMatchObject({
      platform: 'youtube',
      kind: 'video',
      externalId: 'simtalk0001',
      canonicalUrl: 'https://www.youtube.com/watch?v=simtalk0001',
      title: 'PostGear Sample: A Three Minute Talk',
      channelName: 'PostGear Samples',
      durationMs: 180_000,
      live: false,
      thumbnailUrl: 'https://img.sim.invalid/vi/simtalk0001/maxresdefault.jpg',
    });
    expect(sectionMs).toBeNull();
    expect(info.formats.map((format) => format.id)).toEqual([
      'h1080',
      'h720',
      'h480',
      'h360',
      'audio',
    ]);
    expect(info.formats[0]).toEqual({
      id: 'h1080',
      label: '1080p',
      height: 1080,
      fps: 30,
      ext: 'mp4',
      bytes: 54_470_000 + 2_913_000,
      audioOnly: false,
    });
    // VP9 never wins over H.264; video-only streams are merged with AAC.
    expect(picks[0]?.ytDlpIds).toEqual(['137', '140']);
    expect(picks[1]?.ytDlpIds).toEqual(['136', '140']);
    // The muxed 360p stream beats a video-only one, and an approximate size is not a fact.
    expect(picks[3]?.ytDlpIds).toEqual(['18']);
    expect(info.formats[3]?.bytes).toBeNull();
    expect(picks[4]).toMatchObject({ ytDlpIds: ['140'], audioFromVideo: false, aacAudio: true });
    expect(info.formats[4]).toEqual({
      id: 'audio',
      label: 'Audio Only',
      height: null,
      fps: null,
      ext: 'm4a',
      bytes: 2_913_000,
      audioOnly: true,
    });
    expect(info.replayed).toEqual([
      { startMs: 0, endMs: 30_000, value: 0.2 },
      { startMs: 30_000, endMs: 36_000, value: 1 },
      { startMs: 36_000, endMs: 90_000, value: 0.3 },
      { startMs: 90_000, endMs: 100_000, value: 0.8 },
      { startMs: 100_000, endMs: 180_000, value: 0.25 },
    ]);
    // No yt-dlp selector or format id ever reaches a LinkFormat.
    for (const format of info.formats) expect(format.id).toMatch(/^(h\d+|audio)$/);
  });

  it('maps the Twitch stream: storyboards and AV1 dropped, HLS playlists kept for the slicer, three qualities and audio', () => {
    const { info, picks } = mapProbeJson(twitchStream, twitch);
    expect(info.kind).toBe('past_stream');
    expect(info.durationMs).toBe(600_000);
    expect(info.channelName).toBe('Acme');
    expect(info.formats.map((format) => format.label)).toEqual([
      '1080p 60 fps',
      '720p 60 fps',
      '480p',
      'Audio Only',
    ]);
    expect(picks[0]).toMatchObject({
      ytDlpIds: ['1080p60'],
      hls: true,
      url: 'https://cdn.sim.invalid/vod/900000001/chunked/index-dvr.m3u8',
    });
    // Only allowlisted headers are kept.
    expect(picks[0]?.httpHeaders).toEqual({
      'User-Agent': 'Mozilla/5.0 (PostGear simulation)',
      Accept: '*/*',
    });
    expect(picks.at(-1)).toMatchObject({ ytDlpIds: ['Audio_Only'], audioFromVideo: false });
  });

  it('maps the Kick stream and takes its sound from the smallest video when there is no audio-only file', () => {
    const { info, picks } = mapProbeJson(kickStream, kick);
    expect(info.channel).toBe('simstreamer');
    expect(info.formats.map((format) => format.id)).toEqual(['h1080', 'h720', 'h360', 'audio']);
    expect(picks.at(-1)).toMatchObject({
      ytDlpIds: ['hls-360p30'],
      audioFromVideo: true,
      aacAudio: true,
    });
    expect(picks[0]?.httpHeaders).toEqual({
      'User-Agent': 'Mozilla/5.0 (PostGear simulation)',
      Referer: 'https://kick.com/',
    });
  });

  it('reports a live stream as live (the API refuses it), with no length', () => {
    const { info } = mapProbeJson(
      withFields(twitchStream, { duration: null, is_live: true, live_status: 'is_live' }),
      twitch,
    );
    expect(info.live).toBe(true);
    expect(info.durationMs).toBe(0);
    for (const status of ['is_upcoming', 'post_live']) {
      expect(
        mapProbeJson(withFields(twitchStream, { live_status: status }), twitch).info.live,
      ).toBe(true);
    }
  });

  it('turns a finished YouTube live stream into a past stream', () => {
    const { info } = mapProbeJson(withFields(youtubeTalk, { live_status: 'was_live' }), youtube);
    expect(info.kind).toBe('past_stream');
  });

  it('refuses lists, wrong extractors and gated videos', () => {
    const expectCode = (json: unknown, link: LinkRef, code: string): void => {
      try {
        mapProbeJson(json, link);
        throw new Error('expected a refusal');
      } catch (error) {
        expect(error).toBeInstanceOf(DownloaderError);
        expect((error as DownloaderError).code).toBe(code);
      }
    };
    expectCode({ _type: 'playlist', id: 'PL1', entries: [] }, youtube, 'link_not_a_video');
    expectCode(withFields(youtubeTalk, { extractor: 'youtube:tab' }), youtube, 'link_not_a_video');
    expectCode(withFields(youtubeTalk, { extractor: 'generic' }), youtube, 'link_not_a_video');
    expectCode(withFields(youtubeTalk, { availability: 'private' }), youtube, 'link_private');
    expectCode(
      withFields(youtubeTalk, { availability: 'subscriber_only' }),
      youtube,
      'link_private',
    );
    expectCode(withFields(youtubeTalk, { age_limit: 18 }), youtube, 'link_private');
    expectCode(withFields(youtubeTalk, { duration: null }), youtube, 'tool_failed');
    expectCode(withFields(youtubeTalk, { formats: [] }), youtube, 'tool_failed');
    expectCode('not json', youtube, 'tool_failed');
  });

  it('uses a YouTube clip range as the length', () => {
    const clip: LinkRef = {
      ...youtube,
      kind: 'clip',
      externalId: 'UgkxSimClip',
      canonicalUrl: 'https://www.youtube.com/clip/UgkxSimClip',
    };
    const { info, sectionMs } = mapProbeJson(
      withFields(youtubeTalk, { extractor: 'youtube:clip', section_start: 30.5, section_end: 45 }),
      clip,
    );
    expect(sectionMs).toEqual({ fromMs: 30_500, toMs: 45_000 });
    expect(info.durationMs).toBe(14_500);
    expect(info.kind).toBe('clip');
  });

  it('keeps titles and names to plain one-line text', () => {
    const { info } = mapProbeJson(
      withFields(youtubeTalk, { title: 'Line\none\u0007 ', channel: '', uploader: 'Up' }),
      youtube,
    );
    expect(info.title).toBe('Line one');
    expect(info.channelName).toBe('Up');
    expect(mapProbeJson(withFields(youtubeTalk, { title: '   ' }), youtube).info.title).toBe(
      'Untitled video',
    );
  });

  it('never returns a thumbnail that is not https', () => {
    const { info } = mapProbeJson(
      withFields(youtubeTalk, {
        thumbnail: 'http://x/y.jpg',
        thumbnails: [{ url: 'javascript:alert(1)' }],
      }),
      youtube,
    );
    expect(info.thumbnailUrl).toBeNull();
  });
});

describe('pickFormats and chooseVideo', () => {
  it('drops ids that could carry selector syntax and portrait copies', () => {
    const picks = pickFormats([
      { format_id: 'best[height<=720]', vcodec: 'avc1', acodec: 'mp4a', height: 720 },
      { format_id: 'portrait-720', vcodec: 'avc1', acodec: 'mp4a', height: 720 },
      { format_id: '720', vcodec: 'avc1.4d', acodec: 'mp4a.40.2', height: 720, fps: 30 },
      { not: 'a format' },
    ]);
    expect(picks.map((pick) => pick.ytDlpIds)).toEqual([['720'], ['720']]);
  });

  it('keeps a Twitch clip whose codecs are unknown', () => {
    const picks = pickFormats([
      {
        format_id: '1080',
        height: 1080,
        ext: 'mp4',
        protocol: 'https',
        url: 'https://clips.sim.invalid/a.mp4',
      },
    ]);
    expect(picks.map((pick) => pick.format.id)).toEqual(['h1080', 'audio']);
    expect(picks[1]?.audioFromVideo).toBe(true);
  });

  it('chooses the tallest rendition at or below the cap, else the smallest', () => {
    const { picks } = mapProbeJson(twitchStream, twitch);
    expect(chooseVideo(picks, 720)?.format.id).toBe('h720');
    expect(chooseVideo(picks, 1080)?.format.id).toBe('h1080');
    expect(chooseVideo(picks, 600)?.format.id).toBe('h480');
    expect(chooseVideo(picks, 240)?.format.id).toBe('h480');
    expect(chooseVideo([], 720)).toBeNull();
  });
});
