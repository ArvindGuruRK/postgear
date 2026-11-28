/**
 * Security sweep, Sprint 13 Module 16: Module 12's sites never log in.
 *
 * What must hold, beyond `sites.test.ts` ("%s uses only its own extractors
 * and never the operator cookies", the probe only):
 * - no Module 12 site is given the operator's cookies or any other login on
 *   any call: the probe, the whole download and a range fetch, whatever
 *   cookies file the job holds and whatever the config names;
 * - each uses only its own extractors: never yt-dlp's `generic` reader
 *   (which would fetch any address) and never another site's;
 * - a canonical link of one site cannot be passed off as another's.
 */
import { isLinkRefusal, type LinkRef, recogniseLink, SITES } from '@postgear/video-engine';
import {
  assertCanonicalUrl,
  type YtDlpConfig,
  ytDlpDownloadArgs,
  ytDlpProbeArgs,
} from './yt-dlp.args';

const SPRINT_12 = new Set(['youtube', 'twitch', 'kick']);

/** One link per Module 12 site that has an extractor. */
const LINKS: Record<string, string> = {
  vimeo: 'https://vimeo.com/123456789',
  rumble: 'https://rumble.com/v4abcde-postgear-sample-talk.html',
  dailymotion: 'https://www.dailymotion.com/video/x8abcde',
  loom: 'https://www.loom.com/share/0123456789abcdef0123456789abcdef',
  x: 'https://x.com/i/status/1854123456789012345',
  facebook: 'https://www.facebook.com/reel/1234567890123456',
  linkedin:
    'https://www.linkedin.com/posts/simsamples_postgear-sample-video-activity-7254123456789012345-AbCd',
  reddit: 'https://www.reddit.com/comments/1abcdef/',
  pinterest: 'https://www.pinterest.com/pin/123456789012345678/',
  zoom: 'https://zoom.us/rec/share/AbC-123_def.ghiJKL456',
  tiktok: 'https://www.tiktok.com/@postgear/video/7254123456789012345',
  instagram: 'https://www.instagram.com/reel/CzAbC123xyz/',
  dropbox: 'https://www.dropbox.com/scl/fi/abc123def456ghi/talk.mp4?rlkey=zyx987wvu654tsr&dl=0',
};

/** Every yt-dlp option that logs in or carries a login. */
const LOGIN_FLAGS = [
  '--cookies',
  '--cookies-from-browser',
  '--username',
  '-u',
  '--password',
  '-p',
  '--netrc',
  '--netrc-location',
  '--netrc-cmd',
  '--video-password',
  '--ap-mso',
  '--ap-username',
  '--ap-password',
  '--client-certificate',
  '--add-headers',
  '--add-header',
];

const config: YtDlpConfig = {
  paths: { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe', ytDlp: 'yt-dlp', jsRuntime: null },
  cookiesFile: '/operator/cookies.txt',
};

function refOf(url: string): LinkRef {
  const ref = recogniseLink(url);
  if (isLinkRefusal(ref)) throw new Error(`${url} was refused: ${ref.code}`);
  return ref;
}

const newSites = SITES.filter((site) => !SPRINT_12.has(site.id) && site.extractors.length > 0);

function everyCall(ref: LinkRef): Array<[string, string[]]> {
  const download = {
    formatIds: ['http-720'],
    outTemplate: '/scratch/job/original.%(ext)s',
    mergeFormat: 'mp4' as const,
    maxDurationSec: 3_600,
    maxBytes: 1_000_000,
    section: null,
    cookiesPath: '/scratch/job/cookies.txt',
  };
  return [
    ['probe', ytDlpProbeArgs(config, ref, '/scratch/job/cookies.txt')],
    ['download', ytDlpDownloadArgs(config, ref, download)],
    ['range', ytDlpDownloadArgs(config, ref, { ...download, section: { fromSec: 10, toSec: 40 } })],
  ];
}

describe('Module 12 sites', () => {
  it('has a link here for every one of them', () => {
    expect(Object.keys(LINKS).sort()).toEqual(newSites.map((site) => site.id).sort());
    for (const site of newSites) expect(site.operatorCookies).not.toBe(true);
  });

  it.each(newSites.map((site) => [site.id, site] as const))(
    '%s: no login on the probe, the download or a range, and only its own extractors',
    (id, site) => {
      const ref = refOf(LINKS[id] as string);
      expect(ref.platform).toBe(id);
      for (const [call, args] of everyCall(ref)) {
        for (const flag of LOGIN_FLAGS)
          expect([call, flag, args.includes(flag)]).toEqual([call, flag, false]);
        expect([call, args.some((arg) => arg.includes('cookies.txt'))]).toEqual([call, false]);
        const extractors = (args[args.indexOf('--use-extractors') + 1] ?? '').split(',');
        expect(extractors).toEqual([...site.extractors]);
        expect(extractors).not.toContain('generic');
        // Never another site's extractor.
        for (const other of SITES.filter((one) => one.id !== id)) {
          for (const name of other.extractors) expect(extractors).not.toContain(name);
        }
        expect(args).toContain('--ignore-config');
        expect(args[args.length - 1]).toBe(ref.canonicalUrl);
        expect(args[args.length - 2]).toBe('--');
      }
    },
  );

  it('Sprint 12 sites still get the cookies file on a download (the only ones that may)', () => {
    const ref = refOf('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    const [, , range] = everyCall(ref);
    expect(range?.[1]).toContain('--cookies');
  });

  it.each(newSites.map((site) => [site.id] as const))(
    "%s: its canonical link cannot be passed off as another site's",
    (id) => {
      const ref = refOf(LINKS[id] as string);
      for (const platform of ['youtube', 'twitch', 'kick'] as const) {
        expect(() => assertCanonicalUrl({ ...ref, platform })).toThrow();
      }
    },
  );
});
