/**
 * Module 12's sites through the yt-dlp binding: the argument builder uses
 * only the entry's extractors and never the operator's cookies, every
 * recorded probe maps to a card with the site's id, a post with several
 * videos is refused, and the new failure strings map onto existing codes.
 */
import { isLinkRefusal, type LinkRef, recogniseLink, SITES } from '@postgear/video-engine';
import { resolveSimulationLink, simulationLinks } from './simulation';
import { DownloaderError } from './types';
import { assertCanonicalUrl, type YtDlpConfig, ytDlpProbeArgs } from './yt-dlp.args';
import { mapYtDlpError } from './yt-dlp.errors';
import { mapProbeJson } from './yt-dlp.probe';

const config: YtDlpConfig = {
  paths: { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe', ytDlp: 'yt-dlp', jsRuntime: null },
  cookiesFile: '/operator/cookies.txt',
};

const SPRINT_12 = new Set(['youtube', 'twitch', 'kick']);
const newLinks = simulationLinks().filter((entry) => !SPRINT_12.has(entry.platform));

function refOf(url: string): LinkRef {
  const ref = recogniseLink(url);
  if (isLinkRefusal(ref)) throw new Error(`${url} was refused: ${ref.code}`);
  return ref;
}

describe('Module 12 simulation links', () => {
  it('has at least one link for every new site', () => {
    for (const site of SITES.filter((one) => !SPRINT_12.has(one.id))) {
      expect(newLinks.some((entry) => entry.platform === site.id)).toBe(true);
    }
  });

  it.each(newLinks.map((entry) => [entry.url, entry] as const))(
    '%s is recognised as itself, with its canonical address',
    (url, entry) => {
      const ref = refOf(url);
      expect(ref).toMatchObject({ platform: entry.platform, externalId: entry.externalId });
      expect(ref.canonicalUrl).toBe(url);
      expect(assertCanonicalUrl(ref)).toBe(url);
    },
  );

  it.each(newLinks.map((entry) => [entry.url, entry] as const))(
    '%s answers through the real probe and error mappers',
    (url, entry) => {
      const ref = refOf(url);
      const answer = resolveSimulationLink(ref);
      expect(answer).not.toBeNull();
      if (answer?.type === 'error') {
        expect(entry.stderr).toBeDefined();
        expect(['link_private', 'link_not_found']).toContain(mapYtDlpError(answer.stderr));
        return;
      }
      if (answer?.type !== 'video') throw new Error('no answer');
      if (entry.refuses) {
        expect(() => mapProbeJson(answer.probeJson, ref)).toThrow(
          expect.objectContaining({ code: entry.refuses }),
        );
        return;
      }
      const { info, picks } = mapProbeJson(answer.probeJson, ref);
      expect(info).toMatchObject({
        platform: entry.platform,
        externalId: entry.externalId,
        canonicalUrl: url,
        live: false,
      });
      expect(info.title.length).toBeGreaterThan(0);
      expect(info.durationMs).toBeGreaterThan(0);
      expect(picks.length).toBeGreaterThan(0);
      expect(info.formats.some((format) => format.audioOnly)).toBe(true);
    },
  );
});

describe('the argument builder for Module 12 sites', () => {
  const onSites = SITES.filter((site) => !SPRINT_12.has(site.id) && site.extractors.length > 0);

  it.each(onSites.map((site) => [site.id, site] as const))(
    '%s uses only its own extractors and never the operator cookies',
    (id, site) => {
      const entry = newLinks.find((one) => one.platform === id);
      if (!entry) throw new Error(`no link for ${id}`);
      const args = ytDlpProbeArgs(config, refOf(entry.url), '/job/cookies.txt');
      const at = args.indexOf('--use-extractors');
      expect(args[at + 1]).toBe(site.extractors.join(','));
      expect(args).not.toContain('--cookies');
      expect(args).toContain('--no-playlist');
      expect(args[args.length - 1]).toBe(entry.url);
    },
  );

  it('keeps the operator cookies for Sprint 12 sites as before', () => {
    const args = ytDlpProbeArgs(
      config,
      refOf('https://www.youtube.com/watch?v=simtalk0001'),
      '/job/cookies.txt',
    );
    expect(args).toContain('--cookies');
  });

  it('refuses to build a call for a site with no extractor (Threads)', () => {
    const ref = refOf('https://www.threads.com/@postgearsamples/post/SimThread01');
    expect(() => ytDlpProbeArgs(config, ref, null)).toThrow(DownloaderError);
  });
});

describe('a post with several videos', () => {
  const ref = refOf('https://x.com/i/status/1900000000000000002');
  const video = {
    _type: 'video',
    id: 'one',
    extractor: 'twitter',
    title: 'One clip',
    duration: 12,
    formats: [
      {
        format_id: 'http-950',
        ext: 'mp4',
        protocol: 'https',
        vcodec: 'avc1.4D401E',
        acodec: 'mp4a.40.2',
        height: 360,
        width: 640,
        url: 'https://media.sim.invalid/a.mp4',
      },
    ],
  };

  it('is refused with its own code when it holds more than one', () => {
    expect(() =>
      mapProbeJson({ _type: 'playlist', extractor: 'twitter', entries: [video, video] }, ref),
    ).toThrow(expect.objectContaining({ code: 'link_many_videos' }));
  });

  it('reads as that video when it holds exactly one', () => {
    const { info } = mapProbeJson(
      { _type: 'playlist', extractor: 'twitter', entries: [video] },
      ref,
    );
    expect(info).toMatchObject({
      platform: 'x',
      externalId: '1900000000000000002',
      durationMs: 12_000,
    });
  });

  it('is still not a video when its one entry is a list', () => {
    expect(() =>
      mapProbeJson({ _type: 'playlist', entries: [{ _type: 'playlist', entries: [] }] }, ref),
    ).toThrow(expect.objectContaining({ code: 'link_not_a_video' }));
  });

  it('never applies to Sprint 12 sites, which keep refusing any list', () => {
    const yt = refOf('https://www.youtube.com/watch?v=simtalk0001');
    expect(() => mapProbeJson({ _type: 'playlist', entries: [video] }, yt)).toThrow(
      expect.objectContaining({ code: 'link_not_a_video' }),
    );
  });

  it('refuses an answer from another extractor than the site lists', () => {
    expect(() => mapProbeJson({ ...video, extractor: 'generic' }, ref)).toThrow(
      expect.objectContaining({ code: 'link_not_a_video' }),
    );
  });
});

describe('Module 12 failure strings', () => {
  const cases: Array<[string, string]> = [
    [
      'ERROR: [vimeo] 900000102: This video is protected by a password, use the --video-password option',
      'link_private',
    ],
    ['ERROR: [twitter] 1: NSFW tweet requires authentication. Use --cookies', 'link_private'],
    ['ERROR: [Reddit] 1simvd2: This post is marked NSFW (over 18)', 'link_private'],
    ['ERROR: [zoom] x: This recording needs a passcode', 'link_private'],
    [
      'ERROR: [Instagram] x: Requested content is not available, rate-limit reached or login required',
      'link_private',
    ],
    ['ERROR: [twitter] 1: No video could be found in this tweet', 'link_not_found'],
    ['ERROR: [zoom] x: This recording has expired', 'link_not_found'],
    ['ERROR: [dailymotion] x9sim01: This content has been deleted.', 'link_not_found'],
    ['ERROR: [TikTok] 1: Video not available, status code 10204', 'link_not_found'],
    ['ERROR: [TikTok] 1: Your IP address is blocked from accessing this post', 'platform_resting'],
  ];

  it.each(cases)('%s', (stderr, code) => {
    expect(mapYtDlpError(stderr)).toBe(code);
  });
});
