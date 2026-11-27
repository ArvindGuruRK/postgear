/**
 * Sites as data (Sprint 13 Module 12, D13-08). One entry per site a link can
 * come from: its name, its exact hosts, the yt-dlp extractors it may use,
 * whether it is on by default, and (for the sites added in Module 12) the
 * link shapes it reads.
 *
 * Sprint 12's three sites (YouTube, Twitch, Kick) keep their hand-written
 * readers in `recognise.ts`, behaviour unchanged: their entries here carry
 * the hosts, extractors and switch only (`shapes` is empty). A new site is
 * one entry with its shapes, one recorded probe fixture and one test file.
 *
 * Rules every shape follows (Sprint 12 research 04, and the same rule as the
 * three first sites):
 * - only exact hosts; a link pasted without a scheme is read as `https`;
 * - the id is checked against a strict pattern, and the address yt-dlp is
 *   given is rebuilt from it (`canonical`), never the pasted text, so
 *   tracking parameters and extra paths are dropped by construction;
 * - a page of the site that is not one video (a profile, a board, a folder,
 *   a channel) answers `link_not_a_video`;
 * - no shape reads anything that needs a login: that is refused by the
 *   probe with the private sentence.
 *
 * Shapes were written against yt-dlp 2026.10.26's extractor list, read from
 * the worker image with `yt-dlp --list-extractors` (no network). Threads has
 * no extractor in that build, so its entry is written and stays off.
 *
 * Pure: the `URL` global only.
 */
import type { ClipPlatformId, LinkKind } from './types';

/** What a shape found in a link: the id, and the second part some addresses need. */
export interface ShapeMatch {
  id: string;
  channel?: string;
}

export interface SiteShape {
  kind: LinkKind;
  /** Reads a link's path parts and query; null when this shape does not fit. */
  match: (parts: readonly string[], url: URL) => ShapeMatch | null;
  /** The id this shape's canonical address is built from. */
  idPattern: RegExp;
  /** Set when the canonical address also needs `channel`. */
  channelPattern?: RegExp;
  /** The one address yt-dlp is given. Must read back to the same id through `match`. */
  canonical: (id: string, channel?: string) => string;
}

export interface SiteEntry {
  id: ClipPlatformId;
  /** Shown to people: "Vimeo". */
  name: string;
  /** Exact hosts, lower case. */
  hosts: readonly string[];
  /** Hosts that are short links (`fb.watch`, `pin.it`): we cannot read one without following it, so they are refused. */
  shortHosts?: readonly string[];
  /** Any sub-host of these is the site too (Zoom's `us02web.zoom.us`). */
  hostSuffixes?: readonly string[];
  /** The yt-dlp extractor names (lower case) a probe or fetch of this site may use. Empty: no extractor exists. */
  extractors: readonly string[];
  /** Per-site yt-dlp `--extractor-args` (quirks as data, never scattered ifs). */
  extractorArgs?: string;
  /** In `CLIPS_PLATFORMS`'s default. */
  defaultOn: boolean;
  /**
   * May use the operator's `YTDLP_COOKIES_FILE` (Sprint 12's three sites, for
   * YouTube's bot checks). Never set on a Module 12 site: no site uses a login.
   */
  operatorCookies?: boolean;
  /** Kinds this site's links can be. */
  shapes: readonly SiteShape[];
  /** Why it is off by default; shown to operators only. */
  notes?: string;
}

// --- Patterns ---------------------------------------------------------------------

const DIGITS = (min: number, max: number) => new RegExp(`^\\d{${min},${max}}$`);
const VIMEO_ID = /^\d{1,12}$/;
const VIMEO_HASH = /^[0-9a-f]{6,20}$/;
/** Ids are at most 128 characters (the probe answer's limit), so slugs are capped. */
const RUMBLE_SLUG = /^v[a-z0-9]{4,10}(?:-[a-z0-9-]{1,110})?$/;
const DAILYMOTION_ID = /^x[a-z0-9]{4,12}$/;
const LOOM_ID = /^[0-9a-f]{32}$/;
const X_ID = DIGITS(5, 20);
const X_USER = /^[A-Za-z0-9_]{1,15}$/;
const FACEBOOK_ID = DIGITS(5, 20);
const LINKEDIN_SLUG = /^[A-Za-z0-9_%-]{1,100}-\d{15,20}-[A-Za-z0-9_-]{4}$/;
const REDDIT_ID = /^[a-z0-9]{4,10}$/;
const PINTEREST_ID = DIGITS(5, 20);
const THREADS_CODE = /^[A-Za-z0-9_-]{6,20}$/;
const THREADS_USER = /^[a-z0-9._]{1,30}$/;
const ZOOM_ID = /^[A-Za-z0-9_.-]{10,120}$/;
const TIKTOK_ID = DIGITS(10, 22);
const TIKTOK_USER = /^[a-z0-9._]{2,24}$/;
const INSTAGRAM_CODE = /^[A-Za-z0-9_-]{5,40}$/;
const DROPBOX_ID = /^[a-z0-9]{10,30}$/;
const DROPBOX_KEY = /^[a-z0-9]{10,40}$/;
/** A Dropbox file name: letters, digits and a few safe marks, ending in a video type. */
const DROPBOX_NAME = /^[A-Za-z0-9_.()-]{1,58}\.(?:mp4|mov|m4v|mkv|webm)$/i;

/** One path of exactly these parts; `null` in the list means "the id goes here". */
function exactly(...pattern: (string | null)[]) {
  return (parts: readonly string[]): string | null => {
    if (parts.length !== pattern.length) return null;
    let id: string | null = null;
    for (let i = 0; i < pattern.length; i += 1) {
      const want = pattern[i];
      const part = parts[i] as string;
      if (want === null) id = part;
      else if (part.toLowerCase() !== want) return null;
    }
    return id;
  };
}

function tested(id: string | null, pattern: RegExp): ShapeMatch | null {
  return id !== null && pattern.test(id) ? { id } : null;
}

// --- The sites --------------------------------------------------------------------

const YOUTUBE: SiteEntry = {
  id: 'youtube',
  name: 'YouTube',
  hosts: ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'],
  extractors: ['youtube', 'youtube:clip'],
  defaultOn: true,
  operatorCookies: true,
  shapes: [],
};

const TWITCH: SiteEntry = {
  id: 'twitch',
  name: 'Twitch',
  hosts: [
    'twitch.tv',
    'www.twitch.tv',
    'm.twitch.tv',
    'go.twitch.tv',
    'clips.twitch.tv',
    'player.twitch.tv',
  ],
  extractors: ['twitch:vod', 'twitch:clips'],
  defaultOn: true,
  operatorCookies: true,
  shapes: [],
};

const KICK: SiteEntry = {
  id: 'kick',
  name: 'Kick',
  hosts: ['kick.com', 'www.kick.com'],
  extractors: ['kick:vod', 'kick:clip'],
  defaultOn: true,
  operatorCookies: true,
  shapes: [],
};

const VIMEO: SiteEntry = {
  id: 'vimeo',
  name: 'Vimeo',
  hosts: ['vimeo.com', 'www.vimeo.com', 'player.vimeo.com'],
  extractors: ['vimeo'],
  defaultOn: true,
  shapes: [
    {
      // vimeo.com/123, vimeo.com/123/abcdef (unlisted: the hash is part of the id),
      // vimeo.com/channels/<name>/123, player.vimeo.com/video/123?h=abcdef
      kind: 'video',
      match: (parts, url) => {
        let id: string | undefined;
        let hash: string | null = null;
        if (parts.length === 1) id = parts[0];
        else if (parts.length === 2 && VIMEO_ID.test(parts[0] as string)) {
          id = parts[0];
          hash = parts[1] as string;
        } else if (parts.length === 2 && parts[0] === 'video') {
          id = parts[1];
          hash = url.searchParams.get('h');
        } else if (parts.length === 3 && parts[0] === 'channels') id = parts[2];
        if (id === undefined || !VIMEO_ID.test(id)) return null;
        if (hash !== null && !VIMEO_HASH.test(hash)) return null;
        return { id: hash === null ? id : `${id}/${hash}` };
      },
      idPattern: /^\d{1,12}(?:\/[0-9a-f]{6,20})?$/,
      canonical: (id) => `https://vimeo.com/${id}`,
    },
  ],
};

const RUMBLE: SiteEntry = {
  id: 'rumble',
  name: 'Rumble',
  hosts: ['rumble.com', 'www.rumble.com'],
  extractors: ['rumble', 'rumbleembed'],
  defaultOn: true,
  shapes: [
    {
      // rumble.com/v4abcde-some-title.html
      kind: 'video',
      match: (parts) => {
        const page = parts.length === 1 ? (parts[0] as string) : null;
        if (page === null || !page.endsWith('.html')) return null;
        return tested(page.slice(0, -5).toLowerCase(), RUMBLE_SLUG);
      },
      idPattern: RUMBLE_SLUG,
      canonical: (id) => `https://rumble.com/${id}.html`,
    },
  ],
};

const DAILYMOTION: SiteEntry = {
  id: 'dailymotion',
  name: 'Dailymotion',
  hosts: ['dailymotion.com', 'www.dailymotion.com', 'dai.ly', 'geo.dailymotion.com'],
  extractors: ['dailymotion'],
  defaultOn: true,
  shapes: [
    {
      // dailymotion.com/video/x8abcde, dai.ly/x8abcde, geo.dailymotion.com/player.html?video=x8abcde
      kind: 'video',
      match: (parts, url) => {
        if (url.hostname === 'dai.ly') return tested(exactly(null)(parts), DAILYMOTION_ID);
        if (parts.length === 1 && parts[0] === 'player.html') {
          return tested(url.searchParams.get('video'), DAILYMOTION_ID);
        }
        const id = exactly('video', null)(parts) ?? exactly('embed', 'video', null)(parts);
        // A pasted id may carry the old title slug: x8abcde_some-title.
        return tested(id === null ? null : (id.split('_')[0] as string), DAILYMOTION_ID);
      },
      idPattern: DAILYMOTION_ID,
      canonical: (id) => `https://www.dailymotion.com/video/${id}`,
    },
  ],
};

const LOOM: SiteEntry = {
  id: 'loom',
  name: 'Loom',
  hosts: ['loom.com', 'www.loom.com'],
  extractors: ['loom'],
  defaultOn: true,
  shapes: [
    {
      // loom.com/share/<32 hex>, loom.com/embed/<32 hex>. A folder (share/folder/...) is not one video.
      kind: 'video',
      match: (parts) =>
        tested(exactly('share', null)(parts) ?? exactly('embed', null)(parts), LOOM_ID),
      idPattern: LOOM_ID,
      canonical: (id) => `https://www.loom.com/share/${id}`,
    },
  ],
};

const X: SiteEntry = {
  id: 'x',
  name: 'X',
  hosts: [
    'x.com',
    'www.x.com',
    'twitter.com',
    'www.twitter.com',
    'mobile.twitter.com',
    'mobile.x.com',
  ],
  shortHosts: ['t.co'],
  extractors: ['twitter'],
  defaultOn: true,
  shapes: [
    {
      // x.com/<user>/status/<id>, x.com/i/status/<id>, x.com/i/web/status/<id>, with or without /video/1
      kind: 'video',
      match: (parts) => {
        let at = parts.indexOf('status');
        if (at < 0) return null;
        const before = parts.slice(0, at);
        const okBefore =
          (before.length === 1 && (before[0] === 'i' || X_USER.test(before[0] as string))) ||
          (before.length === 2 && before[0] === 'i' && before[1] === 'web');
        if (!okBefore) return null;
        at += 1;
        const rest = parts.slice(at + 1);
        const okRest =
          rest.length === 0 ||
          (rest.length === 2 &&
            (rest[0] === 'video' || rest[0] === 'photo') &&
            /^\d$/.test(rest[1] as string));
        return okRest ? tested(parts[at] ?? null, X_ID) : null;
      },
      idPattern: X_ID,
      canonical: (id) => `https://x.com/i/status/${id}`,
    },
  ],
};

const FACEBOOK: SiteEntry = {
  id: 'facebook',
  name: 'Facebook',
  hosts: ['facebook.com', 'www.facebook.com', 'm.facebook.com', 'web.facebook.com'],
  shortHosts: ['fb.watch', 'fb.me'],
  extractors: ['facebook', 'facebook:reel'],
  defaultOn: true,
  shapes: [
    {
      // facebook.com/reel/<id>
      kind: 'short',
      match: (parts) => tested(exactly('reel', null)(parts), FACEBOOK_ID),
      idPattern: FACEBOOK_ID,
      canonical: (id) => `https://www.facebook.com/reel/${id}`,
    },
    {
      // facebook.com/watch/?v=<id>, facebook.com/<page>/videos/<id>, facebook.com/<page>/videos/<title>/<id>
      kind: 'video',
      match: (parts, url) => {
        if (parts.length === 1 && parts[0] === 'watch') {
          return tested(url.searchParams.get('v'), FACEBOOK_ID);
        }
        if (parts.length >= 3 && parts.length <= 4 && parts[1] === 'videos') {
          return tested(parts[parts.length - 1] as string, FACEBOOK_ID);
        }
        return null;
      },
      idPattern: FACEBOOK_ID,
      canonical: (id) => `https://www.facebook.com/watch/?v=${id}`,
    },
  ],
};

const LINKEDIN: SiteEntry = {
  id: 'linkedin',
  name: 'LinkedIn',
  hosts: ['linkedin.com', 'www.linkedin.com'],
  shortHosts: ['lnkd.in'],
  extractors: ['linkedin'],
  defaultOn: true,
  shapes: [
    {
      // linkedin.com/posts/<author>_<words>-activity-<id>-<four>. yt-dlp reads only this
      // address, so the whole slug is the id.
      kind: 'video',
      match: (parts) => tested(exactly('posts', null)(parts), LINKEDIN_SLUG),
      idPattern: LINKEDIN_SLUG,
      canonical: (id) => `https://www.linkedin.com/posts/${id}`,
    },
  ],
};

const REDDIT: SiteEntry = {
  id: 'reddit',
  name: 'Reddit',
  hosts: [
    'reddit.com',
    'www.reddit.com',
    'old.reddit.com',
    'new.reddit.com',
    'm.reddit.com',
    'redd.it',
  ],
  extractors: ['reddit'],
  defaultOn: true,
  shapes: [
    {
      // reddit.com/r/<sub>/comments/<id>/<slug>/, reddit.com/comments/<id>, redd.it/<id>
      kind: 'video',
      match: (parts, url) => {
        if (url.hostname === 'redd.it') return tested(exactly(null)(parts), REDDIT_ID);
        let rest = parts;
        if ((rest[0] === 'r' || rest[0] === 'user') && rest.length >= 2) rest = rest.slice(2);
        if (rest[0] !== 'comments' || rest.length < 2 || rest.length > 3) return null;
        return tested((rest[1] as string).toLowerCase(), REDDIT_ID);
      },
      idPattern: REDDIT_ID,
      canonical: (id) => `https://www.reddit.com/comments/${id}/`,
    },
  ],
};

const PINTEREST_HOSTS = [
  'pinterest.com',
  'www.pinterest.com',
  'in.pinterest.com',
  'uk.pinterest.com',
  'pinterest.co.uk',
  'www.pinterest.co.uk',
  'pinterest.ca',
  'www.pinterest.ca',
  'pinterest.com.au',
  'www.pinterest.com.au',
  'pinterest.de',
  'www.pinterest.de',
  'pinterest.fr',
  'www.pinterest.fr',
];

const PINTEREST: SiteEntry = {
  id: 'pinterest',
  name: 'Pinterest',
  hosts: PINTEREST_HOSTS,
  shortHosts: ['pin.it'],
  extractors: ['pinterest'],
  defaultOn: true,
  shapes: [
    {
      // pinterest.com/pin/<id>/ (a board, /<user>/<board>/, is not one video)
      kind: 'video',
      match: (parts) => tested(exactly('pin', null)(parts), PINTEREST_ID),
      idPattern: PINTEREST_ID,
      canonical: (id) => `https://www.pinterest.com/pin/${id}/`,
    },
  ],
};

const THREADS: SiteEntry = {
  id: 'threads',
  name: 'Threads',
  hosts: ['threads.net', 'www.threads.net', 'threads.com', 'www.threads.com'],
  extractors: [],
  defaultOn: false,
  notes:
    'yt-dlp 2026.10.26 has no Threads extractor. The entry is written; switch it on once one exists.',
  shapes: [
    {
      // threads.com/@<user>/post/<code>
      kind: 'video',
      match: (parts) => {
        const [user, post, code] = parts;
        if (parts.length !== 3 || post !== 'post' || !user?.startsWith('@')) return null;
        const channel = user.slice(1).toLowerCase();
        if (!THREADS_USER.test(channel) || !THREADS_CODE.test(code as string)) return null;
        return { id: code as string, channel };
      },
      idPattern: THREADS_CODE,
      channelPattern: THREADS_USER,
      canonical: (id, channel) => `https://www.threads.com/@${channel}/post/${id}`,
    },
  ],
};

const ZOOM: SiteEntry = {
  id: 'zoom',
  name: 'Zoom',
  hosts: ['zoom.us'],
  hostSuffixes: ['.zoom.us'],
  extractors: ['zoom'],
  defaultOn: false,
  notes: 'Cloud recording share links often need a passcode. Off until tried for real (D13-08).',
  shapes: [
    {
      // <any>.zoom.us/rec/share/<id>, /rec/play/<id>
      kind: 'video',
      match: (parts) =>
        tested(
          exactly('rec', 'share', null)(parts) ?? exactly('rec', 'play', null)(parts),
          ZOOM_ID,
        ),
      idPattern: ZOOM_ID,
      canonical: (id) => `https://zoom.us/rec/share/${id}`,
    },
  ],
};

const TIKTOK: SiteEntry = {
  id: 'tiktok',
  name: 'TikTok',
  hosts: ['tiktok.com', 'www.tiktok.com', 'm.tiktok.com'],
  shortHosts: ['vm.tiktok.com', 'vt.tiktok.com'],
  extractors: ['tiktok'],
  defaultOn: false,
  notes:
    'Links break often and the site changes its protection. Off until tried for real (D13-08).',
  shapes: [
    {
      // tiktok.com/@<user>/video/<id>
      kind: 'short',
      match: (parts) => {
        const [user, video, id] = parts;
        if (parts.length !== 3 || video !== 'video' || !user?.startsWith('@')) return null;
        const channel = user.slice(1).toLowerCase();
        if (!TIKTOK_USER.test(channel) || !TIKTOK_ID.test(id as string)) return null;
        return { id: id as string, channel };
      },
      idPattern: TIKTOK_ID,
      channelPattern: TIKTOK_USER,
      canonical: (id, channel) => `https://www.tiktok.com/@${channel}/video/${id}`,
    },
  ],
};

const INSTAGRAM: SiteEntry = {
  id: 'instagram',
  name: 'Instagram',
  hosts: ['instagram.com', 'www.instagram.com'],
  extractors: ['instagram'],
  defaultOn: false,
  notes: 'Most posts need a login, and we never use one. Off until tried for real (D13-08).',
  shapes: [
    {
      // instagram.com/reel/<code>/, /reels/<code>/
      kind: 'short',
      match: (parts) =>
        tested(exactly('reel', null)(parts) ?? exactly('reels', null)(parts), INSTAGRAM_CODE),
      idPattern: INSTAGRAM_CODE,
      canonical: (id) => `https://www.instagram.com/reel/${id}/`,
    },
    {
      // instagram.com/p/<code>/, /tv/<code>/
      kind: 'video',
      match: (parts) =>
        tested(exactly('p', null)(parts) ?? exactly('tv', null)(parts), INSTAGRAM_CODE),
      idPattern: INSTAGRAM_CODE,
      canonical: (id) => `https://www.instagram.com/p/${id}/`,
    },
  ],
};

const DROPBOX: SiteEntry = {
  id: 'dropbox',
  name: 'Dropbox',
  hosts: ['dropbox.com', 'www.dropbox.com'],
  extractors: ['dropbox'],
  defaultOn: false,
  notes: 'Shared file links. Off until tried for real (D13-08).',
  shapes: [
    {
      // dropbox.com/scl/fi/<id>/<name>?rlkey=<key>: the key is part of the id, or the link does not open.
      kind: 'video',
      match: (parts, url) => {
        const [scl, fi, id, name] = parts;
        if (parts.length !== 4 || scl !== 'scl' || fi !== 'fi') return null;
        const key = url.searchParams.get('rlkey');
        if (!DROPBOX_ID.test(id as string) || key === null || !DROPBOX_KEY.test(key)) return null;
        if (!DROPBOX_NAME.test(name as string)) return null;
        return { id: `${id}~${key}`, channel: name as string };
      },
      idPattern: /^[a-z0-9]{10,30}~[a-z0-9]{10,40}$/,
      channelPattern: DROPBOX_NAME,
      canonical: (id, channel) => {
        const [file, key] = id.split('~');
        return `https://www.dropbox.com/scl/fi/${file}/${channel}?rlkey=${key}&dl=0`;
      },
    },
    {
      // dropbox.com/s/<id>/<name> (the older shared link; its id has no key, which tells the two apart)
      kind: 'video',
      match: (parts) => {
        const [s, id, name] = parts;
        if (parts.length !== 3 || s !== 's') return null;
        if (!DROPBOX_ID.test(id as string) || !DROPBOX_NAME.test(name as string)) return null;
        return { id: id as string, channel: name as string };
      },
      idPattern: DROPBOX_ID,
      channelPattern: DROPBOX_NAME,
      canonical: (id, channel) => `https://www.dropbox.com/s/${id}/${channel}?dl=0`,
    },
  ],
};

/** Every site, in the order the page lists them. */
export const SITES: readonly SiteEntry[] = Object.freeze([
  YOUTUBE,
  TWITCH,
  KICK,
  VIMEO,
  RUMBLE,
  DAILYMOTION,
  LOOM,
  X,
  FACEBOOK,
  LINKEDIN,
  REDDIT,
  PINTEREST,
  THREADS,
  ZOOM,
  TIKTOK,
  INSTAGRAM,
  DROPBOX,
]);

const BY_ID = new Map<string, SiteEntry>(SITES.map((site) => [site.id, site]));

/** The entry for a site id, or undefined. */
export function siteById(id: string): SiteEntry | undefined {
  return BY_ID.get(id);
}

/** The ids in `CLIPS_PLATFORMS`'s default: every site that is on by default. */
export const DEFAULT_ON_SITES: readonly ClipPlatformId[] = Object.freeze(
  SITES.filter((site) => site.defaultOn).map((site) => site.id),
);

/** The site a host belongs to, or undefined. Exact hosts, then sub-hosts of a suffix. */
export function siteForHost(host: string): SiteEntry | undefined {
  for (const site of SITES) {
    if (site.hosts.includes(host) || site.shortHosts?.includes(host)) return site;
    if (site.hostSuffixes?.some((suffix) => host.endsWith(suffix) && host.length > suffix.length)) {
      return site;
    }
  }
  return undefined;
}

/**
 * Sites with no extractor at all (D13-08): their links cannot be read, so
 * the sentence says to upload the file and names the site.
 */
export const UPLOAD_ONLY_SITES: Readonly<Record<string, string>> = Object.freeze({
  'riverside.fm': 'Riverside',
  'www.riverside.fm': 'Riverside',
  'riverside.com': 'Riverside',
  'www.riverside.com': 'Riverside',
  'streamyard.com': 'StreamYard',
  'www.streamyard.com': 'StreamYard',
});
